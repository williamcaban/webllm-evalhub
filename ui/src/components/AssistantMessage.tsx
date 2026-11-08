import { Card, CardBody, Content, Spinner } from '@patternfly/react-core';
import type { ChatItem } from '../types';
import { Markdown } from './Markdown';
import { ReasoningBlock } from './ReasoningBlock';

/** One model reply: optional reasoning above, then the answer, or a spinner until the first token arrives. */
export function AssistantMessage({ item }: { item: Extract<ChatItem, { kind: 'assistant' }> }) {
  const showPending = !item.text && item.pending !== '';
  return (
    <Card isCompact className="msg msg-assistant">
      <CardBody>
        <Content component="small" className="msg-who">assistant</Content>
        {item.reasoning && <ReasoningBlock reasoning={item.reasoning} />}
        {showPending && (
          <div className="msg-pending" role="status">
            <Spinner size="sm" aria-hidden="true" /> <span>{item.pending}</span>
          </div>
        )}
        {item.text && <Markdown source={item.text} />}
      </CardBody>
    </Card>
  );
}
