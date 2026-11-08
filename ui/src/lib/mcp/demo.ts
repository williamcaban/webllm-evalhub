import { DEMO_CATALOG, DEMO_EXAMPLES, DEMO_PROVIDERS, DEMO_TOOLS, type DemoBenchmark } from './demoData';
import type { McpConnection, McpTool, McpToolResult } from './types';

interface DemoBenchmarkRef {
  id?: string;
  provider_id?: string;
  weight?: number;
  pass_criteria?: { threshold?: number };
}

/** Every argument any demo tool accepts; each handler reads only its own. */
interface DemoArgs {
  target_type?: string;
  evaluates?: string[];
  query?: string;
  category?: string;
  provider_id?: string;
  labels?: string[];
  limit?: number;
  benchmark_id?: string;
  evaluation_goal?: string;
  provider_filter?: string;
  max_benchmarks?: number;
  strictness?: string;
  name?: string;
  domains?: string[];
  pass_criteria?: { threshold?: number };
  benchmarks?: DemoBenchmarkRef[];
  model?: { name?: string };
  collection?: { id: string };
  job_id?: string;
}

const demoBenchmarkOut = (b: DemoBenchmark) => ({
  id: b.id, provider_id: b.provider_id, name: b.name, description: b.description, category: b.category,
  metrics: b.metrics, tags: b.tags, primary_score: { metric: b.metrics[0], lower_is_better: b.lower },
  pass_criteria: { threshold: b.thr },
});

const ok = (structured: unknown, text?: string): McpToolResult => ({
  content: [{ type: 'text', text: text ?? JSON.stringify(structured) }],
  structuredContent: structured,
});
const fail = (message: string): McpToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });
const inUnit = (t: number | undefined) => t == null || (t >= 0 && t <= 1);

/** A simulated EvalHub MCP server that runs in the browser, with a small SAMPLE catalog. */
export class DemoMcp implements McpConnection {
  readonly label = 'Demo' as const;
  private readonly collections = new Map<string, DemoArgs>();
  private readonly jobs = new Map<string, { started: number; cancelled: boolean }>();

  async init(): Promise<void> {}

  async listTools(): Promise<McpTool[]> {
    return DEMO_TOOLS;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const a = args as DemoArgs;
    switch (name) {
      case 'discover_providers': return this.discoverProviders(a);
      case 'search_benchmarks': return this.searchBenchmarks(a);
      case 'get_benchmark': return this.getBenchmark(a);
      case 'design_collection': return this.designCollection(a);
      case 'create_collection': return this.createCollection(a);
      case 'submit_evaluation': return this.submitEvaluation(a);
      case 'get_job_status': return this.getJobStatus(a);
      case 'cancel_job': return this.cancelJob(a);
      default: return fail(`Unknown tool: ${name}`);
    }
  }

  private discoverProviders(a: DemoArgs): McpToolResult {
    let providers = DEMO_PROVIDERS;
    if (a.target_type) providers = providers.filter((p) => p.target_type === a.target_type);
    if (a.evaluates?.length) providers = providers.filter((p) => a.evaluates?.every((e) => p.evaluates.includes(e)));
    return ok({ providers });
  }

  private searchBenchmarks(a: DemoArgs): McpToolResult {
    const q = (a.query ?? '').toLowerCase();
    const matches = DEMO_CATALOG.filter((b) =>
      (!q || [b.id, b.name, b.description, ...b.tags].join(' ').toLowerCase().includes(q)) &&
      (!a.category || b.category === a.category) &&
      (!a.provider_id || b.provider_id === a.provider_id) &&
      (!a.labels?.length || a.labels.every((l) => b.tags.some((t) => t.toLowerCase() === l.toLowerCase()))));
    return ok({ benchmarks: matches.slice(0, a.limit || 50).map(demoBenchmarkOut), total: matches.length });
  }

  private getBenchmark(a: DemoArgs): McpToolResult {
    const b = DEMO_CATALOG.find((x) => x.id === a.benchmark_id && (!a.provider_id || x.provider_id === a.provider_id));
    return b ? ok(demoBenchmarkOut(b)) : fail(`benchmark not found: ${a.benchmark_id}`);
  }

