import React, { useEffect, useRef } from 'react';
import { shotImage } from 'lib/drone/drone.mjs';
import s from './atlas.module.css';

const fmtTime = (t) => {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}, ${m[4]}:${m[5]}`;
};

function Ring({ value }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg className={s.ring} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} />
      <circle cx="18" cy="18" r={r} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - Math.min(1, value)) }} />
    </svg>
  );
}

/**
 * The interface over the map while you are in a drone survey. The photo and the
 * 3D reconstruction are drawn by the map itself; this is only the frame around them.
 */
export default function DroneHud({
  site, mode, index, seen, xpPop, orbit, has3d, onIndex, onMode, onExit, onDropToStreet, onOrbit, onOpen,
}) {
  const n = site.shots.length;
  const shot = site.shots[index] || site.shots[0];
  const stripRef = useRef(null);
  const titleRef = useRef(null);
  const handlers = useRef({});
  handlers.current = { onIndex, onExit, onOpen, mode, index };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      const h = handlers.current;
      if (e.key === 'Escape') h.onExit();
      else if (e.key === 'ArrowRight') { h.onIndex(h.index + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { h.onIndex(h.index - 1); e.preventDefault(); }
      else if (e.key === 'Enter' && h.mode === '3d' && !(e.target.closest && e.target.closest('button, a'))) h.onOpen(h.index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // the survey takes over from the map: keyboard focus moves to it
  useEffect(() => { if (titleRef.current) titleRef.current.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    const strip = stripRef.current;
    const el = strip && strip.querySelector('[data-active="true"]');
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (strip && el) strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2, behavior: reduced ? 'auto' : 'smooth' });
  }, [index]);

  const meta = mode === '3d'
    ? `3D reconstruction · ${n} cameras · ${site.points.total.toLocaleString('en-US')} points · ${site.odm.gsdCm} cm/px`
    : `${shot.name} · ${index + 1} of ${n} · ${fmtTime(shot.time)} · ${shot.agl} m above ground · heading ${Math.round(shot.yaw)}°`;

  return (
    <div className={s.hud} data-mode={mode} role="region" aria-label={`Drone survey ${site.name}`}>
      <header className={s.hudTop}>
        <div className={s.hudCard}>
          <p className={s.hudKicker}>Drone survey · demo data</p>
          <h2 ref={titleRef} tabIndex={-1}>{site.name}</h2>
          <p className={s.hudMeta} aria-live="polite">{meta}</p>
        </div>
        <div className={s.hudActions}>
          <div className={s.hudSeg} role="group" aria-label="View">
            <button type="button" aria-pressed={mode === 'photo'} onClick={() => onMode('photo')}>Photo</button>
            <button type="button" aria-pressed={mode === '3d'} onClick={() => onMode('3d')} disabled={!has3d} title={has3d ? undefined : '3D needs WebGL 2'}>3D</button>
          </div>
          {site.street && <button type="button" className={s.hudPill} onClick={onDropToStreet}>Drop to street <small>{site.street.distanceM} m</small></button>}
          <button type="button" className={s.hudSolid} onClick={onExit}>Map</button>
        </div>
      </header>

      {mode === 'photo' && (
        <>
          <button type="button" className={`${s.hudArrow} ${s.hudPrev}`} onClick={() => onIndex(index - 1)} aria-label="Previous photo">←</button>
          <button type="button" className={`${s.hudArrow} ${s.hudNext}`} onClick={() => onIndex(index + 1)} aria-label="Next photo">→</button>
        </>
      )}

      <footer className={s.hudBottom}>
        <div className={s.hudRow}>
          <p className={s.hudProgress}>
            <Ring value={seen.size / n} />
            <span><b>{seen.size} of {n}</b> photos seen</span>
            {xpPop && <em key={xpPop.k} className={s.xpPop}>{xpPop.text}</em>}
          </p>
          {mode === '3d' ? (
            <div className={s.hudTools}>
              <button type="button" aria-pressed={orbit} onClick={onOrbit}>{orbit ? 'Stop orbit' : 'Orbit'}</button>
              <span>Right-drag or two fingers to turn and tilt · click a camera to see its photo</span>
            </div>
          ) : (
            <span className={s.hudHint}>Scroll to zoom into the photo · ← → for the next one</span>
          )}
        </div>
        <ol ref={stripRef} className={s.strip} aria-label="Photos of this survey">
          {site.shots.map((sh, i) => (
            <li key={sh.name} data-active={i === index ? 'true' : undefined} data-seen={seen.has(i) ? 'true' : undefined}>
              <button
                type="button"
                onClick={() => (mode === '3d' && i === index ? onOpen(i) : onIndex(i))}
                aria-label={`Photo ${i + 1} of ${n}${seen.has(i) ? ', seen' : ''}`}
                aria-current={i === index ? 'true' : undefined}
              >
                <img src={shotImage(site, sh, '480')} alt="" loading="lazy" draggable={false} />
              </button>
            </li>
          ))}
        </ol>
        <p className={s.hudCredit}>
          {site.source.label} · {site.source.copyright} · {site.source.licence} · processed with OpenDroneMap {site.odm.version}
        </p>
      </footer>
    </div>
  );
}
