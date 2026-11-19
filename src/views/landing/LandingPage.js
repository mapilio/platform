import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import MapilioLogo from 'svg/logos/MapilioLogo';
import { footerLinks } from './footerLinks';
import s from './landing.module.css';
import Story, { HERO_IMAGE } from './Story';
import WhereAmI from './WhereAmI';
import Progress from './Progress';
import { PinMark } from './marks';
import gamePool from './data/gamePool.json';
import {
  NAV, PLAY, PROGRESS, OPEN, CTA, LINKS,
} from './content';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,300..700&family=Mona+Sans:ital,wdth,wght@0,75..125,300..900;1,75..125,300..900&display=swap';

const SOCIAL = [
  { label: 'GitHub', href: 'https://github.com/mapilio' },
  { label: 'Discord', href: 'https://discord.gg/St5z2sUZ7H' },
  { label: 'X', href: 'https://twitter.com/mapiliocom' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/mapilio' },
  { label: 'Instagram', href: 'https://www.instagram.com/mapilio' },
];

const LEGAL = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Cookie policy', href: '/cookie-policy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Licences', href: '/licenses' },
  { label: 'Data processing', href: '/data-processing' },
  { label: 'GDPR', href: '/gdpr' },
];

// Only allow app deep links (mapilio:// or https://mapilio.com/...) from ?deeplink=
function safeDeeplink() {
  try {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return;
    const raw = new URLSearchParams(window.location.search).get('deeplink');
    if (!raw) return;
    const u = new URL(raw, window.location.origin);
    const ok = u.protocol === 'mapilio:' || (u.protocol === 'https:' && /(^|\.)mapilio\.com$/.test(u.hostname));
    if (ok) window.location.href = u.toString();
  } catch (e) { /* ignore malformed links */ }
}

function Header({ tone }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);
  const dark = tone === 'dark' && !open;
  return (
    <header className={s.header} data-tone={dark ? 'dark' : 'light'} data-scrolled={scrolled ? 'true' : 'false'} data-open={open ? 'true' : 'false'}>
      <a className={s.logo} href="/" aria-label="Mapilio home">
        <MapilioLogo width={112} height={37} primaryColor={dark ? '#ffffff' : '#0b1220'} secondaryColor="#0056f1" />
      </a>
      <nav className={s.nav} aria-label="Primary">
        <ul>
          {NAV.map((n) => <li key={n.label}><a href={n.href}>{n.label}</a></li>)}
        </ul>
      </nav>
      <a className={s.headerCta} href={LINKS.app}>Open the map</a>
      <button type="button" className={s.menuBtn} aria-expanded={open} aria-controls="mp-menu" onClick={() => setOpen((v) => !v)}>
        <span>{open ? 'Close' : 'Menu'}</span>
      </button>
      <div id="mp-menu" className={s.menu} hidden={!open}>
        <ul>
          {NAV.map((n) => <li key={n.label}><a href={n.href} onClick={() => setOpen(false)}>{n.label}</a></li>)}
          <li><a href={LINKS.app} onClick={() => setOpen(false)}>Open the map</a></li>
        </ul>
      </div>
    </header>
  );
}

function OpenSection() {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch (e) { /* ignore */ }
  };
  return (
    <section id="open" className={s.open} aria-labelledby="open-title">
      <div className={s.openHead}>
        <h2 id="open-title" className={s.sectionTitle}>{OPEN.title}</h2>
        <p className={s.sectionLede}>{OPEN.intro}</p>
      </div>
      <ol className={s.openList}>
        {OPEN.rows.map((r, i) => (
          <li key={r.key}>
            <span className={s.openIndex}>{String(i + 1).padStart(2, '0')}</span>
            <span className={s.openTag}>{r.tag}</span>
            <div className={s.openText}>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
              {r.code && (
                <button type="button" className={s.code} onClick={() => copy(r.code)} aria-label={`Copy command: ${r.code}`}>
                  <code>$ {r.code}</code>
                  <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
                </button>
              )}
            </div>
            <a className={s.openLink} href={r.href} {...(/^https?:/.test(r.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {r.linkLabel}<i aria-hidden="true">↗</i>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className={s.footer}>
      <div className={s.footerTop}>
        <div className={s.footerBrand}>
          <MapilioLogo width={132} height={43} primaryColor="#ffffff" secondaryColor="#0056f1" />
          <p>Mapilio aims to make the world accessible to everyone by creating better maps from images.</p>
          <ul className={s.social}>
            {SOCIAL.map((x) => <li key={x.label}><a href={x.href} target="_blank" rel="noopener noreferrer">{x.label}</a></li>)}
          </ul>
        </div>
        <div className={s.footerCols}>
          {footerLinks.map((col) => (
            <div key={col.main}>
              <h3>{col.main}</h3>
              <ul>
                {col.children.filter((c) => c.to).map((c) => (
                  <li key={c.name}>
                    <a href={c.to} {...(c.target === '_blank' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{c.name}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className={s.footerBottom}>
        <p>
          © Mapilio {year}. Imagery under CC BY-SA unless stated otherwise. Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> and ©{' '}
          <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">Mapbox</a>.
        </p>
        <ul>
          {LEGAL.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
          <li><a href="/cookie-policy#settings">Cookie settings</a></li>
        </ul>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const [tone, setTone] = useState('light');
  const onTone = useCallback((t) => setTone(t), []);
  useEffect(() => { safeDeeplink(); }, []);

  return (
    <>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
        <link rel="preload" as="image" href={HERO_IMAGE} type="image/webp" />
        <meta name="theme-color" content="#e8edf1" />
      </Head>
      <div className={s.root}>
        <a className={s.skip} href="#play">Skip the story</a>
        <Header tone={tone} />
        <main>
          <Story onTone={onTone} />

          <section id="play" className={s.play} aria-labelledby="play-title">
            <div className={s.playHead}>
              <h2 id="play-title" className={s.playTitle}>{PLAY.title}</h2>
              <p className={s.sectionLedeLight}>{PLAY.body}</p>
            </div>
            <WhereAmI pool={gamePool} rounds={3} />
            <p className={s.playFoot}>{PLAY.appNote} <a href={LINKS.play}>{PLAY.appCta} →</a></p>
          </section>

          <section id="progress" className={s.progress} aria-labelledby="progress-title">
            <div className={s.progressHead}>
              <h2 id="progress-title" className={s.sectionTitle}>{PROGRESS.title}</h2>
              <p className={s.sectionLede}>{PROGRESS.body}</p>
            </div>
            <Progress />
          </section>

          <OpenSection />

          <section id="get-the-app" className={s.cta} aria-labelledby="cta-title">
            <div className={s.ctaMark} aria-hidden="true"><PinMark size={180} color="#0056f1" /></div>
            <h2 id="cta-title" className={s.ctaTitle}>{CTA.title}</h2>
            <p className={s.ctaBody}>{CTA.body}</p>
            <div className={s.ctaRow}>
              <a className={s.store} href={LINKS.appStore} target="_blank" rel="noopener noreferrer"><small>Download on the</small>App Store</a>
              <a className={s.store} href={LINKS.googlePlay} target="_blank" rel="noopener noreferrer"><small>Get it on</small>Google Play</a>
              <a className={s.btnBlueLg} href={LINKS.app}>Open the map</a>
            </div>
            <p className={s.ctaFoot}>Shooting with an action or 360° camera? <a href={LINKS.uploader}>Upload with Mapilio Kit</a>.</p>
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
