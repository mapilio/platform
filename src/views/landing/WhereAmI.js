import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Config } from 'Configs/config';
import { addAttribution } from 'lib/mapAttribution';
import s from './landing.module.css';
import {
  applyEvent, haversineKm, roundScore, loadProgress, saveProgress, dailyPick, localDay,
} from 'lib/game/progress.mjs';

const displayName = (u) => (!u || /^\d{12,}$/.test(String(u)) ? 'a Mapilio contributor' : u);

const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`);

function pickRounds(pool, n) {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // prefer a spread of difficulties: one easy first
  arr.sort((a, b) => (a.difficulty === 'easy' ? -1 : 0) - (b.difficulty === 'easy' ? -1 : 0));
  return arr.slice(0, n);
}

function useGuessMap(containerRef, enabled, onPick) {
  const mapRef = useRef(null);
  const glRef = useRef(null);
  const guessMarker = useRef(null);
  const answerMarker = useRef(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!enabled || mapRef.current || !containerRef.current) return undefined;
    let cancelled = false;
    setStatus('loading');
    import('mapbox-gl').then((mod) => {
      if (cancelled) return;
      const mapboxgl = mod.default || mod;
      glRef.current = mapboxgl;
      mapboxgl.accessToken = Config.accessToken;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [18, 30],
        zoom: 1.25,
        projection: 'globe',
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: false,
      });
      addAttribution(mapboxgl, map, 'bottom-right');
      map.touchZoomRotate.disableRotation();
      map.on('style.load', () => {
        try {
          map.setFog({ color: 'rgb(232,237,241)', 'high-color': 'rgb(16,23,37)', 'horizon-blend': 0.03, 'space-color': 'rgb(16,23,37)', 'star-intensity': 0 });
        } catch (e) { /* older style */ }
        map.addSource('guess-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'guess-line', type: 'line', source: 'guess-line', paint: { 'line-color': '#0b1220', 'line-width': 2, 'line-dasharray': [2, 1.6] } });
        setStatus('ready');
      });
      map.on('click', (e) => onPick && onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      map.on('error', () => setStatus((st) => (st === 'ready' ? st : 'error')));
      mapRef.current = map;
    }).catch(() => setStatus('error'));
    return () => { cancelled = true; };
  }, [enabled, containerRef, onPick]);

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  const marker = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    return el;
  };

  const setGuess = useCallback((ll) => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (!map || !gl) return;
    if (!ll) { if (guessMarker.current) { guessMarker.current.remove(); guessMarker.current = null; } return; }
    if (!guessMarker.current) guessMarker.current = new gl.Marker({ element: marker(s.pinGuess), anchor: 'center' });
    guessMarker.current.setLngLat([ll.lng, ll.lat]).addTo(map);
  }, []);

  const reveal = useCallback((guess, answer) => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (!map || !gl) return;
    if (!answerMarker.current) answerMarker.current = new gl.Marker({ element: marker(s.pinAnswer), anchor: 'center' });
    answerMarker.current.setLngLat([answer.lng, answer.lat]).addTo(map);
    const src = map.getSource('guess-line');
    if (src && guess) {
      src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[guess.lng, guess.lat], [answer.lng, answer.lat]] } });
    }
    const b = new gl.LngLatBounds();
    b.extend([answer.lng, answer.lat]);
    if (guess) b.extend([guess.lng, guess.lat]);
    map.fitBounds(b, { padding: 70, maxZoom: 9, duration: 1400 });
  }, []);

  const reset = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (answerMarker.current) { answerMarker.current.remove(); answerMarker.current = null; }
    if (guessMarker.current) { guessMarker.current.remove(); guessMarker.current = null; }
    const src = map.getSource('guess-line');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
    map.easeTo({ center: [18, 30], zoom: 1.25, duration: 900 });
  }, []);

  return { status, setGuess, reveal, reset };
}

export default function WhereAmI({ pool, rounds = 3, mode = 'practice', onFinish }) {
  const isDaily = mode === 'daily';
  const day = useMemo(() => localDay(), []);
  const sectionRef = useRef(null);
  const mapEl = useRef(null);
  const [armed, setArmed] = useState(false);
  const [game, setGame] = useState(() => ({ items: [], round: 0, phase: 'intro', guess: null, results: [] }));
  const [imgState, setImgState] = useState('loading');
  const [xpNote, setXpNote] = useState(null);

  // only load the map when the section gets close to the viewport
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setArmed(true); io.disconnect(); } }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!pool || !pool.length) return;
    if (isDaily) {
      let done = null;
      try { done = loadProgress(window.localStorage).dailyDone[day]; } catch (e) { /* ignore */ }
      setGame((g) => ({ ...g, items: dailyPick(pool, rounds, day), phase: done != null ? 'played' : g.phase, playedScore: done }));
    } else {
      setGame((g) => ({ ...g, items: pickRounds(pool, rounds) }));
    }
  }, [pool, rounds, isDaily, day]);

  const current = game.items[game.round];
  const onPick = useCallback((ll) => {
    setGame((g) => (g.phase === 'guessing' || g.phase === 'intro' ? { ...g, phase: 'guessing', guess: ll } : g));
  }, []);
  const map = useGuessMap(mapEl, armed, onPick);

  useEffect(() => { map.setGuess(game.guess); }, [game.guess, map]);
  useEffect(() => { setImgState('loading'); }, [current?.id]);

  // preload the next photo
  useEffect(() => {
    const next = game.items[game.round + 1];
    if (next) { const im = new Image(); im.src = next.url1080; }
  }, [game.items, game.round]);

  const submit = () => {
    if (!current || !game.guess) return;
    const answer = { lat: current.lat, lng: current.lng };
    const km = haversineKm(game.guess, answer);
    const score = roundScore(km);
    map.reveal(game.guess, answer);
    let note = null;
    try {
      const st = loadProgress(window.localStorage);
      const r = applyEvent(st, { type: 'round', score, km, country: current.countrycode });
      saveProgress(window.localStorage, r.state);
      note = { gained: r.gained, badges: r.newBadges.map((b) => b.name), level: r.level };
    } catch (e) { /* storage unavailable */ }
    setXpNote(note);
    setGame((g) => ({ ...g, phase: 'revealed', results: [...g.results, { km, score, item: current }] }));
  };

  const next = () => {
    if (game.round + 1 >= game.items.length) {
      const total = game.results.reduce((a, r) => a + r.score, 0);
      try {
        const st = loadProgress(window.localStorage);
        const r = applyEvent(st, { type: 'game', total, daily: isDaily, day });
        saveProgress(window.localStorage, r.state);
        setXpNote({ gained: r.gained, badges: r.newBadges.map((b) => b.name), level: r.level });
        if (onFinish) onFinish(r);
      } catch (e) { /* ignore */ }
      setGame((g) => ({ ...g, phase: 'done' }));
      return;
    }
    map.reset();
    setXpNote(null);
    setGame((g) => ({ ...g, round: g.round + 1, phase: 'guessing', guess: null }));
  };

  const again = () => {
    map.reset();
    setXpNote(null);
    setGame({ items: pickRounds(pool, rounds), round: 0, phase: 'guessing', guess: null, results: [], practice: true });
  };
  const shareText = () => {
    const per = game.results.map((r) => r.score.toLocaleString('en-US')).join(' · ');
    // link to the game on the site the player is on: on a preview or before
    // the new pages ship, mapilio.com/app/play does not exist yet
    const playUrl = `${window.location.origin}/app/play`;
    return `Mapilio · Where am I?${isDaily && !game.practice ? ` daily ${day}` : ''}: ${game.results.reduce((a, r) => a + r.score, 0).toLocaleString('en-US')} / ${(game.items.length * 5000).toLocaleString('en-US')} (${per}) ${playUrl}`;
  };
  const [copied, setCopied] = useState(false);
  const copyResult = async () => {
    try { await navigator.clipboard.writeText(shareText()); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch (e) { /* ignore */ }
  };

  const total = game.results.reduce((a, r) => a + r.score, 0);
  const last = game.results[game.results.length - 1];
  const level = useMemo(() => (xpNote?.level) || null, [xpNote]);

  if (!pool || !pool.length) return null;

  return (
    <div ref={sectionRef} className={s.game}>
      <div className={s.gameHead}>
        <p className={s.gameMeta}>
          <span>{isDaily && !game.practice ? `Daily five · ${day}` : `Practice · ${rounds} photos`}</span>
          <span aria-live="polite">Round {Math.min(game.round + 1, game.items.length || rounds)} / {game.items.length || rounds}</span>
          <span>Score {total.toLocaleString('en-US')}</span>
        </p>
      </div>
      <div className={s.gameBoard} data-phase={game.phase}>
        <figure className={s.gamePhoto} data-state={imgState}>
          {current && (
            <img
              key={current.id}
              src={current.url1080}
              alt="A street photographed by a Mapilio contributor. Where is it?"
              onLoad={() => setImgState('ready')}
              onError={() => setImgState('error')}
              draggable={false}
            />
          )}
          {imgState === 'loading' && <span className={s.gameLoading}>Loading photo…</span>}
          {imgState === 'error' && <span className={s.gameLoading}>This photo did not load. <button type="button" onClick={next}>Skip it</button></span>}
          {game.phase !== 'guessing' && game.phase !== 'intro' && current && (
            <figcaption>
              <b>{current.place}</b>
              <span>Photo by {displayName(current.username)} · {String(current.capture_time || '').slice(0, 4)} · CC BY-SA</span>
            </figcaption>
          )}
        </figure>
        <div className={s.gameMap}>
          <div ref={mapEl} className={s.gameMapCanvas} aria-label="World map: click to place your guess" role="application" />
          {map.status !== 'ready' && <span className={s.gameLoading}>{map.status === 'error' ? 'The map could not load.' : 'Loading map…'}</span>}
          {game.phase === 'intro' && map.status === 'ready' && <p className={s.gameTip}>Click the map where you think this photo was taken.</p>}
        </div>
      </div>
      {game.phase === 'played' && (
        <div className={s.gameBar}>
          <div className={s.gameDone}>
            <p>Today’s five: <b>{(game.playedScore || 0).toLocaleString('en-US')}</b></p>
            <p className={s.gameLevel}>A new set arrives at midnight, your local time.</p>
            <div className={s.gameDoneCtas}>
              <button type="button" className={s.btnSignal} onClick={again}>Practice round</button>
            </div>
          </div>
        </div>
      )}
      <div className={s.gameBar} hidden={game.phase === 'played'}>
        {(game.phase === 'intro' || game.phase === 'guessing') && (
          <button type="button" className={s.btnSignal} onClick={submit} disabled={!game.guess || imgState !== 'ready'}>
            {game.guess ? 'Guess' : 'Place your pin'}
          </button>
        )}
        {game.phase === 'revealed' && last && (
          <>
            <p className={s.gameResult} aria-live="polite">
              <b>{fmtKm(last.km)}</b> away · <b>{last.score.toLocaleString('en-US')}</b> points
              {xpNote && xpNote.gained > 0 && <span className={s.xp}>+{xpNote.gained} XP</span>}
              {xpNote && xpNote.badges.length > 0 && <span className={s.badgeNote}>Badge: {xpNote.badges.join(', ')}</span>}
            </p>
            <button type="button" className={s.btnSignal} onClick={next}>{game.round + 1 >= game.items.length ? 'See your score' : 'Next photo'}</button>
          </>
        )}
        {game.phase === 'done' && (
          <div className={s.gameDone} aria-live="polite">
            <p><b>{total.toLocaleString('en-US')}</b> / {(game.items.length * 5000).toLocaleString('en-US')}</p>
            {level && <p className={s.gameLevel}>{level.name}{level.nextName ? ` · ${Math.max(0, level.next - level.xp)} XP to ${level.nextName}` : ''}</p>}
            <div className={s.gameDoneCtas}>
              {isDaily
                ? <button type="button" className={s.btnSignal} onClick={copyResult}>{copied ? 'Copied' : 'Copy result'}</button>
                : <a className={s.btnSignal} href="/app/play">Play the daily five</a>}
              <button type="button" className={s.btnGhostLight} onClick={again}>{isDaily ? 'Practice round' : 'Play again'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
