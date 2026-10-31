import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, m, useInView, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, ArrowRight, Check, ChevronDown, Pause, RotateCcw, Send } from 'lucide-react';
import { Logo, BrandLogo } from './ui';
import { ThemeControl } from './theme';
import { useSession } from './main';
import './landing.css';

const steps = [
  { title: 'A new listing', text: 'Someone posts the thing you’ve been looking for. Scout checks your marketplaces in the background.' },
  { title: 'Your kind of find', text: 'The right keywords. Within your budget. Scout checks the listing against your search.' },
  { title: 'Your notification', text: 'Your match appears in Scout. Add email or your Telegram bots when you want an extra heads-up.' },
];
const examples = [
  { image: 'leather-jacket', title: 'The jacket with a past.', search: 'Leather jacket', budget: 'Under €60', bot: 'Wardrobe finds', alt: 'Vintage black leather jacket hanging in a wooden wardrobe', width: 700, height: 933 },
  { image: 'film-camera', title: 'Your next weekend obsession.', search: '35mm film camera', budget: 'Under €100', bot: 'Camera alerts', alt: 'Silver and black 35mm film camera on a pale tabletop', width: 1000, height: 1333 },
  { image: 'sneakers', title: 'That pair. In your size.', search: 'Running trainers', budget: 'Under €80', bot: 'Daily finds', alt: 'Grey trainers with yellow and red accents', width: 600, height: 750 },
];
const questions = [
  ['How quickly will I hear about a listing?', 'Scout checks on the schedule you set and sends an alert when a scan finds a new match. Timing depends on your check interval and marketplace availability. It gives you a head start without keeping the app open; it cannot guarantee you’ll be first.'],
  ['Do I need a Vinted account?', 'No. Scout searches public Vinted listings. Choose your region and start a search. Availability depends on whether Vinted accepts requests from your server.'],
  ['Can I use eBay too?', 'Yes. Add your own eBay production App ID and Cert ID in Settings, test the connection, and include eBay in your searches. Vinted is available by default.'],
  ['Where will I receive my notifications?', 'Every match appears in your Scout feed. You can also enable email notifications or connect Telegram bots. Choose the extra destinations you want for each search.'],
  ['Can different searches send to different Telegram bots?', 'Yes. Add your bots in Settings, then choose one or more for each search. Camera finds can go to one bot, clothing to another, or a search can notify both. Your bot credentials and settings belong only to your account.'],
  ['Will it notify me about old listings?', 'The first scan builds your feed quietly by default. Notifications start with new matches after that. You can choose to include existing listings when you create a search.'],
];

function Reveal({ children, className = '', ...props }) {
  const reduced = useReducedMotion();
  return <m.div className={className} initial={reduced ? false : { opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .12 }} transition={{ duration: .65 }} {...props}>{children}</m.div>;
}

function MatchNotice({ compact = false, destinations = [], channel = 'Scout' }) {
  return <div className={`sl-notification ${compact ? 'sl-notification-compact' : ''}`}>
    <div className="sl-notification-top"><span className="sl-notice-symbol" aria-hidden="true">{channel === 'Telegram' ? <BrandLogo source="telegram" /> : channel === 'Email' ? '@' : 's.'}</span><span>{channel === 'Telegram' ? destinations.join(' + ') || 'Your selected bots' : channel === 'Email' ? 'Scout · Email alert' : 'Scout · New match'}</span><small>Example alert</small></div>
    <div className="sl-notification-body"><img src="/landing/film-camera.webp" alt="" width="56" height="64" decoding="async" /><div><strong>Found: 35mm film camera</strong><p>€85 · Vinted · Matches your search</p><span>Open listing <ArrowUpRight size={13} aria-hidden="true" /></span></div></div>
  </div>;
}

