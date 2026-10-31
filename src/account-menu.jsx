import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, UserRound, LogOut, ChevronUp } from 'lucide-react';
import { ThemeControl } from './theme';
import { Notice } from './ui';

export default function AccountMenu({ name, closeNavigation, logout, action }) {
  const [open, setOpen] = useState(false), root = useRef(null), trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="account-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="account-trigger" ref={trigger} aria-label="Account menu" aria-expanded={open} aria-controls="account-options" onClick={() => setOpen(value => !value)}><span className="account-avatar"><UserRound size={21} /></span><span className="account-name" title={name}>{name}</span><ChevronUp size={16} /></button>
    {open && <div id="account-options" className="account-options" role="region" aria-label="Account options">
      <ThemeControl labeled />
      <Link to="/app/settings" onClick={() => { setOpen(false); closeNavigation(); }}><Settings2 size={18} /> Settings</Link>
      <button type="button" disabled={action.busy} onClick={logout}><LogOut size={18} /> Log out</button>
      <Notice error={action.error} />
    </div>}
  </div>;
}
