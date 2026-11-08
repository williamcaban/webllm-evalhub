import { ModelHttpError, type ModelHooks, type ModelReply, type ModelRequest } from '../llm';
import { findBrowserModel, type BrowserModelSpec } from './catalog';
import { parseReply, partialToolName, sanitizeCalls, stripStopTokens, toolCallMarker, toTemplateMessages, toToolCalls, ToolCallSyntaxError } from './toolFormats';
import type { FromWorker, ToWorker } from './worker';

export interface BrowserModelState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Catalog key of the model that is loading or loaded. */
  key: string;
  /** Bytes of weights fetched so far, and the total once known. */
  loaded: number;
  total: number;
  device: 'webgpu' | 'wasm' | '';
  error: string;
}

const IDLE: BrowserModelState = { status: 'idle', key: '', loaded: 0, total: 0, device: '', error: '' };

/** The weights are fetched once and kept by the browser (Cache API); this reports whether the page can run a model at all. */
export const hasWebGpu = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator;

/** Raised when the browser model fails. It is a ModelHttpError so the agent retries a malformed tool call the same way. */
export class BrowserModelError extends ModelHttpError {
  constructor(message: string, toolParse = false) {
    super(message, 500, toolParse);
  }
}

const MAX_NEW_TOKENS = 1536;

let worker: Worker | null = null;
let state: BrowserModelState = IDLE;
let nextId = 1;
let pendingLoad: { key: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();
const handlers = new Map<number, (m: FromWorker) => void>();

const set = (patch: Partial<BrowserModelState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
export const getState = (): BrowserModelState => state;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<FromWorker>) => handlers.get(e.data.id)?.(e.data);
  worker.onerror = (e) => {
    const message = e.message || 'The model worker crashed.';
    for (const h of handlers.values()) h({ type: 'error', id: -1, message });
    worker?.terminate();
    worker = null;
    pendingLoad = null;
    set({ ...IDLE, status: 'error', error: message });
  };
  return worker;
}

const post = (m: ToWorker) => getWorker().postMessage(m);

/** Starts downloading and loading a model (a no-op if it is loaded or already loading). */
export function loadBrowserModel(spec: BrowserModelSpec): Promise<void> {
  if (state.status === 'ready' && state.key === spec.key) return Promise.resolve();
  if (pendingLoad?.key === spec.key) return pendingLoad.promise;
  const id = nextId++;
  set({ ...IDLE, status: 'loading', key: spec.key });
  const promise = new Promise<void>((resolve, reject) => {
    handlers.set(id, (m) => {
      if (m.type === 'progress') set({ loaded: m.loaded, total: m.total });
      else if (m.type === 'loaded') { handlers.delete(id); set({ status: 'ready', device: m.device, error: '' }); resolve(); }
      else if (m.type === 'error') { handlers.delete(id); reject(new BrowserModelError(m.message)); }
    });
    post({ type: 'load', id, repo: spec.repo, dtype: spec.dtype });
  });
  pendingLoad = { key: spec.key, promise };
  promise.then(
    () => { if (pendingLoad?.promise === promise) pendingLoad = null; },
    (e: unknown) => {
      if (pendingLoad?.promise === promise) pendingLoad = null;
      set({ ...IDLE, status: 'error', key: spec.key, error: e instanceof Error ? e.message : String(e) });
    },
  );
  return promise;
}

/** One line for the status strip while the model is not yet answering. */
export function browserLoadHint(): string {
  if (state.status !== 'loading') return '';
  const mb = (n: number) => (n / 1e6).toFixed(0);
  return state.total > 0
    ? `Downloading the model into this browser: ${mb(state.loaded)} of ${mb(state.total)} MB. It is cached afterwards, so this happens once.`
    : 'Loading the model into this browser…';
}

const abortError = () => new DOMException('Aborted', 'AbortError');

/** The in-browser counterpart of chatCompletion: same inputs, same ModelReply, no network after the first download. */
export async function browserCompletion(req: ModelRequest, hooks: ModelHooks, signal: AbortSignal): Promise<ModelReply> {
  const spec = findBrowserModel(req.model.trim());
  if (!spec) throw new Error(`"${req.model}" is not an in-browser model. Pick one in the Model list.`);
  if (signal.aborted) throw abortError();
  await Promise.race([
    loadBrowserModel(spec),
    new Promise<never>((_r, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true })),
  ]);

  const id = nextId++;
  const marker = toolCallMarker(spec.format);
  let raw = '';
  let announced = '';
  return new Promise<ModelReply>((resolve, reject) => {
    const finish = () => { handlers.delete(id); signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { post({ type: 'interrupt' }); finish(); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    handlers.set(id, (m) => {
      if (m.type === 'token') {
        raw += m.text;
        const cut = raw.indexOf(marker);
        // Show the answer as it is written, but never the tool-call markup that follows it.
        const visible = stripStopTokens(cut >= 0 ? raw.slice(0, cut) : raw);
        if (visible.trim()) hooks.onContent?.(m.text, visible);
        const name = partialToolName(spec.format, raw);
        if (name && name !== announced) { announced = name; hooks.onToolName?.(name); }
      } else if (m.type === 'done') {
        finish();
        try {
          const parsed = parseReply(spec.format, raw, req.tools);
          resolve({ text: parsed.text, reasoning: '', toolCalls: toToolCalls(sanitizeCalls(parsed.calls, req.tools)) });
        } catch (e) {
          if (!(e instanceof ToolCallSyntaxError)) return reject(e);
          reject(new BrowserModelError(`The model wrote a tool call that could not be read (${e.message.slice(0, 200)}).`, true));
        }
      } else if (m.type === 'error') {
        finish();
        if (/OrtRun|GPUBuffer|WebGPU|device (was )?lost/i.test(m.message)) {
          // The GPU runtime is unusable after this (a lost device). Start a fresh worker on the next request; the weights are cached.
          worker?.terminate();
          worker = null;
          pendingLoad = null;
          set({ ...IDLE });
          reject(new BrowserModelError(`${m.message.slice(0, 300)}\n\nThe GPU stopped responding, possibly from too long a prompt. Press Retry: the model reloads from the browser cache.`));
          return;
        }
        reject(new BrowserModelError(m.message));
      }
    });
    post({
      type: 'generate',
      id,
      messages: toTemplateMessages(spec.format, req.system, req.messages),
      tools: req.tools,
      maxNewTokens: MAX_NEW_TOKENS,
      temperature: req.temperature,
      maxPromptTokens: spec.contextTokens,
    });
  });
}
