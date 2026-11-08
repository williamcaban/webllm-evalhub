import { useEffect, useState } from 'react';
import { Button, Card, CardBody, CodeBlock, CodeBlockCode, Content, ExpandableSection, Label, Spinner } from '@patternfly/react-core';
import CogIcon from '@patternfly/react-icons/dist/esm/icons/cog-icon';
import { useNow } from '../hooks/useNow';
import type { ApprovalVerdict, ChatItem, ToolStatus } from '../types';
import { CollectionPreview } from './CollectionPreview';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

const STATUS_COLOR: Record<ToolStatus, 'orange' | 'blue' | 'green' | 'red'> = {
  pending: 'orange', running: 'blue', ok: 'green', error: 'red', denied: 'red',
};
const RESULT_PREVIEW_CHARS = 8000;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** One MCP tool call: arguments, live status and timer, the result, and the approve/deny gate for write tools. */
export function ToolCallCard({ item, onDecide }: { item: ToolItem; onDecide: (id: number, verdict: ApprovalVerdict) => void }) {
  const running = item.status === 'running';
  const now = useNow(running, 200);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (item.approval === 'awaiting') setExpanded(true); }, [item.approval]);

  const statusText = running
    ? `running ${seconds(now - item.startedAt)}`
    : item.label + ((item.status === 'ok' || item.status === 'error') && item.tookMs ? ` · ${seconds(item.tookMs)}` : '');
  const shown = item.result && item.result.length > RESULT_PREVIEW_CHARS
    ? `${item.result.slice(0, RESULT_PREVIEW_CHARS)}\n…[${item.result.length - RESULT_PREVIEW_CHARS} more chars not shown here]`
    : item.result;
  const decided = item.approval === 'done';

  return (
    <Card isCompact className={running ? 'tool-card tool-card-live' : 'tool-card'}>
      <CardBody>
        <ExpandableSection
          isExpanded={expanded}
          onToggle={(_e, open) => setExpanded(open)}
          toggleContent={
            <span className="tool-toggle">
              <CogIcon aria-hidden="true" />
              <code className="tool-name">{item.name}</code>
              <Label isCompact color={STATUS_COLOR[item.status]} icon={running ? <Spinner size="sm" aria-hidden="true" /> : undefined}>{statusText}</Label>
            </span>
          }
        >
          <Content component="h4">Arguments</Content>
          <CodeBlock className="tool-pre"><CodeBlockCode>{JSON.stringify(item.args, null, 2)}</CodeBlockCode></CodeBlock>
          {item.approval !== 'none' && item.name === 'create_collection' && <CollectionPreview args={item.args} />}
          {item.approval !== 'none' && (
            <div className="approve-row">
              <Button variant="primary" isDisabled={decided} onClick={() => onDecide(item.id, 'approve')}>Approve and run</Button>
              <Button variant="secondary" isDisabled={decided} onClick={() => onDecide(item.id, 'deny')}>Deny</Button>
              <Label isCompact color="orange">{item.name} changes state in EvalHub.</Label>
            </div>
          )}
          {shown !== null && (
            <>
              <Content component="h4">Result</Content>
              <CodeBlock className="tool-pre">
                <CodeBlockCode>{shown + (item.sentChars !== null ? `\n\n[${item.sentChars} chars sent to the model]` : '')}</CodeBlockCode>
              </CodeBlock>
            </>
          )}
        </ExpandableSection>
      </CardBody>
    </Card>
  );
}
