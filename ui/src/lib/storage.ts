type Area = 'local' | 'session';

// Storage can be missing or throw (private windows, blocked site data), so every access is guarded.
function area(kind: Area): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson(kind: Area, key: string): Record<string, unknown> {
  try {
    const raw = area(kind)?.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function writeJson(kind: Area, key: string, value: unknown): void {
  try {
    area(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: settings simply do not persist
  }
}
