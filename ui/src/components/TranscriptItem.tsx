import { Alert, AlertActionLink, Card, CardBody, Content } from '@patternfly/react-core';
import type { ApprovalVerdict, ChatItem } from '../types';
import { AssistantMessage } from './AssistantMessage';
import { ToolCallCard } from './ToolCallCard';

interface Props {
  item: ChatItem;
  onDecide: (id: number, verdict: ApprovalVerdict) => void;
  onRetry: (id: number) => void;
}

export function TranscriptItem({ item, onDecide, onRetry }: Props) {
  switch (item.kind) {
    case 'user':
      return (
        <Card isCompact className="msg msg-user">
          <CardBody>
            <Content component="small" className="msg-who">you</Content>
            <div className="msg-user-text">{item.text}</div>
          </CardBody>
        </Card>
      );
    case 'assistant':
      return <AssistantMessage item={item} />;
    case 'tool':
      return <ToolCallCard item={item} onDecide={onDecide} />;
    case 'note':
      return <Alert isInline isPlain variant="info" className="msg-note" title={item.text} />;
    case 'error':
      return (
        <Alert
          isInline
          variant="danger"
          className="msg-error"
          title={item.who}
          actionLinks={item.retryable ? <AlertActionLink onClick={() => onRetry(item.id)}>Retry</AlertActionLink> : undefined}
        >
          <span className="msg-error-text">{item.text}</span>
        </Alert>
      );
  }
}
