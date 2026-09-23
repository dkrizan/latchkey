import { useEffect, useState } from 'react';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Mirror the OS theme onto <html class="dark"> (shadcn's dark variant). */
export function applySystemTheme() {
  const set = () => document.documentElement.classList.toggle('dark', query().matches);
  set();
  query().addEventListener('change', set);
}

export function useTheme() {
  const [dark, setDark] = useState(() => query().matches);
  useEffect(() => {
    const q = query();
    const on = () => setDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return dark ? 'dark' : 'light';
}
