import { useEffect, useState } from 'react';

// Light/dark switch. The choice is stored in localStorage and applied as
// data-theme="light" on <html>, which flips the CSS variables in index.css.
export default function ThemeToggle({ block = false }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className={`secondary theme-toggle ${block ? 'block' : ''}`}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title="Switch theme"
    >
      {dark ? '☀️ Light mode' : '🌙 Dark mode'}
    </button>
  );
}
