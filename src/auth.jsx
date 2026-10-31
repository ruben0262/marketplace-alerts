import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, Radar, Check } from 'lucide-react';
import { api, useAction } from './api';
import { useSession } from './main';
import { ThemeControl } from './theme';
import { Logo, Field, Notice, Submit, RecoveryKey, fade } from './ui';

export default function Auth({ mode }) { return <AuthForm key={mode} mode={mode} />; }
function AuthForm({ mode }) {
  const navigate = useNavigate(), { user, setUser, refresh } = useSession();
  const action = useAction();
  const [recovery, setRecovery] = useState(''), [useKey, setUseKey] = useState(false), [verified, setVerified] = useState(false);
  const [linkToken] = useState(() => ['reset-password', 'verify-email'].includes(mode) ? window.location.hash.slice(1) : '');
  const signup = mode === 'signup', login = mode === 'login', forgot = mode === 'forgot-password', verify = mode === 'verify-email';
  const title = verify ? verified ? 'Email verified.' : 'One last step.' : signup ? 'Your next find starts here.' : login ? 'Welcome back, scout.' : 'Let’s get you back in.';
  const submit = e => {
    e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget));
    action.run(async setMessage => {
      if (verify) {
        await api('/auth/verify-email', { method: 'POST', body: { token: linkToken } });
        setVerified(true); window.history.replaceState(null, '', '/verify-email');
        if (user) await refresh();
        return;
      }
      if (form.confirmPassword !== undefined && form.confirmPassword !== form.password) throw new Error('Your passwords do not match.');
      delete form.confirmPassword;
      if (form.identifier !== undefined) {
        const identifier = form.identifier.trim(); delete form.identifier;
        form[identifier.includes('@') ? 'email' : 'username'] = identifier;
      }
      const endpoint = forgot && !useKey ? '/auth/forgot' : forgot || mode === 'reset-password' ? '/auth/reset' : `/auth/${mode}`;
      if (linkToken) { form.resetToken = linkToken; delete form.username; delete form.email; }
      const result = await api(endpoint, { method: 'POST', body: form });
      if (result.user) setUser(result.user);
      if (result.recoveryKey) { setRecovery(result.recoveryKey); if (linkToken) window.history.replaceState(null, '', '/reset-password'); }
      else if (result.message) setMessage(result.message);
      else navigate('/app');
    });
  };
  return <div className="auth-layout"><aside className="auth-aside"><Logo /><div><span className="eyebrow">YOUR PERSONAL MARKETPLACE LOOKOUT</span><h2>Good things<br />come to those<br />who <em>scout.</em></h2><p>Save your searches.<br />Let the right finds come to you.</p><div className="auth-orbit"><Radar size={110} strokeWidth={.65} /></div></div><span className="auth-aside-bottom"><Check size={15} /> Vinted ready. eBay when you are.</span></aside><main id="main" tabIndex={-1} className="auth-main"><div className="auth-top"><Link className="back-link" to="/"><ArrowLeft size={17} /> Back to Scout</Link><ThemeControl /></div><m.div {...fade} className="auth-card">{recovery ? <RecoveryKey value={recovery} onDone={() => navigate('/app')} /> : <><span className="eyebrow">{verify ? 'YOUR EMAIL, CONFIRMED' : signup ? 'MAKE YOURSELF AT HOME' : login ? 'YOUR LOOKOUT IS WAITING' : 'ACCOUNT RECOVERY'}</span><h1>{title}</h1><p>{verify ? verified ? 'You can now choose email alerts for any of your searches.' : 'Confirm your email to have new finds delivered to your inbox.' : signup ? 'A small setup for a lot less searching.' : login ? 'Log in to see what’s on your radar.' : 'Get a reset link by email, or use your saved recovery key. Accounts without email can use a private Telegram recovery bot.'}</p>
    {verified ? <Link className="button primary" to={user ? '/app/settings' : '/login'}>{user ? 'Back to your account' : 'Log in'}</Link> : <form onSubmit={submit}>
      {signup ? <Field label="Email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /> : !linkToken && !verify && <Field label="Email or username" name="identifier" autoComplete="username" required maxLength={254} placeholder="you@example.com" />}
      {(useKey || (mode === 'reset-password' && !linkToken)) && <Field label="Recovery key" name="recoveryKey" required autoComplete="off" placeholder="Paste your saved recovery key" />}
      {!verify && (!forgot || useKey) && <Field label={login || signup ? 'Password' : 'New password'} name="password" type="password" required minLength={login ? 1 : 10} maxLength={128} autoComplete={login ? 'current-password' : 'new-password'} placeholder={login ? 'Your password' : 'At least 10 characters'} />}
      {(signup || useKey || mode === 'reset-password') && <Field label="Confirm password" name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" placeholder="One more time" />}
      {login && <Link className="forgot-link" to="/forgot-password">Forgot your password?</Link>}
      {verify && !linkToken && <p role="alert">Open the complete link from your verification email. You can request a new one in account settings.</p>}
      <Notice {...action} /><Submit busy={action.busy} disabled={action.busy || (verify && !linkToken)}>{verify ? 'Verify email' : signup ? 'Create your account' : login ? 'Log in' : forgot && !useKey ? 'Send reset link' : 'Reset password'}<ArrowUpRight size={17} /></Submit>
    </form>}
    {forgot && <button className="text-link recovery-toggle" onClick={() => setUseKey(v => !v)}>{useKey ? 'Send a reset link instead' : 'Use my recovery key instead'}</button>}<div className="auth-support"><Link to="/support">Need help? Contact support</Link></div><div className="auth-bottom">{signup ? <>Already have an account? <Link to="/login">Log in</Link></> : login ? <>New around here? <Link to="/signup">Create an account</Link></> : !verified && <Link to="/login">Back to log in</Link>}</div>{signup && <p className="privacy-note">Your searches and connections are private. Verify your email to turn on email alerts. We’ll also give you a recovery key to keep.</p>}</>}</m.div></main></div>;
}
