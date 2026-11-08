import { afterEach, describe, expect, it, vi } from 'vitest';
import { findModel, listOllamaModels, parseModelInfo } from './ollama';

const shows: Record<string, unknown> = {
  'lfm3:latest': { capabilities: ['completion', 'tools', 'thinking'], thinking: { values: [true, false], default: true } },
  'gemma3:latest': { capabilities: ['completion', 'vision'] },
  'nomic-embed:latest': { capabilities: ['embedding'] },
};

function fakeOllama() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: Object.keys(shows).map((name) => ({ name })) });
    const { model } = JSON.parse(String(init?.body)) as { model: string };
    return Response.json(shows[model]);
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('parseModelInfo', () => {
  it('flags tool support from capabilities', () => {
    expect(parseModelInfo(shows['lfm3:latest']).tools).toBe(true);
    expect(parseModelInfo(shows['gemma3:latest']).tools).toBe(false);
    expect(parseModelInfo(null).tools).toBe(false);
  });
});

describe('listOllamaModels', () => {
  it('lists installed models sorted, with capabilities, from the native API behind /v1', async () => {
    fakeOllama();
    const models = await listOllamaModels('http://localhost:11434/v1', new AbortController().signal);
    expect(models.map((m) => m.name)).toEqual(['gemma3:latest', 'lfm3:latest', 'nomic-embed:latest']);
    expect(models.filter((m) => m.tools).map((m) => m.name)).toEqual(['lfm3:latest']);
    expect(models.find((m) => m.name === 'lfm3:latest')?.thinking).toEqual({ kind: 'toggle', defaultOn: true });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://localhost:11434/api/tags');
  });
  it('keeps a model Ollama cannot describe, flagged unreadable, without hiding the others', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'broken:latest' }, { name: 'lfm3:latest' }] });
      const { model } = JSON.parse(String(init?.body)) as { model: string };
      return model === 'broken:latest' ? Response.json({ error: 'read GGUF metadata' }, { status: 500 }) : Response.json(shows[model]);
    }));
    const models = await listOllamaModels('http://localhost:11434/v1', new AbortController().signal);
    expect(models.map((m) => [m.name, m.tools, m.unreadable])).toEqual([['broken:latest', false, true], ['lfm3:latest', true, false]]);
  });
  it('rejects when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(listOllamaModels('http://localhost:11434/v1', new AbortController().signal)).rejects.toThrow();
  });
});

describe('findModel', () => {
  const models = [{ name: 'lfm3:latest', tools: true, thinking: { kind: 'unknown' as const }, unreadable: false }];
  it('matches a bare name to :latest', () => {
    expect(findModel(models, 'lfm3')?.name).toBe('lfm3:latest');
    expect(findModel(models, 'nope')).toBeUndefined();
  });
});
