import { browserCompletion, browserLoadHint } from './browserModel/engine';
import { chatCompletion, ModelHttpError, type ModelReply } from './llm';
import { WRITE_TOOLS } from './mcp/tools';
import type { McpConnection, OpenAiTool } from './mcp/types';
import { systemFor } from './prompts';
import { toolResultText } from './toolResult';
import type { ActivityKind, ActivityState, ApprovalVerdict, ChatMessage, Secrets, Settings, ToolStatus } from '../types';

/** How the agent loop talks to the transcript. useChat implements it with React state. */
export interface AssistantHandle {
  setPending(label: string): void;
  clearPending(): void;
  setText(text: string): void;
  addReasoning(delta: string): void;
  /** timed=false is for non-streamed replies, where the duration of the thinking is unknown. */
  reasoningDone(timed?: boolean): void;
  hasReasoning(): boolean;
  /** Ends the bubble. It is removed if it holds neither text nor reasoning (tool-call-only replies, aborts). */
  finish(hasText: boolean): void;
}

export interface ToolHandle {
  setStatus(status: ToolStatus, label?: string): void;
  setResult(text: string, sentChars?: number): void;
  requestApproval(signal: AbortSignal): Promise<ApprovalVerdict>;
}

export interface ChatSink {
  beginAssistant(): AssistantHandle;
  beginTool(name: string, args: unknown): ToolHandle;
  note(text: string): void;
  setActivity(kind: ActivityKind, text: string, hint?: ActivityState['hint']): void;
}

export interface AgentDeps {
  settings: Settings;
  secrets: Secrets;
  mcp: McpConnection;
  tools: OpenAiTool[];
  /** The OpenAI-format history; the loop appends to it. */
  history: ChatMessage[];
  ui: ChatSink;
}

const abortError = () => new DOMException('Aborted', 'AbortError');

const slowHint = (s: number) => (s > 20 ? 'Still waiting. A local model can take a while on its first request while it loads into memory.' : '');
const readingHint = (s: number) => (s > 20 ? 'Still reading. The design_collection catalog is a few hundred benchmarks, so prompt processing can be slow on a large local model.' : '');
const toolHint = (s: number) => (s > 15 ? 'EvalHub is still working. design_collection fetches the live benchmark catalog, which can take a moment.' : '');

/** One model request. Draws the reply into a bubble and moves the status strip through its phases. */
async function modelStep(deps: AgentDeps, signal: AbortSignal, step: number): Promise<Extract<ChatMessage, { role: 'assistant' }>> {
  const { settings, secrets, ui } = deps;
  const temp = settings.temp.trim();
  // The bubble and status strip appear the moment the request leaves, so a silent model never looks hung.
  const bubble = ui.beginAssistant();
  bubble.setPending('Waiting for the model…');
  const local = settings.preset === 'browser';
  const waitHint = local ? (s: number) => browserLoadHint() || (s > 20 ? 'Still reading. A small model in the browser is slower on a long prompt such as the design_collection catalog.' : '') : step === 0 ? slowHint : readingHint;
  ui.setActivity('wait', step === 0 ? 'Waiting for the model' : 'Model is reading the tool results', waitHint);

  let phase: ActivityKind = 'wait';
  let thoughtChars = 0;
  let text = '';
  const enter = (next: ActivityKind, label: string, hint?: ActivityState['hint']) => {
    if (next === phase) return;
    if (phase === 'think') bubble.reasoningDone(); // thinking ends when answer or tool-call tokens start
    phase = next;
    ui.setActivity(next, label, hint);
  };

  let reply: ModelReply;
  try {
    reply = await (local ? browserCompletion : chatCompletion)({
      base: settings.base,
      apiKey: secrets.key,
      model: settings.model,
      system: systemFor(settings.preset, settings.system),
      messages: deps.history,
      tools: deps.tools,
      stream: settings.stream,
      temperature: temp !== '' && Number.isFinite(Number(temp)) ? Number(temp) : null,
      reasoningEffort: settings.think,
    }, {
      onThought(delta) {
        thoughtChars += delta.length;
        if (phase !== 'think') bubble.clearPending(); // the reasoning block shows its own live indicator
        bubble.addReasoning(delta);
        enter('think', 'Model is thinking', () => `${thoughtChars.toLocaleString()} characters of reasoning so far · expand "Thinking…" above to read it`);
      },
      onContent(_delta, full) {
        text = full;
        enter('write', 'Model is writing the reply');
        bubble.setText(full);
      },
      onToolName(name) {
        if (!text) bubble.setPending(`Preparing a call to ${name}…`);
        enter('plan', `Model is preparing a call to ${name}`);
      },
    }, signal);
    text = reply.text;
    if (reply.reasoning) {
      bubble.clearPending();
      bubble.addReasoning(reply.reasoning);
      bubble.reasoningDone(false);
    }
    if (text) bubble.setText(text);
  } catch (e) {
    bubble.finish(!!text); // keep whatever was streamed before the failure or the Stop press
    throw e;
  }
  bubble.finish(!!text);

  const msg: Extract<ChatMessage, { role: 'assistant' }> = { role: 'assistant', content: text || null };
  if (reply.toolCalls.length) msg.tool_calls = reply.toolCalls;
  if (!text && !reply.toolCalls.length) {
    ui.note('The model returned an empty reply.');
    msg.content = '';
  }
  return msg;
}

