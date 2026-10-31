import { useEffect, useState, useCallback } from 'react';

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'marketplace-alerts', ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('scout-session-expired'));
    throw Object.assign(new Error(data.error || data.message || 'The request failed. Please try again.'), { status: response.status });
  }
  return data;
}

export function useResource(path, interval = 0) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setState({ data: null, error: '', loading: true });
    const load = async () => {
      if (document.hidden) return;
      try {
        const data = await api(path, { signal: controller.signal });
        if (alive) setState({ data, error: '', loading: false });
      } catch (e) { if (alive && e.name !== 'AbortError') setState(s => ({ ...s, error: e.message, loading: false })); }
    };
    load();
    const timer = interval && setInterval(load, interval);
    const visible = () => { if (!document.hidden) load(); };
    if (interval) document.addEventListener('visibilitychange', visible);
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [path, revision, interval]);
  return { ...state, refresh };
}

export function useAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const run = async fn => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { return await fn(setMessage); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return { busy, error, message, run };
}
