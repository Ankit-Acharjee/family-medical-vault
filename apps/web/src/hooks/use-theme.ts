import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    return localStorage.getItem('fmv.theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('fmv.theme', theme);
    } catch {
      // Theme switching still works without persistent storage.
    }
  }, [theme]);
  useEffect(() => {
    const sync = () => setTheme(initialTheme());
    const observer = new MutationObserver(() => {
      setTheme(
        document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light',
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    window.addEventListener('storage', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', sync);
    };
  }, []);
  return {
    theme,
    toggleTheme: () =>
      setTheme((current) => (current === 'light' ? 'dark' : 'light')),
  };
}
