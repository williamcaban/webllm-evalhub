import type { McpTool, OpenAiTool } from './types';

/** Tools that change state in EvalHub: they wait for the user's approval when that setting is on. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['create_collection', 'submit_evaluation', 'cancel_job']);

// Some servers publish JSON Schema features OpenAI-style endpoints reject ($schema, ["x","null"] unions).
export function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      out.type = types.length === 1 ? types[0] : types;
      continue;
    }
    out[key] = cleanSchema(value);
  }
  return out;
}

export function toOpenAiTools(tools: McpTool[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: cleanSchema(t.inputSchema ?? { type: 'object', properties: {} }),
    },
  }));
}
