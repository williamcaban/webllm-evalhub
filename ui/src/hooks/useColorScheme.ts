import { useEffect } from 'react';

const DARK_CLASS = 'pf-v6-theme-dark';

/** Follow the OS light/dark preference by toggling PatternFly's dark theme class on <html>. */
export function useColorScheme(): void {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle(DARK_CLASS, query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
}
