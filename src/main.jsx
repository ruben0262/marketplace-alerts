import React, { createContext, useContext, useEffect, useState, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LazyMotion, MotionConfig } from 'framer-motion';
import { api } from './api';
import { Spinner } from './ui';
import { ThemeProvider } from './theme';
import './style.css';
import './theme.css';

const Landing = lazy(() => import('./landing'));
const Support = lazy(() => import('./support'));
const Auth = lazy(() => import('./auth'));
const AppPages = lazy(() => import('./pages'));
const loadMotion = () => import('./motion-features').then(module => module.default);
const Session = createContext(null);
export const useSession = () => useContext(Session);

function App() {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const location = useLocation();
  const refresh = async () => { const data = await api('/me'); setUser(data.user); return data.user; };
  useEffect(() => { const expired = () => setUser(null); window.addEventListener('scout-session-expired', expired); return () => window.removeEventListener('scout-session-expired', expired); }, []);
  useEffect(() => { api('/me').then(data => setUser(data.user)).catch(e => { if (e.status !== 401) setError('We could not connect to your account. Please reload to try again.'); }).finally(() => setLoading(false)); }, []);
  useEffect(() => { window.scrollTo(0, 0); document.title = 'Scout'; }, [location.pathname]);
  return <Session.Provider value={{ user, setUser, loading, refresh }}><ThemeProvider user={user} setUser={setUser}><a className="skip-link" href="#main">Skip to content</a><Suspense fallback={<Spinner />}><Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/support" element={<Support />} />
    {['login', 'signup', 'forgot-password', 'reset-password', 'verify-email'].map(mode => <Route key={mode} path={`/${mode}`} element={<Auth mode={mode} />} />)}
    <Route path="/app/*" element={loading ? <Spinner /> : user ? <AppPages /> : error ? <div className="empty" role="alert">{error}<button className="button primary" onClick={() => window.location.reload()}>Reload</button></div> : <Navigate to="/login" replace />} />
    <Route path="*" element={<div className="empty"><h1>Nothing on the radar here.</h1><a className="button primary" href="/">Back to Scout</a></div>} />
  </Routes></Suspense></ThemeProvider></Session.Provider>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><LazyMotion features={loadMotion}><MotionConfig reducedMotion="user" transition={{ duration: .3, ease: [.22, 1, .36, 1] }}><App /></MotionConfig></LazyMotion></BrowserRouter></React.StrictMode>);
