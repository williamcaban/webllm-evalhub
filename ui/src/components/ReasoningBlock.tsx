import { useLayoutEffect, useRef } from 'react';
import { ExpandableSection, Spinner } from '@patternfly/react-core';
import { useNow } from '../hooks/useNow';
import type { ReasoningState } from '../types';

/** The model's reasoning tokens: collapsed by default, readable on demand, with a live clock while it thinks. */
export function ReasoningBlock({ reasoning }: { reasoning: ReasoningState }) {
  const now = useNow(reasoning.live);
  const seconds = (((reasoning.live ? now - reasoning.startedAt : reasoning.elapsedMs)) / 1000).toFixed(1);
  const chars = `${reasoning.text.length.toLocaleString()} characters`;
  const label = reasoning.live
    ? `Thinking… ${seconds}s · ${chars}`
    : reasoning.timed ? `Thought for ${seconds}s · ${chars}` : `Reasoning · ${chars}`;

  // Follow the newest text unless the reader has scrolled up inside the box.
  const text = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const el = text.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [reasoning.text]);

  return (
    <ExpandableSection
      className={reasoning.live ? 'reasoning reasoning-live' : 'reasoning'}
      toggleContent={
        <span className="reasoning-toggle">
          {reasoning.live && <Spinner size="sm" aria-hidden="true" />}
          <span>{label}</span>
        </span>
      }
    >
      <pre
        ref={text}
        className="reasoning-text"
        tabIndex={0}
        aria-label="Model reasoning"
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >{reasoning.text}</pre>
    </ExpandableSection>
  );
}
