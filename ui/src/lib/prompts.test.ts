import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM, PREVIOUS_DEFAULT_SYSTEMS, persistedSystem, resolveSystem } from './prompts';

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

describe('resolveSystem', () => {
  it('moves a stored earlier default, or nothing, to the current default', () => {
    expect(resolveSystem(PREVIOUS_DEFAULT_SYSTEMS[0])).toBe(DEFAULT_SYSTEM);
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
