import { useEffect, useRef } from 'react';

/** KaTeX is loaded the first time a reply contains math, so it stays out of the initial bundle. */
const loadKatex = () => import('katex').then((m) => m.default);

/**
 * One formula. KaTeX writes MathML into the element (no HTML fonts needed, and screen readers get real math); the
 * TeX source shows meanwhile, and stays if the formula cannot be parsed.
 */
export function MathExpr({ tex, display }: { tex: string; display: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
    let cancelled = false;
    loadKatex().then(
      (katex) => {
        if (!cancelled) katex.render(tex, el, { output: 'mathml', displayMode: display, throwOnError: false, strict: 'ignore', trust: false });
      },
      () => undefined, // the chunk failed to load: the source text stays visible
    );
    return () => { cancelled = true; };
  }, [tex, display]);
  return <span ref={ref} className={display ? 'math math-display' : 'math'} />;
}
