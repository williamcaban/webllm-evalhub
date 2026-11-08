import { useCallback, useEffect, useState } from 'react';
import { loadSecrets, loadSettings, PRESETS, saveSecrets, saveSettings, type ManagedBaseline } from '../lib/config';
import { DEFAULT_SYSTEM } from '../lib/prompts';
import type { ManagedProxyInfo, PresetId, Secrets, Settings } from '../types';

const baselineOf = (s: Settings): ManagedBaseline => ({ mcpmode: s.mcpmode, mcpurl: s.mcpurl, mcptenant: s.mcptenant });

/** Settings and secrets, persisted as they change. In managed-proxy mode the proxy's MCP fields are not persisted. */
export function useSettings() {
  const [initial] = useState(loadSettings);
  const [settings, setSettings] = useState<Settings>(initial);
  const [secrets, setSecrets] = useState<Secrets>(loadSecrets);
  const [managed, setManaged] = useState<ManagedProxyInfo | null>(null);
  const [baseline] = useState(() => baselineOf(initial));

  useEffect(() => saveSettings(settings, managed ? baseline : null), [settings, managed, baseline]);
  useEffect(() => saveSecrets(secrets, managed !== null), [secrets, managed]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const updateSecret = useCallback((patch: Partial<Secrets>) => setSecrets((s) => ({ ...s, ...patch })), []);

  const selectPreset = useCallback((preset: PresetId) => {
    const p = PRESETS[preset];
    setSettings((s) => ({ ...s, preset, ...(preset === 'custom' ? {} : { base: p.base, model: p.model }) }));
  }, []);
  const resetSystem = useCallback(() => update({ system: DEFAULT_SYSTEM }), [update]);

  /** The proxy holds the token and injects Authorization/X-Tenant, so the page only needs its own URL. */
  const applyManaged = useCallback((info: ManagedProxyInfo) => {
    setManaged(info);
    setSettings((s) => ({ ...s, mcpmode: 'live', mcpurl: window.location.origin + info.mcpPath, mcptenant: info.tenant }));
    setSecrets((s) => ({ ...s, mcptoken: '' }));
  }, []);

  return { settings, secrets, managed, update, updateSecret, selectPreset, resetSystem, applyManaged };
}
