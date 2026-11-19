import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import MapilioLogo from 'svg/logos/MapilioLogo';
import { Config } from 'Configs/config';
import { applyEvent, loadProgress, saveProgress, levelFor } from 'lib/game/progress.mjs';
import { addAttribution } from 'lib/mapAttribution';
import s from './walk.module.css';
import {
  loadSequence, loadUsername, reverseGeocode, frameIndexFor, nearestFrame, FEATURED, DEFAULT_SEQUENCE,
} from './sequence.mjs';

const API = process.env.REACT_APP_API_URL || 'https://end.mapilio.com';
const IMG = process.env.REACT_APP_API_IMAGE_URL || 'https://cdn.mapilio.com/im';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,300..700&family=Mona+Sans:ital,wdth,wght@0,75..125,300..900&display=swap';
const fmtDate = (t) => { const d = new Date(String(t).replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function conePolygon(lat, lng, yaw, fov, radiusM = 45) {
  const pts = [[lng, lat]];
  const k = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let a = yaw - fov / 2; a <= yaw + fov / 2 + 0.01; a += fov / 12) {
    const r = (a * Math.PI) / 180;
    pts.push([lng + Math.sin(r) * radiusM * k, lat + (Math.cos(r) * radiusM) / 110540]);
  }
  pts.push([lng, lat]);
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}

/** A small north-up sketch of the route around the walker, drawn without a map (used when embedded). */
function RouteSketch({ frames, index, yaw, vfov }) {
  const c = frames[index];
  if (!c) return null;
  const R = 80; // metres from the centre to the edge
  const to = (f) => [50 + ((f.east - c.east) / R) * 50, 50 - ((f.north - c.north) / R) * 50];
  let d = '';
  let pen = false;
  for (let k = Math.max(0, index - 80); k <= Math.min(frames.length - 1, index + 80); k++) {
    const f = frames[k];
    if (Math.hypot(f.east - c.east, f.north - c.north) > R * 1.6) { pen = false; continue; }
    const [x, y] = to(f);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = true;
  }
  const half = Math.min(80, (vfov * 1.2) / 2);
  const ray = (a) => [50 + Math.sin((a * Math.PI) / 180) * 24, 50 - Math.cos((a * Math.PI) / 180) * 24];
  const [x1, y1] = ray(yaw - half);
  const [x2, y2] = ray(yaw + half);
  return (
    <svg className={s.sketch} viewBox="0 0 100 100" aria-hidden="true">
      <path className={s.sketchCone} d={`M50 50 L${x1.toFixed(1)} ${y1.toFixed(1)} A24 24 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`} />
      <path className={s.sketchRoute} d={d} />
      <circle className={s.sketchMe} cx="50" cy="50" r="3.6" />
    </svg>
  );
}

function useMinimap(elRef, frames, onPick) {
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!frames || !frames.length || !elRef.current) return undefined;
    let cancelled = false;
    import('mapbox-gl').then((mod) => {
      if (cancelled || !elRef.current) return;
      const mapboxgl = mod.default || mod;
      mapboxgl.accessToken = Config.accessToken;
      const map = new mapboxgl.Map({
        container: elRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [frames[0].lng, frames[0].lat],
        zoom: 16.4,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      addAttribution(mapboxgl, map, 'bottom-left');
      map.on('load', () => {
        map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: frames.map((f) => [f.lng, f.lat]) } } });
        map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 7 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#0056f1', 'line-width': 3.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        map.addSource('cone', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'cone', type: 'fill', source: 'cone', paint: { 'fill-color': '#0056f1', 'fill-opacity': 0.22 } });
        map.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 11, 'circle-color': '#0056f1', 'circle-opacity': 0.18 } });
        map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 6, 'circle-color': '#0b1220', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
        setReady(true);
      });
      map.on('click', (e) => onPick && onPick(e.lngLat.lat, e.lngLat.lng));
      mapRef.current = map;
    });
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } setReady(false); };
  }, [frames, elRef, onPick]);

  const update = useCallback((lat, lng, yaw, fov, follow) => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const me = map.getSource('me');
    const cone = map.getSource('cone');
    if (me) me.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
    if (cone) cone.setData(conePolygon(lat, lng, yaw, fov));
    if (follow) map.easeTo({ center: [lng, lat], duration: 300 });
  }, [ready]);
  const resize = useCallback(() => { if (mapRef.current) mapRef.current.resize(); }, []);
  return { ready, update, resize };
}

