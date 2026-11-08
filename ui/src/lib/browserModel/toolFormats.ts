import type { ChatMessage, ToolCall } from '../../types';
import type { OpenAiTool } from '../mcp/types';

/** How a model writes tool calls in its own text (there is no server here to translate them to OpenAI tool_calls). */
export type ToolFormat = 'lfm2' | 'qwen';

export interface ParsedReply {
  /** What the model said before any tool call. */
  text: string;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

/** A tool call that started but could not be read, usually because generation stopped halfway through it. */
export class ToolCallSyntaxError extends Error {}

const LFM2_START = '<|tool_call_start|>';
const LFM2_END = '<|tool_call_end|>';
const QWEN_START = '<tool_call>';

/** End-of-turn markers the model emits after its reply; they are not part of the text. */
export function stripStopTokens(text: string): string {
  let out = text;
  for (const t of STOP_TOKEN_TEXTS) {
    const i = out.indexOf(t);
    if (i >= 0) out = out.slice(0, i);
  }
  return out;
}

export const toolCallMarker = (format: ToolFormat): string => (format === 'qwen' ? QWEN_START : LFM2_START);

/** Every end-of-turn token a model here may emit, so generation can stop on any of them. */
export const STOP_TOKEN_TEXTS: readonly string[] = ['<|im_end|>', '<|endoftext|>'];

// ---- a small reader shared by both syntaxes ----------------------------------------------------------------------

class Reader {
  pos = 0;
  constructor(readonly src: string) {}
  get done(): boolean { return this.pos >= this.src.length; }
  peek(): string { return this.src[this.pos] ?? ''; }
  skipSpace(): void { while (/\s/.test(this.peek()) && !this.done) this.pos++; }
  eat(s: string): boolean {
    this.skipSpace();
    if (!this.src.startsWith(s, this.pos)) return false;
    this.pos += s.length;
    return true;
  }
  expect(s: string): void {
    if (!this.eat(s)) throw new ToolCallSyntaxError(`expected "${s}" at ${this.pos} in: ${this.src.slice(0, 200)}`);
  }
  match(re: RegExp): string | null {
    this.skipSpace();
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (!m || m.index !== this.pos) return null;
    this.pos += m[0].length;
    return m[0];
  }
}

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z_][\w.-]*/y;

function unescapeQuoted(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (_m, c: string) => {
    if (c[0] === 'u' || c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c;
  });
}

function readQuoted(r: Reader): string | null {
  r.skipSpace();
  const q = r.peek();
  if (q !== '"' && q !== "'") return null;
  let i = r.pos + 1;
  while (i < r.src.length && r.src[i] !== q) i += r.src[i] === '\\' ? 2 : 1;
  if (i >= r.src.length) throw new ToolCallSyntaxError('a string was not closed');
  const raw = r.src.slice(r.pos + 1, i);
  r.pos = i + 1;
  return unescapeQuoted(raw);
}

const WORDS: Record<string, unknown> = { True: true, true: true, False: false, false: false, None: null, null: null };

/** Python / JSON literal: strings, numbers, True/False/None, lists, tuples, dicts. */
function readPyValue(r: Reader): unknown {
  const s = readQuoted(r);
  if (s !== null) return s;
  const num = r.match(NUMBER);
  if (num !== null) return Number(num);
  if (r.eat('[')) return readSeq(r, ']', () => readPyValue(r));
  if (r.eat('(')) return readSeq(r, ')', () => readPyValue(r));
  if (r.eat('{')) {
    const out: Record<string, unknown> = {};
    readSeq(r, '}', () => {
      const key = readQuoted(r) ?? r.match(IDENT);
      if (key === null) throw new ToolCallSyntaxError(`expected a key at ${r.pos}`);
      r.expect(':');
      out[key] = readPyValue(r);
    });
    return out;
  }
  const word = r.match(IDENT);
  if (word === null) throw new ToolCallSyntaxError(`unexpected "${r.peek()}" at ${r.pos}`);
  return word in WORDS ? WORDS[word] : word;
}

