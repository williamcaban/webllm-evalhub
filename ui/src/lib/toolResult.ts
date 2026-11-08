import type { McpToolResult } from './mcp/types';

export const MAX_TOOL_CHARS = 100000;

interface DesignPayload {
  benchmarks?: Array<{ id?: string; provider_id?: string; name?: string; description?: string; category?: string; metrics?: unknown; tags?: string[] }>;
  guidance?: unknown;
}

/** Shortlist the catalog for a model too small to read all of it (the in-browser models): `limit` best matches for `goal`. */
export interface Digest {
  goal: string;
  limit: number;
}

const FILLER = new Set(['that', 'this', 'with', 'from', 'make', 'sure', 'need', 'build', 'building', 'create', 'collection', 'evaluate', 'evaluation', 'model', 'models', 'agent', 'agents', 'must', 'should', 'have', 'will', 'doesn', 'does', 'gives', 'give', 'well', 'into', 'your', 'about', 'level', 'design']);

/** First five letters of each meaningful word, so "truthful" finds "truthfulqa" and "instructions" finds "instruction_following". */
const stems = (text: string): string[] => [...new Set(text.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !FILLER.has(w)).map((w) => w.slice(0, 5)) ?? [])];

function digestDesign(payload: unknown, digest: Digest): unknown {
  const p = payload as DesignPayload | null;
  if (!p || !Array.isArray(p.benchmarks)) return payload;
  const wanted = stems(digest.goal);
  const scored = p.benchmarks
    .map((b) => {
      const hay = `${b.id ?? ''} ${b.name ?? ''} ${b.category ?? ''} ${(b.tags ?? []).join(' ')} ${b.description ?? ''}`.toLowerCase();
      return { b, score: wanted.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, c) => c.score - a.score)
    .slice(0, digest.limit);
  return {
    guidance: p.guidance,
    note: `Shortlist: the ${scored.length} of ${p.benchmarks.length} catalog benchmarks that best match the goal. The rest were left out to fit a small model. If none fits, say so; do not invent one.`,
    benchmarks: scored.map(({ b }) => ({ id: b.id, provider_id: b.provider_id, name: b.name, metrics: b.metrics, tags: (b.tags ?? []).slice(0, 4) })),
  };
}

// design_collection returns hundreds of benchmarks with long descriptions; the model only needs ids,
// names, metrics and a few tags to choose, which keeps the context small enough for local models.
function compactDesign(payload: unknown): unknown {
  const p = payload as DesignPayload | null;
  if (!p || !Array.isArray(p.benchmarks)) return payload;
  return {
    ...p,
    benchmarks: p.benchmarks.map((b) => ({ id: b.id, provider_id: b.provider_id, name: b.name, metrics: b.metrics, tags: (b.tags ?? []).slice(0, 5) })),
  };
}

/** The text the model receives for a tool result (and what the tool card shows). */
export function toolResultText(name: string, res: McpToolResult, compact: boolean, digest: Digest | null = null): string {
  let text: string;
  if (res.structuredContent && !res.isError) {
    const design = name === 'design_collection';
    const payload = design && digest ? digestDesign(res.structuredContent, digest) : compact && design ? compactDesign(res.structuredContent) : res.structuredContent;
    text = JSON.stringify(payload);
  } else {
    text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type} content]`)).join('\n');
  }
  if (res.isError) text = `ERROR: ${text}`;
  if (text.length > MAX_TOOL_CHARS) text = `${text.slice(0, MAX_TOOL_CHARS)}\n…[truncated ${text.length - MAX_TOOL_CHARS} chars]`;
  return text;
}
