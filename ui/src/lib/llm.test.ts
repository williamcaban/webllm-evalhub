import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion, ModelHttpError, type ModelRequest } from './llm';

const req = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  base: 'http://m/v1/', apiKey: '', model: 'x', system: 's', messages: [], tools: [], stream: true, temperature: null, reasoningEffort: '', ...over,
});
const sse = (events: unknown[]) => new Response(new ReadableStream({
  start(c) {
    const enc = new TextEncoder();
    for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
    c.enqueue(enc.encode('data: [DONE]\n\n'));
    c.close();
  },
}));
const mockFetch = (res: Response) => { const f = vi.fn(async () => res); vi.stubGlobal('fetch', f); return f; };
const signal = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('chatCompletion', () => {
  it('streams reasoning, then content, through the hooks', async () => {
    mockFetch(sse([
      { choices: [{ delta: { reasoning: 'hm' } }] }, { choices: [{ delta: { reasoning_content: 'mm' } }] },
      { choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: { content: 'lo' } }] },
    ]));
    const events: string[] = [];
    const reply = await chatCompletion(req(), {
      onThought: (d) => events.push(`t:${d}`), onContent: (_d, full) => events.push(`c:${full}`),
    }, signal);
    expect(events).toEqual(['t:hm', 't:mm', 'c:Hel', 'c:Hello']);
    expect(reply).toMatchObject({ text: 'Hello', toolCalls: [] });
  });

  it('accumulates a tool call split across chunks', async () => {
    mockFetch(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'design_', arguments: '{"evalu' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'collection', arguments: 'ation_goal":"x"}' } }] } }] },
    ]));
    const names: string[] = [];
    const reply = await chatCompletion(req(), { onToolName: (n) => names.push(n) }, signal);
    expect(names).toEqual(['design_', 'design_collection']);
    expect(reply.toolCalls).toEqual([{ id: 'c1', type: 'function', function: { name: 'design_collection', arguments: '{"evaluation_goal":"x"}' } }]);
  });

  it('reads a non-streamed reply with reasoning and tool calls', async () => {
    mockFetch(new Response(JSON.stringify({ choices: [{ message: { content: 'ok', reasoning_content: 'because', tool_calls: [{ id: 't', function: { name: 'get_job_status', arguments: '' } }] } }] })));
    const reply = await chatCompletion(req({ stream: false }), {}, signal);
    expect(reply.reasoning).toBe('because');
    expect(reply.toolCalls[0]?.function).toEqual({ name: 'get_job_status', arguments: '{}' });
  });

  it('sends optional fields only when set, and trims the base URL', async () => {
    const f = mockFetch(sse([]));
    await chatCompletion(req({ temperature: 0.2, reasoningEffort: 'low', apiKey: 'k' }), {}, signal);
    const calls = f.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0] ?? ['', {}];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe('http://m/v1/chat/completions');
    expect(body).toMatchObject({ temperature: 0.2, reasoning_effort: 'low', stream: true });
    expect(body).not.toHaveProperty('tools');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('marks Ollama tool-call parse failures as retryable', async () => {
    mockFetch(new Response('{"error":{"message":"XML syntax error on line 15: unexpected EOF"}}', { status: 500 }));
    await expect(chatCompletion(req(), {}, signal)).rejects.toMatchObject({ status: 500, toolParse: true });
    mockFetch(new Response('model runner crashed', { status: 500 }));
    const err = await chatCompletion(req(), {}, signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelHttpError);
    expect((err as ModelHttpError).toolParse).toBe(false);
  });

  it('explains an unreachable endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(chatCompletion(req(), {}, signal)).rejects.toThrow(/Cannot reach the model endpoint http:\/\/m\/v1 .*OLLAMA_ORIGINS/);
  });
});
