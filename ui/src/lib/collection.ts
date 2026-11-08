export interface PreviewRow {
  id: string;
  provider: string;
  weight: string;
  threshold: string;
}

export interface CollectionPreview {
  rows: PreviewRow[];
  /** Weighted average of the benchmark thresholds, or null when nothing can be averaged. */
  average: number | null;
  /** The collection-level threshold the model proposed, if it is a number. */
  given: number | null;
  matches: boolean;
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** The collection threshold must be the weighted average of its benchmark thresholds: show whether it is. */
export function previewCollection(args: unknown): CollectionPreview | null {
  const benchmarks = record(args).benchmarks;
  if (!Array.isArray(benchmarks) || !benchmarks.length) return null;
  let num = 0;
  let den = 0;
  const rows = benchmarks.map((entry): PreviewRow => {
    const b = record(entry);
    const weight = Number(b.weight ?? 1);
    const threshold = record(b.pass_criteria).threshold;
    if (Number.isFinite(weight) && typeof threshold === 'number') {
      num += weight * threshold;
      den += weight;
    }
    return {
      id: String(b.id ?? '?'),
      provider: String(b.provider_id ?? '?'),
      weight: String(b.weight ?? '(unset)'),
      threshold: threshold === undefined || threshold === null ? '—' : String(threshold),
    };
  });
  const average = den > 0 ? num / den : null;
  const proposed = record(record(args).pass_criteria).threshold;
  const given = typeof proposed === 'number' ? proposed : null;
  return { rows, average, given, matches: average !== null && given !== null && Math.abs(given - average) < 0.005 };
}
