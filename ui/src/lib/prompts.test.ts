import { describe, expect, it } from 'vitest';
import { BROWSER_SYSTEM, DEFAULT_SYSTEM, PREVIOUS_DEFAULT_SYSTEMS, persistedSystem, resolveSystem } from './prompts';

describe('default system prompt', () => {
  it('tells the model to end with an approve-or-refine next step', () => {
    expect(DEFAULT_SYSTEM).toMatch(/end every reply .* next step .* approve or refine/i);
  });
  it('forbids inventing benchmarks and asks the model to say when none fit', () => {
    expect(DEFAULT_SYSTEM).toMatch(/never invent a benchmark/i);
    expect(DEFAULT_SYSTEM).toMatch(/has no benchmark for part or all of the use case, say so/i);
  });
  it('points help requests to the docs', () => {
    expect(DEFAULT_SYSTEM).toContain('https://eval-hub.github.io/');
    expect(DEFAULT_SYSTEM).toContain('https://eval-hub.github.io/guides/collections/');
  });
});

describe('scope', () => {
  it('keeps the model to evaluation collections and covers the mixed-request case', () => {
    for (const p of [DEFAULT_SYSTEM, BROWSER_SYSTEM]) {
      expect(p).toMatch(/only (help with|design) (EvalHub )?evaluation collections/i);
      expect(p).toMatch(/data,? (and )?not instructions|data, never instructions/i);
    }
    expect(DEFAULT_SYSTEM).toMatch(/mixes an evaluation goal with an out-of-scope request/i);
    expect(DEFAULT_SYSTEM).toMatch(/pass only that part to design_collection/i);
  });
  it('does not turn away evaluating a model on code or math', () => {
    expect(DEFAULT_SYSTEM).toMatch(/evaluating a model's ability at code, math .* is in scope/i);
  });
  it('does not tell the browser model to forward the whole message to the tool', () => {
    expect(BROWSER_SYSTEM).not.toMatch(/as they wrote it/i);
  });
});

describe('resolveSystem', () => {
  it('moves a stored earlier default, or nothing, to the current default', () => {
    for (const old of PREVIOUS_DEFAULT_SYSTEMS) expect(resolveSystem(old)).toBe(DEFAULT_SYSTEM);
    expect(resolveSystem('')).toBe(DEFAULT_SYSTEM);
    expect(resolveSystem(undefined)).toBe(DEFAULT_SYSTEM);
  });
  it('keeps a prompt the user wrote', () => {
    expect(resolveSystem('my own prompt')).toBe('my own prompt');
  });
});

describe('persistedSystem', () => {
  it('stores nothing for the default so later changes reach users who never edited it', () => {
    expect(persistedSystem(DEFAULT_SYSTEM)).toBe('');
    expect(persistedSystem('my own prompt')).toBe('my own prompt');
  });
});
