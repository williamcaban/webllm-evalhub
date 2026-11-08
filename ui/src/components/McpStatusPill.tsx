import { useEffect, useRef, useState } from 'react';
import { Label, Popover } from '@patternfly/react-core';
import { WRITE_TOOLS } from '../lib/mcp/tools';
import type { McpStatus } from '../hooks/useMcpConnection';
import type { McpConnectionState } from '../hooks/useMcpConnection';

const TONE_COLOR = { none: 'grey', ok: 'green', warn: 'orange', err: 'red' } as const;
const CLOSE_DELAY_MS = 200;

/** The "MCP: Live · 8 tools" pill. Hover previews the tool list; click pins it open; Esc closes. */
export function McpStatusPill({ status, connection }: { status: McpStatus; connection: McpConnectionState | null }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const open = hovered || pinned;
  const enter = () => { window.clearTimeout(closeTimer.current); setHovered(true); };
  // A short delay lets the pointer cross from the pill to the popover without it closing.
  const leave = () => { closeTimer.current = window.setTimeout(() => setHovered(false), CLOSE_DELAY_MS); };
  const tools = connection?.tools ?? [];

  // Popover only handles Esc while focus is inside it, so listen on the document while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setHovered(false); setPinned(false); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const body = (
    <div onMouseEnter={enter} onMouseLeave={leave}>
      {tools.length === 0 ? (
        <p>No tools: not connected to an EvalHub source yet.</p>
      ) : (
        <>
          <p className="tools-head">{tools.length} tools · {connection?.client.label} · {pinned ? 'click the pill to close' : 'click the pill to pin'}</p>
          <ul className="tools-list" aria-label="Available EvalHub tools">
            {tools.map((t) => (
              <li key={t.name} title={t.description ?? t.name}>
                <code>{t.name}</code>
                <span className="tools-desc">{(t.description ?? '').split(/(?<=\.)\s/)[0]}</span>
                {WRITE_TOOLS.has(t.name) && <Label isCompact color="orange">writes</Label>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <span ref={anchor} className="mcp-pill" onMouseEnter={enter} onMouseLeave={leave}>
      <Label
        color={TONE_COLOR[status.tone]}
        variant="outline"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
      >
        {status.text}
      </Label>
      <Popover
        triggerRef={anchor}
        isVisible={open}
        shouldOpen={() => setHovered(true)}
        // Clicks on the pill itself are handled by the pill's own onClick (pin/unpin); everything else, Esc included, closes.
        shouldClose={(event) => {
          if (event?.target instanceof Node && anchor.current?.contains(event.target)) return;
          setHovered(false);
          setPinned(false);
        }}
        aria-label="Available EvalHub tools"
        position="bottom-start"
        showClose={false}
        hasAutoWidth
        withFocusTrap={false}
        bodyContent={body}
      />
    </span>
  );
}
