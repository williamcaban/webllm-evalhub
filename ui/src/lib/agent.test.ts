import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentTurn, type AgentDeps, type AssistantHandle, type ChatSink, type ToolHandle } from './agent';
import { DEFAULT_SETTINGS } from './config';
import { DemoMcp } from './mcp/demo';
import { toOpenAiTools } from './mcp/tools';
import { DEMO_TOOLS } from './mcp/demoData';
import type { ApprovalVerdict, ChatMessage, ToolStatus } from '../types';

const toolCall = (name: string, args: object) => ({ choices: [{ message: { content: null, tool_calls: [{ id: `id_${name}`, function: { name, arguments: JSON.stringify(args) } }] } }] });
const say = (content: string) => ({ choices: [{ message: { content } }] });

function scripted(...replies: Array<object | { status: number; body: string }>) {
  const queue = [...replies];
  vi.stubGlobal('fetch', vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra model request');
    return 'status' in next ? new Response(next.body, { status: next.status }) : new Response(JSON.stringify(next));
  }));
}

function harness(verdict: ApprovalVerdict = 'approve') {
  const log: string[] = [];
  const statuses: ToolStatus[] = [];
  const bubble: AssistantHandle = {
    setPending: () => {}, clearPending: () => {}, setText: () => {}, addReasoning: () => {}, reasoningDone: () => {},
    hasReasoning: () => false, finish: (hasText) => log.push(`finish:${hasText}`),
  };
  const ui: ChatSink = {
    beginAssistant: () => bubble,
    beginTool: (name): ToolHandle => ({
      setStatus: (s) => { statuses.push(s); },
      setResult: () => {},
      requestApproval: async () => { log.push(`approval:${name}`); return verdict; },
    }),
    note: (t) => log.push(`note:${t.slice(0, 30)}`),
    setActivity: () => {},
  };
  const history: ChatMessage[] = [{ role: 'user', content: 'design it' }];
  const deps: AgentDeps = {
    settings: { ...DEFAULT_SETTINGS, mcpmode: 'demo', approve: true, steps: 3, stream: false }, secrets: { key: '', mcptoken: '' },
    mcp: new DemoMcp(), tools: toOpenAiTools(DEMO_TOOLS), history, ui,
  };
  return { deps, log, statuses, history };
}
const roles = (h: ChatMessage[]) => h.map((m) => m.role);
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('runAgentTurn', () => {
  it('runs design_collection, feeds the result back, and ends on a plain reply', async () => {
    scripted(toolCall('design_collection', { evaluation_goal: 'safety' }), say('Here is a proposal.'));
    const { deps, history, statuses, log } = harness();
    await runAgentTurn(deps, signal());
    expect(roles(history)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(statuses).toEqual(['running', 'ok']);
    expect(log).not.toContain('approval:design_collection');
    const tool = history[2];
    expect(tool?.role === 'tool' && tool.content).toContain('toxigen');
  });

  it('asks before create_collection and tells the model when the user denies', async () => {
    scripted(toolCall('create_collection', { name: 'x', domains: ['safety'], benchmarks: [] }), say('Understood.'));
    const { deps, history, statuses, log } = harness('deny');
    await runAgentTurn(deps, signal());
    expect(log).toContain('approval:create_collection');
    expect(statuses).toEqual(['denied']);
    const tool = history[2];
    expect(tool?.role === 'tool' && tool.content).toMatch(/user denied/);
  });

  it('runs an approved write tool and reports the tool error to the model', async () => {
    scripted(toolCall('create_collection', { name: 'x', domains: ['Bad Domain'], benchmarks: [{ id: 'toxigen', provider_id: 'lm_evaluation_harness' }] }), say('Fixing.'));
    const { deps, history, statuses } = harness('approve');
    await runAgentTurn(deps, signal());
    expect(statuses).toEqual(['running', 'error']);
    const tool = history[2];
    expect(tool?.role === 'tool' && tool.content).toMatch(/^ERROR: domains must be snake_case/);
  });

  it('answers every tool_call even when the user cancels at the approval step', async () => {
    scripted(toolCall('create_collection', { name: 'x', domains: ['safety'], benchmarks: [] }));
    const { deps, history } = harness('cancel');
    await expect(runAgentTurn(deps, signal())).rejects.toMatchObject({ name: 'AbortError' });
    expect(roles(history)).toEqual(['user', 'assistant', 'tool']);
    const tool = history[2];
    expect(tool?.role === 'tool' && tool.content).toBe('Cancelled before execution.');
  });

  it('returns invalid tool arguments to the model instead of calling the tool', async () => {
    scripted({ choices: [{ message: { content: null, tool_calls: [{ id: 'b', function: { name: 'get_benchmark', arguments: '{oops' } }] } }] }, say('retrying'));
    const { deps, history, statuses } = harness();
    await runAgentTurn(deps, signal());
    expect(statuses).toEqual(['error']);
    const tool = history[2];
    expect(tool?.role === 'tool' && tool.content).toMatch(/not valid JSON/);
  });

  it('stops at the per-turn tool limit', async () => {
    const again = toolCall('get_benchmark', { benchmark_id: 'toxigen' });
    scripted(again, again, again, again);
    const { deps, history, log } = harness();
    await runAgentTurn(deps, signal());
    expect(log.some((l) => l.startsWith('note:Stopped after 3 tool-call'))).toBe(true);
    expect(roles(history).at(-1)).toBe('tool');
  });

  const xml = { status: 500, body: '{"error":{"message":"XML syntax error on line 15: unexpected EOF"}}' };
  it('retries a malformed tool call, then succeeds', async () => {
    scripted(xml, xml, say('ok now'));
    const { deps, history, log } = harness();
    await runAgentTurn(deps, signal());
    expect(log.filter((l) => l.startsWith('note:')).length).toBe(2);
    expect(roles(history)).toEqual(['user', 'assistant']);
  });
  it('gives up after two retries with an explanation', async () => {
    scripted(xml, xml, xml);
    const { deps } = harness();
    await expect(runAgentTurn(deps, signal())).rejects.toThrow(/failed 3 times in a row/);
  });
});
