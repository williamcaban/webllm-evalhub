import { Button, Checkbox, ExpandableSection, FormGroup, FormHelperText, FormSection, FormSelect, FormSelectOption, HelperText, HelperTextItem, TextInput } from '@patternfly/react-core';
import type { OllamaState } from '../hooks/useOllamaModels';
import { BrowserModelField } from './BrowserModelField';
import { PRESETS, clampSteps } from '../lib/config';
import { findModel } from '../lib/ollama';
import { displayThinkValue, thinkOptionsFor, type ThinkingSupport } from '../lib/thinking';
import type { PresetId, Secrets, Settings, ThinkLevel } from '../types';

interface Props {
  settings: Settings;
  secrets: Secrets;
  onChange: (patch: Partial<Settings>) => void;
  onSecret: (patch: Partial<Secrets>) => void;
  onPreset: (preset: PresetId) => void;
  thinking: ThinkingSupport;
  ollama: OllamaState;
}

function thinkingHelp(support: ThinkingSupport, model: string): string {
  switch (support.kind) {
    case 'toggle': return `${model} can only switch thinking on or off (Ollama reports no effort levels). Off is much faster; thinking helps most when picking weights and thresholds.`;
    case 'levels': return `Effort levels offered by ${model}. Off is much faster; thinking helps most when picking weights and thresholds.`;
    case 'none': return `${model} has no thinking capability, so this setting has no effect.`;
    case 'unknown': return 'Sent as reasoning_effort. Supported levels depend on the model: some only switch thinking on or off, and an unknown level is ignored. Endpoints that do not support the field may reject it, so leave this on the default for those.';
  }
}

export function ModelSection({ settings, secrets, onChange, onSecret, onPreset, thinking, ollama }: Props) {
  const toolModels = ollama.models.filter((m) => m.tools);
  const unreadable = ollama.models.filter((m) => m.unreadable).map((m) => m.name);
  // A dropdown needs a list to choose from; without one (Ollama down, or nothing with tool support) the name is typed.
  const pick = ollama.status === 'loading' || (ollama.status === 'ready' && toolModels.length > 0);
  const installed = findModel(toolModels, settings.model);
  const inBrowser = settings.preset === 'browser';
  return (
    <FormSection title={inBrowser ? 'Model' : 'Model endpoint (OpenAI-compatible)'} titleElement="h2">
      <FormGroup label="Preset" fieldId="preset">
        <FormSelect id="preset" value={settings.preset} onChange={(_e, v) => onPreset(v as PresetId)}>
          {(Object.keys(PRESETS) as PresetId[]).map((id) => <FormSelectOption key={id} value={id} label={PRESETS[id].label} />)}
        </FormSelect>
      </FormGroup>
      {inBrowser ? (
        <BrowserModelField settings={settings} onChange={onChange} />
      ) : (
        <>
        <FormGroup label="Base URL (ends before /chat/completions)" fieldId="base">
          <TextInput id="base" value={settings.base} onChange={(_e, v) => onChange({ base: v })} placeholder="https://my-maas.example.com/v1" spellCheck={false} autoComplete="off" />
        </FormGroup>
        <FormGroup label="API key" fieldId="key">
          <TextInput id="key" type="password" value={secrets.key} onChange={(_e, v) => onSecret({ key: v })} placeholder="kept in this tab's sessionStorage only" autoComplete="off" />
        </FormGroup>
        <FormGroup label="Model" fieldId="model">
          {pick ? (
            <FormSelect id="model" value={settings.model} isDisabled={ollama.status === 'loading'} onChange={(_e, v) => onChange({ model: v })}>
              {ollama.status === 'loading' && <FormSelectOption value={settings.model} label="Loading models from Ollama…" />}
              {ollama.status === 'ready' && !installed && (
                <FormSelectOption value={settings.model} isPlaceholder={!settings.model} label={settings.model ? `${settings.model} (not installed, or no tool support)` : 'Select a model'} />
              )}
              {toolModels.map((m) => <FormSelectOption key={m.name} value={m.name} label={m.name} />)}
            </FormSelect>
          ) : (
            <TextInput id="model" value={settings.model} onChange={(_e, v) => onChange({ model: v })} placeholder="model name as the endpoint expects it" spellCheck={false} autoComplete="off" />
          )}
          {settings.preset === 'ollama' && ollama.status !== 'loading' && (
            <FormHelperText>
              <HelperText><HelperTextItem variant={ollama.status === 'ready' && toolModels.length > 0 ? 'default' : 'warning'}>
                {ollama.status === 'error' && 'Cannot list models: Ollama is not reachable at this Base URL. Type a model name, or start Ollama. '}
                {ollama.status === 'ready' && toolModels.length === 0 && 'No installed model supports tool calling, which this app requires. Pull one (for example ollama pull qwen3), or type a name. '}
                {ollama.status === 'ready' && toolModels.length > 0 && `${toolModels.length} of ${ollama.models.length} installed models support tool calling, which this app requires. `}
                {ollama.status === 'ready' && unreadable.length > 0 && `Ollama could not read ${unreadable.join(', ')} (its /api/show call fails, so the model is probably broken or too old for this Ollama; remove or re-pull it). `}
                <Button variant="link" isInline onClick={ollama.refresh}>Refresh</Button>
              </HelperTextItem></HelperText>
            </FormHelperText>
          )}
        </FormGroup>
        <Checkbox id="stream" label="Stream responses" isChecked={settings.stream} onChange={(_e, v) => onChange({ stream: v })} />
        </>
      )}

      <ExpandableSection toggleText="Advanced">
        <FormSection>
          {!inBrowser && <FormGroup label="Thinking" fieldId="think">
            <FormSelect id="think" value={displayThinkValue(thinking, settings.think)} isDisabled={thinking.kind === 'none'} onChange={(_e, v) => onChange({ think: v as ThinkLevel })}>
              {thinkOptionsFor(thinking).map((o) => <FormSelectOption key={o.value} value={o.value} label={o.label} />)}
            </FormSelect>
            <FormHelperText>
              <HelperText><HelperTextItem>
                {thinkingHelp(thinking, settings.model.trim() || 'The model')}
              </HelperTextItem></HelperText>
            </FormHelperText>
          </FormGroup>}
          <FormGroup label="Temperature (blank = endpoint default)" fieldId="temp">
            <TextInput id="temp" type="number" min={0} max={2} step={0.1} value={settings.temp} onChange={(_e, v) => onChange({ temp: v })} placeholder="e.g. 0.2" />
          </FormGroup>
          <FormGroup label="Max tool calls per turn" fieldId="steps">
            <TextInput id="steps" type="number" min={1} max={40} step={1} value={String(settings.steps)} onChange={(_e, v) => onChange({ steps: clampSteps(v) })} />
          </FormGroup>
        </FormSection>
      </ExpandableSection>

      {!inBrowser && (
        <FormHelperText>
          <HelperText><HelperTextItem>
            The model needs tool calling (Ollama lists this under a model's capabilities: <code>ollama show MODEL</code>). The
            design_collection result is large (a few hundred benchmarks), so use a context of 32k or more. Ollama's default is
            smaller unless you raise <code>OLLAMA_CONTEXT_LENGTH</code>.
          </HelperTextItem></HelperText>
        </FormHelperText>
      )}
    </FormSection>
  );
}
