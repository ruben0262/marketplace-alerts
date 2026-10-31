import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, LifeBuoy, Check } from 'lucide-react';
import { useSession } from './main';
import { api, useAction } from './api';
import { Logo, PageHead, Field, Submit, Notice } from './ui';
import { ThemeControl } from './theme';
import './support.css';

export default function Support({ inApp = false }) {
  const { user } = useSession(), action = useAction();
  const requestId = useRef(crypto.randomUUID()), [receipt, setReceipt] = useState(null);
  const submit = event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    action.run(async () => {
      const result = await api('/support', { method: 'POST', body: { ...fields, requestId: requestId.current } });
      setReceipt({ reference: result.reference, email: fields.email });
    });
  };
  const content = <><PageHead eyebrow="WE’RE HERE TO HELP" title="Support" description="Tell us what’s happening. We’ll help you get back to your next find." />
    <div className="support-grid"><section className="support-card">{receipt ? <div className="support-receipt" role="status"><Check size={30} /><h2>Message received.</h2><p>Your reference is <strong>{receipt.reference}</strong>. We’ll reply to {receipt.email}.</p><Link className="button primary" to={user ? '/app' : '/'}>Back to Scout <ArrowUpRight size={17} /></Link></div> : <form onSubmit={submit}>
      <h2>How can we help?</h2><Field label="Your email" name="email" type="email" autoComplete="email" defaultValue={user?.email || ''} maxLength={254} required hint="The address we should reply to." />
      <Field label="Subject" name="subject" required minLength={5} maxLength={120} placeholder="A short description of the issue" />
      <Field label="Message" hint="Include what you were trying to do and any error you saw. Please leave out passwords, bot tokens and API keys."><textarea name="message" rows={6} required minLength={20} maxLength={4000} placeholder="Tell us a little more…" /></Field>
      <Notice error={action.error} /><Submit busy={action.busy} disabled={action.busy}>Send message <ArrowUpRight size={17} /></Submit>
    </form>}</section><aside className="support-help"><LifeBuoy size={28} /><h2>A little help, right here.</h2><p>Having trouble signing in?</p><Link to="/forgot-password">Reset your password <ArrowUpRight size={15} /></Link><p>Prefer to use your email app?</p><a href="mailto:hello@flow-solutions.xyz">hello@flow-solutions.xyz <ArrowUpRight size={15} /></a><small>Support messages are sent to the FlowSolutions team. We reply to the email address you provide.</small></aside></div></>;
  return inApp ? content : <div className="support-page"><header><Logo /><ThemeControl /></header><main id="main" tabIndex={-1}><Link className="back-link" to="/"><ArrowLeft size={16} /> Back to Scout</Link>{content}</main></div>;
}
