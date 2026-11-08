import { useCallback, useReducer, useRef, useState } from 'react';
import { runAgentTurn, type AssistantHandle, type ChatSink, type ToolHandle } from '../lib/agent';
import type { McpConnection, OpenAiTool } from '../lib/mcp/types';
import type { ActivityState, ApprovalVerdict, ChatItem, ChatMessage, ReasoningState, Secrets, Settings } from '../types';

/** What a turn needs from the rest of the app; passed per call so the hook never holds stale settings. */
export interface TurnContext {
  settings: Settings;
  secrets: Secrets;
  mcp: McpConnection | null;
  tools: OpenAiTool[];
}

type Action =
  | { type: 'add'; item: ChatItem }
  | { type: 'update'; id: number; update: (item: ChatItem) => ChatItem }
  | { type: 'remove'; id: number }
  | { type: 'reset' };

function reducer(items: ChatItem[], action: Action): ChatItem[] {
  switch (action.type) {
    case 'add': return [...items, action.item];
    case 'update': return items.map((it) => (it.id === action.id ? action.update(it) : it));
    case 'remove': return items.filter((it) => it.id !== action.id);
    case 'reset': return [];
  }
}

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>;
type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

function appendReasoning(prev: ReasoningState | null, delta: string): ReasoningState {
  if (!prev) return { text: delta, live: true, startedAt: Date.now(), elapsedMs: 0, timed: true };
  // Thinking can resume after a pause (for example around a tool call): keep one block and one clock.
  return { ...prev, text: prev.text + delta, live: true };
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function useChat() {
  const [items, dispatch] = useReducer(reducer, []);
  const [activity, setActivityState] = useState<ActivityState | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const approvals = useRef(new Map<number, (verdict: ApprovalVerdict) => void>());

  const add = useCallback((item: DistributiveOmit<ChatItem, 'id'>): number => {
    const id = nextId.current++;
    dispatch({ type: 'add', item: { ...item, id } as ChatItem });
    return id;
  }, []);

  const notify = useCallback((kind: 'note' | 'error', text: string, who = 'error') => {
    if (kind === 'note') add({ kind: 'note', text });
    else add({ kind: 'error', text, who, retryable: false });
  }, [add]);

  const makeAssistant = useCallback((): AssistantHandle => {
    const id = add({ kind: 'assistant', text: '', pending: '', reasoning: null });
    const update = (fn: (it: AssistantItem) => AssistantItem) =>
      dispatch({ type: 'update', id, update: (it) => (it.kind === 'assistant' ? fn(it) : it) });
    // Token-rate updates are coalesced to one render per animation frame.
    let reasoningBuffer = '';
    let textBuffer: string | null = null;
    let frame = 0;
    let hasReasoning = false;
    const flush = () => {
      frame = 0;
      if (reasoningBuffer) {
        const delta = reasoningBuffer;
        reasoningBuffer = '';
        update((it) => ({ ...it, reasoning: appendReasoning(it.reasoning, delta) }));
      }
      if (textBuffer !== null) {
        const text = textBuffer;
        textBuffer = null;
        update((it) => ({ ...it, text, pending: '' }));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };
    const stopLive = (timed: boolean) =>
      update((it) => (it.reasoning?.live ? { ...it, reasoning: { ...it.reasoning, live: false, timed, elapsedMs: Date.now() - it.reasoning.startedAt } } : it));
    return {
      setPending: (label) => update((it) => ({ ...it, pending: label })),
      clearPending: () => update((it) => ({ ...it, pending: '' })),
      setText: (text) => { textBuffer = text; schedule(); },
      addReasoning: (delta) => { hasReasoning = true; reasoningBuffer += delta; schedule(); },
      reasoningDone: (timed = true) => {
        if (frame) cancelAnimationFrame(frame);
        flush();
        stopLive(timed);
      },
      hasReasoning: () => hasReasoning,
      finish: (hasText) => {
        if (frame) cancelAnimationFrame(frame);
        flush();
        stopLive(true);
        update((it) => ({ ...it, pending: '' }));
        if (!hasText && !hasReasoning) dispatch({ type: 'remove', id });
      },
    };
  }, [add]);

  const makeTool = useCallback((name: string, args: unknown): ToolHandle => {
    const id = add({ kind: 'tool', name, args, status: 'pending', label: 'pending', startedAt: 0, tookMs: 0, result: null, sentChars: null, approval: 'none' });
    const update = (fn: (it: ToolItem) => ToolItem) =>
      dispatch({ type: 'update', id, update: (it) => (it.kind === 'tool' ? fn(it) : it) });
    return {
      setStatus: (status, label) => update((it) => {
        const now = Date.now();
        return {
          ...it, status, label: label ?? status,
          startedAt: status === 'running' ? now : it.startedAt,
          tookMs: (status === 'ok' || status === 'error') && it.startedAt ? now - it.startedAt : it.tookMs,
        };
      }),
      setResult: (text, sentChars) => update((it) => ({ ...it, result: text, sentChars: sentChars ?? null })),
      requestApproval: (signal) => new Promise<ApprovalVerdict>((resolve) => {
        if (signal.aborted) { resolve('cancel'); return; }
        const done = (verdict: ApprovalVerdict) => {
          signal.removeEventListener('abort', onAbort);
          approvals.current.delete(id);
          update((it) => ({ ...it, approval: 'done' }));
          resolve(verdict);
        };
        const onAbort = () => done('cancel');
        approvals.current.set(id, done);
        signal.addEventListener('abort', onAbort, { once: true });
        update((it) => ({ ...it, status: 'pending', label: 'awaiting approval', approval: 'awaiting' }));
      }),
    };
  }, [add]);

  const makeSink = useCallback((): ChatSink => ({
    beginAssistant: makeAssistant,
    beginTool: makeTool,
    note: (text) => notify('note', text),
    // The clock restarts only when the phase changes, so label updates within a phase keep it.
    setActivity: (kind, text, hint) =>
      setActivityState((prev) => ({ kind, text, hint: hint ?? null, since: prev && prev.kind === kind ? prev.since : Date.now() })),
  }), [makeAssistant, makeTool, notify]);

  const runTurn = useCallback(async (ctx: TurnContext) => {
    if (!ctx.mcp) return;
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await runAgentTurn({ settings: ctx.settings, secrets: ctx.secrets, mcp: ctx.mcp, tools: ctx.tools, history: history.current, ui: makeSink() }, controller.signal);
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) notify('note', 'Stopped.');
      else add({ kind: 'error', text: e instanceof Error ? e.message : String(e), who: 'error', retryable: true });
    } finally {
      abort.current = null;
      setActivityState(null);
      setBusy(false);
    }
  }, [add, makeSink, notify]);

  const send = useCallback((raw: string, ctx: TurnContext) => {
    const text = raw.trim();
    if (!text || abort.current) return;
    if (!ctx.mcp) { notify('error', 'Connect an EvalHub tool source first (sidebar → Connect).'); return; }
    add({ kind: 'user', text });
    history.current.push({ role: 'user', content: text });
    void runTurn(ctx);
  }, [add, notify, runTurn]);

  const retry = useCallback((errorId: number, ctx: TurnContext) => {
    dispatch({ type: 'remove', id: errorId });
    void runTurn(ctx);
  }, [runTurn]);

  const decide = useCallback((toolId: number, verdict: ApprovalVerdict) => approvals.current.get(toolId)?.(verdict), []);
  const stop = useCallback(() => abort.current?.abort(), []);
  const newChat = useCallback(() => {
    abort.current?.abort();
    history.current = [];
    dispatch({ type: 'reset' });
  }, []);
  const messages = useCallback(() => history.current, []);

  return { items, activity, busy, send, retry, decide, stop, newChat, notify, messages };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
