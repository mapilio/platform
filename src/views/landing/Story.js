import React, { useEffect, useMemo, useRef, useState } from 'react';
import s from './landing.module.css';
import meta from './data/dorrigo.json';
import { HERO, STREET, LIFT, DRONE, CITY, WORLD, STATS, LINKS, fmt } from './content';
import { SEGMENTS, overlayAlpha, formatAltitude, cumulative, walkFrames } from './stage/timeline.mjs';
import { PinMark } from './marks';

// The story's place: a real Mapilio 360° sequence baked into /public/landing
const PLACE_DIR = '/landing/dorrigo';
const ASSETS = {
  frameUrl: (file, size) => `${PLACE_DIR}/${file}-${size}.webp`,
  coverageUrl: '/landing/dorrigo-area.json',
  worldUrl: '/landing/world-coverage.json',
};
const WALK = walkFrames(meta);
export const HERO_IMAGE = ASSETS.frameUrl(WALK[0].file, '2k');
const AREA = meta.area || { label: 'City', h: 46000, marks: [] };
const latLngLabel = ({ lat, lng }) => `${lat < 0 ? 'S' : 'N'} ${Math.abs(lat).toFixed(4)}° · ${lng < 0 ? 'W' : 'E'} ${Math.abs(lng).toFixed(4)}°`;
const markAt = (r) => {
  let m = AREA.marks[0];
  AREA.marks.forEach((x) => { if (x.r <= r + 1e-6) m = x; });
  return m;
};

// [fade-in start, fully in, fade-out start, gone] in story progress
const WIN = {
  hero: [-1, 0, 0.022, 0.07],
  street0: [0.15, 0.175, 0.235, 0.26],
  street1: [0.255, 0.28, 0.335, 0.36],
  street2: [0.355, 0.38, 0.43, 0.452],
  lift: [0.465, 0.482, 0.503, 0.518],
  scrimDark: [0.148, 0.172, 0.505, 0.522],
  scrimLight: [0.585, 0.61, 0.845, 0.865],
  worldTitle: [0.875, 0.91, 2, 3],
  drone: [0.575, 0.6, 0.67, 0.69],
  city: [0.705, 0.73, 0.835, 0.86],
  cityYear: [0.7, 0.72, 0.84, 0.86],
  world: [0.875, 0.91, 2, 3],
};

// full-screen or decorative overlays never take the pointer: the panorama under them is draggable
const PASSIVE = new Set(['hero', 'scrimDark', 'scrimLight', 'cityYear']);

const RAIL = [
  { key: 'street', label: 'Street', alt: 2.1 },
  { key: 'drone', label: 'Drone', alt: 120 },
  { key: 'city', label: AREA.label, alt: AREA.h },
  { key: 'world', label: 'World', alt: 20000000 },
];
const LOG_MIN = Math.log(2);
const LOG_MAX = Math.log(2e7);
const railPos = (alt) => (Math.log(Math.max(2, alt)) - LOG_MIN) / (LOG_MAX - LOG_MIN);

function useWalkFacts() {
  return useMemo(() => {
    const cum = cumulative(WALK);
    return { count: WALK.length, metres: Math.round(cum[cum.length - 1]) };
  }, []);
}

