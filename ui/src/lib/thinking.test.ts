import { describe, expect, it } from 'vitest';
import { displayThinkValue, effectiveThink, parseThinkingSupport, thinkOptionsFor } from './thinking';

// Shapes copied from Ollama 0.40 /api/show.
const lfm3 = { capabilities: ['completion', 'tools', 'thinking'], thinking: { values: [true, false], default: true } };
const gptOss = { capabilities: ['completion', 'tools', 'thinking'], thinking: { values: ['low', 'medium', 'high'], default: 'medium' } };
const plain = { capabilities: ['completion', 'tools'] };

describe('parseThinkingSupport', () => {
  it('reads an on/off model', () => {
    expect(parseThinkingSupport(lfm3)).toEqual({ kind: 'toggle', defaultOn: true });
  });
  it('reads a model with effort levels', () => {
    expect(parseThinkingSupport(gptOss)).toEqual({ kind: 'levels', levels: ['low', 'medium', 'high'], canDisable: false, defaultLevel: 'medium' });
  });
  it('reports a model without the capability', () => {
    expect(parseThinkingSupport(plain)).toEqual({ kind: 'none' });
  });
  it('stays unknown when the reply has no thinking details', () => {
    expect(parseThinkingSupport({ capabilities: ['thinking'] })).toEqual({ kind: 'unknown' });
    expect(parseThinkingSupport(null)).toEqual({ kind: 'unknown' });
  });
});

describe('thinkOptionsFor', () => {
  it('offers Default, On and Off for an on/off model, with no effort levels', () => {
    const labels = thinkOptionsFor(parseThinkingSupport(lfm3)).map((o) => o.label);
    expect(labels).toEqual(['Model default (on)', 'On', 'Off']);
  });
  it('offers only the levels the model lists', () => {
    const values = thinkOptionsFor(parseThinkingSupport(gptOss)).map((o) => o.value);
    expect(values).toEqual(['', 'low', 'medium', 'high']);
  });
});

describe('effectiveThink', () => {
  it('sends nothing to a model without thinking', () => {
    expect(effectiveThink({ kind: 'none' }, 'high')).toBe('');
  });
  it('drops a level the model does not list', () => {
    const qwen = parseThinkingSupport({ capabilities: ['thinking'], thinking: { values: [false, 'low', 'medium', 'xhigh'], default: 'medium' } });
    expect(effectiveThink(qwen, 'high')).toBe('');
    expect(effectiveThink(qwen, 'xhigh')).toBe('xhigh');
    expect(effectiveThink(qwen, 'none')).toBe('none');
  });
  it('cannot turn off a model that has no off switch', () => {
    expect(effectiveThink(parseThinkingSupport(gptOss), 'none')).toBe('');
  });
  it('sends an on/off model a single On value', () => {
    expect(effectiveThink({ kind: 'toggle', defaultOn: true }, 'high')).toBe('medium');
  });
  it('leaves everything alone when support is unknown', () => {
    expect(effectiveThink({ kind: 'unknown' }, 'high')).toBe('high');
  });
});

describe('displayThinkValue', () => {
  it('shows a stored effort level as On for an on/off model', () => {
    expect(displayThinkValue({ kind: 'toggle', defaultOn: true }, 'low')).toBe('medium');
    expect(displayThinkValue({ kind: 'toggle', defaultOn: true }, 'none')).toBe('none');
    expect(displayThinkValue({ kind: 'toggle', defaultOn: true }, '')).toBe('');
  });
});
