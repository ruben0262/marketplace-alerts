import { useEffect, useState } from 'react';
import { ArrowUpRight, Plus, ChevronDown } from 'lucide-react';
import { useSession } from './main';
import { api, useAction } from './api';
import { BrandLogo, Field, Notice, Pill, Submit } from './ui';
import './telegram.css';

function BotForm({ bot, busy, onSave, onCancel }) {
  const [name, setName] = useState(bot?.name || ''), [botToken, setBotToken] = useState(''), [chatId, setChatId] = useState('');
  return <form className="telegram-form" onSubmit={e => {
    e.preventDefault();
    onSave({ name: name.trim(), ...(botToken.trim() && { botToken: botToken.trim() }), ...(chatId.trim() && { chatId: chatId.trim() }) });
  }}>
    <h3>{bot ? `Edit ${bot.name}` : 'Add a Telegram destination'}</h3>
    <Field label="Destination name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder="e.g. My phone, Trainers, Home finds" />
    <Field label="Bot token" type="password" autoComplete="new-password" value={botToken} onChange={e => setBotToken(e.target.value)} required={!bot} placeholder={bot ? 'Saved securely · enter to replace' : 'Token from BotFather'} hint="Stored securely. Your saved token is never displayed." />
    <Field label="Chat ID" type="password" autoComplete="new-password" value={chatId} onChange={e => setChatId(e.target.value)} required={!bot} placeholder={bot ? 'Saved securely · enter to replace' : 'Numeric private or group chat ID'} hint={bot ? 'Leave both credential fields empty to keep their saved values.' : 'Start the bot in Telegram, or add it to your group, before testing.'} />
    <div className="settings-actions"><Submit busy={busy}>{bot ? 'Save destination' : 'Add destination'}</Submit><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}

export default function TelegramSettings() {
  const { user, setUser, refresh } = useSession(), action = useAction(), recoveryAction = useAction();
  const bots = user.telegramBots || [];
  const [editing, setEditing] = useState(bots.length ? null : 'new'), [deleting, setDeleting] = useState(null);
  const [recoveryId, setRecoveryId] = useState(user.recoveryTelegramBotId || '');
  useEffect(() => { setRecoveryId(user.recoveryTelegramBotId || ''); }, [user.recoveryTelegramBotId]);
  const privateBots = bots.filter(bot => bot.connection?.ok && bot.connection.chatType === 'private');
  const save = (bot, values) => action.run(async setMessage => {
    const result = await api(bot ? `/telegram-bots/${bot.id}` : '/telegram-bots', { method: bot ? 'PATCH' : 'POST', body: values });
    setUser(result.user); setEditing(null);
    setMessage(bot ? 'Destination saved.' : 'Destination added. Send a test message, then choose it in your searches.');
  });
  const test = bot => action.run(async setMessage => {
    try {
      const result = await api(`/telegram-bots/${bot.id}/test`, { method: 'POST' });
      if (result.user) setUser(result.user);
      if (!result.ok) throw new Error(result.message);
      setMessage(`${bot.name}: ${result.message}`);
    } finally { await refresh(); }
  });
  return <section className="settings-card" id="telegram">
    <div className="settings-card-heading"><BrandLogo source="telegram" /><div><h2>Telegram destinations</h2><p>Send each search to the chats you choose.</p></div></div>
    <div className="settings-card-body">
      <p className="settings-help">Connect several bots or chats and give each a name. These settings belong only to your account. Choose one, several, or no destinations for each search.</p>
      <details className="telegram-guide"><summary>How to connect a Telegram bot <ChevronDown size={17} aria-hidden="true" /></summary><ol className="telegram-steps">
        <li><span>1</span><p>Open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather <ArrowUpRight size={12} /></a>, send <code>/newbot</code>, and copy the bot token.</p></li>
        <li><span>2</span><p>Open your bot and tap <strong>Start</strong>. Get your numeric private chat ID from <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer">@userinfobot</a>. For a group, add your bot and use the group’s numeric chat ID.</p></li>
        <li><span>3</span><p>Add the details below, send a test message, then select this destination in a search.</p></li>
      </ol></details>
      <div className="telegram-destinations">{bots.map(bot => <article className="telegram-destination" aria-label={bot.name} key={bot.id}>
        <div className="telegram-destination-heading"><div><h3>{bot.name}</h3><p>{bot.connection?.ok ? bot.connection.chatType === 'private' ? 'Private chat' : 'Group or channel' : 'Send a test to check delivery'}</p></div><Pill ok={bot.connection?.ok}>{bot.connection?.ok ? 'Verified' : 'Not verified'}</Pill></div>
        {editing === bot.id ? <BotForm key={bot.id} bot={bot} busy={action.busy} onSave={values => save(bot, values)} onCancel={() => setEditing(null)} /> : <>
          {bot.connection?.message && <p className={`telegram-connection-note ${bot.connection.ok ? '' : 'telegram-warning'}`}>{bot.connection.message}</p>}
          <div className="telegram-destination-actions"><button type="button" className="button secondary small" disabled={action.busy || editing !== null} onClick={() => test(bot)}>Send test message</button><button type="button" className="text-button" disabled={action.busy} onClick={() => { setEditing(bot.id); setDeleting(null); }}>Edit</button><button type="button" className="text-button danger" disabled={action.busy} onClick={() => { setDeleting(bot.id); setEditing(null); }}>Delete</button></div>
        </>}
        {deleting === bot.id && <div className="confirm-delete"><p>Delete “{bot.name}”? It will be removed from every search that uses it. Other selected destinations will keep receiving alerts. A search with no destinations will save finds in the app only.{user.recoveryTelegramBotId === bot.id && ' Telegram account recovery will also be turned off.'}</p><button type="button" className="button small danger-button" disabled={action.busy} onClick={() => action.run(async setMessage => {
          const result = await api(`/telegram-bots/${bot.id}`, { method: 'DELETE' });
          setUser(result.user); setDeleting(null); setMessage('Destination deleted. Your searches have been updated.');
        })}>Delete destination</button><button type="button" className="button small secondary" disabled={action.busy} onClick={() => setDeleting(null)}>Keep destination</button></div>}
      </article>)}</div>
      {editing === 'new' ? <BotForm busy={action.busy} onSave={values => save(null, values)} onCancel={() => setEditing(null)} /> : <button className="button secondary telegram-add" type="button" disabled={action.busy || editing !== null} onClick={() => { setEditing('new'); setDeleting(null); }}><Plus size={17} /> Add Telegram destination</button>}
      <Notice {...action} />
      <form className="telegram-recovery" onSubmit={e => { e.preventDefault(); recoveryAction.run(async setMessage => {
        const result = await api('/settings', { method: 'PATCH', body: { recoveryTelegramBotId: recoveryId || null } });
        setUser(result.user); setMessage(recoveryId ? 'Password recovery will use this private chat.' : 'Telegram recovery is off. Keep your recovery key safe.');
      }); }}>
        <h3>Account recovery</h3><p>Choose a verified private chat for password reset links. Groups and channels can receive product alerts, but cannot receive account recovery links.</p>
        <Field label="Password recovery destination"><select value={recoveryId} onChange={e => setRecoveryId(e.target.value)}><option value="">Off — use my recovery key</option>{privateBots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></Field>
        {!privateBots.length && <p className="field-note">Add and test a private chat to enable Telegram recovery.</p>}
        <Notice {...recoveryAction} /><Submit busy={recoveryAction.busy}>Save recovery destination</Submit>
      </form>
    </div>
  </section>;
}
