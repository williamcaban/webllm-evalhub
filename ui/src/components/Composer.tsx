import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Label, TextArea } from '@patternfly/react-core';
import { EXAMPLES } from '../lib/prompts';
import type { ActivityState } from '../types';
import { ActivityStrip } from './ActivityStrip';

interface Props {
  busy: boolean;
  activity: ActivityState | null;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ busy, activity, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const row = useRef<HTMLDivElement>(null);
  const focusInput = () => row.current?.querySelector('textarea')?.focus();
  const wasBusy = useRef(false);
  // Hand the keyboard back to the user when a turn finishes.
  useEffect(() => {
    if (wasBusy.current && !busy) focusInput();
    wasBusy.current = busy;
  }, [busy]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    onSend(text);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={submit} autoComplete="off">
      <div className="column">
        <ActivityStrip activity={activity} />
        <div className="examples" role="group" aria-label="Example prompts">
          {EXAMPLES.map(([label, prompt]) => (
            <Label key={label} variant="outline" title={prompt} onClick={() => { setText(prompt); focusInput(); }}>
              {label}
            </Label>
          ))}
        </div>
        <div className="composer-row" ref={row}>
          <TextArea
            aria-label="Message"
            placeholder="Describe what you need to evaluate. Enter sends, Shift+Enter adds a line."
            value={text}
            onChange={(_e, v) => setText(v)}
            onKeyDown={onKeyDown}
            isDisabled={busy}
            rows={2}
            resizeOrientation="vertical"
          />
          {busy
            ? <Button variant="danger" onClick={onStop}>Stop</Button>
            : <Button variant="primary" type="submit" isDisabled={!text.trim()}>Send</Button>}
        </div>
      </div>
    </form>
  );
}
