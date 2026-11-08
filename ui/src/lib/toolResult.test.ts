import { describe, expect, it } from 'vitest';
import { toolResultText } from './toolResult';

const bench = (id: string, name: string, tags: string[], description = '') => ({ id, provider_id: 'p', name, tags, description, metrics: ['acc'] });
const catalog = {
  guidance: 'calibrate',
  collection_examples: [{ big: 'x'.repeat(1000) }],
  benchmarks: [
    bench('truthfulqa', 'TruthfulQA', ['truthfulness']),
    bench('ifeval', 'IFEval', ['instruction_following']),
    bench('toxigen', 'ToxiGen', ['safety', 'toxicity']),
    bench('gsm8k', 'GSM8K', ['math']),
  ],
};
const res = { structuredContent: catalog, content: [] };

describe('toolResultText for design_collection', () => {
  it('shortlists the benchmarks that match the goal, keeps the guidance, and drops the examples', () => {
    const out = JSON.parse(toolResultText('design_collection', res, true, { goal: 'a support agent that is truthful, follows instructions and avoids toxic content', limit: 20 })) as {
      guidance: string; note: string; benchmarks: Array<{ id: string }>; collection_examples?: unknown;
    };
    expect(out.benchmarks.map((b) => b.id).sort()).toEqual(['ifeval', 'toxigen', 'truthfulqa']);
    expect(out.guidance).toBe('calibrate');
    expect(out.note).toContain('3 of 4');
    expect(out).not.toHaveProperty('collection_examples');
  });
  it('honours the limit, and returns an empty shortlist when nothing matches', () => {
    const one = JSON.parse(toolResultText('design_collection', res, true, { goal: 'truthful instructions toxic', limit: 1 })) as { benchmarks: unknown[] };
    expect(one.benchmarks).toHaveLength(1);
    const none = JSON.parse(toolResultText('design_collection', res, true, { goal: 'acidity of coffee', limit: 20 })) as { benchmarks: unknown[]; note: string };
    expect(none.benchmarks).toEqual([]);
    expect(none.note).toContain('0 of 4');
  });
  it('leaves other tools and the normal compact path alone', () => {
    expect(JSON.parse(toolResultText('get_benchmark', res, true, { goal: 'truthful', limit: 1 }))).toEqual(catalog);
    const compact = JSON.parse(toolResultText('design_collection', res, true)) as { benchmarks: Array<Record<string, unknown>> };
    expect(compact.benchmarks).toHaveLength(4);
    expect(compact.benchmarks[0]).not.toHaveProperty('description');
  });
});
