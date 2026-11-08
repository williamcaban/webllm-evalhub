export type PresetId = 'browser' | 'ollama' | 'custom' | 'openai' | 'openrouter' | 'groq';
export type ThinkLevel = '' | 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type McpMode = 'demo' | 'live';

/** Everything the user can change in the settings panel, except secrets. */
export interface Settings {
  preset: PresetId;
  base: string;
  model: string;
  think: ThinkLevel;
  /** Kept as text so a blank field means "endpoint default". */
  temp: string;
  stream: boolean;
  steps: number;
  mcpmode: McpMode;
  mcpurl: string;
  mcptenant: string;
  approve: boolean;
  compact: boolean;
  system: string;
}

/** Kept in sessionStorage only. */
export interface Secrets {
  key: string;
  mcptoken: string;
}

/** What cors-proxy.py --config reports at /config.json (it never includes the token). */
export interface ManagedProxyInfo {
  mcpPath: string;
  tenant: string;
  upstreamHost: string;
  expiresAt: string;
  expired: boolean;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** The OpenAI chat-completions message shapes this app sends. */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolStatus = 'pending' | 'running' | 'ok' | 'error' | 'denied';
export type ApprovalVerdict = 'approve' | 'deny' | 'cancel';
export type ActivityKind = 'wait' | 'think' | 'write' | 'plan' | 'tool' | 'approve';

export interface ReasoningState {
  text: string;
  live: boolean;
  startedAt: number;
  elapsedMs: number;
  /** False for non-streaming replies, where the duration of the thinking is unknown. */
  timed: boolean;
}

/** One rendered row of the transcript. The OpenAI history is kept separately in useChat. */
export type ChatItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string; pending: string; reasoning: ReasoningState | null }
  | {
      id: number;
      kind: 'tool';
      name: string;
      args: unknown;
      status: ToolStatus;
      label: string;
      startedAt: number;
      tookMs: number;
      result: string | null;
      sentChars: number | null;
      approval: 'none' | 'awaiting' | 'done';
    }
  | { id: number; kind: 'note'; text: string }
  | { id: number; kind: 'error'; text: string; who: string; retryable: boolean };

export interface ActivityState {
  kind: ActivityKind;
  text: string;
  /** Extra line shown under the label; receives the seconds spent in this phase. */
  hint: ((elapsedSeconds: number) => string) | null;
  since: number;
}