  private designCollection(a: DemoArgs): McpToolResult {
    if (!a.evaluation_goal) return fail('evaluation_goal is required');
    const filter = a.provider_filter ? a.provider_filter.split(',').map((s) => s.trim()) : null;
    const catalog = DEMO_CATALOG.filter((b) => !filter || filter.includes(b.provider_id));
    const guidance =
`Design a collection for: ${a.evaluation_goal}
Select at most ${a.max_benchmarks || 12} benchmarks from the catalog in the structured "benchmarks" field. Set weights (higher = more important), a per-benchmark pass_criteria threshold, and a collection-level pass_criteria threshold (weighted average of benchmark thresholds). Fill name, description, domains (snake_case, at least one) and tags.
Threshold calibration: safety (toxicity, bias, fairness) 0.75-0.90; general MCQ accuracy 0.40-0.65 (random baseline 0.25); competition math 0.10-0.20; code pass@1 0.20-0.35; long-context 0.35-0.55; attack success rate is lower_is_better with a ceiling of 0.15-0.25.
Strictness: ${a.strictness || 'moderate'} (lenient multiplies thresholds by ~0.85, strict by ~1.10 capped at 1.0 for accuracy metrics).
[demo mode: sample catalog, ids are illustrative]`;
    return ok({
      guidance,
      benchmarks: catalog.map((b) => ({ id: b.id, provider_id: b.provider_id, name: b.name, description: b.description, tags: b.tags, metrics: b.metrics })),
      collection_examples: DEMO_EXAMPLES,
    }, 'Guidance only. The benchmark catalog and reference collections are provided in the structured fields.');
  }

  private createCollection(a: DemoArgs): McpToolResult {
    if (!a.name) return fail('name is required');
    if (!Array.isArray(a.domains) || !a.domains.length) return fail('at least one domain is required');
    if (a.domains.some((d) => !/^[a-z][a-z0-9_]*$/.test(d))) return fail('domains must be snake_case');
    if (!Array.isArray(a.benchmarks) || !a.benchmarks.length) return fail('at least one benchmark is required');
    for (const b of a.benchmarks) {
      if (!b.id || !b.provider_id) return fail('every benchmark needs id and provider_id');
      if (!DEMO_CATALOG.some((c) => c.id === b.id && c.provider_id === b.provider_id)) return fail(`unknown benchmark ${b.provider_id}/${b.id}: not in the catalog`);
      if (b.weight != null && !(Number(b.weight) >= 0)) return fail(`weight must be >= 0 for ${b.id}`);
      if (!inUnit(b.pass_criteria?.threshold)) return fail(`threshold must be within 0..1 for ${b.id}`);
    }
    if (!inUnit(a.pass_criteria?.threshold)) return fail('collection threshold must be within 0..1');
    const id = crypto.randomUUID();
    this.collections.set(id, a);
    return ok({ id, name: a.name, benchmark_count: a.benchmarks.length, created: true });
  }

  private submitEvaluation(a: DemoArgs): McpToolResult {
    if (!a.name || !a.model?.name) return fail('name and model.name are required');
    if (!!a.benchmarks?.length === !!a.collection) return fail('provide benchmarks OR collection, not both');
    if (a.collection && !this.collections.has(a.collection.id) && !DEMO_EXAMPLES.some((e) => e.id === a.collection?.id)) return fail(`collection not found: ${a.collection.id}`);
    const jobId = crypto.randomUUID();
    this.jobs.set(jobId, { started: Date.now(), cancelled: false });
    return ok({ job_id: jobId, state: 'pending' });
  }

  private getJobStatus(a: DemoArgs): McpToolResult {
    const job = a.job_id ? this.jobs.get(a.job_id) : undefined;
    if (!job) return fail(`job not found: ${a.job_id}`);
    const pct = job.cancelled ? 0 : Math.min(100, Math.round(((Date.now() - job.started) / 20000) * 100));
    const state = job.cancelled ? 'cancelled' : pct >= 100 ? 'completed' : 'running';
    return ok({ job_id: a.job_id, state, progress_percent: pct, note: 'simulated job (demo mode), no model was evaluated' });
  }

  private cancelJob(a: DemoArgs): McpToolResult {
    const job = a.job_id ? this.jobs.get(a.job_id) : undefined;
    if (!job) return fail(`job not found: ${a.job_id}`);
    job.cancelled = true;
    return ok({ job_id: a.job_id, state: 'cancelled' });
  }
}
