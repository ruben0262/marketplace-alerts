import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Moon, Sun } from 'lucide-react';
import { api } from './api';

const Theme = createContext(null);
export const useTheme = () => useContext(Theme);
const validTheme = value => value === 'dark' ? 'dark' : 'light';

export function ThemeProvider({ user, setUser, children }) {
  const [theme, setTheme] = useState(() => validTheme(document.documentElement.dataset.theme));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const busy = useRef(false), account = useRef(user?.id);
  account.current = user?.id;
  const apply = value => {
    document.documentElement.dataset.theme = value;
    setTheme(value);
    try { localStorage.setItem('scout-theme', value); } catch { /* Storage may be disabled. */ }
  };
  useEffect(() => { if (user) apply(validTheme(user.settings.theme)); }, [user?.id, user?.settings.theme]);
  useEffect(() => { setError(''); }, [user?.id]);
  useEffect(() => {
    const sync = event => { if (event.key === 'scout-theme' && !account.current) apply(validTheme(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const saveTheme = async next => {
    const userId = account.current;
    if (!userId || busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try {
      await api('/settings', { method: 'PATCH', body: { settings: { theme: next } } });
      if (account.current === userId) setUser(current => current?.id === userId ? { ...current, settings: { ...current.settings, theme: next } } : current);
    } catch {
      if (account.current === userId) setError('Using this theme on this device. Couldn’t save it to your account.');
    } finally { busy.current = false; setSaving(false); }
  };
  const toggleTheme = () => {
    if (busy.current) return;
    const next = theme === 'light' ? 'dark' : 'light';
    setError('');
    // Saving is independent of animation support or an interrupted transition.
    const update = () => flushSync(() => apply(next));
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try { document.startViewTransition(update).finished.catch(() => {}); }
      catch { update(); }
    } else update();
    void saveTheme(next);
  };
  return <Theme.Provider value={{ theme, toggleTheme, saving, error, retry: () => saveTheme(theme) }}>{children}</Theme.Provider>;
}

export function ThemeControl({ className = '', labeled = false }) {
  const { theme, toggleTheme, saving, error, retry } = useTheme();
  const label = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
  return <div className={`theme-choice ${labeled ? 'theme-choice-labeled' : ''}`}><button type="button" className={`theme-control ${className}`} onClick={toggleTheme} aria-disabled={saving} aria-label={label} title={label}>
    {theme === 'light' ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
    {labeled && <><span>Dark mode</span><span className={`theme-toggle ${theme === 'dark' ? 'on' : ''}`} aria-hidden="true"><i /></span></>}
  </button>{error && <div className="theme-sync-error" role="status">{error} <button type="button" disabled={saving} onClick={retry}>Retry saving theme</button></div>}</div>;
}
