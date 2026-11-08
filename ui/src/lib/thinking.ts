import { THINK_OPTIONS } from './config';
import type { ThinkLevel } from '../types';

/** What the model server says about the model's thinking switch. */
export type ThinkingSupport =
  | { kind: 'toggle'; defaultOn: boolean }
  | { kind: 'levels'; levels: ThinkLevel[]; canDisable: boolean; defaultLevel: string }
  | { kind: 'none' }
  | { kind: 'unknown' };

const LEVEL_NAMES: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xhigh']);

interface ShowReply {
  capabilities?: unknown;
  thinking?: { values?: unknown; default?: unknown };
}

/** Reads Ollama's /api/show reply (`ollama show` prints the same data under "Capabilities"). */
export function parseThinkingSupport(show: unknown): ThinkingSupport {
  const reply = (show ?? {}) as ShowReply;
  const caps = Array.isArray(reply.capabilities) ? reply.capabilities : null;
  if (caps && !caps.includes('thinking')) return { kind: 'none' };
  const values = reply.thinking?.values;
  if (!Array.isArray(values)) return { kind: 'unknown' };
  const levels = values.filter((v): v is ThinkLevel => typeof v === 'string' && LEVEL_NAMES.has(v));
  const canDisable = values.includes(false);
  if (levels.length) return { kind: 'levels', levels, canDisable, defaultLevel: String(reply.thinking?.default ?? '') };
  if (values.includes(true)) return { kind: 'toggle', defaultOn: reply.thinking?.default !== false };
  return { kind: 'unknown' };
}

/** The thinking switch options that make sense for this model. */
export function thinkOptionsFor(support: ThinkingSupport): ReadonlyArray<{ value: ThinkLevel; label: string }> {
  switch (support.kind) {
    case 'toggle':
      return [
        { value: '', label: `Model default (${support.defaultOn ? 'on' : 'off'})` },
        // The OpenAI-compatible field has no plain "true"; Ollama treats any level other than "none" as on.
        { value: 'medium', label: 'On' },
        { value: 'none', label: 'Off' },
      ];
    case 'levels':
      return [
        { value: '', label: `Model default${support.defaultLevel ? ` (${support.defaultLevel})` : ''}` },
        ...(support.canDisable ? [{ value: 'none' as const, label: 'Off' }] : []),
        ...support.levels.map((v) => ({ value: v, label: THINK_OPTIONS.find((o) => o.value === v)?.label ?? v })),
      ];
    case 'none':
      return [{ value: '', label: 'Not supported by this model' }];
    case 'unknown':
      return THINK_OPTIONS;
  }
}

/** What to actually send: nothing the model would reject (Ollama refuses an effort for a model without thinking). */
export function effectiveThink(support: ThinkingSupport, stored: ThinkLevel): ThinkLevel {
  if (support.kind === 'none') return '';
  if (support.kind === 'levels' && stored !== '' && stored !== 'none' && !support.levels.includes(stored)) return '';
  if (support.kind === 'levels' && stored === 'none' && !support.canDisable) return '';
  return displayThinkValue(support, stored);
}

/** The option to show as selected: a stored level the model does not have (for example "low" on an on/off model) reads as On. */
export function displayThinkValue(support: ThinkingSupport, stored: ThinkLevel): ThinkLevel {
  if (support.kind === 'toggle') return stored === '' || stored === 'none' ? stored : 'medium';
  if (support.kind === 'none') return '';
  return stored;
}
