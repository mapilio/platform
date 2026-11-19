import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import MapilioLogo from 'svg/logos/MapilioLogo';
import WhereAmI from 'views/landing/WhereAmI';
import { Stamp, RARITY } from 'views/landing/marks';
import gamePool from 'views/landing/data/gamePool.json';
import landing from 'views/landing/landing.module.css';
import { BADGES, LEVELS, levelFor, loadProgress, localDay } from 'lib/game/progress.mjs';
import s from './play.module.css';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,300..700&family=Mona+Sans:ital,wdth,wght@0,75..125,300..900&display=swap';

function Passport({ state }) {
  if (!state) return null;
  const lvl = levelFor(state.xp);
  return (
    <aside className={s.passport} aria-label="Your explorer passport">
      <h2>Passport</h2>
      <p className={s.level}><b>{lvl.name}</b><span>{state.xp.toLocaleString('en-US')} XP</span></p>
      <div className={s.bar}><i style={{ width: `${Math.round(lvl.progress * 100)}%` }} /></div>
      <p className={s.next}>{lvl.nextName ? `${(lvl.next - state.xp).toLocaleString('en-US')} XP to ${lvl.nextName}` : 'Top level reached'}</p>
      <dl className={s.stats}>
        <div><dt>Streak</dt><dd>{state.streak || 0} {state.streak === 1 ? 'day' : 'days'}</dd></div>
        <div><dt>Best streak</dt><dd>{state.bestStreak || 0}</dd></div>
        <div><dt>Rounds</dt><dd>{(state.rounds || 0).toLocaleString('en-US')}</dd></div>
        <div><dt>Best round</dt><dd>{(state.bestRound || 0).toLocaleString('en-US')}</dd></div>
        <div><dt>Walked</dt><dd>{state.walkedM >= 1000 ? `${(state.walkedM / 1000).toFixed(1)} km` : `${Math.round(state.walkedM || 0)} m`}</dd></div>
        <div><dt>Countries guessed</dt><dd>{(state.countriesNear || []).length}</dd></div>
      </dl>
      <h3>Badges</h3>
      <ul className={s.badges}>
        {BADGES.filter((b) => b.track === 'explorer').map((b) => {
          const earned = !!(state.badges && state.badges[b.id]);
          return (
            <li key={b.id} data-earned={earned ? 'true' : undefined} title={`${b.name}: ${b.criterion}`}>
              <Stamp id={`p-${b.id}`} glyph={b.glyph} ring={b.name} rarity={b.rarity} earned={earned} size={84} />
              <span>{b.name}</span>
              <small style={{ color: RARITY[b.rarity].color }}>{earned ? 'Earned' : b.criterion}</small>
            </li>
          );
        })}
      </ul>
      <p className={s.note}>Progress is saved in this browser. Signed-in sync and contributor badges from your uploads are on the roadmap.</p>
      <ol className={s.levels} aria-label="Levels">
        {LEVELS.map((l) => <li key={l.name} data-current={l.name === lvl.name ? 'true' : undefined}>{l.name}<small>{l.xp.toLocaleString('en-US')}</small></li>)}
      </ol>
    </aside>
  );
}

export default function Play() {
  const [state, setState] = useState(null);
  const refresh = useCallback(() => {
    try { setState(loadProgress(window.localStorage)); } catch (e) { setState(null); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className={`${landing.root} ${s.page}`}>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
        <meta name="theme-color" content="#070b14" />
      </Head>
      <header className={s.top}>
        <a href="/" aria-label="Mapilio home"><MapilioLogo width={108} height={36} primaryColor="#ffffff" secondaryColor="#0056f1" /></a>
        <nav aria-label="Play navigation">
          <a href="/app">Map</a>
          <a href="/app/walk">Walk</a>
          <a href="/" >Home</a>
        </nav>
      </header>
      <main className={s.main}>
        <section className={s.game} aria-labelledby="play-h">
          <div className={s.head}>
            <h1 id="play-h">Where am I?</h1>
            <p>Daily five · {day}. Same five photos for everyone today. Closer guesses score more, up to 5,000 a photo.</p>
          </div>
          <WhereAmI pool={gamePool} rounds={5} mode="daily" key={localDay()} onFinish={refresh} />
          <p className={s.fair}>Practice mode runs in your browser, so a determined player can find the answers. Ranked play with server-side scoring is on the roadmap.</p>
        </section>
        <Passport state={state} />
      </main>
    </div>
  );
}
