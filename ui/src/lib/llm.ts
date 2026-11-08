import type { ChatMessage, ToolCall } from '../types';
import type { OpenAiTool } from './mcp/types';

export interface ModelRequest {
  base: string;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: OpenAiTool[];
  stream: boolean;
  temperature: number | null;
  reasoningEffort: string;
}

/** Live callbacks for a streamed reply; a non-streamed reply returns everything at once. */
export interface ModelHooks {
  onThought?(delta: string): void;
  onContent?(delta: string, full: string): void;
  onToolName?(name: string): void;
}

export interface ModelReply {
  text: string;
  /** Reasoning tokens, only filled for non-streamed replies (streamed ones arrive through onThought). */
  reasoning: string;
  toolCalls: ToolCall[];
}

export class ModelHttpError extends Error {
  constructor(message: string, readonly status: number, readonly toolParse: boolean) {
    super(message);
    this.name = 'ModelHttpError';
  }
}

interface WireToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface WireMessage {
  content?: string | null;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: WireToolCall[];
}
interface WireChunk {
  error?: { message?: string };
  choices?: Array<{ delta?: WireMessage }>;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

function finishCalls(calls: Array<PartialCall | undefined>): ToolCall[] {
  const done: ToolCall[] = [];
  for (const c of calls) {
    if (!c?.name) continue;
    done.push({
      id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function',
      function: { name: c.name, arguments: c.args || '{}' },
    });
  }
  return done;
}

/** One OpenAI-compatible /chat/completions request, streamed or not. */
export async function chatCompletion(req: ModelRequest, hooks: ModelHooks, signal: AbortSignal): Promise<ModelReply> {
  const base = req.base.trim().replace(/\/+$/, '');
  if (!base) throw new Error('Set the model endpoint Base URL in the sidebar.');
  if (!req.model.trim()) throw new Error('Set the Model name in the sidebar.');

  const body: Record<string, unknown> = {
    model: req.model.trim(),
    messages: [{ role: 'system', content: req.system }, ...req.messages],
    stream: req.stream,
  };
  if (req.tools.length) {
    body.tools = req.tools;
    body.tool_choice = 'auto';
  }
  if (req.temperature !== null) body.temperature = req.temperature;
  if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot reach the model endpoint ${base} (${reason}). Check the URL, and that the endpoint allows browser (CORS) requests. For Ollama set OLLAMA_ORIGINS.`);
  }
  if (!res.ok) {
    const detail = await res.text();
    // Ollama answers 500 when the model's tool call is cut off or malformed ("XML syntax error ... unexpected EOF").
    const toolParse = res.status >= 500 && /XML syntax error|tool call pars|unexpected EOF/i.test(detail);
    throw new ModelHttpError(`Model endpoint HTTP ${res.status}: ${detail.slice(0, 600)}`, res.status, toolParse);
  }

  if (!req.stream) {
    const json = (await res.json()) as { choices?: Array<{ message?: WireMessage }> };
    const m = json.choices?.[0]?.message ?? {};
    const calls = (m.tool_calls ?? []).map((tc): PartialCall => ({ id: tc.id ?? '', name: tc.function?.name ?? '', args: tc.function?.arguments ?? '' }));
    return {
      text: typeof m.content === 'string' ? m.content : '',
      reasoning: m.reasoning ?? m.reasoning_content ?? '',
      toolCalls: finishCalls(calls),
    };
  }

  if (!res.body) throw new Error('The model endpoint returned no response body to stream.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const calls: Array<PartialCall | undefined> = [];
  let text = '';
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const chunk = parseJson<WireChunk>(data);
      if (!chunk) continue;
      if (chunk.error) throw new Error(`Model endpoint error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      // Thinking models (Ollama qwen3, gpt-oss...) stream their reasoning in a separate field before any answer.
      const thought = delta.reasoning ?? delta.reasoning_content;
      if (thought) hooks.onThought?.(thought);
      if (delta.content) {
        text += delta.content;
        hooks.onContent?.(delta.content, text);
      }
      for (const tc of delta.tool_calls ?? []) {
        let i = tc.index;
        if (i == null) i = tc.id ? calls.length : Math.max(0, calls.length - 1);
        const call = calls[i] ?? (calls[i] = { id: '', name: '', args: '' });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) {
          call.name += tc.function.name;
          hooks.onToolName?.(call.name);
        }
        if (tc.function?.arguments) call.args += tc.function.arguments;
      }
    }
  }
  return { text, reasoning: '', toolCalls: finishCalls(calls) };
}