/** Comma-separated items up to `close`, allowing a trailing comma. */
function readSeq(r: Reader, close: string, item: () => unknown): unknown[] {
  const out: unknown[] = [];
  if (r.eat(close)) return out;
  for (;;) {
    out.push(item());
    if (r.eat(close)) return out;
    r.expect(',');
    if (r.eat(close)) return out;
  }
}

// ---- LFM2: <|tool_call_start|>[name(arg="x", n=5)]<|tool_call_end|> ---------------------------------------------

function readLfm2Calls(body: string): ParsedReply['calls'] {
  const trimmed = body.trim();
  if (trimmed.startsWith('[{') || trimmed.startsWith('{')) {
    // The model sometimes answers in JSON instead of the pythonic form it was trained on.
    try {
      const json = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(json) ? json : [json];
      return list.flatMap((c) => {
        const o = c as { name?: unknown; arguments?: unknown; parameters?: unknown };
        const args = o.arguments ?? o.parameters ?? {};
        return typeof o.name === 'string' ? [{ name: o.name, args: typeof args === 'object' && args ? (args as Record<string, unknown>) : {} }] : [];
      });
    } catch {
      /* fall through to the pythonic reader for its error message */
    }
  }
  const r = new Reader(trimmed);
  const bracket = r.eat('[');
  const calls: ParsedReply['calls'] = [];
  for (;;) {
    r.skipSpace();
    if (r.done || (bracket && r.peek() === ']')) break;
    const name = r.match(IDENT);
    if (name === null) throw new ToolCallSyntaxError(`expected a function name at ${r.pos} in: ${trimmed.slice(0, 200)}`);
    r.expect('(');
    const args: Record<string, unknown> = {};
    readSeq(r, ')', () => {
      const key = r.match(IDENT);
      if (key === null) throw new ToolCallSyntaxError(`expected an argument name at ${r.pos}`);
      r.expect('=');
      args[key] = readPyValue(r);
    });
    calls.push({ name, args });
    if (!r.eat(',')) break;
  }
  if (bracket) r.expect(']');
  return calls;
}

// ---- Qwen: <tool_call><function=name><parameter=key>value</parameter></function></tool_call> ----------------------

type Schema = { type?: unknown; anyOf?: Schema[]; properties?: Record<string, Schema> };

const paramSchemas = (tools: readonly OpenAiTool[], name: string): Record<string, Schema> =>
  ((tools.find((t) => t.function.name === name)?.function.parameters as Schema | undefined)?.properties) ?? {};

const wantsString = (s: Schema | undefined): boolean => s?.type === 'string' || (s?.anyOf ?? []).some((x) => x.type === 'string');

