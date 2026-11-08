/// <reference lib="webworker" />
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, TextStreamer, env } from '@huggingface/transformers';
import { STOP_TOKEN_TEXTS, type TemplateMessage } from './toolFormats';
import type { OpenAiTool } from '../mcp/types';

// Everything runs in this worker so a long prompt never freezes the page.

export type ToWorker =
  | { type: 'load'; id: number; repo: string; dtype: 'q4' }
  | { type: 'generate'; id: number; messages: TemplateMessage[]; tools: OpenAiTool[]; maxNewTokens: number; temperature: number | null; maxPromptTokens: number }
  | { type: 'interrupt' };

export type FromWorker =
  | { type: 'progress'; id: number; loaded: number; total: number; file: string }
  | { type: 'loaded'; id: number; device: 'webgpu' | 'wasm' }
  | { type: 'token'; id: number; text: string }
  | { type: 'done'; id: number; promptTokens: number; newTokens: number }
  | { type: 'error'; id: number; message: string };

// The ONNX runtime's WebAssembly is bundled with the app (Vite emits both files as hashed assets), so only the model
// weights come from the network. Transformers.js would otherwise fetch the runtime from a CDN.
env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};

type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;

let tokenizer: Tokenizer | null = null;
let model: Model | null = null;
let loadedRepo = '';
let currentDevice: 'webgpu' | 'wasm' = 'wasm';
const stopper = new InterruptableStoppingCriteria();
const send = (m: FromWorker) => self.postMessage(m);

async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return 'webgpu';
  } catch {
    /* no WebGPU */
  }
  return 'wasm';
}

async function load(id: number, repo: string, dtype: 'q4') {
  if (model && loadedRepo === repo) {
    send({ type: 'loaded', id, device: currentDevice });
    return;
  }
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    send({ type: 'progress', id, loaded, total, file: p.file });
  };
  currentDevice = await pickDevice();
  tokenizer = await AutoTokenizer.from_pretrained(repo, { progress_callback });
  model = await AutoModelForCausalLM.from_pretrained(repo, { dtype, device: currentDevice, progress_callback });
  loadedRepo = repo;
  send({ type: 'loaded', id, device: currentDevice });
}

async function generate(m: Extract<ToWorker, { type: 'generate' }>) {
  if (!tokenizer || !model) throw new Error('The model is not loaded.');
  // enable_thinking is read by the Qwen template (the others ignore it); the library's option type does not list it.
  const options = { tools: m.tools, add_generation_prompt: true, tokenize: false, enable_thinking: false };
  const prompt = tokenizer.apply_chat_template(m.messages, options) as string;
  const inputs = tokenizer(prompt, { add_special_tokens: false });
  const promptTokens = inputs.input_ids.dims[1] ?? 0;
  if (promptTokens > m.maxPromptTokens) {
    throw new Error(`The conversation is ${promptTokens.toLocaleString()} tokens, over the ${m.maxPromptTokens.toLocaleString()} this model accepts. Start a new chat, or keep "Compact catalog for the model" on.`);
  }
  // Stop on every end-of-turn token the vocabulary has; Qwen would otherwise run on past <|im_end|> and invent the tool result.
  const eos: number[] = [];
  for (const t of STOP_TOKEN_TEXTS) {
    const id = tokenizer.convert_tokens_to_ids(t);
    if (typeof id === 'number' && tokenizer.decode([id], { skip_special_tokens: false }) === t) eos.push(id);
  }
  stopper.reset();
  // Special tokens are kept: the tool-call markers are special tokens, and the caller needs them to find a call.
  const streamer = new TextStreamer(tokenizer, { skip_prompt: true, skip_special_tokens: false, callback_function: (text: string) => send({ type: 'token', id: m.id, text }) });
  const sampling = m.temperature !== null && m.temperature > 0;
  const out = (await model.generate({
    ...inputs,
    max_new_tokens: m.maxNewTokens,
    do_sample: sampling,
    ...(eos.length ? { eos_token_id: eos } : {}),
    ...(sampling ? { temperature: m.temperature as number, top_k: 50 } : {}),
    streamer,
    stopping_criteria: stopper,
  })) as { dims: number[] };
  send({ type: 'done', id: m.id, promptTokens, newTokens: (out.dims[1] ?? promptTokens) - promptTokens });
}

// One job at a time; a request that arrives while another runs waits its turn.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'interrupt') {
    stopper.interrupt();
    return;
  }
  queue = queue.then(async () => {
    try {
      if (msg.type === 'load') await load(msg.id, msg.repo, msg.dtype);
      else await generate(msg);
    } catch (err) {
      send({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
