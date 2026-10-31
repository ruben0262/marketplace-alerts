import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Palette, Bell, Radio, ArrowUpRight, Link2, LoaderCircle, ChevronDown } from 'lucide-react';
import { useSession } from './main';
import { api, useAction } from './api';
import { BrandLogo, PageHead, Field, Notice, Submit, Pill, RecoveryKey } from './ui';
import TelegramSettings from './telegram';
import { BrowserAlerts } from './notifications';
import { ThemeControl } from './theme';

const regions = { GB: 'United Kingdom', FR: 'France', DE: 'Germany', HU: 'Hungary', NL: 'Netherlands', IT: 'Italy', ES: 'Spain', PL: 'Poland' };
function EmailAccount() {
  const { user, setUser, refresh } = useSession(), action = useAction();
  const [editing, setEditing] = useState(false);
  return <div className="email-account"><h3>Email address</h3><p>{user.email || 'No email address added'}{user.email && ` · ${user.emailVerified ? 'Verified' : 'Not verified'}`}</p>
    {!user.emailDeliveryAvailable && <p className="field-note">Email delivery is not configured on this server yet. Use Telegram or your recovery key for account recovery.</p>}
    {editing ? <form onSubmit={e => {
      e.preventDefault(); const body = Object.fromEntries(new FormData(e.currentTarget));
      action.run(async setMessage => { const result = await api('/email', { method: 'PATCH', body }); if (result.user) setUser(result.user); else await refresh(); setEditing(false); setMessage(result.message || 'Email address updated.'); });
    }}><Field label="Email address" name="email" type="email" defaultValue={user.email || ''} required maxLength={254} autoComplete="email" /><Field label="Confirm current password" name="currentPassword" type="password" required autoComplete="current-password" /><div className="settings-actions"><Submit busy={action.busy}>Save email address</Submit><button type="button" className="button secondary" onClick={() => setEditing(false)}>Cancel</button></div></form> : <div className="settings-actions"><button type="button" className="button secondary" onClick={() => setEditing(true)}>{user.email ? 'Change email address' : 'Add email address'}</button>{user.email && !user.emailVerified && <button type="button" className="button secondary" disabled={action.busy || !user.emailDeliveryAvailable} onClick={() => action.run(async setMessage => { const result = await api('/email/verification', { method: 'POST' }); setMessage(result.message); await refresh(); })}>Send verification email</button>}</div>}
    <Notice {...action} />
  </div>;
}
function RegionPicker({ name, values, onChange, allowed = Object.keys(regions) }) {
  return <fieldset className="region-picker"><legend>{name}</legend><div>{allowed.map(region => <label key={region}><input type="checkbox" checked={values.includes(region)} onChange={e => onChange(e.target.checked ? [...values, region] : values.filter(v => v !== region))} /><span>{regions[region]}</span></label>)}</div></fieldset>;
}
function Credentials({ fields, values, setValues, configured }) {
  return <>{fields.map(([key, label, hint]) => <div className="credential-field" key={key}><Field label={label} hint={hint} type="password" autoComplete="new-password" value={values[key] || ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} placeholder={values[key] === null ? 'Will be removed when you save' : configured[key] ? 'Saved securely · enter to replace' : 'Not configured'} />{configured[key] && <button type="button" className="credential-clear" onClick={() => setValues(v => ({ ...v, [key]: v[key] === null ? '' : null }))}>{values[key] === null ? `Keep saved ${label}` : `Clear ${label}`}</button>}</div>)}</>;
}
function Integration({ source, title, description, children, credentials = [], regionKey, allowedRegions }) {
  const { user, setUser, refresh } = useSession(), [values, setValues] = useState({}), [selected, setSelected] = useState(regionKey ? user.settings[regionKey] : []), action = useAction();
  const [test, setTest] = useState(null), [disconnect, setDisconnect] = useState(false);
  const status = test || user.connections[source];
  const save = async setMessage => {
    if (regionKey && !selected.length) throw new Error('Choose at least one region.');
    const updated = Object.fromEntries(Object.entries(values).filter(([, v]) => v === null || v.trim()));
    if (!Object.keys(updated).length && !regionKey) { setMessage('Your credentials are already saved. You can test the connection below.'); return; }
    const result = await api('/settings', { method: 'PATCH', body: { ...(Object.keys(updated).length && { credentials: updated }), ...(regionKey && { settings: { [regionKey]: selected } }) } });
    setUser(result.user); setValues({}); setTest(null); setMessage('Settings saved. Test the connection when you’re ready.');
  };
  const testConnection = () => action.run(async setMessage => {
    if (Object.values(values).some(v => v === null || v.trim()) || regionKey && selected.join() !== user.settings[regionKey].join()) throw new Error('Save your changes before testing the connection.');
    try { const result = await api(`/connections/${source}/test`, { method: 'POST' }); setTest(result); setMessage(result.message); }
    finally { await refresh(); }
  });
  return <section className="settings-card" id={source}><div className="settings-card-heading"><BrandLogo source={source} /><div><h2>{title}</h2><p>{description}</p></div><Pill ok={status?.ok}>{status?.ok ? 'Connected' : 'Not verified'}</Pill></div><div className="settings-card-body">{children}{regionKey && <RegionPicker name="Search regions" values={selected} onChange={setSelected} allowed={allowedRegions} />}<form onSubmit={e => { e.preventDefault(); action.run(save); }}><Credentials fields={credentials} configured={user.configured} values={values} setValues={setValues} />{status && <div className={`connection-status ${status.ok ? 'connected' : ''}`}><span className={status.ok ? 'status-dot' : 'status-dot warn'} />{status.message}</div>}<Notice {...action} /><div className="settings-actions"><Submit busy={action.busy}>Save settings</Submit><button className="button secondary" type="button" disabled={action.busy} onClick={testConnection}>{action.busy ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />} Test connection</button>{source !== 'vinted' && credentials.some(([key]) => user.configured[key]) && <button type="button" className="text-button danger" onClick={() => setDisconnect(true)}>Disconnect</button>}</div></form>{disconnect && <div className="confirm-delete"><p>Remove your saved {title} credentials?</p><button className="button small danger-button" disabled={action.busy} onClick={() => action.run(async setMessage => { const result = await api('/settings', { method: 'PATCH', body: { credentials: Object.fromEntries(credentials.map(([k]) => [k, null])) } }); setUser(result.user); setValues({}); setTest(null); setDisconnect(false); setMessage(`${title} disconnected.`); })}>Disconnect {title}</button><button className="button small secondary" onClick={() => setDisconnect(false)}>Cancel</button></div>}</div></section>;
}

