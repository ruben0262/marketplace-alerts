import { useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { m } from 'framer-motion';
import { LifeBuoy, LayoutDashboard, Search, Layers3, Plus, ArrowUpRight, Send, Check, SlidersHorizontal, Menu, X, Bell, Radio, ArrowRight } from 'lucide-react';
import { useSession } from './main';
import { api, useResource, useAction } from './api';
import { BrandLogo, Logo, Spinner, Notice, PageHead, Empty, MatchCard, Pill, fade } from './ui';
import { Searches, SearchEditor } from './searches';
import Notifications, { NotificationsProvider, useNotifications } from './notifications';

import AccountMenu from './account-menu';
import './workspace.css';

const Support = lazy(() => import('./support'));
const Settings = lazy(() => import('./settings'));
const Connections = lazy(() => import('./settings').then(module => ({ default: module.Connections })));
const navigation = [
  { to: '/app', title: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/searches', title: 'My searches', icon: Search },
  { to: '/app/matches', title: 'Latest finds', icon: Layers3 },
  { to: '/app/notifications', title: 'Notifications', icon: Bell },
  { to: '/app/connections', title: 'Connections', icon: Radio },
  { to: '/app/support', title: 'Support', icon: LifeBuoy },
];

export default function AppPages() {
  return <NotificationsProvider><Workspace /></NotificationsProvider>;
}
function Workspace() {
  const { user, setUser } = useSession(), navigate = useNavigate(), location = useLocation(), notifications = useNotifications();
  const [menu, setMenu] = useState(false), action = useAction();
  const unread = notifications.data?.unreadCount || 0;
  return <div className="app-layout">
    <div className="mobile-bar"><Logo /><button className="icon-button" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} onClick={() => setMenu(value => !value)}>{menu ? <X /> : <Menu />}</button></div>
    {menu && <button aria-label="Close navigation overlay" className="sidebar-backdrop" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'open' : ''}`}><Logo />
      <nav aria-label="App navigation">{navigation.map(item => <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenu(false)}><item.icon size={19} />{item.title}{item.title === 'Notifications' && !!unread && <span className="notification-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><AccountMenu name={user.email?.split('@')[0] || user.username} closeNavigation={() => setMenu(false)} action={action} logout={() => action.run(async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); navigate('/'); })} /></div>
    </aside>
    <div className="workspace"><header className="workspace-top"><span>YOUR SPACE <span>/</span> {navigation.find(item => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))?.title || (location.pathname === '/app/settings' ? 'Account & preferences' : 'New search')}</span><Link className="quiet-link" to="/">Back to Scout <ArrowUpRight size={14} /></Link></header>
      <main id="main" tabIndex={-1} className="workspace-main"><m.div key={location.pathname} {...fade}><Suspense fallback={<Spinner />}><Routes>
        <Route index element={<Dashboard />} />
        <Route path="searches" element={<Searches />} />
        <Route path="searches/new" element={<SearchEditor />} />
        <Route path="searches/:id/edit" element={<SearchEditor />} />
        <Route path="matches" element={<Matches />} />
        <Route path="connections" element={<Connections />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="support" element={<Support inApp />} />
        <Route path="settings" element={['#vinted', '#ebay', '#telegram'].includes(location.hash) ? <Navigate replace to={`/app/connections?tab=${location.hash.slice(1)}`} /> : <Settings />} />
        <Route path="*" element={<Empty title="Nothing here yet" text="Let’s head back to your overview." action="Your overview" to="/app" />} />
      </Routes></Suspense></m.div></main>
      <footer className="workspace-footer"><span><Radio size={13} /> Made for your next great find.</span><span>Scout · Marketplace alerts</span></footer>
    </div>
  </div>;
}

function Dashboard() {
  const { user } = useSession(), { data, error, loading } = useResource('/dashboard', 15000);
  const verifiedBots = (user.telegramBots || []).filter(bot => bot.connection?.ok).length;
  if (loading) return <Spinner />;
  return <><PageHead eyebrow="YOUR NEXT FIND STARTS HERE" title={`Hey, ${user.email?.split('@')[0] || user.username}.`} description="Here’s what’s on your radar."><Link className="button primary" to="/app/searches/new"><Plus size={18} /> New search</Link></PageHead><Notice error={error} />{data && <><div className="welcome-banner"><div><span className="eyebrow">YOUR NEXT GOOD THING IS OUT THERE</span><h2>Let’s keep an eye out.</h2><p>{data.activeSearches ? `${data.activeSearches} active ${data.activeSearches === 1 ? 'search is' : 'searches are'} keeping watch for your next find.` : 'Create your first search. We’ll take it from there.'}</p><Link to="/app/searches/new" className="text-link">Put something on your radar <ArrowUpRight size={17} /></Link></div><div className="banner-radar"><Radio size={110} strokeWidth={.7} /><span className="banner-dot" /></div></div><div className="stats-grid">{[{ title: 'Active searches', value: data.activeSearches, icon: Search, sub: `${data.totalSearches} searches in your workspace` }, { title: 'Matching finds', value: data.totalMatches, icon: Layers3, sub: 'Collected across your marketplaces' }, { title: 'Alerts delivered', value: data.delivered, icon: Send, sub: verifiedBots ? `${verifiedBots} verified destination${verifiedBots === 1 ? '' : 's'}` : 'Connect a destination to get alerts' }].map(s => <div className="stat-card" key={s.title}><div><span>{s.title}</span><s.icon size={19} /></div><strong>{s.value}</strong><p>{s.sub}</p></div>)}</div>{(!data.totalSearches || !verifiedBots) && <section className="setup-strip"><div><span className="setup-symbol"><SlidersHorizontal size={21} /></span><div><h3>A little setup. A lot of good finds.</h3><p>Make Scout feel like yours in two simple steps.</p></div></div><Link to="/app/searches/new" className={data.totalSearches ? 'complete' : ''}><span>{data.totalSearches ? <Check size={14} /> : '1'}</span> Create a search <ArrowRight size={15} /></Link><Link to="/app/connections?tab=telegram" className={verifiedBots > 0 ? 'complete' : ''}><span>{verifiedBots > 0 ? <Check size={14} /> : '2'}</span> Add a destination <ArrowRight size={15} /></Link></section>}<section className="dashboard-finds"><div className="section-top"><div><h2>Fresh on your radar</h2><p>Your latest matching listings, all in one place.</p></div><Link className="text-link" to="/app/matches">All finds <ArrowUpRight size={16} /></Link></div>{data.latest.length ? <div className="match-grid">{data.latest.map(item => <MatchCard item={item} key={item._id} />)}</div> : <Empty title="The good finds are coming." text={data.totalSearches ? 'Your first scan will build your feed. You can check its progress in My searches.' : 'Start with something you’ve had your eye on. Your matches will land right here.'} action={data.totalSearches ? 'View my searches' : 'Create your first search'} to={data.totalSearches ? '/app/searches' : '/app/searches/new'} />}</section><div className="marketplace-summary"><h3>Your marketplaces</h3><Link to="/app/connections?tab=vinted"><BrandLogo source="vinted" /><div><strong>Vinted</strong><small>{user.settings.vintedRegions.length} selected region(s)</small></div><Pill ok>Included</Pill></Link><Link to="/app/connections?tab=ebay"><BrandLogo source="ebay" /><div><strong>eBay</strong><small>{user.configured.ebayClientId && user.configured.ebayClientSecret ? 'Your own application keys' : 'Add your production keys to search'}</small></div><Pill ok={user.configured.ebayClientId && user.configured.ebayClientSecret}>{user.configured.ebayClientId && user.configured.ebayClientSecret ? 'Configured' : 'Optional'}</Pill></Link></div></>}</>;
}

function Matches() {
  const [source, setSource] = useState(''), [search, setSearch] = useState('');
  const saved = useResource('/searches');
  return <><PageHead eyebrow="THE GOOD STUFF, ALL TOGETHER" title="Latest finds" description="Everything that caught your radar. Open a listing to take a closer look." /><div className="filter-bar"><div className="segmented" aria-label="Filter by marketplace">{[['', 'All finds'], ['vinted', 'Vinted'], ['ebay', 'eBay']].map(([v, label]) => <button key={v} className={source === v ? 'selected' : ''} aria-pressed={source === v} onClick={() => setSource(v)}>{label}</button>)}</div><label className="select-inline"><Search size={17} /><select aria-label="Filter by search" value={search} onChange={e => setSearch(e.target.value)}><option value="">All searches</option>{saved.data?.searches.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label></div><MatchesFeed key={`${source}:${search}`} source={source} search={search} /></>;
}
function MatchesFeed({ source, search }) {
  const query = new URLSearchParams({ ...(source && { source }), ...(search && { search }) });
  const { data, error, loading } = useResource(`/matches?${query}`, 15000), [older, setOlder] = useState([]), [cursor, setCursor] = useState(undefined), action = useAction();
  const rows = [...new Map([...(data?.matches || []), ...older].map(row => [row._id, row])).values()];
  const next = cursor === undefined ? data?.nextCursor : cursor;
  if (loading) return <Spinner />;
  return <><Notice error={error || action.error} />{rows.length ? <><div className="match-grid">{rows.map(item => <MatchCard key={item._id} item={item} />)}</div>{next && <button className="button secondary load-more" disabled={action.busy} onClick={() => action.run(async () => { const result = await api(`/matches?${query}&before=${next}`); setOlder(o => [...o, ...result.matches]); setCursor(result.nextCursor); })}>{action.busy ? 'Loading…' : 'Load more finds'}</button>}</> : <Empty icon={Layers3} title="A little quiet on the radar." text="Matching listings will appear here after a successful scan. Fine-tune your searches or try a broader search." action="See my searches" to="/app/searches" />}</>;
}
