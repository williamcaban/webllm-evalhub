import { Button, ExpandableSection, FormSection, TextArea } from '@patternfly/react-core';

interface Props {
  system: string;
  onChange: (system: string) => void;
  onReset: () => void;
}

export function SystemPromptSection({ system, onChange, onReset }: Props) {
  return (
    <FormSection title="System prompt" titleElement="h2">
      <ExpandableSection toggleText="Edit">
        <TextArea id="system" aria-label="System prompt" value={system} onChange={(_e, v) => onChange(v)} rows={14} resizeOrientation="vertical" spellCheck={false} />
        <Button variant="secondary" size="sm" onClick={onReset}>Reset to default</Button>
      </ExpandableSection>
    </FormSection>
  );
}
