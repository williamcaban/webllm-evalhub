import { Button, FormGroup, FormHelperText, FormSelect, FormSelectOption, HelperText, HelperTextItem, Progress, ProgressMeasureLocation } from '@patternfly/react-core';
import { useBrowserModel } from '../hooks/useBrowserModel';
import { BROWSER_MODELS, findBrowserModel } from '../lib/browserModel/catalog';
import { hasWebGpu, loadBrowserModel } from '../lib/browserModel/engine';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** Model picker for the in-browser preset: choose a model, and download it ahead of the first message if wanted. */
export function BrowserModelField({ settings, onChange }: Props) {
  const load = useBrowserModel();
  const spec = findBrowserModel(settings.model);
  const mine = load.key === settings.model;
  const loading = mine && load.status === 'loading';
  const ready = mine && load.status === 'ready';
  const pct = load.total > 0 ? Math.min(100, Math.round((load.loaded / load.total) * 100)) : 0;
  const webgpu = hasWebGpu();
  return (
    <FormGroup label="Model (runs in this browser tab)" fieldId="model">
      <FormSelect id="model" value={settings.model} onChange={(_e, v) => onChange({ model: v })}>
        {!spec && <FormSelectOption value={settings.model} label={`${settings.model || 'Select a model'} (not available in the browser)`} />}
        {BROWSER_MODELS.map((m) => <FormSelectOption key={m.key} value={m.key} label={`${m.label} · ${m.downloadMb} MB`} />)}
      </FormSelect>
      {spec && <FormHelperText><HelperText><HelperTextItem>{spec.note}</HelperTextItem></HelperText></FormHelperText>}
      {loading && (
        <Progress
          aria-label="Model download"
          value={pct}
          measureLocation={ProgressMeasureLocation.outside}
          title={load.total > 0 ? `Downloading ${(load.loaded / 1e6).toFixed(0)} of ${(load.total / 1e6).toFixed(0)} MB` : 'Loading'}
          size="sm"
        />
      )}
      {spec && !ready && !loading && (
        <Button variant="secondary" size="sm" onClick={() => { void loadBrowserModel(spec).catch(() => undefined); }}>
          {mine && load.status === 'error' ? 'Retry download' : `Download and load (${spec.downloadMb} MB)`}
        </Button>
      )}
      <FormHelperText>
        <HelperText>
          {ready && <HelperTextItem variant="success">Loaded. Running on {load.device === 'webgpu' ? 'the GPU (WebGPU)' : 'the CPU (WebAssembly)'}.</HelperTextItem>}
          {mine && load.status === 'error' && <HelperTextItem variant="error">{load.error}</HelperTextItem>}
          {!webgpu && <HelperTextItem variant="warning">This browser has no WebGPU, so the model runs on the CPU and is much slower. Use a recent Chrome, Edge or Safari.</HelperTextItem>}
          <HelperTextItem>
            The weights are fetched once from huggingface.co and then kept by the browser; after that no server is involved. Sending a
            message loads the model too. Small models get a shorter built-in system prompt, unless you edit the one below.
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
    </FormGroup>
  );
}
