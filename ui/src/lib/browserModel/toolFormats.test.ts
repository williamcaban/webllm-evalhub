import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types';
import type { OpenAiTool } from '../mcp/types';
import { parseReply, partialToolName, sanitizeCalls, stripStopTokens, toTemplateMessages, ToolCallSyntaxError } from './toolFormats';

describe('parseReply (lfm2)', () => {
  it('reads the pythonic call a real LFM2 350M produced', () => {
    const raw = '<|tool_call_start|>[design_collection(goal="Customer Support Agent Performance", max_benchmarks=5)]<|tool_call_end|><|im_end|>';
    expect(parseReply('lfm2', raw)).toEqual({ text: '', calls: [{ name: 'design_collection', args: { goal: 'Customer Support Agent Performance', max_benchmarks: 5 } }] });
  });
  it('keeps the text before the call and reads several calls, lists, dicts and python literals', () => {
    const raw = 'Let me check.<|tool_call_start|>[a(x=[1, 2.5, "s"], y={"k": True, "n": None}), b(z=\'it\\\'s\')]<|tool_call_end|>';
    expect(parseReply('lfm2', raw)).toEqual({
      text: 'Let me check.',
      calls: [{ name: 'a', args: { x: [1, 2.5, 's'], y: { k: true, n: null } } }, { name: 'b', args: { z: "it's" } }],
    });
  });
  it('accepts a JSON call list', () => {
    const raw = '<|tool_call_start|>[{"name": "get_job_status", "arguments": {"job_id": "j1"}}]<|tool_call_end|>';
    expect(parseReply('lfm2', raw).calls).toEqual([{ name: 'get_job_status', args: { job_id: 'j1' } }]);
  });
  it('returns plain text when there is no call', () => {
    expect(parseReply('lfm2', 'Reply approve to create it.<|im_end|>')).toEqual({ text: 'Reply approve to create it.', calls: [] });
  });
  it('reports a call that was cut off', () => {
    expect(() => parseReply('lfm2', '<|tool_call_start|>[create_collection(name="x", benchmarks=[{"id": "tru')).toThrow(ToolCallSyntaxError);
  });
});

const tool = (name: string, properties: Record<string, unknown>): OpenAiTool => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties } } });
const tools = [
  tool('design_collection', { evaluation_goal: { type: 'string' }, max_benchmarks: { anyOf: [{ type: 'null' }, { type: 'integer' }] } }),
  tool('create_collection', { name: { type: 'string' }, domains: { anyOf: [{ type: 'null' }, { type: 'array', items: { type: 'string' } }] } }),
];

describe('parseReply (qwen)', () => {
  it('reads the call a real Qwen3.5 0.8B produced', () => {
    const raw = '<tool_call>\n<function=design_collection>\n<parameter=evaluation_goal>\ncustomer support agent that does not produce toxic content.\n</parameter>\n</function>\n</tool_call><|im_end|>';
    expect(parseReply('qwen', raw, tools)).toEqual({ text: '', calls: [{ name: 'design_collection', args: { evaluation_goal: 'customer support agent that does not produce toxic content.' } }] });
  });
  it('turns values back into the types the schema asks for, and keeps strings as strings', () => {
    const raw = '<tool_call>\n<function=create_collection>\n<parameter=name>\n42\n</parameter>\n<parameter=domains>\n["safety", "truthfulness"]\n</parameter>\n</function>\n</tool_call>';
    expect(parseReply('qwen', raw, tools).calls[0]?.args).toEqual({ name: '42', domains: ['safety', 'truthfulness'] });
    const num = '<tool_call>\n<function=design_collection>\n<parameter=max_benchmarks>\n5\n</parameter>\n</function>\n</tool_call>';
    expect(parseReply('qwen', num, tools).calls[0]?.args).toEqual({ max_benchmarks: 5 });
  });
  it('keeps the text before the call, and reads several calls', () => {
    const raw = 'Checking.\n<tool_call>\n<function=a>\n</function>\n</tool_call>\n<tool_call>\n<function=b>\n<parameter=x>\ny\n</parameter>\n</function>\n</tool_call>';
    const r = parseReply('qwen', raw);
    expect(r.text).toBe('Checking.');
    expect(r.calls).toEqual([{ name: 'a', args: {} }, { name: 'b', args: { x: 'y' } }]);
  });
  it('reports a call that was cut off', () => {
    expect(() => parseReply('qwen', '<tool_call>\n<function=create_collection>\n<parameter=name>\nSupp', tools)).toThrow(ToolCallSyntaxError);
  });
});

describe('sanitizeCalls', () => {
  it('drops arguments the tool does not declare, as LFM2.5 invented test_data_ref and pvc', () => {
    const calls = [{ name: 'design_collection', args: { evaluation_goal: 'x', max_benchmarks: 5, test_data_ref: 'u', pvc: { claim_name: 'a' } } }];
    expect(sanitizeCalls(calls, tools)).toEqual([{ name: 'design_collection', args: { evaluation_goal: 'x', max_benchmarks: 5 } }]);
  });
  it('leaves a call to an unknown tool alone', () => {
    const calls = [{ name: 'mystery', args: { a: 1 } }];
    expect(sanitizeCalls(calls, tools)).toEqual(calls);
  });
});

describe('streaming helpers', () => {
  it('names the tool as soon as its opening is written', () => {
    expect(partialToolName('lfm2', 'ok <|tool_call_start|>[design_coll')).toBeNull();
    expect(partialToolName('lfm2', 'ok <|tool_call_start|>[design_collection(goal=')).toBe('design_collection');
    expect(partialToolName('lfm2', 'plain text')).toBeNull();
    expect(partialToolName('qwen', '<tool_call>\n<function=get_benchmark>\n<param')).toBe('get_benchmark');
  });
  it('drops end-of-turn tokens', () => {
    expect(stripStopTokens('Hi<|im_end|>')).toBe('Hi');
    expect(stripStopTokens('Hi<|im_end|>\n')).toBe('Hi');
  });
});

const history: ChatMessage[] = [
  { role: 'user', content: 'goal' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'design_collection', arguments: '{"goal":"g","max_benchmarks":5,"strict":true}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: '{"benchmarks":[]}' },
];

describe('toTemplateMessages', () => {
  it('writes LFM2 tool calls back as the text the model produced, and names tool results', () => {
    const msgs = toTemplateMessages('lfm2', 'sys', history);
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: '<|tool_call_start|>[design_collection(goal="g", max_benchmarks=5, strict=True)]<|tool_call_end|>' });
    expect(msgs[3]).toEqual({ role: 'tool', content: '{"benchmarks":[]}', name: 'design_collection' });
  });
  it('gives Qwen structured tool_calls with object arguments', () => {
    const msgs = toTemplateMessages('qwen', 'sys', history);
    expect(msgs[2]).toEqual({ role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'design_collection', arguments: { goal: 'g', max_benchmarks: 5, strict: true } } }] });
  });
});
