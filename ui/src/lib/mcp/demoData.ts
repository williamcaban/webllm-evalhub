import type { McpTool } from './types';

// SAMPLE data for the simulated EvalHub: ids are illustrative and do not come from a real catalog.

export interface DemoBenchmark {
  id: string;
  provider_id: string;
  name: string;
  category: string;
  metrics: string[];
  tags: string[];
  description: string;
  lower: boolean;
  thr: number;
}

const mkb = (
  id: string, provider_id: string, name: string, category: string, metric: string,
  tags: string[], description: string, lower = false, thr = 0.5,
): DemoBenchmark => ({ id, provider_id, name, category, metrics: [metric], tags, description, lower, thr });

export const DEMO_CATALOG: DemoBenchmark[] = [
  mkb('toxigen', 'lm_evaluation_harness', 'ToxiGen', 'safety', 'acc', ['safety', 'toxicity', 'bias'], 'Implicit hate speech detection across demographic groups.', false, 0.8),
  mkb('truthfulqa_mc1', 'lm_evaluation_harness', 'TruthfulQA (MC1)', 'safety', 'acc', ['safety', 'truthfulness'], 'Single-answer multiple choice measuring imitation of common falsehoods.', false, 0.5),
  mkb('bigbench_hhh_alignment_multiple_choice', 'lm_evaluation_harness', 'BIG-bench HHH alignment', 'safety', 'acc', ['safety', 'alignment'], 'Helpful, honest, harmless preference choices.', false, 0.75),
  mkb('bbq', 'lm_evaluation_harness', 'BBQ', 'safety', 'acc', ['safety', 'bias', 'fairness'], 'Question answering probing social bias.', false, 0.7),
  mkb('ifeval', 'lm_evaluation_harness', 'IFEval', 'instruction_following', 'inst_level_strict_acc', ['instruction_following'], 'Verifiable instruction following.', false, 0.6),
  mkb('mmlu', 'lm_evaluation_harness', 'MMLU', 'general', 'acc', ['general', 'knowledge'], '57-subject multiple choice knowledge test.', false, 0.55),
  mkb('mmlu_pro', 'lm_evaluation_harness', 'MMLU-Pro', 'reasoning', 'exact_match', ['reasoning', 'knowledge'], 'Harder 10-option MMLU variant.', false, 0.4),
  mkb('gsm8k', 'lm_evaluation_harness', 'GSM8K', 'reasoning', 'exact_match', ['reasoning', 'math'], 'Grade-school math word problems.', false, 0.5),
  mkb('hellaswag', 'lm_evaluation_harness', 'HellaSwag', 'general', 'acc_norm', ['general', 'commonsense'], 'Commonsense sentence completion.', false, 0.6),
  mkb('arc_challenge', 'lm_evaluation_harness', 'ARC Challenge', 'reasoning', 'acc_norm', ['reasoning', 'science'], 'Hard grade-school science questions.', false, 0.5),
  mkb('gpqa_diamond', 'lighteval', 'GPQA Diamond', 'reasoning', 'acc', ['reasoning', 'science'], 'Graduate-level expert science questions.', false, 0.3),
  mkb('math_500', 'lighteval', 'MATH-500', 'reasoning', 'extractive_match', ['reasoning', 'math'], 'Competition-style math subset.', false, 0.4),
  mkb('aime25', 'lighteval', 'AIME 2025', 'reasoning', 'extractive_match', ['reasoning', 'math'], 'Competition math, very hard.', false, 0.15),
  mkb('livecodebench_v6', 'inspect', 'LiveCodeBench v6', 'code', 'pass@1', ['code', 'programming'], 'Fresh competitive programming problems.', false, 0.25),
  mkb('mrcr_2needle', 'inspect', 'MRCR (2 needle)', 'long_context', 'auc', ['long_context', 'retrieval'], 'Multi-round coreference retrieval over long context.', false, 0.45),
  mkb('mrcr_4needle', 'inspect', 'MRCR (4 needle)', 'long_context', 'auc', ['long_context', 'retrieval'], 'Same task with four needles.', false, 0.4),
  mkb('garak_intents', 'garak', 'garak intents', 'safety', 'attack_success_rate', ['safety', 'red_teaming', 'security'], 'Adversarial probes; lower attack success is better.', true, 0.2),
];

export const DEMO_PROVIDERS = [
  { id: 'lm_evaluation_harness', title: 'lm-evaluation-harness', target_type: 'model', evaluates: ['accuracy', 'safety', 'reasoning', 'instruction_following'] },
  { id: 'lighteval', title: 'LightEval', target_type: 'model', evaluates: ['accuracy', 'reasoning'] },
  { id: 'inspect', title: 'Inspect', target_type: 'model', evaluates: ['code', 'long_context', 'agents'] },
  { id: 'garak', title: 'garak', target_type: 'model', evaluates: ['safety', 'security', 'red_teaming'] },
];

