import { useCallback, useState } from 'react';
import { McpClient } from '../lib/mcp/client';
import { DemoMcp } from '../lib/mcp/demo';
import { toOpenAiTools } from '../lib/mcp/tools';
import type { McpConnection, McpTool, OpenAiTool } from '../lib/mcp/types';
import type { McpMode } from '../types';

export interface ConnectParams {
  mode: McpMode;
  url: string;
  token: string;
  tenant: string;
}

export type StatusTone = 'none' | 'ok' | 'warn' | 'err';
export interface McpStatus {
  text: string;
  tone: StatusTone;
}

export type Notify = (kind: 'note' | 'error', text: string, who?: string) => void;

export interface McpConnectionState {
  client: McpConnection;
  tools: McpTool[];
  openAiTools: OpenAiTool[];
}

export function useMcpConnection(notify: Notify) {
  const [status, setStatus] = useState<McpStatus>({ text: 'MCP: not connected', tone: 'none' });
  const [connection, setConnection] = useState<McpConnectionState | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async (p: ConnectParams) => {
    setConnecting(true);
    setStatus({ text: 'MCP: connecting…', tone: 'warn' });
    try {
      let client: McpConnection;
      if (p.mode === 'demo') {
        client = new DemoMcp();
      } else {
        if (!p.url.trim()) throw new Error('Enter the MCP URL.');
        client = new McpClient({ url: p.url.trim(), token: p.token.trim(), tenant: p.tenant.trim() });
      }
      await client.init();
      const tools = await client.listTools();
      setConnection({ client, tools, openAiTools: toOpenAiTools(tools) });
      const names = tools.map((t) => t.name);
      const hasDesign = names.includes('design_collection');
      setStatus({ text: `MCP: ${client.label} · ${tools.length} tools${hasDesign ? '' : ' · no design_collection'}`, tone: hasDesign ? 'ok' : 'warn' });
      if (!hasDesign) notify('note', `Connected, but this server has no design_collection tool (tools: ${names.join(', ')}). The shipped RHOAI 3.6 EA2 MCP image has only 4 tools; use a newer EvalHub MCP build.`);
      if (!names.includes('create_collection')) notify('note', 'This server has no create_collection tool, so designs cannot be saved.');
    } catch (e) {
      setConnection(null);
      setStatus({ text: 'MCP: not connected', tone: 'err' });
      notify('error', e instanceof Error ? e.message : String(e), 'connect error');
    } finally {
      setConnecting(false);
    }
  }, [notify]);

  return { status, connection, connecting, connect };
}
