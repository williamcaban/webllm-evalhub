import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('leaves arithmetic asterisks alone', () => {
    expect(parseInline('3*0.8 + 2*0.6')).toEqual([{ t: 'text', v: '3*0.8 + 2*0.6' }]);
  });
  it('parses bold, italic, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.io/p)')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'strong', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] }, { t: 'text', v: ' ' }, { t: 'code', v: 'd' }, { t: 'text', v: ' ' },
      { t: 'link', href: 'https://x.io/p', v: 'e' },
    ]);
  });
  it('only links http(s) URLs', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: '[x](javascript:alert(1))' }]);
  });
  it('keeps markup-looking text as plain text (React escapes it)', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }]);
  });
  it('turns newlines into breaks', () => {
    expect(parseInline('a\nb')).toEqual([{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings, lists, fences and tables', () => {
    const blocks = parseMarkdown('## Title\n\n- one\n- two\n\n1. a\n2. b\n\n```\nx < y\n```\n\n| id | w |\n|---|---|\n| toxigen | 3 |\n');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'list', 'list', 'pre', 'table']);
    expect(blocks[1]).toMatchObject({ t: 'list', ordered: false });
    expect(blocks[2]).toMatchObject({ t: 'list', ordered: true });
    expect(blocks[3]).toEqual({ t: 'pre', v: 'x < y' });
    const table = blocks[4];
    expect(table?.t === 'table' && table.rows.length).toBe(1);
  });
  it('joins consecutive lines into one paragraph', () => {
    expect(parseMarkdown('a\nb\n\nc')).toHaveLength(2);
  });
});

describe('bare URLs', () => {
  it('links them and leaves trailing punctuation outside', () => {
    expect(parseInline('see https://eval-hub.github.io/guides/collections/.')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', href: 'https://eval-hub.github.io/guides/collections/', v: 'https://eval-hub.github.io/guides/collections/' },
      { t: 'text', v: '.' },
    ]);
    expect(parseInline('(https://x.io/a)')).toEqual([
      { t: 'text', v: '(' },
      { t: 'link', href: 'https://x.io/a', v: 'https://x.io/a' },
      { t: 'text', v: ')' },
    ]);
  });
  it('does not link other schemes or double-link a markdown link', () => {
    expect(parseInline('javascript:alert(1) ftp://x.io')).toEqual([{ t: 'text', v: 'javascript:alert(1) ftp://x.io' }]);
    expect(parseInline('[docs](https://x.io/p)')).toEqual([{ t: 'link', href: 'https://x.io/p', v: 'docs' }]);
  });
});

describe('math', () => {
  const formula = String.raw`\frac{1\times0.85 + 1\times0.60 + 1\times0.60}{3}=0.683\;(\approx 0.68)`;
  it('reads a multi-line \\[ ... \\] block as one display formula', () => {
    const src = `The threshold is:\n\n\\[\n${formula}\n\\]\n\nDone.`;
    expect(parseMarkdown(src)).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'The threshold is:' }] },
      { t: 'math', tex: formula },
      { t: 'p', c: [{ t: 'text', v: 'Done.' }] },
    ]);
  });
  it('reads $$ ... $$ blocks, on one line or several', () => {
    expect(parseMarkdown('$$x^2$$')).toEqual([{ t: 'math', tex: 'x^2' }]);
    expect(parseMarkdown('$$\nx^2\n$$')).toEqual([{ t: 'math', tex: 'x^2' }]);
  });
  it('reads inline \\( \\) and $ $ math inside a sentence', () => {
    expect(parseInline(String.raw`so \(a+b\) and $c_1$ hold`)).toEqual([
      { t: 'text', v: 'so ' },
      { t: 'math', tex: 'a+b', display: false },
      { t: 'text', v: ' and ' },
      { t: 'math', tex: 'c_1', display: false },
      { t: 'text', v: ' hold' },
    ]);
  });
  it('treats a display formula inside a sentence as a display node', () => {
    expect(parseInline(String.raw`gives \[x\] here`)).toEqual([
      { t: 'text', v: 'gives ' },
      { t: 'math', tex: 'x', display: true },
      { t: 'text', v: ' here' },
    ]);
  });
  it('leaves prices and arithmetic alone', () => {
    expect(parseInline('costs $5 and $10 each')).toEqual([{ t: 'text', v: 'costs $5 and $10 each' }]);
    expect(parseInline('from $5-$10')).toEqual([{ t: 'text', v: 'from $5-$10' }]);
    expect(parseInline('3*0.8 + 2*0.6')).toEqual([{ t: 'text', v: '3*0.8 + 2*0.6' }]);
  });
  it('does not read math inside code', () => {
    expect(parseInline('use `$x$` here')).toEqual([{ t: 'text', v: 'use ' }, { t: 'code', v: '$x$' }, { t: 'text', v: ' here' }]);
    expect(parseMarkdown('```\n\\[x\\]\n```')).toEqual([{ t: 'pre', v: '\\[x\\]' }]);
  });
  it('keeps an unclosed formula as text until it is closed (streaming)', () => {
    expect(parseMarkdown('\\[\nx^2')).toEqual([{ t: 'p', c: [{ t: 'text', v: '\\[' }, { t: 'br' }, { t: 'text', v: 'x^2' }] }]);
  });
});