function ProcessDemo() {
  const reduced = useReducedMotion(), ref = useRef(null), visible = useInView(ref, { amount: .35 });
  const [step, setStep] = useState(reduced ? 2 : 0), [playing, setPlaying] = useState(!reduced);
  const [pageVisible, setPageVisible] = useState(true), [channel, setChannel] = useState('Scout'), [destinations, setDestinations] = useState(['Camera alerts', 'Weekend finds']);
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (reduced) { setPlaying(false); setStep(2); }
  }, [reduced]);
  useEffect(() => {
    if (!playing || !visible || !pageVisible || reduced) return;
    if (step === 2) { setPlaying(false); return; }
    const timer = setTimeout(() => setStep(value => value + 1), 3200);
    return () => clearTimeout(timer);
  }, [step, playing, visible, pageVisible, reduced]);
  const selectStep = value => { setStep(value); setPlaying(false); };
  const toggleDestination = name => setDestinations(value => value.includes(name) ? value.filter(item => item !== name) : [...value, name]);
  return <div className="sl-demo" ref={ref}>
    <div className="sl-demo-controls"><div className="sl-demo-label"><span className="sl-status-dot" /> A SEARCH IN ACTION</div><div className="sl-demo-steps" role="group" aria-label="Explore how Scout works">{steps.map((item, index) => <button key={item.title} type="button" className={`sl-demo-step ${step === index ? 'is-current' : ''}`} aria-pressed={step === index} onClick={() => selectStep(index)}><span className="sl-step-number">0{index + 1}</span>{step === index && playing && visible && pageVisible && !reduced && <m.span className="sl-step-progress" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 3.2, ease: "linear" }} />}<span><strong>{item.title}</strong><span className="sl-step-description">{item.text}</span></span></button>)}</div><button className="sl-replay" type="button" onClick={() => { if (playing) setPlaying(false); else { setStep(0); setPlaying(!reduced); } }}>{playing ? <Pause size={13} aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}{playing ? 'Pause demo' : reduced ? 'Restart demo' : 'Replay demo'}</button></div>
    <div className="sl-demo-screen"><div className="sl-screen-toolbar"><span>SCOUT / 35MM FILM CAMERA</span><span>0{step + 1} — 03</span></div><div className="sl-demo-stage"><AnimatePresence mode="wait" initial={false}><m.div className={`sl-demo-panel sl-demo-panel-${step}`} key={step} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -10 }} transition={{ duration: .28 }}>
      {step === 0 && <><div className="sl-new-listing"><img src="/landing/film-camera.webp" alt="An example 35mm film camera listing" width="1000" height="1333" loading="lazy" /><span>NEW ON VINTED</span></div><div className="sl-listing-caption"><div><span>Just listed</span><h3>35mm film camera</h3></div><strong>€85</strong></div><p className="sl-demo-footnote">A new listing appears. Scout finds it on the next check.</p></>}
      {step === 1 && <><div className="sl-match-summary"><img src="/landing/film-camera.webp" alt="" width="74" height="84" loading="lazy" /><div><span>CHECKING YOUR SEARCH</span><h3>Looks like your kind of find.</h3></div></div><div className="sl-match-rules">{[['Search', '35mm film camera'], ['Your budget', '€85 / under €100'], ['Marketplace', 'Vinted']].map(([label, value], index) => <m.div key={label} initial={reduced ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduced ? 0 : index * .18 }}><span>{label}</span><strong>{value}</strong><Check size={17} aria-label="Matched" /></m.div>)}</div><div className="sl-match-confirmed"><span className="sl-status-dot" /> It’s a match. Ready to send.</div></>}
      {step === 2 && <><div className="sl-destination-heading"><span>YOUR NOTIFICATIONS, YOUR CHOICE</span><h3>Found it.<br />You’re up.</h3></div><div className="sl-demo-channels" role="group" aria-label="Example notification channels">{['Scout', 'Email', 'Telegram'].map(name => <button type="button" key={name} aria-pressed={channel === name} onClick={() => setChannel(name)}>{name === 'Scout' ? 'In Scout' : name}<small>{name === 'Scout' ? 'Default' : 'Optional'}</small></button>)}</div>{channel === 'Telegram' && <div className="sl-demo-destinations" role="group" aria-label="Example Telegram destinations">{['Camera alerts', 'Weekend finds'].map(name => <button type="button" key={name} aria-pressed={destinations.includes(name)} onClick={() => toggleDestination(name)}><span>{destinations.includes(name) && <Check size={11} aria-hidden="true" />}</span>{name}</button>)}</div>}{(channel !== 'Telegram' || destinations.length) ? <m.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><MatchNotice channel={channel} destinations={destinations} /></m.div> : <div className="sl-feed-only"><strong>Just your Scout feed.</strong><p>Select a bot above to preview a Telegram alert.</p></div>}<p className="sl-demo-footnote">{channel === 'Telegram' ? 'Choose one bot, several, or keep this search in your feed.' : channel === 'Email' ? 'An optional email alert, with a link straight to the listing.' : 'Matches are saved here by default. No bot setup needed.'}</p></>}
    </m.div></AnimatePresence></div><div className="sl-demo-disclaimer">Illustrative demo · timing and prices are examples</div></div>
  </div>;
}

