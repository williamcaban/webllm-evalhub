import { Alert, Spinner } from '@patternfly/react-core';
import { useNow } from '../hooks/useNow';
import type { ActivityState } from '../types';

/** What the app is waiting on right now (model, EvalHub, or the user), and for how long. */
export function ActivityStrip({ activity }: { activity: ActivityState | null }) {
  const now = useNow(activity !== null, 200);
  if (!activity) return null;
  const approving = activity.kind === 'approve';
  const seconds = (now - activity.since) / 1000;
  const elapsed = approving ? '' : seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds)}s`;
  const hint = activity.hint?.(seconds) ?? '';
  return (
    <Alert
      isInline
      className="activity-strip"
      variant={approving ? 'warning' : 'info'}
      customIcon={approving ? undefined : <Spinner size="md" aria-hidden="true" />}
      title={
        <>
          {/* Only the label is a live region: the ticking clock would make a screen reader chatter. */}
          <span role="status">{activity.text}</span>
          <span className="activity-time" aria-hidden="true">{elapsed}</span>
        </>
      }
    >
      {hint}
    </Alert>
  );
}