function DroneForm() {
  const [status, setStatus] = useState('idle');
  const [email, setEmail] = useState('');
  const onSubmit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setStatus('invalid'); return; }
    setStatus('sending');
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL}/api/subscribe`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: { parameters: { email: email.trim() } } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('done');
      setEmail('');
    } catch (err) {
      setStatus('error');
    }
  };
  return (
    <form className={s.droneForm} onSubmit={onSubmit} aria-label={DRONE.formLabel}>
      <label className={s.srOnly} htmlFor="drone-email">Email address</label>
      <input
        id="drone-email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => { setEmail(e.target.value); if (status !== 'idle') setStatus('idle'); }}
        aria-invalid={status === 'invalid'}
      />
      <button type="submit" className={s.btnInk} disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : DRONE.cta}
      </button>
      <p className={s.formNote} role="status" aria-live="polite">
        {status === 'done' && 'Thanks. We will write when drone uploads open.'}
        {status === 'invalid' && 'Please enter a valid email address.'}
        {status === 'error' && 'That did not work. Please try again.'}
        {status === 'idle' && <>Or follow the <a href={LINKS.droneRoadmap} target="_blank" rel="noopener noreferrer">public roadmap</a>.</>}
      </p>
    </form>
  );
}

export default function Story({ onTone }) {
  const sectionRef = useRef(null);
  const canvasRef = useRef(null);
  const coreRef = useRef(null);
  const railRef = useRef(null);
  const altRef = useRef(null);
  const chapterRef = useRef(null);
  const yearRef = useRef(null);
  const yearSmallRef = useRef(null);
  const overlaysRef = useRef({});
  const stageRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const walk = useWalkFacts();

  useEffect(() => {
    let destroyed = false;
    let stage = null;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
    const section = sectionRef.current;
    let tone = 'light';
    let lastChapter = '';

    const readProgress = () => {
      const rect = section.getBoundingClientRect();
      const total = section.offsetHeight - window.innerHeight;
      return total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
    };

    const applyOverlays = (p) => {
      const ov = overlaysRef.current;
      Object.keys(ov).forEach((k) => {
        const el = ov[k];
        if (!el) return;
        const a = overlayAlpha(p, WIN[k]);
        el.style.opacity = a.toFixed(3);
        el.style.setProperty('--in', a.toFixed(3));
        el.style.visibility = a < 0.003 ? 'hidden' : 'visible';
        el.style.pointerEvents = a > 0.6 && !PASSIVE.has(k) ? 'auto' : 'none';
      });
    };

    const onFrame = ({ progress, state, planetPx, reveal }) => {
      applyOverlays(progress);
      // planet core mark
      const core = coreRef.current;
      if (planetPx && core) {
        const P = state.pano;
        const coreR = planetPx.r * 0.5;
        // the pin belongs to the floating planet; hide it while the core fills the screen
        const big = 1 - Math.min(1, Math.max(0, (coreR - 230) / 60));
        const showCore = P.ring > 0.5 && P.planet > 0.85 && P.opacity > 0.02;
        core.style.opacity = showCore ? Math.min(1, P.ring * P.opacity * big * (reveal || 0)).toFixed(3) : '0';
        core.style.transform = `translate3d(${planetPx.x}px, ${planetPx.y}px, 0) translate(-50%, -50%) scale(${Math.max(0.001, Math.min(coreR, 150) / 60).toFixed(4)})`;
      } else if (core) {
        core.style.opacity = '0';
      }
      // altimeter
      if (altRef.current) altRef.current.textContent = formatAltitude(state.alt);
      if (railRef.current) {
        railRef.current.style.setProperty('--alt', railPos(state.alt).toFixed(4));
        railRef.current.style.opacity = (1 - overlayAlpha(progress, WIN.hero)).toFixed(3);
      }
      const chapter = state.alt < 60 ? 'Street'
        : state.alt < Math.min(1200, AREA.h * 0.6) ? 'Drone'
          : state.segment === 'world' && state.globe.alpha > 0.3 ? 'World' : AREA.label;
      if (chapterRef.current && chapter !== lastChapter) { chapterRef.current.textContent = chapter; lastChapter = chapter; }
      // the date the area's coverage has been drawn up to
      if (yearRef.current && AREA.marks.length) {
        const m = markAt(state.map.reveal);
        if (yearRef.current.textContent !== m.big) yearRef.current.textContent = m.big;
        if (yearSmallRef.current && yearSmallRef.current.textContent !== m.small) yearSmallRef.current.textContent = m.small;
      }
      // header tone: light text over imagery
      const P = state.pano;
      const dark = P.visible && P.planet < 0.55 && (state.segment === 'walk' || state.segment === 'dive' || state.segment === 'lift');
      const next = dark ? 'dark' : 'light';
      if (next !== tone) { tone = next; onTone && onTone(next); section.dataset.tone = next; }
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const p = readProgress();
        if (stage) stage.setProgress(p); else applyOverlays(p);
      });
    };

    import('./stage/Stage')
      .then(({ createStage }) => {
        if (destroyed) return;
        stage = createStage({
          canvas: canvasRef.current,
          meta,
          assets: ASSETS,
          reducedMotion: reduced,
          isMobile,
          onFrame,
          onHeroReady: () => setReady(true),
          onError: () => setFailed(true),
        });
        if (!stage) { setFailed(true); return; }
        stageRef.current = stage;
        stage.setProgress(readProgress());
      })
      .catch(() => setFailed(true));

    // pause rendering when the story is off-screen
    const io = new IntersectionObserver(([entry]) => { if (stage) stage.setVisible(entry.isIntersecting); }, { rootMargin: '200px' });
    io.observe(section);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    applyOverlays(readProgress());

    return () => {
      destroyed = true;
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (stage) stage.destroy();
    };
  }, [onTone]);

  const setOv = (k) => (el) => { overlaysRef.current[k] = el; };
  const scrollToChapter = (key) => {
    const section = sectionRef.current;
    if (!section) return;
    const total = section.offsetHeight - window.innerHeight;
    const target = { street: SEGMENTS.walk[0] + 0.01, drone: SEGMENTS.drone[0] + 0.05, city: SEGMENTS.city[0] + 0.12, world: SEGMENTS.world[0] + 0.1 }[key];
    window.scrollTo({ top: section.offsetTop + target * total, behavior: 'smooth' });
  };

  return (
    <section ref={sectionRef} className={s.story} aria-label="Mapilio, from street level to the whole world" data-tone="light" data-ready={ready ? 'true' : 'false'} data-failed={failed ? 'true' : 'false'}>
      {/* full text of the story for screen readers; the visual chapters appear one at a time */}
      <div className={s.srOnly}>
        <h1>{HERO.titleTop} {HERO.titleBottom}</h1>
        <p>{HERO.lede}</p>
        {STREET.map((c) => <p key={c.key}><strong>{c.title}</strong> {c.body(meta, walk)}</p>)}
        <p><strong>{LIFT.title}</strong> {LIFT.body}</p>
        <p><strong>{DRONE.title}</strong> ({DRONE.tag}) {DRONE.body}</p>
        <p><strong>{CITY.title}</strong> {CITY.body(meta)}</p>
        <p><strong>{WORLD.title}</strong> {fmt(STATS.images)} image records, imagery in {fmt(STATS.countries)} countries and territories, {fmt(STATS.uploaders)} contributors uploading, {fmt(STATS.accounts)} registered accounts ({WORLD.snapshot}, {STATS.checkedAt}).</p>
      </div>
      <div className={s.sticky}>
        <div className={s.poster} aria-hidden="true">
          <img src={`${PLACE_DIR}/poster.webp`} alt="" width="520" height="520" decoding="async" />
        </div>
        <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />
        {failed && (
          <div className={s.fallback} aria-hidden="true">
            <img src={HERO_IMAGE} alt="" />
          </div>
        )}

        <div ref={setOv('scrimDark')} className={s.scrimDark} aria-hidden="true" />
        <div ref={setOv('scrimLight')} className={s.scrimLight} aria-hidden="true" />
        <div ref={coreRef} className={s.planetCore} aria-hidden="true">
          <PinMark />
        </div>

        {/* HERO */}
        <div ref={setOv('hero')} className={s.hero}>
          <h1 className={s.heroTitle} aria-hidden="true">
            <span className={s.heroTop}>{HERO.titleTop}</span>
            <span className={s.heroBottom}>{HERO.titleBottom}</span>
          </h1>
          <div className={s.heroFoot}>
            <p className={s.heroLede}>{HERO.lede}</p>
            <div className={s.heroCtas}>
              <a className={s.btnBlue} href={LINKS.app}>Open the map</a>
              <a className={s.btnGhost} href="#get-the-app">Get the app</a>
            </div>
          </div>
          <p className={s.heroMeta}>
            <span>{latLngLabel(meta.origin)}</span>
            <span>{HERO.place(meta)}</span>
            <span>360° photo by {meta.credit.username} · {meta.credit.licence}</span>
          </p>
          <button type="button" className={s.scrollHint} onClick={() => scrollToChapter('street')}>
            <span>{HERO.hint}</span>
            <i aria-hidden="true" />
          </button>
        </div>

        {/* STREET */}
        {STREET.map((c, i) => (
          <div key={c.key} ref={setOv(`street${i}`)} className={`${s.chapter} ${s.onImage}`}>
            <h2 className={s.chapterTitle}>{c.title}</h2>
            <p className={s.chapterBody}>{c.body(meta, walk)}</p>
            {i === 0 && <a className={s.inlineLink} href={`${LINKS.walk}?seq=${meta.sequence}`}>Walk the whole sequence in the app →</a>}
          </div>
        ))}

        {/* LIFT */}
        <div ref={setOv('lift')} className={`${s.chapter} ${s.onImage}`}>
          <h2 className={s.chapterTitle}>{LIFT.title}</h2>
          <p className={s.chapterBody}>{LIFT.body}</p>
        </div>

        {/* DRONE */}
        <div ref={setOv('drone')} id="drones" className={`${s.chapter} ${s.chapterDrone}`}>
          <span className={s.tag}>{DRONE.tag}</span>
          <h2 className={s.chapterTitle}>{DRONE.title}</h2>
          <p className={s.chapterBody}>{DRONE.body}</p>
          <a className={s.inlineLink} href={DRONE.demoHref}>{DRONE.demoLabel} →</a>
          <DroneForm />
        </div>

        {/* CITY */}
        <div ref={setOv('city')} className={`${s.chapter} ${s.chapterCity}`}>
          <h2 className={s.chapterTitle}>{CITY.title}</h2>
          <p className={s.chapterBody}>{CITY.body(meta)}</p>
          <ul className={s.legend}>
            {CITY.legend.map((l) => <li key={l.key} data-k={l.key}><i aria-hidden="true" />{l.label}</li>)}
          </ul>
          <p className={s.legendNote}>
            {CITY.attribution.text} <a href={CITY.attribution.href} target="_blank" rel="noopener noreferrer">{CITY.attribution.link}</a>
          </p>
        </div>
        <div ref={setOv('cityYear')} className={s.yearBig} aria-hidden="true">
          <small ref={yearSmallRef}>{AREA.marks[0] && AREA.marks[0].small}</small>
          <span ref={yearRef}>{AREA.marks[0] && AREA.marks[0].big}</span>
        </div>

        {/* WORLD */}
        <h2 ref={setOv('worldTitle')} className={s.worldTitle}>{WORLD.title}</h2>
        <div ref={setOv('world')} className={`${s.chapter} ${s.chapterWorld}`}>
          <dl className={s.numbers}>
            <div><dt>Image records</dt><dd>{fmt(STATS.images)}</dd></div>
            <div><dt>Countries &amp; territories</dt><dd>{fmt(STATS.countries)}</dd></div>
            <div><dt>Contributors uploading</dt><dd>{fmt(STATS.uploaders)}</dd></div>
            <div><dt>Registered accounts</dt><dd>{fmt(STATS.accounts)}</dd></div>
          </dl>
          <p className={s.numbersNote}>{WORLD.snapshot}, {new Date(`${STATS.checkedAt}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Image records exclude deleted and anomalous records.</p>
        </div>

        {/* ALTIMETER */}
        <nav ref={railRef} className={s.rail} aria-label="Story chapters">
          <div className={s.railReadout} aria-hidden="true">
            <span ref={chapterRef}>Street</span>
            <b ref={altRef}>2.1 m</b>
          </div>
          <ol>
            {RAIL.map((r) => (
              <li key={r.key} style={{ '--pos': railPos(r.alt) }}>
                <button type="button" onClick={() => scrollToChapter(r.key)}>
                  <span>{r.label}</span>
                  <small>{formatAltitude(r.alt)}</small>
                </button>
              </li>
            ))}
          </ol>
          <i className={s.railMarker} aria-hidden="true" />
        </nav>
      </div>
    </section>
  );
}
