import { describe, expect, it } from 'vitest';
import { previewCollection } from './collection';

const bm = (id: string, weight: number, threshold: number) => ({ id, provider_id: 'p', weight, pass_criteria: { threshold } });

describe('previewCollection', () => {
  it('flags a collection threshold that is the weighted average', () => {
    const p = previewCollection({ benchmarks: [bm('a', 3, 0.8), bm('b', 2, 0.7), bm('c', 2, 0.5)], pass_criteria: { threshold: 0.69 } });
    expect(p?.average).toBeCloseTo(4.8 / 7, 6);
    expect(p?.matches).toBe(true);
  });
  it('flags a mismatch and missing thresholds', () => {
    expect(previewCollection({ benchmarks: [bm('a', 1, 0.8)], pass_criteria: { threshold: 0.5 } })?.matches).toBe(false);
    const p = previewCollection({ benchmarks: [{ id: 'a' }] });
    expect(p?.average).toBeNull();
    expect(p?.rows[0]).toMatchObject({ weight: '(unset)', threshold: '—' });
  });
  it('returns null without benchmarks', () => {
    expect(previewCollection({})).toBeNull();
    expect(previewCollection(null)).toBeNull();
  });
});
