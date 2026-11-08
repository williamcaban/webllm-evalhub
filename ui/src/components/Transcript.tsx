import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ApprovalVerdict, ChatItem } from '../types';
import { TranscriptItem } from './TranscriptItem';
import { WelcomeBanner } from './WelcomeBanner';

const NEAR_BOTTOM_PX = 140;

interface Props {
  items: ChatItem[];
  demo: boolean;
  onDecide: (id: number, verdict: ApprovalVerdict) => void;
  onRetry: (id: number) => void;
}

/** Scrolling message list. It follows new content unless the reader has scrolled up, and always for their own message. */
export function Transcript({ items, demo, onDecide, onRetry }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = items[items.length - 1];
  const forceFollow = last?.kind === 'user' || (last?.kind === 'tool' && last.approval === 'awaiting');

  useLayoutEffect(() => {
    const el = scroller.current;
    if (forceFollow) pinned.current = true;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });

  // Content can grow without this component re-rendering (a tool card expanding, a table wrapping): keep following.
  useEffect(() => {
    const el = scroller.current;
    const inner = column.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={scroller}
      className="transcript"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      }}
    >
      <div className="column" ref={column}>
        <WelcomeBanner demo={demo} />
        {items.map((item) => <TranscriptItem key={item.id} item={item} onDecide={onDecide} onRetry={onRetry} />)}
      </div>
    </div>
  );
}
