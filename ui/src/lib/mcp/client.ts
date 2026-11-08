import type { McpConnection, McpTool, McpToolResult } from './types';

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface RpcOptions {
  notify?: boolean;
  signal?: AbortSignal;
  retried?: boolean;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** MCP over Streamable HTTP: JSON-RPC POSTs whose replies are either JSON or a text/event-stream. */
export class McpClient implements McpConnection {
  readonly label = 'Live' as const;
  private sessionId: string | null = null;
  private lastId = 0;

  constructor(private readonly opts: { url: string; token: string; tenant: string }) {}

  private async rpc(method: string, params: unknown, { notify = false, signal, retried = false }: RpcOptions = {}): Promise<unknown> {
    const body: Record<string, unknown> = { jsonrpc: '2.0', method, params };
    const id = notify ? undefined : ++this.lastId;
    if (id !== undefined) body.id = id;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    if (this.opts.tenant) headers['X-Tenant'] = this.opts.tenant;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    let res: Response;
    try {
      res = await fetch(this.opts.url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`Cannot reach the MCP server at ${this.opts.url} (${reason}). Usually CORS, a wrong URL, or an untrusted TLS certificate: run cors-proxy.py and point the URL at it.`);
    }
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid) this.sessionId = sid;
    // A restarted server forgets the session: start a new one and replay the call once.
    if (res.status === 404 && this.sessionId && !retried && method !== 'initialize') {
      this.sessionId = null;
      await this.init(signal);
      return this.rpc(method, params, { notify, signal, retried: true });
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 400)}`);
    if (notify || !text.trim()) return null;

    let msg: RpcResponse | null = null;
    if ((res.headers.get('Content-Type') ?? '').includes('text/event-stream')) {
      for (const event of text.split(/\r?\n\r?\n/)) {
        const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!data) continue;
        const parsed = parseJson<RpcResponse>(data);
        if (parsed && parsed.id === id) {
          msg = parsed;
          break;
        }
      }
    } else {
      msg = parseJson<RpcResponse>(text);
    }
    if (!msg) throw new Error(`MCP: could not parse the response: ${text.slice(0, 200)}`);
    if (msg.error) throw new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
    return msg.result;
  }

  async init(signal?: AbortSignal): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'evalhub-collection-chat', version: '0.1' },
    }, { signal });
    await this.rpc('notifications/initialized', {}, { notify: true, signal });
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = (await this.rpc('tools/list', cursor ? { cursor } : {}, { signal })) as { tools?: McpTool[]; nextCursor?: string } | null;
      tools.push(...(page?.tools ?? []));
      cursor = page?.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    return (await this.rpc('tools/call', { name, arguments: args }, { signal })) as McpToolResult;
  }
}
