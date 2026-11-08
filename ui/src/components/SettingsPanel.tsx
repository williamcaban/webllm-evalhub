import { useState } from 'react';
import { ExpandableSection, Form } from '@patternfly/react-core';
import type { OllamaState } from '../hooks/useOllamaModels';
import type { ThinkingSupport } from '../lib/thinking';
import type { ManagedProxyInfo, PresetId, Secrets, Settings } from '../types';
import { McpSection } from './McpSection';
import { ModelSection } from './ModelSection';
import { SystemPromptSection } from './SystemPromptSection';

interface Props {
  settings: Settings;
  secrets: Secrets;
  managed: ManagedProxyInfo | null;
  thinking: ThinkingSupport;
  ollama: OllamaState;
  connecting: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onSecret: (patch: Partial<Secrets>) => void;
  onPreset: (preset: PresetId) => void;
  onResetSystem: () => void;
  onConnect: () => void;
}

export function SettingsPanel(p: Props) {
  // With a managed proxy the URL, tenant and token are all fixed, so there is nothing to set: start collapsed.
  // Without one the user has to fill them in, so start open. Once the user toggles it, their choice wins.
  const [mcpOpen, setMcpOpen] = useState<boolean | null>(null);
  const managed = p.managed !== null;
  return (
    <Form className="settings" aria-label="Settings" onSubmit={(e) => e.preventDefault()}>
      <ModelSection settings={p.settings} secrets={p.secrets} onChange={p.onChange} onSecret={p.onSecret} onPreset={p.onPreset} thinking={p.thinking} ollama={p.ollama} />
      <ExpandableSection
        toggleText={managed ? 'EvalHub tools (MCP): managed by the local proxy' : 'EvalHub tools (MCP)'}
        isExpanded={mcpOpen ?? !managed}
        onToggle={(_e, open) => setMcpOpen(open)}
      >
        <McpSection settings={p.settings} secrets={p.secrets} managed={p.managed} connecting={p.connecting} onChange={p.onChange} onSecret={p.onSecret} onConnect={p.onConnect} />
      </ExpandableSection>
      <SystemPromptSection system={p.settings.system} onChange={(system) => p.onChange({ system })} onReset={p.onResetSystem} />
    </Form>
  );
}