const ref = (id: string, provider_id: string, weight: number, metric: string, threshold: number) => ({
  id, provider_id, weight, primary_score: { metric, lower_is_better: false }, pass_criteria: { threshold },
});

export const DEMO_EXAMPLES = [
  { id: 'safety-and-fairness-v1', name: 'Safety and fairness', domains: ['safety'], description: 'Toxicity, bias and truthfulness gate.',
    pass_criteria: { threshold: 0.7 },
    benchmarks: [
      ref('toxigen', 'lm_evaluation_harness', 3, 'acc', 0.8),
      ref('bbq', 'lm_evaluation_harness', 2, 'acc', 0.7),
      ref('truthfulqa_mc1', 'lm_evaluation_harness', 2, 'acc', 0.5),
    ] },
  { id: 'standard-llm-evals-v1', name: 'Standard LLM evals', domains: ['general', 'reasoning'], description: 'General capability baseline.',
    pass_criteria: { threshold: 0.55 },
    benchmarks: [
      ref('mmlu', 'lm_evaluation_harness', 2, 'acc', 0.55),
      ref('gsm8k', 'lm_evaluation_harness', 2, 'exact_match', 0.5),
      ref('hellaswag', 'lm_evaluation_harness', 1, 'acc_norm', 0.6),
    ] },
];

// Names, descriptions and input schemas mirror the real EvalHub MCP server's tools.
export const DEMO_TOOLS: McpTool[] = [
  { name: 'discover_providers', description: 'Discover evaluation providers. Filter by target_type (model, agent, inference_server) and/or evaluates (e.g. safety, robustness) to find the right provider for your use case.',
    inputSchema: { type: 'object', properties: { target_type: { type: 'string' }, evaluates: { type: 'array', items: { type: 'string' } } } } },
  { name: 'search_benchmarks', description: 'Search the live benchmark catalog and return matching benchmarks with their id and provider_id. Filter by query (substring), labels (tags), category, and/or provider_id.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, category: { type: 'string' }, provider_id: { type: 'string' }, limit: { type: 'integer' } } } },
  { name: 'get_benchmark', description: 'Look up a single benchmark by its ID. Returns full detail including the provider_id, metrics, primary_score, and pass_criteria threshold.',
    inputSchema: { type: 'object', required: ['benchmark_id'], properties: { benchmark_id: { type: 'string' }, provider_id: { type: 'string' } } } },
  { name: 'design_collection', description: 'Design a benchmark collection from a natural-language evaluation goal. Fetches the live provider catalog and curated collection examples and returns guidance for benchmark selection, weight assignment, and threshold calibration. Returns guidance only: follow it up with create_collection to persist the design.',
    inputSchema: { type: 'object', required: ['evaluation_goal'], properties: { evaluation_goal: { type: 'string' }, provider_filter: { type: 'string', description: "Comma-separated provider IDs, e.g. 'lm_evaluation_harness,lighteval'" }, max_benchmarks: { type: 'integer' }, strictness: { type: 'string', enum: ['lenient', 'moderate', 'strict'] } } } },
  { name: 'create_collection', description: 'Create a new benchmark collection. Use after designing a collection to persist it in eval-hub. The collection can then be used with submit_evaluation.',
    inputSchema: { type: 'object', required: ['name', 'domains', 'benchmarks'], properties: {
      name: { type: 'string' }, description: { type: 'string' }, domains: { type: 'array', items: { type: 'string' }, description: 'snake_case, at least one' },
      tags: { type: 'array', items: { type: 'string' } }, pass_criteria: { type: 'object', properties: { threshold: { type: 'number' } } },
      benchmarks: { type: 'array', items: { type: 'object', required: ['id', 'provider_id'], properties: {
        id: { type: 'string' }, provider_id: { type: 'string' }, weight: { type: 'number' },
        primary_score: { type: 'object', properties: { metric: { type: 'string' }, lower_is_better: { type: 'boolean' } } },
        pass_criteria: { type: 'object', properties: { threshold: { type: 'number' } } }, parameters: { type: 'object' } } } } } } },
  { name: 'submit_evaluation', description: 'Submit a new model evaluation job. Specify benchmarks OR a collection, plus the model endpoint to evaluate. Returns the job ID and initial state.',
    inputSchema: { type: 'object', required: ['name', 'model'], properties: { name: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      model: { type: 'object', required: ['name'], properties: { url: { type: 'string' }, name: { type: 'string' } } },
      benchmarks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, provider_id: { type: 'string' } } } },
      collection: { type: 'object', properties: { id: { type: 'string' } } } } } },
  { name: 'get_job_status', description: 'Get the current status of an evaluation job including overall state and progress percentage. Designed for polling.',
    inputSchema: { type: 'object', required: ['job_id'], properties: { job_id: { type: 'string' } } } },
  { name: 'cancel_job', description: 'Cancel a running or pending evaluation job.',
    inputSchema: { type: 'object', required: ['job_id'], properties: { job_id: { type: 'string' } } } },
];
