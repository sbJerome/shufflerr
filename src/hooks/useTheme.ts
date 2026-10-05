import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'shufflerr-theme';

/**
 * Inline script for `_document`: applies the saved theme before first paint so
 * there is no flash. Dark is the default.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

const readTheme = (): Theme =>
  typeof document !== 'undefined' &&
  document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light'
    : 'dark';

/** Current theme + toggle. Persists to localStorage and `<html data-theme>`. */
const useTheme = () => {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(
    () => setTheme(readTheme() === 'dark' ? 'light' : 'dark'),
    [setTheme]
  );

  return { theme, setTheme, toggleTheme };
};

export default useTheme;