export default function Landing() {
  const { user } = useSession(), reduced = useReducedMotion();
  const heroRef = useRef(null), heroVisible = useInView(heroRef, { once: true, amount: .3 });
  const start = user ? '/app/searches/new' : '/signup';
  return <div className="scout-landing">
    <header className="sl-nav sl-wrap"><Logo /><nav aria-label="Main navigation"><a className="sl-nav-section" href="#how-it-works">How it works</a><a className="sl-nav-section" href="#your-searches">What’s on your list?</a><ThemeControl className="sl-theme-control" />{user ? <Link className="sl-nav-start" to="/app">Your dashboard <ArrowUpRight size={16} /></Link> : <><Link className="sl-login" to="/login">Log in</Link><Link className="sl-nav-start" to="/signup">Get started <ArrowUpRight size={16} /></Link></>}</nav></header>
    <main id="main" tabIndex={-1}>
      <section className="sl-hero sl-wrap" ref={heroRef}>
        <div className="sl-hero-copy"><Reveal><span className="sl-kicker">FOR THE THINGS WORTH FINDING</span><h1>The good ones<br /><em>don’t wait.</em></h1><p>Scout watches Vinted and eBay for new matches, so you can move before they’re gone. In-app alerts first. Email and Telegram when you want them.</p><div className="sl-hero-actions"><Link to={start} className="sl-button">Start your first search <ArrowUpRight size={18} aria-hidden="true" /></Link><a href="#how-it-works" className="sl-underlined">Watch it work <span aria-hidden="true">↘</span></a></div><span className="sl-hero-note">Your searches keep running. You get on with your day.</span></Reveal></div>
        <div className="sl-hero-scene"><m.figure className="sl-hero-photo" initial={reduced ? false : { opacity: 0, y: 28, rotate: 3 }} animate={heroVisible ? { opacity: 1, y: 0, rotate: 0 } : undefined} transition={{ duration: .85, delay: .15 }}><img src="/landing/film-camera.webp" alt="A vintage silver and black film camera, the kind of find worth catching early" width="1000" height="1333" fetchPriority="high" /><span className="sl-photo-index">THE NEXT GOOD FIND / 001</span></m.figure><m.div className="sl-photo-small" initial={reduced ? false : { opacity: 0, x: -30, rotate: -12 }} animate={heroVisible ? { opacity: 1, x: 0, rotate: -7 } : undefined} transition={{ duration: .8, delay: .4 }}><img src="/landing/leather-jacket.webp" alt="A vintage leather jacket on a hanger" width="700" height="933" decoding="async" /><span>Something with a story.</span></m.div><m.div className="sl-hero-alert" initial={reduced ? false : { opacity: 0, y: 25 }} animate={heroVisible ? { opacity: 1, y: 0 } : undefined} transition={{ duration: .65, delay: .8 }}><MatchNotice compact /></m.div><div className="sl-hero-caption"><span className="sl-hero-sequence" aria-label="Posted, matched, notified">{["Posted", "Matched", "Notified"].map((label, index) => <m.span key={label} initial={reduced ? false : { opacity: .3, y: 5 }} animate={heroVisible ? { opacity: 1, y: 0 } : undefined} transition={{ duration: .35, delay: reduced ? 0 : 1.2 + index * .4 }}>{index > 0 && <span aria-hidden="true">→</span>}{label}</m.span>)}</span><span>Illustrative listings</span></div></div>
      </section>
      <div className="sl-marketplaces sl-wrap"><span>Good places to look.<br /><strong>One place to keep watch.</strong></span><div><BrandLogo source="vinted" decorative={false} /><small>Ready from the start</small></div><div><BrandLogo source="ebay" decorative={false} /><small>Connect your own keys</small></div><div className="sl-marketplace-alerts"><span>Your notifications<small>In Scout · Email · Telegram</small></span></div></div>
      <section className="sl-process sl-wrap" id="how-it-works"><Reveal className="sl-section-heading"><div><span className="sl-kicker">01 / THE HEAD START</span><h2>Posted. Matched.<br /><em>In your pocket.</em></h2></div><p>No constant refreshing.<br />A search that keeps looking. A notification when it finds something worth your attention.</p></Reveal><Reveal><ProcessDemo /></Reveal><p className="sl-timing-note">Scout checks on your schedule. Alerts follow each scan, subject to marketplace availability.</p></section>
      <section className="sl-collection sl-wrap" id="your-searches"><Reveal className="sl-section-heading"><div><span className="sl-kicker">02 / WHATEVER YOU’RE INTO</span><h2>A good eye.<br /><em>Now with backup.</em></h2></div><p>One search for your camera. Another for your wardrobe. Give each its own budget, filters and notifications. Keep everything in Scout, or add email and Telegram.</p></Reveal><div className="sl-example-grid">{examples.map((item, index) => <Reveal className="sl-example" key={item.image}><div className="sl-example-image"><img src={`/landing/${item.image}.webp`} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" /><span>0{index + 1}</span></div><h3>{item.title}</h3><div className="sl-example-details"><span>{item.search}</span><span>{item.budget}</span></div><div className="sl-example-route"><span>Scout feed +</span><strong>{item.bot}</strong><ArrowRight size={15} aria-hidden="true" /></div></Reveal>)}</div><div className="sl-collection-bottom"><p>Example searches. Yours can be as specific as you like.</p><Link to={start} className="sl-underlined">Put it on your list <ArrowUpRight size={16} aria-hidden="true" /></Link></div></section>
      <section className="sl-faq sl-wrap"><Reveal><span className="sl-kicker">03 / GOOD TO KNOW</span><h2>A few things<br /><em>before you go.</em></h2></Reveal><div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={17} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
      <section className="sl-closing"><div className="sl-wrap"><Reveal><span className="sl-kicker">YOUR NEXT FIND IS OUT THERE</span><h2>Less refreshing.<br /><em>More finding.</em></h2><Link to={start} className="sl-button sl-button-light">Start scouting <ArrowUpRight size={19} aria-hidden="true" /></Link></Reveal><div className="sl-closing-aside"><span className="sl-closing-star" aria-hidden="true">✳</span><p>Let Scout do the looking.<br />You’ll know when to look.</p></div></div></section>
    </main>
    <footer className="sl-footer sl-wrap"><Logo /><Link to="/support">Support <ArrowUpRight size={14} /></Link><p>For the find. And the head start.</p><span>Independent of Vinted, eBay and Telegram.</span></footer>
  </div>;
}
