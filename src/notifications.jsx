import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bell, Check } from 'lucide-react';
import { useSession } from './main';
import { api, useAction } from './api';
import { BrandLogo, Empty, Notice, PageHead, Spinner, relative } from './ui';
import { prepareBrowserNotifications, showBrowserNotification } from './browser-notifications';
import './notifications.css';

const NotificationsContext = createContext(null);
export const useNotifications = () => useContext(NotificationsContext);

export function NotificationsProvider({ children }) {
  const { user } = useSession(), navigate = useNavigate();
  const [data, setData] = useState(null), [error, setError] = useState(''), [browserError, setBrowserError] = useState('');
  const seen = useRef(null), inFlight = useRef(false), alive = useRef(true);
  const browserEnabled = useRef(user.settings.browserNotifications);
  browserEnabled.current = user.settings.browserNotifications;
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await api('/notifications?limit=30');
      if (alive.current) { setData(result); setError(''); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { inFlight.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const poll = () => { if (!document.hidden || user.settings.browserNotifications && 'Notification' in window && Notification.permission === 'granted') refresh(); };
    const timer = setInterval(poll, 15000);
    document.addEventListener('visibilitychange', poll);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [refresh, user.settings.browserNotifications]);
  useEffect(() => {
    if (!data) return;
    const incoming = seen.current ? data.notifications.filter(item => !seen.current.has(item._id) && !item.readAt) : [];
    seen.current = new Set(data.notifications.map(item => item._id));
    if (!user.settings.browserNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    for (const item of incoming.slice(0, 3)) {
      showBrowserNotification(item, () => { window.focus(); navigate('/app/notifications'); }, () => alive.current && browserEnabled.current).then(shown => {
        if (alive.current) setBrowserError(shown ? '' : 'This browser could not display an alert. Your matches are still in Scout; use Telegram or email for reliable delivery on this device.');
      });
    }
  }, [data, user.settings.browserNotifications, navigate]);
  const markRead = async ids => {
    const result = await api('/notifications/read', { method: 'POST', body: ids ? { ids } : { all: true } });
    const now = new Date().toISOString();
    setData(current => current && { ...current, unreadCount: result.unreadCount, notifications: current.notifications.map(item => !ids || ids.includes(item._id) ? { ...item, readAt: item.readAt || now } : item) });
  };
  return <NotificationsContext.Provider value={{ data, error, browserError, refresh, markRead }}>{children}</NotificationsContext.Provider>;
}

export function BrowserAlerts() {
  const { user, setUser } = useSession(), action = useAction();
  const { browserError } = useNotifications();
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unavailable');
  const [permissionWarning, setPermissionWarning] = useState('');
  const [enabled, setEnabled] = useState(!!user.settings.browserNotifications);
  useEffect(() => { setEnabled(!!user.settings.browserNotifications); }, [user.settings.browserNotifications]);
  const save = value => action.run(async setMessage => {
    setPermissionWarning(''); setEnabled(value);
    try {
      const result = await api('/settings', { method: 'PATCH', body: { settings: { browserNotifications: value } } });
      setUser(result.user); setMessage(value ? 'Browser alert preference saved.' : 'Browser alerts turned off. Your in-app notifications stay available.');
    } catch (error) { setEnabled(enabled); throw error; }
  });
  return <div className="browser-alert-preferences"><h3>Browser notifications</h3><p>Get a browser alert for new matches while Scout is open. In-app notifications remain in your notification feed.</p>
    <label className="check-row"><input type="checkbox" checked={enabled} disabled={action.busy} onChange={e => save(e.target.checked)} /><span><strong>Allow browser alerts</strong><small>Your browser also needs permission. Closing Scout stops these alerts; use Telegram or email for delivery when you’re away. Some mobile browsers, including iOS browser tabs, may not support these alerts.</small></span></label>
    {permission === 'unavailable' ? <p className="field-note">This browser does not support browser notifications.</p> : permission === 'denied' ? <p className="field-note">Notifications are blocked in this browser. Allow them in the browser’s site settings to receive alerts.</p> : permission === 'granted' ? <p className="field-note">Browser permission granted.{!enabled && ' Your Scout browser alerts are currently off.'}</p> : <button type="button" className="button secondary" disabled={action.busy || !enabled} onClick={() => action.run(async setMessage => {
      setPermissionWarning('');
      const requested = await Notification.requestPermission();
      const value = requested === 'granted' ? Notification.permission : requested;
      if (value === 'granted') await prepareBrowserNotifications().catch(() => null);
      setPermission(value);
      if (value === 'granted') setMessage('Browser permission granted. New matching notifications can appear while Scout is open.');
      else setPermissionWarning('Permission was not granted. Your notifications will still appear in Scout.');
    })}>Enable browser notifications</button>}
    <Notice error={action.error || browserError} warning={permissionWarning} message={action.message} />
  </div>;
}

export default function Notifications() {
  const { data, error, browserError, markRead } = useNotifications(), action = useAction();
  const [older, setOlder] = useState([]), [cursor, setCursor] = useState(undefined);
  const rows = [...new Map([...(data?.notifications || []), ...older].map(item => [item._id, item])).values()];
  const next = cursor === undefined ? data?.nextCursor : cursor;
  const read = ids => action.run(async () => {
    await markRead(ids);
    setOlder(items => items.map(item => !ids || ids.includes(item._id) ? { ...item, readAt: item.readAt || new Date().toISOString() } : item));
  });
  return <><PageHead eyebrow="ON YOUR RADAR" title="Notifications" description="New matches from your searches, ready when you are.">{!!data?.unreadCount && <button type="button" className="button secondary" disabled={action.busy} onClick={() => read()}>Mark all as read</button>}</PageHead><Notice error={error || action.error || browserError} />
    {!data && !error ? <Spinner /> : rows.length ? <div className="notification-feed">{rows.map(item => <article className={`notification-item ${item.readAt ? '' : 'unread'}`} aria-label={item.title} key={item._id}>
      <span className="notification-dot" aria-label={item.readAt ? 'Read' : 'Unread'} />
      <div className="notification-content"><div className="notification-context"><span>{item.searchName || 'Your search'}</span><span>{relative(item.foundAt)}</span></div><h2><a href={/^https:\/\//.test(item.url || '') ? item.url : undefined} target="_blank" rel="noopener noreferrer" onClick={() => { if (!item.readAt) read([item._id]); }}>{item.title} <ArrowUpRight size={16} /></a></h2><p>{item.body}</p><div className="notification-footer"><span className={`source-chip ${item.source}`}>{['vinted', 'ebay'].includes(item.source) ? <BrandLogo source={item.source} decorative={false} /> : 'Scout'}</span>{!item.readAt && <button type="button" className="text-button" disabled={action.busy} onClick={() => read([item._id])}><Check size={14} /> Mark as read</button>}</div></div>
    </article>)}</div> : !error && <Empty icon={Bell} title="You’re all caught up." text="New matches will appear here after your searches find fresh listings. The first scan stays quiet unless you choose to include existing matches." action="Manage searches" to="/app/searches" />}
    {next && <button className="button secondary load-more" disabled={action.busy} onClick={() => action.run(async () => { const result = await api(`/notifications?limit=30&before=${encodeURIComponent(next)}`); setOlder(items => [...items, ...result.notifications]); setCursor(result.nextCursor); })}>Load older notifications</button>}
    <p className="notifications-preferences-link"><Link to="/app/settings#notifications">Manage notification preferences <ArrowUpRight size={14} /></Link></p>
  </>;
}
