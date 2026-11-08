// A small markdown subset (what chat models emit): paragraphs, headings, lists, fenced code, tables,
// **bold**, *italic*, `code`, http(s) links and LaTeX math. It returns a typed tree, never HTML, so rendering it with
// React cannot inject markup. Math is kept as TeX source; the renderer turns it into MathML.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; v: string }
  | { t: 'math'; tex: string; display: boolean };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'pre'; v: string }
  | { t: 'math'; tex: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

// Alternatives, leftmost match wins and ties go in this order: code, \[display\], $$display$$, \(inline\), $inline$, bold,
// link, bare URL, italic. A bare URL stops before trailing punctuation, so "see https://x.io/a." does not swallow the
// full stop. Single-dollar math follows the pandoc rule so prices are left alone: the opening $ is followed by a
// non-space, the closing $ is preceded by a non-space and not followed by a digit ("$5 and $10" is text). Italic
// needs a non-word, non-asterisk character before the opening * so that "3*0.8 + 2*0.6" is left alone.
const INLINE = new RegExp(
  [
    '`(?<code>[^`]+)`',
    String.raw`\\\[(?<dsp1>[\s\S]+?)\\\]`,
    String.raw`\$\$(?<dsp2>[\s\S]+?)\$\$`,
    String.raw`\\\((?<inl1>[\s\S]+?)\\\)`,
    String.raw`(?<![\\$\w])\$(?![\s$])(?<inl2>(?:[^$\n\\]|\\.)*?[^\s$\\])\$(?!\d)`,
    String.raw`\*\*(?<strong>[^*]+)\*\*`,
    String.raw`\[(?<ltext>[^\]]+)\]\((?<lhref>https?:\/\/[^\s)]+)\)`,
    String.raw`(?<url>https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"*\]])`,
    String.raw`(?<![*\w])\*(?<em>[^\s*](?:[^*\n]*[^\s*])?)\*(?!\w)`,
  ].join('|'),
  'g',
);

function textWithBreaks(s: string): Inline[] {
  const out: Inline[] = [];
  s.split('\n').forEach((part, i) => {
    if (i > 0) out.push({ t: 'br' });
    if (part) out.push({ t: 'text', v: part });
  });
  return out;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...textWithBreaks(src.slice(last, at)));
    const g = m.groups ?? {};
    const display = g.dsp1 ?? g.dsp2;
    const inline = g.inl1 ?? g.inl2;
    if (g.code !== undefined) out.push({ t: 'code', v: g.code });
    else if (display !== undefined) out.push({ t: 'math', tex: display.trim(), display: true });
    else if (inline !== undefined) out.push({ t: 'math', tex: inline.trim(), display: false });
    else if (g.strong !== undefined) out.push({ t: 'strong', c: parseInline(g.strong) });
    else if (g.lhref !== undefined) out.push({ t: 'link', href: g.lhref, v: g.ltext ?? '' });
    else if (g.url !== undefined) out.push({ t: 'link', href: g.url, v: g.url });
    else out.push({ t: 'em', c: parseInline(g.em ?? '') });
    last = at + m[0].length;
  }
  if (last < src.length) out.push(...textWithBreaks(src.slice(last)));
  return out;
}

const FENCE = /^```/;
const TABLE_ROW = /^\s*\|/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}[\s:|-]*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;
const DISPLAY_OPEN = /^\s*(\\\[|\$\$)/;
// A display formula may span lines but not a whole reply: an unclosed one is left as text until the closing arrives.
const MAX_MATH_LINES = 30;

/** A block that is only a \[ ... \] or $$ ... $$ formula starting at line i, with the index of its last line. */
function displayMath(lines: string[], i: number): { tex: string; end: number } | null {
  const open = DISPLAY_OPEN.exec(lines[i] ?? '');
  if (!open) return null;
  const close = open[1] === '$$' ? '$$' : '\\]';
  let text = (lines[i] ?? '').slice(open[0].length);
  for (let j = i; j < lines.length && j - i < MAX_MATH_LINES; j++) {
    if (j > i) text += `\n${lines[j] ?? ''}`;
    const at = text.indexOf(close);
    if (at < 0) continue;
    const tex = text.slice(0, at).trim();
    return tex && text.slice(at + close.length).trim() === '' ? { tex, end: j } : null;
  }
  return null;
}

const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1];
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i] ?? ''); i++) code.push(lines[i] ?? '');
      out.push({ t: 'pre', v: code.join('\n') });
    } else if (TABLE_ROW.test(line) && next !== undefined && TABLE_RULE.test(next)) {
      flush();
      const head = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i] ?? ''); i++) rows.push(cells(lines[i] ?? '').map(parseInline));
      i--;
      out.push({ t: 'table', head, rows });
    } else if (DISPLAY_OPEN.test(line) && displayMath(lines, i)) {
      flush();
      const math = displayMath(lines, i);
      if (math) {
        out.push({ t: 'math', tex: math.tex });
        i = math.end;
      }
    } else if (HEADING.test(line)) {
      flush();
      const m = HEADING.exec(line);
      out.push({ t: 'h', level: (m?.[1]?.length ?? 1) as 1 | 2 | 3 | 4, c: parseInline(m?.[2] ?? '') });
    } else if (LIST_ITEM.test(line)) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const items: Inline[][] = [];
      for (; i < lines.length && LIST_ITEM.test(lines[i] ?? ''); i++) items.push(parseInline((lines[i] ?? '').replace(LIST_ITEM, '')));
      i--;
      out.push({ t: 'list', ordered, items });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}