export default function Settings() {
  const { user, setUser } = useSession(), preferences = useAction(), account = useAction();
  const location = useLocation();
  const [settings, setSettings] = useState(user.settings), [translationKey, setTranslationKey] = useState(''), [recovery, setRecovery] = useState('');
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);
  const set = (key, value) => setSettings(s => ({ ...s, [key]: value }));
  const savePreferences = e => { e.preventDefault(); preferences.run(async setMessage => {
    const { vintedRegions, ebayRegions, browserNotifications, theme, ...general } = settings;
    const result = await api('/settings', { method: 'PATCH', body: { settings: general, ...(translationKey && { credentials: { deeplApiKey: translationKey } }) } });
    setUser(result.user); setTranslationKey(''); setMessage('Preferences saved. They’ll apply on the next scan.');
  }); };
  const changePassword = e => { e.preventDefault(); const formElement = e.currentTarget; const form = Object.fromEntries(new FormData(formElement)); account.run(async () => {
    if (form.password !== form.confirmPassword) throw new Error('Your new passwords do not match.');
    const result = await api('/password', { method: 'POST', body: { currentPassword: form.currentPassword, password: form.password } });
    formElement.reset(); setRecovery(result.recoveryKey);
  }); };
  return <><PageHead eyebrow="YOUR ACCOUNT" title="Account & preferences" description="Manage your profile, notifications and search preferences." /><nav className="settings-nav" aria-label="Settings sections"><a href="#appearance">Appearance</a><a href="#notifications">Notifications</a><a href="#preferences">Search preferences</a><a href="#account">Account</a></nav><div className="settings-stack"><section className="settings-card" id="appearance"><div className="settings-card-heading"><span className="integration-icon"><Palette size={23} /></span><div><h2>Appearance</h2><p>A space that feels like yours.</p></div></div><div className="settings-card-body"><div className="appearance-preferences"><div><h3>Light or dark</h3><p>Your theme follows you across devices.</p></div><ThemeControl /></div></div></section><section className="settings-card" id="notifications"><div className="settings-card-heading"><span className="integration-icon"><Bell size={23} /></span><div><h2>Notifications</h2><p>Decide how Scout gets your attention.</p></div></div><div className="settings-card-body"><BrowserAlerts /></div></section><section className="settings-card" id="preferences"><div className="settings-card-heading"><span className="integration-icon"><Radio size={23} /></span><div><h2>Search preferences</h2><p>Set the pace and keep the noise down.</p></div></div><div className="settings-card-body"><form onSubmit={savePreferences}><Field label="Check for new listings"><select value={settings.pollInterval} onChange={e => set('pollInterval', Number(e.target.value))}>{[60, 120, 300, 600, 900, 1800, 3600].map(n => <option value={n} key={n}>Every {n / 60} {n === 60 ? 'minute' : 'minutes'}</option>)}{![60, 120, 300, 600, 900, 1800, 3600].includes(settings.pollInterval) && <option value={settings.pollInterval}>Every {settings.pollInterval} seconds</option>}</select></Field><label className="check-row"><input type="checkbox" checked={settings.notifications} onChange={e => set('notifications', e.target.checked)} /><span><strong>Send Telegram and email alerts</strong><small>Your feed and in-app notifications still update when these alerts are off.</small></span></label><label className="check-row"><input type="checkbox" checked={settings.translation} onChange={e => set('translation', e.target.checked)} /><span><strong>Translate listing text into English</strong><small>Use your own DeepL API key. Standard condition labels translate automatically.</small></span></label>{settings.translation && <Field label="DeepL API key" type="password" autoComplete="new-password" value={translationKey} onChange={e => setTranslationKey(e.target.value)} placeholder={user.configured.deeplApiKey ? 'Saved securely · enter to replace' : 'Your DeepL API key'} />}<details className="advanced-filters"><summary>Advanced scan preferences <ChevronDown size={17} aria-hidden="true" /></summary><p>More pages and item detail lookups increase scan time and marketplace requests.</p><div className="field-row"><Field label="Vinted pages per search" type="number" min="1" max="5" value={settings.vintedPages} onChange={e => set('vintedPages', Number(e.target.value))} /><Field label="Vinted results per page" type="number" min="5" max="96" value={settings.vintedPerPage} onChange={e => set('vintedPerPage', Number(e.target.value))} /></div><div className="field-row"><Field label="eBay pages per search" type="number" min="1" max="5" value={settings.ebayPages} onChange={e => set('ebayPages', Number(e.target.value))} /><Field label="eBay results per page" type="number" min="1" max="200" value={settings.ebayPerPage} onChange={e => set('ebayPerPage', Number(e.target.value))} /></div><label className="check-row"><input type="checkbox" checked={settings.vintedDetails} onChange={e => set('vintedDetails', e.target.checked)} /><span>Fetch Vinted item details</span></label><label className="check-row"><input type="checkbox" checked={settings.ebayDetails} onChange={e => set('ebayDetails', e.target.checked)} /><span>Fetch eBay item details</span></label><Field label="Custom user agent (optional)" value={settings.userAgent} maxLength={160} onChange={e => set('userAgent', e.target.value)} /></details><Notice {...preferences} /><Submit busy={preferences.busy}>Save preferences</Submit></form></div></section><section className="settings-card" id="account"><div className="settings-card-heading"><span className="integration-icon"><ShieldCheck size={23} /></span><div><h2>Your account</h2><p>Signed in as <strong>{user.email || user.username}</strong></p></div></div><div className="settings-card-body"><EmailAccount />{recovery ? <RecoveryKey value={recovery} onDone={() => setRecovery('')} /> : <form onSubmit={changePassword}><h3 className="settings-subheading">Password & security</h3><p className="settings-help">Changing your password signs out other sessions and creates a new recovery key.</p><Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /><Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="At least 10 characters." /><Field label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /><Notice {...account} /><Submit busy={account.busy}>Change password</Submit></form>}</div></section></div></>;
}

