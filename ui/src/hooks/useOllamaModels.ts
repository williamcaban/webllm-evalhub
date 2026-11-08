import { useCallback, useEffect, useState } from 'react';
import { listOllamaModels, type OllamaModel } from '../lib/ollama';
import type { PresetId } from '../types';

export interface OllamaState {
  /** "off" when the preset is not Ollama: nothing is queried. */
  status: 'off' | 'loading' | 'ready' | 'error';
  models: OllamaModel[];
  refresh: () => void;
}

/** The models installed in a local Ollama, with their capabilities. */
export function useOllamaModels(preset: PresetId, base: string): OllamaState {
  const [state, setState] = useState<Pick<OllamaState, 'status' | 'models'>>({ status: 'off', models: [] });
  const [round, setRound] = useState(0);
  const refresh = useCallback(() => setRound((n) => n + 1), []);
  useEffect(() => {
    if (preset !== 'ollama') {
      setState({ status: 'off', models: [] });
      return;
    }
    setState((s) => ({ ...s, status: 'loading' }));
    const controller = new AbortController();
    // Wait for typing in the Base URL field to pause so each keystroke does not hit the server.
    const timer = setTimeout(() => {
      listOllamaModels(base, controller.signal).then(
        (models) => setState({ status: 'ready', models }),
        (e: unknown) => { if (!(e instanceof DOMException && e.name === 'AbortError')) setState({ status: 'error', models: [] }); },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [preset, base, round]);
  return { ...state, refresh };
}
