export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContent {
  type: string;
  text?: string;
}

export interface McpToolResult {
  isError?: boolean;
  content?: McpContent[];
  structuredContent?: unknown;
}

/** Implemented by the live Streamable HTTP client and by the in-browser demo. */
export interface McpConnection {
  readonly label: 'Live' | 'Demo';
  init(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult>;
}

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}