/**
 * Walk viewer. Standalone at /app/walk; embedded in the Atlas map it also takes:
 *  initialData  { frames, length, info } already loaded by the map, so nothing is fetched twice
 *  initialView  { yaw, pitch, vfov } to start exactly where the map camera landed
 *  chrome       false hides the interface (while the map cross-fades into the photo)
 *  onReady(state)  once the first photo is on screen
 *  onApi(api)      { getState, animateView, play } for the map's transitions; null on unmount
 *  onFail(message) when the sequence or its photos cannot be shown
 */
export default function Walk({
  embedded = false, initialSeq = null, initialPhoto = null, initialData = null, initialView = null, chrome = true,
  onClose = null, onFrame = null, onAerial = null, onReady = null, onApi = null, onFail = null,
}) {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const routeRef = useRef(null);
  const dotsRef = useRef(null);
  const cursorRef = useRef(null);
  const miniRef = useRef(null);
  const viewerRef = useRef(null);
  const dragRef = useRef(null);
  const walkAcc = useRef(0);
  const [seq, setSeq] = useState(null);
  const [data, setData] = useState({ status: 'loading' });
  const [ui, setUi] = useState({ index: 0, yaw: 0, playing: false, planet: false, s: 0, total: 0, loadedSize: 0, failed: false, hasAny: false });
  const [place, setPlace] = useState(null);
  const [user, setUser] = useState(null);
  const [progress, setProgress] = useState(null);
  const [toast, setToast] = useState(null);
  const [miniBig, setMiniBig] = useState(false);
  const [help, setHelp] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastGeo = useRef(null);

  // read the query once on the client
  const hooks = useRef({ onFrame, onClose, onReady, onApi, onFail });
  hooks.current = { onFrame, onClose, onReady, onApi, onFail };
  // while the map is still flying in, the viewer listens only for Escape
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const mapBtnRef = useRef(null);
  // when the street view takes over from the map, keyboard focus moves with it
  useEffect(() => {
    if (embedded && chrome && mapBtnRef.current) mapBtnRef.current.focus({ preventScroll: true });
  }, [embedded, chrome]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (embedded) setSeq({ id: initialSeq || DEFAULT_SEQUENCE, photo: initialPhoto, yaw: null });
    else setSeq({ id: q.get('seq') || DEFAULT_SEQUENCE, photo: q.get('photo'), yaw: q.get('yaw') });
    try { const st = loadProgress(window.localStorage); setProgress({ ...levelFor(st.xp), streak: st.streak, walkedM: st.walkedM }); } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, initialSeq, initialPhoto]);

  useEffect(() => {
    if (!seq) return undefined;
    if (embedded && initialData && initialData.frames && initialData.frames.length && seq.id === initialSeq) {
      setData({ status: 'ready', ...initialData, start: frameIndexFor(initialData.frames, seq.photo) });
      loadUsername(API, initialData.frames[0].userId).then(setUser);
      return undefined;
    }
    const ctrl = new AbortController();
    setData({ status: 'loading' });
    loadSequence(API, seq.id, { signal: ctrl.signal })
      .then((d) => {
        if (!d.frames.length) { setData({ status: 'error', message: 'This sequence has no photos we can show.' }); return; }
        setData({ status: 'ready', ...d, start: frameIndexFor(d.frames, seq.photo) });
        loadUsername(API, d.frames[0].userId, { signal: ctrl.signal }).then(setUser);
      })
      .catch((e) => { if (e.name !== 'AbortError') setData({ status: 'error', message: 'We could not load this sequence.' }); });
    return () => ctrl.abort();
    // the embedded props only matter for the sequence they came with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const frames = data.status === 'ready' ? data.frames : null;

  const onMiniPick = useCallback((lat, lng) => {
    const v = viewerRef.current;
    if (!v || !frames) return;
    const o = frames[0];
    const k = Math.cos((o.lat * Math.PI) / 180);
    const east = ((lng - o.lng) * Math.PI / 180) * 6378137 * k;
    const north = ((lat - o.lat) * Math.PI / 180) * 6378137;
    const j = nearestFrame(frames, east + o.east, north + o.north, 120);
    if (j < 0) return;
    const st = v.getState();
    if (Math.abs(frames[j].cum - st.s) < 80) v.goTo(j); else v.teleport(j);
  }, [frames]);
  // embedded in the map page, a second Mapbox map would cost a map load per street; a sketch does
  const mini = useMinimap(miniRef, embedded ? null : frames, onMiniPick);
  const miniLatest = useRef(mini);
  miniLatest.current = mini;

  const addWalk = useCallback((metres) => {
    walkAcc.current += metres;
    if (walkAcc.current < 25) return;
    const m = walkAcc.current;
    walkAcc.current = 0;
    try {
      const r = applyEvent(loadProgress(window.localStorage), { type: 'walk', metres: m });
      saveProgress(window.localStorage, r.state);
      setProgress({ ...r.level, streak: r.state.streak, walkedM: r.state.walkedM });
      if (r.newBadges.length) setToast({ kind: 'badge', text: `Badge earned: ${r.newBadges.map((b) => b.name).join(', ')}` });
      else if (r.levelUp) setToast({ kind: 'level', text: `Level up: ${r.level.name}` });
    } catch (e) { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // overlays drawn every frame without React
  const drawOverlays = useCallback(() => {
    const v = viewerRef.current;
    const svg = svgRef.current;
    if (!v || !svg || !frames) return;
    const st = v.getState();
    const route = routeRef.current;
    const dots = dotsRef.current;
    if (st.planet) { route.setAttribute('d', ''); dots.innerHTML = ''; return; }
    const from = Math.max(0, st.i - 8);
    const to = Math.min(frames.length - 1, st.i + 16);
    let d = '';
    let pen = false;
    const marks = [];
    for (let k = from; k <= to; k++) {
      const p = v.project(frames[k].east, frames[k].north, 0.02);
      if (!p || p.z > 70) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
      pen = true;
      if (k !== st.index && Math.abs(k - st.index) <= 6) marks.push({ k, x: p.x, y: p.y, r: Math.max(3, Math.min(13, 70 / p.z)) });
    }
    route.setAttribute('d', d);
    dots.innerHTML = marks.map((m) => `<circle data-k="${m.k}" cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}" r="${m.r.toFixed(1)}"></circle>`).join('');
  }, [frames]);

  // create the viewer
  useEffect(() => {
    if (!frames || !canvasRef.current) return undefined;
    let viewer = null;
    let cancelled = false;
    let lastUi = 0;
    let lastUrl = 0;
    let readyFired = false;
    const isMobile = window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
    import('./viewer').then(({ createWalkViewer }) => {
      if (cancelled) return;
      const iv = embedded && initialView ? initialView : null;
      const yaw = iv && Number.isFinite(iv.yaw) ? iv.yaw : seq && seq.yaw != null && seq.yaw !== '' ? parseFloat(seq.yaw) : null;
      viewer = createWalkViewer({
        canvas: canvasRef.current,
        frames,
        imageBase: IMG,
        startIndex: data.start || 0,
        startYaw: Number.isFinite(yaw) ? yaw : null,
        startPitch: iv && Number.isFinite(iv.pitch) ? iv.pitch : 0,
        startVfov: iv && Number.isFinite(iv.vfov) ? iv.vfov : null,
        isMobile,
        onWalk: (m) => addWalk(m),
        onChange: () => {
          drawOverlays();
          if (!readyFired) {
            const st0 = viewer.getState();
            if (st0.loadedSize > 0) { readyFired = true; if (hooks.current.onReady) hooks.current.onReady(st0); }
          }
          const now = performance.now();
          if (now - lastUi > 90) {
            lastUi = now;
            const st = viewer.getState();
            setUi((u) => (u.index === st.index && Math.abs(u.yaw - st.yaw) < 1 && u.playing === st.playing && u.planet === st.planet && Math.abs(u.s - st.s) < 0.5 && u.loadedSize === st.loadedSize && u.failed === st.failed && u.hasAny === st.hasAny ? u : st));
            const f = frames[st.index];
            miniLatest.current.update(f.lat, f.lng, st.yaw, st.vfov * 1.2, true);
            if (now - lastUrl > 800 && embedded) {
              lastUrl = now;
              if (hooks.current.onFrame) hooks.current.onFrame(f, st);
            } else if (now - lastUrl > 800) {
              lastUrl = now;
              const q = new URLSearchParams(window.location.search);
              q.set('seq', seq.id); q.set('photo', String(f.id)); q.set('yaw', String(Math.round(st.yaw)));
              window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
            }
          }
        },
      });
      viewerRef.current = viewer;
      if (hooks.current.onApi) {
        hooks.current.onApi({
          frames,
          getState: () => viewer.getState(),
          animateView: (target, ms, ease) => viewer.animateView(target, ms, ease),
          play: (on, sp) => viewer.play(on, sp),
        });
      }
    }).catch(() => {
      // the 3D engine needs a recent browser
      if (!cancelled) setData({ status: 'error', message: 'The street viewer could not start in this browser.' });
    });
    return () => {
      cancelled = true;
      if (viewer) viewer.destroy();
      viewerRef.current = null;
      if (hooks.current.onApi) hooks.current.onApi(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames]);

  // place name, refreshed after moving ~350 m
  useEffect(() => {
    if (!frames) return;
    const f = frames[ui.index];
    if (!f) return;
    const lg = lastGeo.current;
    if (lg && Math.hypot(lg.east - f.east, lg.north - f.north) < 350) return;
    lastGeo.current = { east: f.east, north: f.north };
    reverseGeocode(f.lat, f.lng).then((p) => { if (p) setPlace(p); });
  }, [frames, ui.index]);

  // pointer: drag to look, click the ground to walk
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  const onPointerMove = (e) => {
    const v = viewerRef.current;
    if (!v) return;
    const d = dragRef.current;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = e.clientX; d.y = e.clientY;
      const st = v.getState();
      const k = st.vfov / (canvasRef.current.clientHeight || 1);
      v.look(-dx * k, dy * k);
      if (cursorRef.current) cursorRef.current.style.opacity = '0';
      return;
    }
    // hover cursor on the ground
    const hit = v.pickGround(e.clientX, e.clientY);
    const c = cursorRef.current;
    if (!c) return;
    if (!hit) { c.style.opacity = '0'; return; }
    const pts = [];
    for (let a = 0; a < 360; a += 20) {
      const p = v.project(hit.east + Math.sin((a * Math.PI) / 180) * 0.7, hit.north + Math.cos((a * Math.PI) / 180) * 0.7, 0.02);
      if (!p) { c.style.opacity = '0'; return; }
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    c.setAttribute('points', pts.join(' '));
    c.style.opacity = '1';
  };
  const onPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    const v = viewerRef.current;
    if (!v || !d || d.moved > 6 || !frames) return;
    const k = e.target && e.target.getAttribute && e.target.getAttribute('data-k');
    if (k != null) { v.goTo(parseInt(k, 10)); return; }
    const hit = v.pickGround(e.clientX, e.clientY);
    if (!hit) return;
    const j = nearestFrame(frames, hit.east, hit.north, 25);
    if (j >= 0) v.goTo(j);
  };
  const onWheel = (e) => { const v = viewerRef.current; if (v) v.zoom(e.deltaY > 0 ? 4 : -4); };

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      const v = viewerRef.current;
      if (!v || (e.target.closest && e.target.closest('input, textarea, select'))) return;
      const k = e.key.toLowerCase();
      if (!chromeRef.current && k !== 'escape') return;
      if (k === 'arrowup' || k === 'w') { v.step(1); e.preventDefault(); }
      else if (k === 'arrowdown' || k === 's') { v.step(-1); e.preventDefault(); }
      else if (k === 'arrowleft' || k === 'a') { v.look(-15, 0); e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { v.look(15, 0); e.preventDefault(); }
      else if (k === ' ') { const st = v.getState(); v.play(!st.playing, speed); e.preventDefault(); }
      else if (k === 'p') { const st = v.getState(); v.setPlanet(!st.planet); }
      else if (k === '+' || k === '=') v.zoom(-6);
      else if (k === '-') v.zoom(6);
      else if (k === '?') setHelp((h) => !h);
      else if (k === 'escape' && hooks.current.onClose) hooks.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [speed]);

  useEffect(() => { mini.resize(); }, [miniBig, mini]);

  const failed = data.status === 'error' || !!(frames && ui.failed && !ui.hasAny);
  useEffect(() => {
    if (failed && hooks.current.onFail) hooks.current.onFail(data.status === 'error' ? data.message : 'These photos are not loading from our image server right now.');
  }, [failed, data]);

  const frame = frames ? frames[ui.index] : null;
  const pct = ui.total ? (ui.s / ui.total) * 100 : 0;
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setToast({ kind: 'info', text: 'Link copied' }); } catch (e) { /* ignore */ }
  };
  const idUrl = frame ? `https://www.openstreetmap.org/edit?editor=id#map=19/${frame.lat}/${frame.lng}&photo=mapilio/${frame.id}&photo_overlay=mapilio` : '#';
  // back to the map above this spot (a pId link would open this street view again)
  const mapUrl = frame ? `/app?lat=${frame.lat.toFixed(5)}&lng=${frame.lng.toFixed(5)}&zoom=17.5` : '/app';
  const ticks = useMemo(() => (frames && frames.length <= 400 ? frames.map((f) => (f.cum / (data.length || 1)) * 100) : []), [frames, data.length]);

  return (
    <div className={s.viewer} data-embedded={embedded ? 'true' : 'false'} data-chrome={chrome ? 'shown' : 'hidden'}>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
        {(!embedded || chrome) && <meta name="theme-color" content="#0a0e16" />}
      </Head>
      <canvas
        ref={canvasRef}
        className={s.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (cursorRef.current) cursorRef.current.style.opacity = '0'; }}
        onWheel={onWheel}
        aria-label="Street-level panorama. Drag to look around, click the ground to walk, arrow keys to move."
        role="img"
      />
      <svg
        ref={svgRef}
        className={s.overlay}
        onClick={(e) => {
          const k = e.target && e.target.getAttribute && e.target.getAttribute('data-k');
          if (k != null && viewerRef.current) viewerRef.current.goTo(parseInt(k, 10));
        }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="walk-route" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#4d8bff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#4d8bff" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <path ref={routeRef} className={s.route} d="" />
        <g ref={dotsRef} className={s.dots} />
        <polygon ref={cursorRef} className={s.cursor} points="" />
      </svg>

      <header className={s.top}>
        <a className={s.logo} href="/" aria-label="Mapilio home"><MapilioLogo width={104} height={34} primaryColor="#ffffff" secondaryColor="#0056f1" /></a>
        <div className={s.place} aria-live="polite">
          <h1>{place ? place.title : data.status === 'ready' ? 'Street view' : 'Loading…'}</h1>
          {place && <p>{place.sub}</p>}
          {frame && (
            <p className={s.meta}>
              {frame.pano ? '360°' : 'Photo'} · {fmtDate(frame.time)} · {user ? `by ${user}` : 'Mapilio contributor'} · CC BY-SA
            </p>
          )}
        </div>
        <div className={s.actions}>
          {progress && (
            <a className={s.xpChip} href="/app/play" title="Explorer level">
              <b>{progress.name}</b>
              <span>{progress.xp.toLocaleString('en-US')} XP{progress.streak > 1 ? ` · ${progress.streak}-day streak` : ''}</span>
              <i style={{ '--p': progress.progress }} aria-hidden="true" />
            </a>
          )}
          <button type="button" className={s.iconBtn} aria-pressed={ui.planet} onClick={() => viewerRef.current && viewerRef.current.setPlanet(!ui.planet)}>Planet</button>
          {onAerial
            ? <button type="button" className={s.iconBtn} onClick={onAerial} title="Rise to the drone survey of this place">Aerial <small>demo</small></button>
            : <button type="button" className={s.iconBtn} disabled title="Drone imagery is in development">Aerial <small>soon</small></button>}
          <a className={s.iconBtn} href={idUrl} target="_blank" rel="noopener noreferrer">Edit in iD</a>
          <button type="button" className={s.iconBtn} onClick={share}>Share</button>
          {onClose
            ? <button ref={mapBtnRef} type="button" className={s.iconBtnSolid} onClick={onClose}>Map</button>
            : <a className={s.iconBtnSolid} href={mapUrl}>Map</a>}
        </div>
      </header>

      <aside className={s.mini} data-big={miniBig ? 'true' : 'false'} data-sketch={embedded ? 'true' : 'false'}>
        {embedded
          ? frames && <RouteSketch frames={frames} index={ui.index} yaw={ui.yaw} vfov={viewerRef.current ? viewerRef.current.getState().vfov : 72} />
          : <div ref={miniRef} className={s.miniMap} />}
        {!embedded && <button type="button" className={s.miniToggle} onClick={() => setMiniBig((b) => !b)} aria-label={miniBig ? 'Shrink map' : 'Enlarge map'}>{miniBig ? '–' : '+'}</button>}
        <span className={s.compass} style={{ '--yaw': `${ui.yaw}deg` }} aria-label={`Heading ${Math.round(ui.yaw)} degrees`}>
          <i aria-hidden="true" />{COMPASS[Math.round(ui.yaw / 45) % 8]} {Math.round(ui.yaw)}°
        </span>
      </aside>

      <footer className={s.bottom}>
        <button type="button" className={s.play} onClick={() => viewerRef.current && viewerRef.current.play(!ui.playing, speed)} aria-label={ui.playing ? 'Pause' : 'Drive along the sequence'}>
          {ui.playing ? <span className={s.pauseIcon} aria-hidden="true" /> : <span className={s.playIcon} aria-hidden="true" />}
        </button>
        <div className={s.speed} role="group" aria-label="Playback speed">
          {[1, 2, 4].map((x) => (
            <button key={x} type="button" aria-pressed={speed === x} onClick={() => { setSpeed(x); if (viewerRef.current) viewerRef.current.setSpeed(x); }}>{x}×</button>
          ))}
        </div>
        <div
          className={s.timeline}
          role="slider"
          tabIndex={0}
          aria-label="Position in sequence"
          aria-valuemin={1}
          aria-valuemax={frames ? frames.length : 1}
          aria-valuenow={ui.index + 1}
          onPointerDown={(e) => {
            const v = viewerRef.current;
            if (!v || !ui.total) return;
            const r = e.currentTarget.getBoundingClientRect();
            const go = (x) => v.seek(((x - r.left) / r.width) * ui.total);
            go(e.clientX);
            const move = (ev) => go(ev.clientX);
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        >
          <div className={s.ticks}>{ticks.map((t, k) => <i key={k} style={{ left: `${t}%` }} />)}</div>
          <div className={s.fill} style={{ width: `${pct}%` }} />
          <div className={s.knob} style={{ left: `${pct}%` }} />
        </div>
        <p className={s.counter}>
          <b>{frames ? ui.index + 1 : 0}</b> / {frames ? frames.length : 0}
          <span>{fmtM(ui.s || 0)} of {fmtM(ui.total || 0)}</span>
        </p>
        <button type="button" className={s.helpBtn} onClick={() => setHelp((h) => !h)} aria-expanded={help}>?</button>
      </footer>

      {help && (
        <div className={s.help} role="dialog" aria-label="Controls">
          <h2>Controls</h2>
          <dl>
            <div><dt>Drag</dt><dd>Look around</dd></div>
            <div><dt>Click the ground</dt><dd>Walk there</dd></div>
            <div><dt>↑ ↓ / W S</dt><dd>Next or previous photo</dd></div>
            <div><dt>← → / A D</dt><dd>Turn</dd></div>
            <div><dt>Space</dt><dd>Drive along the sequence</dd></div>
            <div><dt>P</dt><dd>Little-planet view</dd></div>
            <div><dt>Wheel, + −</dt><dd>Zoom</dd></div>
          </dl>
          <button type="button" className={s.iconBtnSolid} onClick={() => setHelp(false)}>Close</button>
        </div>
      )}

      {toast && <div className={s.toast} role="status">{toast.text}</div>}

      {data.status === 'loading' && chrome && <div className={s.center}><span className={s.spinner} aria-hidden="true" /> Loading sequence…</div>}
      {failed && chrome && (
        <div className={s.center} role="alert">
          <div className={s.errorCard}>
            <h2>{data.status === 'error' ? data.message : 'These photos are not loading from our image server right now.'}</h2>
            <p>Some 360° sequences are temporarily unavailable. Try one of these walks:</p>
            <ul>
              {FEATURED.map((f) => <li key={f.seq}><a href={`/app/walk?seq=${f.seq}`}>{f.label}<small>{f.kind}</small></a></li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
