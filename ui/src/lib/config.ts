import { readJson, writeJson } from './storage';
import { DEFAULT_BROWSER_MODEL } from './browserModel/catalog';
import { DEFAULT_SYSTEM, persistedSystem, resolveSystem } from './prompts';
import type { ManagedProxyInfo, PresetId, Secrets, Settings, ThinkLevel } from '../types';

// Keys are unchanged from the earlier single-file page, so settings saved by it still load.
const SETTINGS_KEY = 'evalhub-chat-cfg';
const SECRETS_KEY = 'evalhub-chat-secrets';

export const PRESETS: Record<PresetId, { label: string; base: string; model: string }> = {
  browser: { label: 'In this browser (WebGPU, no server)', base: '', model: DEFAULT_BROWSER_MODEL },
  ollama: { label: 'Ollama (localhost)', base: 'http://localhost:11434/v1', model: 'lfm3:latest' },
  custom: { label: 'Custom (vLLM / MaaS / gateway)', base: '', model: '' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
};

export const THINK_OPTIONS: ReadonlyArray<{ value: ThinkLevel; label: string }> = [
  { value: '', label: 'Model default (not sent)' },
  { value: 'none', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
];

export const DEFAULT_STEPS = 12;
export const MAX_STEPS = 40;

export const DEFAULT_SETTINGS: Settings = {
  preset: 'ollama',
  base: PRESETS.ollama.base,
  model: PRESETS.ollama.model,
  think: '',
  temp: '',
  stream: true,
  steps: DEFAULT_STEPS,
  mcpmode: 'demo',
  mcpurl: '',
  mcptenant: '',
  approve: true,
  compact: true,
  system: DEFAULT_SYSTEM,
};

export function clampSteps(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_STEPS, Math.trunc(n))) : DEFAULT_STEPS;
}

/** Merge stored values over the defaults, keeping only keys of the right type. */
export function loadSettings(): Settings {
  const stored = readJson('local', SETTINGS_KEY);
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const value = stored[key];
    if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  out.steps = clampSteps(stored.steps ?? out.steps);
  out.system = resolveSystem(stored.system);
  // Earlier Ollama preset defaults: move users who never changed the model onto the current default.
  if (out.preset === 'ollama' && ['qwen2.5:14b', 'qwen3.8:latest'].includes(out.model)) out.model = PRESETS.ollama.model;
  return out;
}

export function loadSecrets(): Secrets {
  const stored = readJson('session', SECRETS_KEY);
  return {
    key: typeof stored.key === 'string' ? stored.key : '',
    mcptoken: typeof stored.mcptoken === 'string' ? stored.mcptoken : '',
  };
}

/** Fields the managed proxy fills in; they are not user settings and must not be persisted. */
export type ManagedBaseline = Pick<Settings, 'mcpmode' | 'mcpurl' | 'mcptenant'>;

export function saveSettings(settings: Settings, managedBaseline: ManagedBaseline | null): void {
  writeJson('local', SETTINGS_KEY, { ...settings, ...managedBaseline, system: persistedSystem(settings.system) });
}

export function saveSecrets(secrets: Secrets, managed: boolean): void {
  writeJson('session', SECRETS_KEY, managed ? { ...secrets, mcptoken: '' } : secrets);
}

/** Served by cors-proxy.py --config, which holds the token and adds Authorization/X-Tenant itself. */
export async function fetchManagedProxy(): Promise<ManagedProxyInfo | null> {
  if (window.location.protocol === 'file:') return null;
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const c: unknown = await res.json();
    if (!c || typeof c !== 'object' || (c as { mode?: unknown }).mode !== 'proxy') return null;
    const r = c as Record<string, unknown>;
    return {
      mcpPath: typeof r.mcp_path === 'string' ? r.mcp_path : '/mcp',
      tenant: typeof r.tenant === 'string' ? r.tenant : '',
      upstreamHost: typeof r.upstream_host === 'string' ? r.upstream_host : '',
      expiresAt: typeof r.expires_at === 'string' ? r.expires_at : '',
      expired: r.expired === true,
    };
  } catch {
    return null;
  }
}