export function Connections() {
  const { user } = useSession(), [params, setParams] = useSearchParams();
  const active = ['vinted', 'ebay', 'telegram'].includes(params.get('tab')) ? params.get('tab') : 'vinted';
  const choices = [
    { id: 'vinted', name: 'Vinted', detail: 'Ready to search' },
    { id: 'ebay', name: 'eBay', detail: user.configured.ebayClientId && user.configured.ebayClientSecret ? 'Keys configured' : 'Connect your keys' },
    { id: 'telegram', name: 'Telegram', detail: `${user.telegramBots?.length || 0} destination${user.telegramBots?.length === 1 ? '' : 's'}` },
  ];
  return <><PageHead eyebrow="YOUR CONNECTIONS" title="Connections" description="Choose a marketplace or manage where your alerts arrive." /><div className="connections-workspace">
    <div className="connection-tabs" role="tablist" aria-label="Connections">{choices.map(choice => <button type="button" role="tab" aria-label={choice.name} id={`connection-tab-${choice.id}`} aria-controls={`connection-panel-${choice.id}`} aria-selected={active === choice.id} tabIndex={active === choice.id ? 0 : -1} onKeyDown={event => {
      const index = choices.findIndex(item => item.id === choice.id);
      const next = event.key === 'ArrowRight' ? (index + 1) % choices.length : event.key === 'ArrowLeft' ? (index + choices.length - 1) % choices.length : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : null;
      if (next !== null) { event.preventDefault(); setParams({ tab: choices[next].id }); document.getElementById(`connection-tab-${choices[next].id}`)?.focus(); }
    }} key={choice.id} className={`connection-tab ${active === choice.id ? 'selected' : ''}`} onClick={() => setParams({ tab: choice.id })}><BrandLogo source={choice.id} /><span><strong>{choice.name}</strong><small>{choice.detail}</small></span></button>)}</div>
    <div role="tabpanel" id={`connection-panel-${active}`} aria-labelledby={`connection-tab-${active}`} className="connection-panel" key={active}>
      {active === 'vinted' && <Integration source="vinted" title="Vinted" description="Your default marketplace. No account keys needed." regionKey="vintedRegions" credentials={[[ 'vintedProxy', 'Vinted proxy (optional)', 'For servers Vinted blocks: http://user:password@host:port. Leave blank to keep your saved proxy.' ]]}><div className="info-box">Choose the regions you want to search. Some regional catalogs overlap; fewer regions mean fewer requests. If Vinted blocks your server, the connection test will tell you.</div></Integration>}
      {active === 'ebay' && <Integration source="ebay" title="eBay" description="Optional. Search using your own production application keys." regionKey="ebayRegions" allowedRegions={['GB', 'DE', 'FR', 'IT', 'ES', 'NL']} credentials={[[ 'ebayClientId', 'Production App ID (Client ID)' ], [ 'ebayClientSecret', 'Production Cert ID (Client secret)' ], [ 'ebayProxy', 'eBay proxy (optional)', 'Leave blank to keep your saved proxy.' ]]}><p className="settings-help">Get your production keys from the <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener noreferrer">eBay Developers Program <ArrowUpRight size={13} /></a>. Your application needs access to the Browse API. Saving both keys unlocks eBay in the search builder.</p></Integration>}
      {active === 'telegram' && <TelegramSettings />}
    </div>
  </div></>;
}
