import { parseThinkingSupport, type ThinkingSupport } from './thinking';

export interface OllamaModel {
  name: string;
  /** Tool calling is required by the agent loop. */
  tools: boolean;
  thinking: ThinkingSupport;
  /** Ollama could not describe this model (a stale or incompatible download), so its capabilities are unknown. */
  unreadable: boolean;
}

/** Ollama's native API sits next to the OpenAI-compatible one: http://host:11434/v1 -> http://host:11434. */
const nativeRoot = (base: string) => base.trim().replace(/\/+$/, '').replace(/\/v1$/, '');

async function post(url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Capabilities from an /api/show reply (the data `ollama show` prints under "Capabilities"). */
export function parseModelInfo(show: unknown): Omit<OllamaModel, 'name'> {
  const caps = (show as { capabilities?: unknown } | null)?.capabilities;
  return { tools: Array.isArray(caps) && caps.includes('tools'), thinking: parseThinkingSupport(show), unreadable: false };
}

/** Every installed model with its capabilities. Rejects when Ollama cannot be reached. */
export async function listOllamaModels(base: string, signal: AbortSignal): Promise<OllamaModel[]> {
  const root = nativeRoot(base);
  if (!root) throw new Error('no base URL');
  const res = await fetch(`${root}/api/tags`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tags = (await res.json()) as { models?: Array<{ name?: string }> };
  const names = (tags.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
  const shown = await Promise.all(names.map(async (name): Promise<OllamaModel> => {
    try {
      return { name, ...parseModelInfo(await post(`${root}/api/show`, { model: name }, signal)) };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      return { name, tools: false, thinking: { kind: 'unknown' }, unreadable: true }; // one unreadable model must not hide the rest
    }
  }));
  return shown.sort((a, b) => a.name.localeCompare(b.name));
}

/** The installed model a setting refers to; Ollama also accepts a bare name for ":latest". */
export function findModel(models: OllamaModel[], name: string): OllamaModel | undefined {
  const n = name.trim();
  return models.find((m) => m.name === n || m.name === `${n}:latest`);
}