/** Qwen writes every value as text; turn it back into what the tool's schema asks for. */
function coerce(text: string, schema: Schema | undefined): unknown {
  if (wantsString(schema)) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readQwenCalls(body: string, tools: readonly OpenAiTool[]): ParsedReply['calls'] {
  const fn = /<function=([^>\s]+)>([\s\S]*?)<\/function>/g;
  const calls: ParsedReply['calls'] = [];
  for (let m = fn.exec(body); m; m = fn.exec(body)) {
    const name = m[1] ?? '';
    const schemas = paramSchemas(tools, name);
    const args: Record<string, unknown> = {};
    const param = /<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g;
    for (let p = param.exec(m[2] ?? ''); p; p = param.exec(m[2] ?? '')) args[p[1] ?? ''] = coerce((p[2] ?? '').trim(), schemas[p[1] ?? '']);
    calls.push({ name, args });
  }
  if (!calls.length) throw new ToolCallSyntaxError(`no complete <function=...> block in: ${body.slice(0, 200)}`);
  return calls;
}

// ---- public ------------------------------------------------------------------------------------------------------

/**
 * Splits a model reply into text and tool calls. Throws ToolCallSyntaxError when a call was started and cannot be read
 * (cut off, or not in the model's format); a reply with no call marker is plain text.
 */
export function parseReply(format: ToolFormat, raw: string, tools: readonly OpenAiTool[] = []): ParsedReply {
  const text = stripStopTokens(raw);
  const start = toolCallMarker(format);
  const first = text.indexOf(start);
  if (first < 0) return { text: text.trim(), calls: [] };
  const before = text.slice(0, first).trim();
  const calls: ParsedReply['calls'] = [];
  if (format === 'qwen') {
    calls.push(...readQwenCalls(text.slice(first), tools));
  } else {
    let at = first;
    while (at >= 0) {
      const bodyStart = at + start.length;
      const bodyEnd = text.indexOf(LFM2_END, bodyStart);
      // A missing end marker usually means generation stopped at the token limit; the end of the text is the best guess.
      const body = text.slice(bodyStart, bodyEnd >= 0 ? bodyEnd : undefined);
      calls.push(...readLfm2Calls(body));
      if (bodyEnd < 0) break;
      at = text.indexOf(start, bodyEnd);
    }
  }
  if (!calls.length) throw new ToolCallSyntaxError('the tool call was empty');
  return { text: before, calls };
}

/** The name of the tool being written, readable before the call is complete (for the "preparing a call" status). */
export function partialToolName(format: ToolFormat, raw: string): string | null {
  const start = toolCallMarker(format);
  const i = raw.indexOf(start);
  if (i < 0) return null;
  const rest = raw.slice(i + start.length);
  const m = format === 'qwen' ? /^\s*<function=([^>\s]+)>/.exec(rest) : /^\s*\[?\s*([A-Za-z_][\w.-]*)\s*\(/.exec(rest);
  return m?.[1] ?? null;
}

/** Drops arguments the tool does not declare. Small models invent extras, and the server rejects them. */
export function sanitizeCalls(calls: ParsedReply['calls'], tools: readonly OpenAiTool[]): ParsedReply['calls'] {
  return calls.map((c) => {
    const known = paramSchemas(tools, c.name);
    if (!Object.keys(known).length) return c;
    return { name: c.name, args: Object.fromEntries(Object.entries(c.args).filter(([k]) => k in known)) };
  });
}

export const toToolCalls = (calls: ParsedReply['calls']): ToolCall[] =>
  calls.map((c) => ({
    id: `call_${Math.random().toString(36).slice(2, 10)}`,
    type: 'function',
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));

// ---- history -> the messages the model's chat template expects ---------------------------------------------------

function pyLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`;
  return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${pyLiteral(x)}`).join(', ')}}`;
}

const safeArgs = (json: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** What a chat template receives. LFM2 has no tool_calls field, so its calls go back as the text it wrote. */
export interface TemplateMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: Array<{ type: 'function'; function: { name: string; arguments: Record<string, unknown> } }>;
}

export function toTemplateMessages(format: ToolFormat, system: string, history: ChatMessage[]): TemplateMessage[] {
  const out: TemplateMessage[] = [{ role: 'system', content: system }];
  const names = new Map<string, string>();
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const calls = m.tool_calls ?? [];
      for (const c of calls) names.set(c.id, c.function.name);
      if (!calls.length) out.push({ role: 'assistant', content: m.content ?? '' });
      else if (format === 'qwen') {
        out.push({
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: calls.map((c) => ({ type: 'function', function: { name: c.function.name, arguments: safeArgs(c.function.arguments) } })),
        });
      } else {
        const written = calls.map((c) => `${c.function.name}(${Object.entries(safeArgs(c.function.arguments)).map(([k, v]) => `${k}=${pyLiteral(v)}`).join(', ')})`);
        out.push({ role: 'assistant', content: `${m.content ?? ''}${LFM2_START}[${written.join(', ')}]${LFM2_END}` });
      }
    } else {
      out.push({ role: 'tool', content: m.content, name: names.get(m.tool_call_id) ?? 'tool' });
    }
  }
  return out;
}
