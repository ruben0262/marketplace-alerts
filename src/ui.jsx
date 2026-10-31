import { Link } from 'react-router-dom';
import { ArrowUpRight, Search, LoaderCircle, AlertCircle, Check, Package, KeyRound } from 'lucide-react';
import { m } from 'framer-motion';
import { useId, useState, cloneElement } from 'react';

export const fade = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: .3 } };
export function Logo({ light = false }) { return <Link to="/" className={`logo ${light ? 'light' : ''}`} aria-label="Scout home"><img className="logo-mark" src="/favicon.svg?v=3" alt="" width="35" height="35" />scout<span className="logo-dot">.</span></Link>; }
export function BrandLogo({ source, decorative = true, className = '' }) {
  const name = { vinted: 'Vinted', ebay: 'eBay', telegram: 'Telegram' }[source];
  return <span className={`brand-logo brand-${source} ${className}`}><img src={`/brands/${source}.svg`} alt={decorative ? '' : name} /></span>;
}
export function Spinner() { return <div className="loading" role="status"><LoaderCircle className="spin" size={24} /><span>Loading your space…</span></div>; }
export function Notice({ error, warning, message }) { return error ? <div className="notice error" role="alert"><AlertCircle size={18} />{error}</div> : warning ? <div className="notice warning" role="status" aria-label="Warning"><AlertCircle size={18} />{warning}</div> : message ? <div className="notice success" role="status"><Check size={18} />{message}</div> : null; }
export function Field({ label, hint, children, ...props }) {
  const id = useId(), accessibility = { id, 'aria-describedby': hint ? `${id}-hint` : undefined };
  return <div className="field"><label htmlFor={id}>{label}</label>{children ? cloneElement(children, accessibility) : <input {...accessibility} {...props} />}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Submit({ busy, children, ...props }) { return <button className="button primary" disabled={busy} {...props}>{busy && <LoaderCircle size={17} className="spin" />}{busy ? 'Working…' : children}</button>; }
export function PageHead({ eyebrow, title, description, children }) { return <div className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</div>; }
export function Empty({ title, text, action, to, icon: Icon = Search }) { return <div className="empty"><span className="empty-icon"><Icon size={30} /></span><h3>{title}</h3><p>{text}</p>{to && <Link className="button primary" to={to}>{action}<ArrowUpRight size={17} /></Link>}</div>; }
export function Pill({ ok, children }) { return <span className={`pill ${ok ? 'good' : 'muted'}`}><i />{children}</span>; }
export function relative(date) {
  if (!date) return 'Not scanned yet';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : new Date(date).toLocaleDateString();
}
export function MatchCard({ item }) {
  const [failedImage, setFailedImage] = useState(null);
  const price = item.price === null ? 'Price unavailable' : `${item.currency || ''} ${Number(item.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const safe = /^https:\/\//.test(item.url);
  return <article className="match-card"><a href={safe ? item.url : undefined} target="_blank" rel="noopener noreferrer" aria-label={`View ${item.title}`}><div className="match-image">{item.image && /^https:\/\//.test(item.image) && failedImage !== item.image ? <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(item.image)} /> : <Package size={44} strokeWidth={1} role="img" aria-label="Product photo unavailable" />}<span className={`source-tag ${item.source}`}><BrandLogo source={item.source} decorative={false} /></span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="match-body"><p className="match-search">{item.searchName}</p><h3>{item.title}</h3><div className="match-bottom"><strong>{price}</strong><span>{relative(item.foundAt)}</span></div></div></a><div className="match-meta">{item.attributes?.Size && <span>Size {item.attributes.Size}</span>}<span>{({ sent: 'Alert delivered', seeded: 'Found on first scan', pending: 'Alert queued', 'web-only': 'Saved to your feed' })[item.alertState]}</span></div></article>;
}
export function RecoveryKey({ value, onDone }) {
  return <m.div {...fade} className="recovery"><span className="empty-icon"><KeyRound size={28} /></span><h2>Keep a way back in.</h2><p>Save this recovery key somewhere private. You can use it if you forget your password. It is shown only once.</p><code data-testid="recovery-key">{value}</code><button className="button secondary" onClick={() => { const blob = new Blob([`Scout recovery key\n${value}\n`], { type: 'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'scout-recovery-key.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }}>Download recovery key</button><button className="button primary" onClick={onDone}>I’ve saved it. Continue <ArrowUpRight size={17} /></button></m.div>;
}