// A malformed tool call fails before any message is stored, and sampling differs per attempt, so retrying is safe.
const MAX_PARSE_RETRIES = 2;

async function modelStepRetrying(deps: AgentDeps, signal: AbortSignal, step: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await modelStep(deps, signal, step);
    } catch (e) {
      if (!(e instanceof ModelHttpError) || !e.toolParse) throw e;
      if (attempt >= MAX_PARSE_RETRIES) {
        e.message += `\n\nThe model's tool call was cut off or malformed, so the server could not parse it. It failed ${attempt + 1} times in a row. Press Retry, or try a larger model: small models often fail to finish long tool calls such as create_collection.`;
        throw e;
      }
      deps.ui.note(`The model produced a malformed tool call and the server could not parse it. Retrying (${attempt + 1}/${MAX_PARSE_RETRIES})…`);
    }
  }
}

async function executeTool(deps: AgentDeps, call: { function: { name: string; arguments: string } }, signal: AbortSignal): Promise<string> {
  const { ui, settings, mcp } = deps;
  const name = call.function.name;
  let args: Record<string, unknown>;
  try {
    args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  } catch (e) {
    const card = ui.beginTool(name, { raw_arguments: call.function.arguments });
    card.setStatus('error', 'bad arguments');
    return `ERROR: the arguments were not valid JSON (${e instanceof Error ? e.message : String(e)}). Call the tool again with a valid JSON object.`;
  }
  const card = ui.beginTool(name, args);
  if (WRITE_TOOLS.has(name) && settings.approve) {
    ui.setActivity('approve', `Waiting for your approval: ${name}`);
    const verdict = await card.requestApproval(signal);
    if (verdict === 'cancel') {
      card.setStatus('denied', 'cancelled');
      throw abortError();
    }
    if (verdict === 'deny') {
      card.setStatus('denied', 'denied');
      return 'The user denied this action. Do not retry it. Ask what they want to change.';
    }
  }
  card.setStatus('running');
  ui.setActivity('tool', `Running ${name} on ${mcp.label === 'Demo' ? 'the simulated EvalHub (demo)' : 'EvalHub'}`, toolHint);
  try {
    const res = await mcp.callTool(name, args, signal);
    // The in-browser models cannot read the whole catalog (it is about 18k tokens), so they get a shortlist.
    const digest = settings.preset === 'browser' && name === 'design_collection' ? { goal: String(args.evaluation_goal ?? ''), limit: 20 } : null;
    const text = toolResultText(name, res, settings.compact, digest);
    card.setStatus(res.isError ? 'error' : 'ok');
    card.setResult(text, text.length);
    return text;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      card.setStatus('denied', 'cancelled');
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    card.setStatus('error');
    card.setResult(message);
    return `ERROR: ${message}`;
  }
}

/** The agent loop for one user turn: model, tool calls, model, ... until the model answers without tools. */
export async function runAgentTurn(deps: AgentDeps, signal: AbortSignal): Promise<void> {
  const { history, settings, ui } = deps;
  for (let step = 0; ; step++) {
    if (signal.aborted) throw abortError();
    const msg = await modelStepRetrying(deps, signal, step);
    history.push(msg);
    const calls = msg.tool_calls;
    if (!calls) return;
    if (step >= settings.steps) {
      for (const tc of calls) history.push({ role: 'tool', tool_call_id: tc.id, content: 'Not executed: the per-turn tool call limit was reached.' });
      ui.note(`Stopped after ${settings.steps} tool-call rounds. Send a message to continue.`);
      return;
    }
    // Every tool_call needs a matching tool message or the next request is rejected, even when aborted midway.
    const pending = new Set(calls.map((c) => c.id));
    try {
      for (const tc of calls) {
        const out = await executeTool(deps, tc, signal);
        history.push({ role: 'tool', tool_call_id: tc.id, content: out });
        pending.delete(tc.id);
      }
    } finally {
      for (const tc of calls) if (pending.has(tc.id)) history.push({ role: 'tool', tool_call_id: tc.id, content: 'Cancelled before execution.' });
    }
  }
}
