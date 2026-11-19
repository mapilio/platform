import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import MapilioLogo from 'svg/logos/MapilioLogo';
import { Config } from 'Configs/config';
import { getCookie } from 'helper/globalHelper';
import { addAttribution } from 'lib/mapAttribution';
import site from 'lib/drone/brighton-beach.json';
import {
  siteGeoJSON, siteFacts, pipeline, siteAsset, shotImage, distanceM, shadeAround, footprintLine, nearestShot,
} from 'lib/drone/drone.mjs';
import { applyEvent, levelFor, loadProgress, saveProgress } from 'lib/game/progress.mjs';
import { useLeaderboard } from 'views/landing/Progress';
import { nearestFrame, imageUrl, loadUsername, loadSequence, frameIndexFor } from '../Walk/sequence.mjs';
import Walk from '../Walk/Walk';
import DroneHud from './DroneHud';
import { atlasStyle, droneLayers, photoSources, photoLayers, FOG } from './mapStyle';
import {
  STOPS, ZOOM_MIN, railPosition, zoomForRail, chapterForZoom, formatAltitude, placeLevel, placeFromPhoton, yearRange, yearFilter,
} from './altitude.mjs';
import {
  MAP_VFOV, STREET_LOOK, cameraForEye, eyeForCamera, planFlight, photoCamera, streetEye, surveyCamera, surveyTopCamera,
} from './camera.mjs';
import { runFlight, easeCamera, mapIdle, loadImageSource, waitFor, sleep } from './flight';
import s from './atlas.module.css';

const API = process.env.REACT_APP_API_URL || 'https://end.mapilio.com';
const IMG = process.env.REACT_APP_API_IMAGE_URL || 'https://cdn.mapilio.com/im';
const WFS = process.env.REACT_APP_GEOSERVER_WFS_URL || '';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,300..700&family=Mona+Sans:ital,wdth,wght@0,75..125,300..900&display=swap';
const YEARS = yearRange();
const N_SHOTS = site.shots.length;
const MAP_MAX_ZOOM = 22;
const STREET_MAX_ZOOM = 23.8; // eye height on tall screens
const wrapShot = (i) => ((i % N_SHOTS) + N_SHOTS) % N_SHOTS;
const fmtDate = (t) => { const d = new Date(String(t).replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
const fmtLength = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const validLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Rewrite the address without a navigation; keeps Next's history state usable for Back and Forward. */
function writeUrl(qs) {
  const q = qs.toString();
  const url = `${window.location.pathname}${q ? `?${q}` : ''}`;
  if (url === window.location.pathname + window.location.search) return;
  const st = window.history.state;
  try {
    window.history.replaceState({ ...(st && typeof st === 'object' ? st : {}), url, as: url }, '', url);
  } catch (e) { /* the browser limits how often the address may change */ }
}
/** The classic map at the same place (an anchor's href is read when it is clicked). */
function toClassic(e) {
  const qs = new URLSearchParams(window.location.search);
  ['drone', 'shot', 'view', 'board'].forEach((k) => qs.delete(k));
  const q = qs.toString();
  e.currentTarget.href = `/app/classic${q ? `?${q}` : ''}`;
}

function Search({ onGo }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !(e.target.closest && e.target.closest('input, textarea'))) { e.preventDefault(); inputRef.current && inputRef.current.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setItems([]); return undefined; }
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
    if (m) {
      setItems(validLatLng(+m[1], +m[2]) ? [{ key: 'coord', title: `${m[1]}, ${m[2]}`, sub: 'Coordinates', lat: +m[1], lng: +m[2], zoom: 16 }] : []);
      return undefined;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      // Photon (OpenStreetMap data); a plain request, no credentials
      fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=6&lang=en`, { signal: ctrl.signal, credentials: 'omit' })
        .then((r) => r.json())
        .then((j) => setItems((j.features || []).map((f, i) => {
          const p = f.properties || {};
          const zoom = p.type === 'country' ? 4.5 : p.type === 'state' ? 6.5 : p.type === 'city' || p.type === 'county' ? 11 : p.type === 'district' || p.type === 'locality' ? 13.5 : 16;
          return { key: `${p.osm_id}-${i}`, title: p.name || p.street || p.city, sub: [p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(', '), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], zoom, extent: p.extent };
        }).filter((x) => x.title)))
        .catch(() => {});
    }, 220);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  const pick = (it) => { onGo(it); setOpen(false); setQ(it.title); inputRef.current && inputRef.current.blur(); };
  return (
    <div className={s.search} role="search">
      <label className={s.srOnly} htmlFor="atlas-search">Search a place</label>
      <input
        id="atlas-search"
        ref={inputRef}
        value={q}
        placeholder="Search a place or paste lat, lng"
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && items[0]) pick(items[0]); if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); } }}
      />
      <kbd aria-hidden="true">/</kbd>
      {open && items.length > 0 && (
        <ul className={s.results}>
          {items.map((it) => (
            <li key={it.key}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}><b>{it.title}</b><span>{it.sub}</span></button></li>
          ))}
          <li className={s.resultsNote}>Search by Photon, © OpenStreetMap contributors</li>
        </ul>
      )}
    </div>
  );
}

function Board({ onClose }) {
  const lb = useLeaderboard(8);
  return (
    <aside className={s.board} aria-label="Contributors leaderboard">
      <header>
        <h2>Contributors</h2>
        <p>{lb.label || 'This month'}</p>
        <button type="button" onClick={onClose} aria-label="Close leaderboard">Close</button>
      </header>
      {lb.status === 'loading' && <p className={s.boardNote}>Loading…</p>}
      {lb.status === 'error' && <p className={s.boardNote}>The leaderboard is not reachable right now.</p>}
      {lb.status === 'empty' && <p className={s.boardNote}>No uploads counted yet this month.</p>}
      {lb.status === 'ready' && (
        <ol>
          {lb.rows.map((r, i) => (
            <li key={r.id || r.username}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <b>{r.display_name || r.username}</b>
              <small>{lb.showKm ? `${Math.round(parseFloat(r.total_length) || 0).toLocaleString('en-US')} km · ` : ''}{(r.total_images || 0).toLocaleString('en-US')} photos</small>
              <em>{(parseInt(r.point, 10) || 0).toLocaleString('en-US')}</em>
            </li>
          ))}
        </ol>
      )}
      <p className={s.boardNote}>Contribution points measure uploaded imagery. They are not OpenStreetMap edits.</p>
      <a href="/app/play">Play the daily five →</a>
    </aside>
  );
}

function TimeBar({ range, setRange, hist, playing, onPlay }) {
  const max = Math.max(1, ...YEARS.map((y) => hist[y] || 0));
  const [from, to] = range;
  return (
    <div className={s.time} role="group" aria-label="Capture years">
      <button type="button" className={s.timePlay} onClick={onPlay} aria-label={playing ? 'Pause the timeline' : 'Play coverage through the years'}>
        <i data-playing={playing ? 'true' : 'false'} aria-hidden="true" />
      </button>
      <div className={s.timeTrack}>
        <div className={s.timeBars} aria-hidden="true">
          {YEARS.map((y) => (
            <span key={y} data-in={y >= from && y <= to ? 'true' : 'false'} style={{ '--h': Math.sqrt((hist[y] || 0) / max) }} />
          ))}
        </div>
        <input type="range" aria-label="From year" min={YEARS[0]} max={YEARS[YEARS.length - 1]} step={1} value={from} onChange={(e) => setRange([Math.min(+e.target.value, to), to])} style={from === YEARS[YEARS.length - 1] ? { zIndex: 1 } : undefined} />
        <input type="range" aria-label="To year" min={YEARS[0]} max={YEARS[YEARS.length - 1]} step={1} value={to} onChange={(e) => setRange([from, Math.max(+e.target.value, from)])} />
      </div>
      <p className={s.timeLabel}><b>{from === to ? from : `${from}–${to}`}</b><span>capture years</span></p>
    </div>
  );
}

/**
 * A peek at the street under the pointer, before you click. It keeps its own
 * state so following the mouse re-renders only this, not the whole map page.
 */
function LensLayer({ apiRef, hidden }) {
  const [lens, setLens] = useState(null);
  useEffect(() => {
    apiRef.current = setLens;
    return () => { apiRef.current = null; };
  }, [apiRef]);
  if (!lens || hidden) return null;
  return <Lens lens={lens} />;
}

function Lens({ lens }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [lens.src]);
  return (
    <figure className={s.lens} style={{ '--x': `${Math.round(lens.x)}px`, '--y': `${Math.round(lens.y)}px` }} data-pano={lens.pano ? 'true' : 'false'} aria-hidden="true">
      <span className={s.lensImg} data-loaded={loaded ? 'true' : 'false'}>
        <img src={lens.src} alt="" onLoad={() => setLoaded(true)} draggable={false} />
      </span>
      <figcaption><b>{lens.title}</b><span>{lens.sub}</span></figcaption>
    </figure>
  );
}

export default function Atlas() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const glRef = useRef(null);
  const droneRef = useRef(null); // the 3D layer inside the map
  const railRef = useRef(null);
  const altRef = useRef(null);
  const chapterRef = useRef(null);
  const markerRef = useRef(null);
  const siteMarkerRef = useRef(null);
  const geoTimer = useRef(null);
  const lastGeo = useRef('');
  const hoverShot = useRef(-1);
  const hoverSeq = useRef('');
  const pickReq = useRef(0);
  const settleRef = useRef(() => {});
  const flightRef = useRef(null);
  const flyingRef = useRef(false);
  const orbitRef = useRef(0);
  const opRef = useRef(0); // the latest transition wins; older ones stop at their next await
  const reducedRef = useRef(false);
  const walkApi = useRef(null);
  const streetReady = useRef(null);
  const streetFail = useRef(null);
  const returnRef = useRef(null);
  const photoSlot = useRef('a');
  const shownRef = useRef(-1);
  const droneStateRef = useRef(null);
  const streetRef = useRef(null);
  const seenRef = useRef(new Set());
  const seqCache = useRef(new Map());
  const seqData = useRef(new Map());
  const lensTimer = useRef(0);
  const frus2d = useRef(-1);
  const tourRef = useRef(null);
  const layerReady = useRef(Promise.resolve(false));
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [place, setPlace] = useState({ title: 'The world', sub: 'Street-level imagery by Mapilio contributors' });
  const [stats, setStats] = useState({ kind: 'dots', count: 0, hist: {} });
  const [layers, setLayers] = useState({ street: true, pano: true, drone: true });
  const [range, setRange] = useState([YEARS[0], YEARS[YEARS.length - 1]]);
  const [playing, setPlaying] = useState(false);
  const [pick, setPick] = useState(null);
  const [droneState, setDroneState] = useState(null); // null | { mode: 'photo' | '3d', index }
  const [street, setStreetState] = useState(null);
  const [flying, setFlying] = useState(false);
  const [level, setLevel] = useState('world');
  const [nearSite, setNearSite] = useState(false);
  const [sheet, setSheet] = useState(() => typeof window === 'undefined' || window.innerWidth > 760); // collapsed on phones
  const [orthoOpacity, setOrthoOpacity] = useState(1);
  const [board, setBoard] = useState(false);
  const [toast, setToast] = useState(null);
  const [me, setMe] = useState(null);
  const [seen, setSeen] = useState(() => new Set());
  const [xpPop, setXpPop] = useState(null);
  const [orbit, setOrbit] = useState(false);
  const lensApi = useRef(null);
  const setLens = (v) => { if (lensApi.current) lensApi.current(v); };
  const [has3d, setHas3d] = useState(true);
  const [tour, setTour] = useState(false);
  const [busy, setBusy] = useState(null); // a short line while the street or its photo is on its way
  const [signedIn, setSignedIn] = useState(false);
  const [announce, setAnnounce] = useState('');
  const focusBack = useRef(null);
  const facts = useMemo(() => siteFacts(site), []);
  const steps = useMemo(() => pipeline(site), []);
  droneStateRef.current = droneState;
  streetRef.current = street;

  const say = useCallback((text) => { setToast({ text, k: Date.now() }); setAnnounce(text); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => { if (busy) setAnnounce(busy); }, [busy]);
  useEffect(() => {
    if (!xpPop) return undefined;
    const t = setTimeout(() => setXpPop(null), 1700);
    return () => clearTimeout(t);
  }, [xpPop]);
  useEffect(() => {
    // the same signal the server middleware uses
    setSignedIn(!!getCookie('auth'));
    if (new URLSearchParams(window.location.search).get('board') === 'contributors') setBoard(true);
    reducedRef.current = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      const st = loadProgress(window.localStorage);
      if (st.xp > 0) setMe(levelFor(st.xp));
      const done = new Set((st.surveys && st.surveys[site.id]) || []);
      seenRef.current = done;
      setSeen(done);
    } catch (e) { /* storage unavailable */ }
  }, []);

  const setDrone = (next) => { droneStateRef.current = next; setDroneState(next); };
  const setStreet = (next) => {
    const v = typeof next === 'function' ? next(streetRef.current) : next;
    streetRef.current = v;
    setStreetState(v);
  };
  const viewport = () => {
    const el = mapRef.current ? mapRef.current.getContainer() : null;
    return { width: el ? el.clientWidth : window.innerWidth, height: el ? el.clientHeight : window.innerHeight };
  };
  const H = () => viewport().height;
  const camNow = () => {
    const m = mapRef.current;
    const c = m.getCenter();
    return { center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
  };
  const photoInsets = () => {
    const { width } = viewport();
    return width <= 760 ? { top: 168, bottom: 150, left: 8, right: 8 } : { top: 124, bottom: 156, left: 92, right: 92 };
  };
  const quiet = () => flyingRef.current || !!orbitRef.current;

  // ------------------------------------------------------------------ map
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // filters the new map does not offer yet still open in the classic app
    if (q.get('user') || q.get('features')) { window.location.replace(`/app/classic${window.location.search}`); return undefined; }
    let map = null;
    let cancelled = false;
    let raf = 0;
    import('mapbox-gl').then((mod) => {
      if (cancelled) return;
      const mapboxgl = mod.default || mod;
      glRef.current = mapboxgl;
      mapboxgl.accessToken = Config.accessToken;
      const lat = parseFloat(q.get('lat'));
      const lng = parseFloat(q.get('lng'));
      const zoom = parseFloat(q.get('zoom'));
      const has = validLatLng(lat, lng);
      const droneStart = q.get('drone') === site.id;
      const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      try {
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: atlasStyle(),
          projection: 'globe',
          center: droneStart ? [site.centre.lng, site.centre.lat] : has ? [lng, lat] : [24, 41],
          zoom: droneStart ? 18.1 : has && Number.isFinite(zoom) ? Math.min(zoom, MAP_MAX_ZOOM) : 2.3,
          minZoom: ZOOM_MIN,
          maxZoom: MAP_MAX_ZOOM,
          maxPitch: 85,
          attributionControl: false,
          dragRotate: false, // turned on in the 3D view only, where right-drag turns and tilts
          pitchWithRotate: true,
          touchPitch: false,
          useWebGL2: true, // the drone survey's 3D layer shares the map's WebGL 2 context
          antialias: fine,
        });
      } catch (e) { setMapError(true); return; }
      mapRef.current = map;
      if (process.env.NODE_ENV !== 'production') window.__atlasMap = map; // handle for scripted checks in development
      addAttribution(mapboxgl, map, 'bottom-right');
      map.touchZoomRotate.disableRotation();

      const updateRail = () => {
        raf = 0;
        const z = map.getZoom();
        const c = map.getCenter();
        const eye = eyeForCamera({ center: [c.lng, c.lat], zoom: z, pitch: map.getPitch(), bearing: map.getBearing() }, map.getContainer().clientHeight);
        if (railRef.current) railRef.current.style.setProperty('--pos', railPosition(z).toFixed(4));
        if (altRef.current) altRef.current.textContent = formatAltitude(eye.alt);
        if (chapterRef.current) chapterRef.current.textContent = eye.alt < 12 ? 'Street level' : chapterForZoom(z);
        if (siteMarkerRef.current) siteMarkerRef.current.getElement().style.display = z < 15.2 && z > 3.5 ? '' : 'none';
      };
      map.on('move', () => { if (!raf) raf = requestAnimationFrame(updateRail); });

      map.on('style.load', () => {
        if (map.getSource('drone-ortho')) return; // the style is set once; never add the sources twice
        try { map.setFog(FOG); } catch (e) { /* ignore */ }
        // drone survey: orthophoto, footprints, flight line, camera positions
        const geo = siteGeoJSON(site);
        map.addSource('drone-ortho', { type: 'image', url: siteAsset(site, site.ortho.url), coordinates: site.ortho.corners });
        map.addSource('drone-foot', { type: 'geojson', data: geo.footprints });
        map.addSource('drone-shots', { type: 'geojson', data: geo.shots });
        map.addSource('drone-path', { type: 'geojson', data: geo.path });
        droneLayers().forEach((l) => map.addLayer({ ...l, minzoom: 13.5 }, 'cov-dots'));
        // a drone photo is laid on the map itself, just above the orthophoto
        Object.entries(photoSources(site.shots[0].footprint)).forEach(([id, src]) => map.addSource(id, src));
        photoLayers().forEach((l) => map.addLayer({ ...l, minzoom: 13 }, 'drone-foot-case'));
        // the 3D reconstruction lives in the map too (WebGL 2 only). three.js loads on its own,
        // so a browser that cannot run it still gets the whole map
        const gl2 = !!map.getCanvas().getContext('webgl2');
        layerReady.current = !gl2 ? Promise.resolve(false) : import('./droneLayer').then((dl) => {
          if (cancelled || !mapRef.current) return false;
          const layer = dl.createDroneLayer({
            mapboxgl,
            site,
            onReady: (err) => { if (err) say('The 3D point cloud did not load; the cameras are still shown.'); },
            onChange: (rise, frus) => {
              const v = Math.round(frus * 10) / 10;
              if (v !== frus2d.current) { frus2d.current = v; apply2d(); }
            },
          });
          map.addLayer(layer.layer, 'cov-dots');
          droneRef.current = layer;
          return true;
        }).catch(() => false);
        layerReady.current.then((ok) => { if (!ok && !cancelled) setHas3d(false); });
        const el = document.createElement('button');
        el.type = 'button';
        el.className = s.siteBadge;
        el.innerHTML = '<i></i><span>Drone demo</span>';
        el.setAttribute('aria-label', 'Fly to the drone survey demo');
        el.addEventListener('click', (ev) => { ev.stopPropagation(); map.flyTo({ center: [site.centre.lng, site.centre.lat], zoom: 18.1, pitch: 0, bearing: 0, duration: 2600 }); });
        siteMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([site.centre.lng, site.centre.lat]).addTo(map);
        updateRail();
        syncPlace();
        setReady(true);
        // deep links into the drone survey: ?drone=brighton-beach&shot=3 or &view=3d
        if (droneStart) {
          const shot = parseInt(q.get('shot'), 10);
          if (q.get('view') === '3d') layerReady.current.then(() => { if (!cancelled) open3dRef.current(); });
          else if (Number.isFinite(shot)) setTimeout(() => { if (!cancelled) openPhotoRef.current(shot); }, 400);
        }
      });
      map.on('error', (e) => { if (e && e.error && /access token|401|403/i.test(String(e.error.message || ''))) setMapError(true); });

      const syncUrl = () => {
        const c = map.getCenter();
        const qs = new URLSearchParams(window.location.search);
        qs.set('lat', c.lat.toFixed(5)); qs.set('lng', c.lng.toFixed(5)); qs.set('zoom', map.getZoom().toFixed(2));
        if (!droneStateRef.current) { qs.delete('drone'); qs.delete('shot'); qs.delete('view'); }
        qs.delete('board');
        writeUrl(qs);
      };
      function syncPlace() {
        if (streetRef.current) return; // the street view has its own place name; do not send every step to the geocoder
        const c = map.getCenter();
        const z = map.getZoom();
        setLevel(z < 6 ? 'world' : z < 15.5 ? 'city' : 'drone');
        setNearSite(z >= 14.8 && distanceM({ lat: c.lat, lng: c.lng }, site.centre) < 900);
        const level = placeLevel(z);
        const key = `${level}:${c.lat.toFixed(level === 'street' ? 4 : level === 'city' ? 2 : 1)},${c.lng.toFixed(level === 'street' ? 4 : level === 'city' ? 2 : 1)}`;
        if (key === lastGeo.current) return;
        lastGeo.current = key;
        clearTimeout(geoTimer.current);
        if (level === 'world') { setPlace(placeFromPhoton(null, 'world')); return; }
        geoTimer.current = setTimeout(() => {
          fetch(`https://photon.komoot.io/reverse?lat=${c.lat.toFixed(5)}&lon=${c.lng.toFixed(5)}&limit=1&lang=en`, { credentials: 'omit' })
            .then((r) => r.json())
            .then((j) => { if (!cancelled && lastGeo.current === key) setPlace(placeFromPhoton(j.features && j.features[0] && j.features[0].properties, level)); })
            .catch(() => {});
        }, 450);
      }
      settleRef.current = () => { syncUrl(); syncPlace(); };
      // flights move the camera every frame; the address and place name follow once it settles
      map.on('moveend', (e) => {
        if (quiet() || (e && e.atlasQuiet)) return;
        syncUrl();
        syncPlace();
        // the extra zoom for eye height is only lent for street moments
        if (!streetRef.current && map.getMaxZoom() > MAP_MAX_ZOOM && map.getZoom() <= MAP_MAX_ZOOM) map.setMaxZoom(MAP_MAX_ZOOM);
      });

      map.on('idle', () => {
        const z = map.getZoom();
        if (z < 5.5) {
          setStats({ kind: 'dots', count: map.queryRenderedFeatures({ layers: ['cov-dots'] }).length, hist: {} });
          return;
        }
        if (!map.getLayer('cov-all')) return;
        // sequences crossing the view: the count respects the layer and year filters,
        // the histogram does not, so the scrubber always shows what a year would add
        const shown = new Map();
        map.queryRenderedFeatures({ layers: ['cov-hit'] }).forEach((f) => {
          const id = f.properties.sequence_uuid;
          if (id && !shown.has(id)) shown.set(id, String(f.properties.fov) === '360');
        });
        const years = new Map();
        map.queryRenderedFeatures({ layers: ['cov-all'] }).forEach((f) => {
          const id = f.properties.sequence_uuid;
          if (id && !years.has(id)) years.set(id, parseInt(String(f.properties.capture_time).slice(0, 4), 10));
        });
        const hist = {};
        years.forEach((y) => { if (y) hist[y] = (hist[y] || 0) + 1; });
        let pano = 0;
        shown.forEach((is) => { if (is) pano++; });
        setStats({ kind: 'lines', count: shown.size, pano, hist });
      });

      map.on('mousemove', (e) => {
        if (quiet() || streetRef.current || !map.getLayer('cov-hover')) return;
        const dm = droneStateRef.current;
        if (dm) {
          const i = dm.mode === '3d' && droneRef.current ? droneRef.current.pick(e.point.x, e.point.y) : -1;
          map.getCanvas().style.cursor = i >= 0 ? 'pointer' : '';
          return;
        }
        const shots = map.getLayer('drone-shots') && frus2d.current < 0.5 ? map.queryRenderedFeatures([[e.point.x - 7, e.point.y - 7], [e.point.x + 7, e.point.y + 7]], { layers: ['drone-shots'] }) : [];
        const idx = shots.length ? shots[0].properties.index : -1;
        if (idx !== hoverShot.current) {
          ['drone-foot', 'drone-shots'].forEach((src) => {
            if (hoverShot.current >= 0) map.setFeatureState({ source: src, id: hoverShot.current }, { active: false });
            if (idx >= 0) map.setFeatureState({ source: src, id: idx }, { active: true });
          });
          hoverShot.current = idx;
        }
        const cov = idx < 0 ? map.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: ['cov-hit'] }) : [];
        const seq = cov.length ? cov[0].properties.sequence_uuid : '';
        if (seq !== hoverSeq.current) {
          hoverSeq.current = seq;
          map.setFilter('cov-hover', ['==', ['get', 'sequence_uuid'], seq]);
        }
        map.getCanvas().style.cursor = idx >= 0 || seq ? 'pointer' : '';
        peekRef.current(idx, seq, e);
      });
      map.on('mouseout', () => {
        hoverSeq.current = '';
        if (map.getLayer('cov-hover')) map.setFilter('cov-hover', ['==', ['get', 'sequence_uuid'], '']);
        peekRef.current(-1, '', null);
      });

      // the globe turns slowly when nobody is using it, as on the homepage
      let idleSince = performance.now();
      let spin = 0;
      const touch = () => { idleSince = performance.now(); };
      ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((n) => map.getCanvasContainer().addEventListener(n, touch, { passive: true }));
      const idle = () => !cancelled && !reducedRef.current && !document.hidden && performance.now() - idleSince > 9000
        && map.getZoom() <= 3.2 && !droneStateRef.current && !streetRef.current && !flyingRef.current;
      const drift = () => {
        if (!idle()) { spin = 0; settleRef.current(); return; }
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + 0.02, c.lat] }, { atlasQuiet: true });
        spin = requestAnimationFrame(drift);
      };
      const watch = setInterval(() => { if (!spin && idle() && !map.isMoving()) spin = requestAnimationFrame(drift); }, 1000);
      map.once('remove', () => { clearInterval(watch); cancelAnimationFrame(spin); });

      map.on('click', (e) => {
        if (flyingRef.current || streetRef.current || !map.getLayer('cov-hit')) return;
        const dm = droneStateRef.current;
        if (dm && dm.mode === '3d') {
          const i = droneRef.current ? droneRef.current.pick(e.point.x, e.point.y) : -1;
          if (i >= 0) openPhotoRef.current(i);
          return;
        }
        if (dm && dm.mode === 'photo') {
          const inFoot = map.queryRenderedFeatures(e.point, { layers: ['drone-foot-fill'] });
          if (inFoot.length) {
            const i = nearestShot(site, e.lngLat.lng, e.lngLat.lat);
            if (i !== dm.index) openPhotoRef.current(i);
          }
          return;
        }
        const box = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
        const shots = frus2d.current < 0.5 ? map.queryRenderedFeatures(box, { layers: ['drone-shots'] }) : [];
        if (shots.length) { openPhotoRef.current(shots[0].properties.index); return; }
        if (frus2d.current >= 0.5 && droneRef.current) {
          const i = droneRef.current.pick(e.point.x, e.point.y);
          if (i >= 0) { openPhotoRef.current(i); return; }
        }
        const cov = map.queryRenderedFeatures(box, { layers: ['cov-hit'] });
        if (cov.length) { selectSequenceRef.current(cov[0].properties.sequence_uuid, e.lngLat); return; }
        const inOrtho = map.queryRenderedFeatures(e.point, { layers: ['drone-foot-fill'] });
        if (inOrtho.length && map.getZoom() >= 15) { openPhotoRef.current(nearestShot(site, e.lngLat.lng, e.lngLat.lat)); return; }
        pickReq.current += 1;
        setPick(null);
      });

      // deep link to a photo: /app?pId=123
      const pId = q.get('pId');
      if (pId && WFS) {
        fetch(`${WFS}map_points&maxFeatures=1&CQL_FILTER=${encodeURIComponent(`id=${parseInt(pId, 10)}`)}`, { credentials: 'omit' })
          .then((r) => r.json())
          .then((j) => {
            const f = j.features && j.features[0];
            if (!f || cancelled) return;
            enterStreetRef.current(f.properties.sequence_uuid, f.properties.id);
          })
          .catch(() => {});
      }
    }).catch(() => setMapError(true));
    return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(geoTimer.current); if (map) map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------------- camera moves
  /** Fly the eye along a planned path; true if it arrived. */
  async function flyTo(eye, { speed = 1 } = {}) {
    const map = mapRef.current;
    if (!map) return false;
    if (flightRef.current) flightRef.current.cancel();
    map.stop();
    const plan = planFlight(eyeForCamera(camNow(), H()), eye, { speed });
    flyingRef.current = true;
    setFlying(true);
    const f = runFlight(map, plan, { height: H, reduced: reducedRef.current });
    flightRef.current = f;
    const ok = await f.promise;
    if (flightRef.current === f) {
      flightRef.current = null;
      flyingRef.current = false;
      setFlying(false);
      settleRef.current();
    }
    return ok;
  }
  /** Ease around a subject (the map's own look-at interpolation). */
  async function easeTo(cam, ms) {
    const map = mapRef.current;
    if (!map) return;
    if (flightRef.current) flightRef.current.cancel();
    await easeCamera(map, { center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, duration: ms }, { reduced: reducedRef.current });
  }
  /** After a flight was interrupted outside the drone views: level the camera so the map is usable again. */
  async function levelOut() {
    const map = mapRef.current;
    if (!map || droneStateRef.current) return;
    const c = map.getCenter();
    if (map.getPitch() > 1) await easeTo({ center: [c.lng, c.lat], zoom: Math.min(map.getZoom(), 19), pitch: 0, bearing: map.getBearing() }, reducedRef.current ? 0 : 900);
    if (mapRef.current && mapRef.current.getZoom() <= MAP_MAX_ZOOM) mapRef.current.setMaxZoom(MAP_MAX_ZOOM);
  }
  function stopOrbit() {
    if (orbitRef.current) cancelAnimationFrame(orbitRef.current);
    orbitRef.current = 0;
    setOrbit(false);
  }
  function startOrbit() {
    const map = mapRef.current;
    if (!map || reducedRef.current) return;
    stopOrbit();
    let last = performance.now();
    const el = map.getCanvasContainer();
    const stop = () => { stopOrbit(); ['pointerdown', 'wheel', 'touchstart'].forEach((n) => el.removeEventListener(n, stop)); settleRef.current(); };
    ['pointerdown', 'wheel', 'touchstart'].forEach((n) => el.addEventListener(n, stop, { passive: true, once: true }));
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      map.setBearing(map.getBearing() + dt * 7);
      orbitRef.current = requestAnimationFrame(tick);
    };
    orbitRef.current = requestAnimationFrame(tick);
    setOrbit(true);
  }
  function setInteractive(mode) {
    const map = mapRef.current;
    if (!map) return;
    if (mode === '3d') { map.dragRotate.enable(); map.touchPitch.enable(); map.touchZoomRotate.enableRotation(); }
    else { map.dragRotate.disable(); map.touchPitch.disable(); map.touchZoomRotate.disableRotation(); }
  }
  function apply2d() {
    const map = mapRef.current;
    if (!map || !map.getLayer('drone-shots')) return;
    const hide = !!droneStateRef.current || frus2d.current >= 0.5;
    const o = hide ? 0 : 1 - Math.max(0, frus2d.current);
    map.setPaintProperty('drone-shots', 'circle-opacity', o);
    map.setPaintProperty('drone-shots', 'circle-stroke-opacity', o);
    map.setPaintProperty('drone-path', 'line-opacity', 0.9 * o);
  }
  /** A street view that never became visible (its descent was overtaken) is dropped. */
  function dropHiddenStreet() {
    if (streetRef.current && !streetRef.current.visible) { setStreet(null); walkApi.current = null; }
  }
  function clearHoverShot() {
    const map = mapRef.current;
    if (!map || hoverShot.current < 0) return;
    ['drone-foot', 'drone-shots'].forEach((src) => { if (map.getSource(src)) map.setFeatureState({ source: src, id: hoverShot.current }, { active: false }); });
    hoverShot.current = -1;
  }
  /** Remember what had keyboard focus before a view takes over, to hand it back after. */
  function keepFocus() {
    const el = document.activeElement;
    if (el && el !== document.body && !focusBack.current) focusBack.current = el;
  }
  function restoreFocus() {
    const el = focusBack.current;
    focusBack.current = null;
    if (el && document.contains(el) && !el.closest('[inert]')) el.focus({ preventScroll: true });
    else if (mapRef.current) mapRef.current.getCanvas().focus({ preventScroll: true });
  }
  function droneUrl(params) {
    const qs = new URLSearchParams(window.location.search);
    ['drone', 'shot', 'view'].forEach((k) => qs.delete(k));
    if (params) { qs.set('drone', site.id); Object.entries(params).forEach(([k, v]) => qs.set(k, String(v))); }
    writeUrl(qs);
  }

  // ----------------------------------------------------------------- drone photos
  function markSeen(i) {
    if (seenRef.current.has(i)) return;
    const next = new Set(seenRef.current);
    next.add(i);
    seenRef.current = next;
    setSeen(next);
    try {
      const r = applyEvent(loadProgress(window.localStorage), { type: 'survey', site: site.id, photos: [i], total: N_SHOTS });
      saveProgress(window.localStorage, r.state);
      setMe(levelFor(r.state.xp));
      if (r.gained > 0) setXpPop({ k: Date.now(), text: `+${r.gained} XP` });
      if (next.size === N_SHOTS) say(`Survey explored: all ${N_SHOTS} photos seen.`);
      else if (r.levelUp) say(`Level up: ${r.level.name}`);
    } catch (e) { /* storage unavailable */ }
  }
  /** Load photo i into the hidden slot, then dissolve to it. */
  async function showPhoto(i, op) {
    const map = mapRef.current;
    if (!map || !map.getSource('drone-photo-a')) return;
    const slot = photoSlot.current === 'a' ? 'b' : 'a';
    const other = slot === 'a' ? 'b' : 'a';
    const shot = site.shots[i];
    let ok = await loadImageSource(map, `drone-photo-${slot}`, shotImage(site, shot), shot.footprint);
    if (op !== opRef.current || !mapRef.current) return;
    if (!ok) ok = await loadImageSource(map, `drone-photo-${slot}`, shotImage(site, shot, '480'), shot.footprint);
    if (op !== opRef.current || !mapRef.current) return;
    if (!ok) { say('That drone photo did not load.'); return; }
    map.moveLayer(`drone-photo-${slot}`, 'drone-frame');
    map.setPaintProperty(`drone-photo-${slot}`, 'raster-opacity-transition', { duration: 420, delay: 0 });
    map.setPaintProperty(`drone-photo-${slot}`, 'raster-opacity', 1);
    map.setPaintProperty(`drone-photo-${other}`, 'raster-opacity-transition', { duration: 300, delay: 360 });
    map.setPaintProperty(`drone-photo-${other}`, 'raster-opacity', 0);
    map.getSource('drone-dim').setData(shadeAround(site, shot));
    map.setPaintProperty('drone-dim', 'fill-opacity', 0.52);
    map.getSource('drone-frame').setData(footprintLine(shot));
    map.setPaintProperty('drone-frame', 'line-opacity', 0.95);
    photoSlot.current = slot;
    shownRef.current = i;
  }
  function hidePhotos() {
    const map = mapRef.current;
    if (!map || !map.getLayer('drone-photo-a')) return;
    ['a', 'b'].forEach((k) => {
      map.setPaintProperty(`drone-photo-${k}`, 'raster-opacity-transition', { duration: 380, delay: 0 });
      map.setPaintProperty(`drone-photo-${k}`, 'raster-opacity', 0);
    });
    map.setPaintProperty('drone-dim', 'fill-opacity', 0);
    map.setPaintProperty('drone-frame', 'line-opacity', 0);
    shownRef.current = -1;
  }
  async function openPhoto(i, { keepCamera = false } = {}) {
    const map = mapRef.current;
    if (!map || !map.getSource('drone-photo-a')) return;
    const idx = wrapShot(i);
    const op = ++opRef.current;
    stopOrbit();
    const prev = droneStateRef.current;
    if (!prev) keepFocus();
    clearHoverShot();
    dropHiddenStreet();
    setDrone({ mode: 'photo', index: idx });
    pickReq.current += 1;
    setPick(null);
    setBoard(false);
    setLens(null);
    if (!layers.drone) setLayers((l) => ({ ...l, drone: true }));
    if (droneRef.current) droneRef.current.setActive(idx);
    setInteractive('photo');
    apply2d();
    markSeen(idx);
    droneUrl({ shot: idx });
    const cam = photoCamera(site.shots[idx], { ...viewport(), ...photoInsets() });
    const showing = showPhoto(idx, op);
    const here = distanceM(map.getCenter(), site.centre) < 1500 && map.getZoom() > 14;
    if (keepCamera) { await showing; return; }
    if (prev && prev.mode === 'photo') await easeTo(cam, reducedRef.current ? 0 : 850);
    else if (prev || here) await easeTo(cam, prev ? 1500 : 1400);
    else await flyTo(eyeForCamera(cam, H()));
    await showing;
  }
  async function open3d(index, { viaFlight = false, keepCamera = false } = {}) {
    const map = mapRef.current;
    if (!map) return;
    if (!droneRef.current) { say('The 3D view needs WebGL 2, which this browser does not offer.'); return; }
    const op = ++opRef.current;
    stopOrbit();
    const cur = droneStateRef.current;
    if (!cur) keepFocus();
    clearHoverShot();
    dropHiddenStreet();
    const idx = wrapShot(index != null ? index : cur ? cur.index : Math.floor(N_SHOTS / 2));
    pickReq.current += 1;
    setPick(null);
    setBoard(false);
    setLens(null);
    if (!layers.drone) setLayers((l) => ({ ...l, drone: true }));
    hidePhotos();
    droneRef.current.setEnabled(true);
    droneRef.current.setActive(idx);
    const cam = surveyCamera(site, viewport(), (cur && cur.mode === 'photo' ? map.getBearing() : -10) - 38);
    const enter = () => { setDrone({ mode: '3d', index: idx }); setInteractive('3d'); apply2d(); droneUrl({ view: '3d' }); };
    if (keepCamera) {
      enter();
    } else if (viaFlight) {
      // rising from the street: the interface arrives once the camera is up
      const arrived = await flyTo(eyeForCamera(cam, H()));
      if (op !== opRef.current) return;
      if (!arrived) { droneRef.current.setActive(-1); await levelOut(); return; }
      enter();
    } else {
      enter();
      await easeTo(cam, reducedRef.current ? 0 : 1700);
    }
    // turn slowly only once the camera really is in the tilted view
    if (op === opRef.current && !tourRef.current && Math.abs(map.getPitch() - cam.pitch) < 2) startOrbit();
  }
  async function exitDrone() {
    const map = mapRef.current;
    if (!map) return;
    ++opRef.current;
    stopOrbit();
    hidePhotos();
    setDrone(null);
    setInteractive('map');
    apply2d();
    droneUrl(null);
    if (droneRef.current) droneRef.current.setActive(-1);
    restoreFocus();
    await easeTo(surveyTopCamera(site, viewport()), reducedRef.current ? 0 : 1400);
  }
  function setShot(i) {
    const cur = droneStateRef.current;
    if (!cur) return;
    if (cur.mode === 'photo') { openPhoto(i); return; }
    const idx = wrapShot(i);
    setDrone({ mode: '3d', index: idx });
    if (droneRef.current) droneRef.current.setActive(idx);
  }

  // ------------------------------------------------------------- street level
  /** Fly down to a street photo and dissolve into it. */
  async function descend({ seq, photoId, data: pre = null }) {
    const map = mapRef.current;
    if (!map || !seq) return;
    const op = ++opRef.current;
    stopOrbit();
    pickReq.current += 1;
    setPick(null);
    setBoard(false);
    setLens(null);
    hoverSeq.current = '';
    if (map.getLayer('cov-hover')) map.setFilter('cov-hover', ['==', ['get', 'sequence_uuid'], '']);
    let data = pre;
    if (!data) {
      setBusy('Finding the street…');
      const hit = seqCache.current.get(seq);
      data = await (hit ? hit.then((d) => d || loadSequence(API, seq)) : loadSequence(API, seq)).catch(() => null);
      setBusy(null);
      if (op !== opRef.current) return;
    }
    if (!data || !data.frames || !data.frames.length) { say('We could not load that street.'); return; }
    const idx = frameIndexFor(data.frames, photoId);
    const f = data.frames[idx];
    const yaw = Number.isFinite(f.heading) ? f.heading : map.getBearing();
    if (!streetRef.current) { returnRef.current = { camera: camNow(), drone: droneStateRef.current }; keepFocus(); }
    clearHoverShot();
    streetReady.current = null;
    streetFail.current = null;
    walkApi.current = null;
    hidePhotos();
    if (droneStateRef.current) { setDrone(null); setInteractive('map'); apply2d(); droneUrl(null); }
    if (droneRef.current) droneRef.current.setActive(-1);
    const key = `${seq}:${f.id}:${op}`;
    setStreet({
      key, seq, photo: f.id, data, view: { yaw, pitch: STREET_LOOK, vfov: MAP_VFOV },
      visible: false, chrome: false, near: distanceM(f, site.centre) < 700,
    });
    map.setMaxZoom(STREET_MAX_ZOOM);
    const mine = () => streetRef.current && streetRef.current.key === key;
    const landed = await flyTo(streetEye(f, yaw));
    if (op !== opRef.current) return;
    if (!landed) { if (mine()) setStreet(null); levelOut(); restoreFocus(); return; }
    if (!streetReady.current && !streetFail.current) setBusy('Developing the photo…');
    // ready when the start photo is drawn, or (after a short grace) any neighbour of it
    const t0 = performance.now();
    const ok = await waitFor(() => streetReady.current || streetFail.current || op !== opRef.current
      || (performance.now() - t0 > 2000 && walkApi.current && walkApi.current.getState().hasAny), 9000);
    setBusy(null);
    if (op !== opRef.current) return;
    if (!ok || streetFail.current) {
      say(typeof streetFail.current === 'string' ? streetFail.current : 'The photos of this street did not load in time.');
      await rise({ to: 'back' });
      return;
    }
    // the camera must stand exactly where the photo was taken when they dissolve
    if (flightRef.current) flightRef.current.cancel();
    map.jumpTo(cameraForEye(streetEye(f, yaw), H()));
    setStreet((st) => st && { ...st, visible: true });
    await sleep(reducedRef.current ? 120 : 560);
    if (op !== opRef.current) return;
    const api = walkApi.current;
    if (api) api.animateView({ pitch: 0, vfov: api.getState().baseVfov }, reducedRef.current ? 1 : 1300, 'out');
    setStreet((st) => st && { ...st, chrome: true });
    setAnnounce('Street view. Escape returns to the map.');
    settleRef.current();
  }
  /** Open a street photo directly (shared links), with the map parked underneath. */
  async function enterStreet(seq, photoId) {
    const map = mapRef.current;
    if (!map) return;
    const op = ++opRef.current;
    const data = await loadSequence(API, seq).catch(() => null);
    if (op !== opRef.current) return;
    if (!data || !data.frames.length) { say('We could not load that photo.'); return; }
    keepFocus();
    const f = data.frames[frameIndexFor(data.frames, photoId)];
    map.setMaxZoom(STREET_MAX_ZOOM);
    map.jumpTo(cameraForEye(streetEye(f, f.heading || 0), H()));
    returnRef.current = null;
    streetReady.current = null;
    streetFail.current = null;
    setStreet({ key: `${seq}:${f.id}:${op}`, seq, photo: f.id, data, view: { yaw: f.heading || 0, pitch: 0 }, visible: true, chrome: true, near: distanceM(f, site.centre) < 700 });
  }
  /** Dissolve from the photo back into the map at the same view, then rise. */
  async function rise({ to = 'back' } = {}) {
    const map = mapRef.current;
    if (!map) return;
    const op = ++opRef.current;
    const api = walkApi.current;
    const cur = streetRef.current;
    if (cur && cur.visible && api) {
      api.play(false);
      const st = api.getState();
      // the walker is often between two photos: stand exactly there
      const a = api.frames[st.i];
      const b = api.frames[Math.min(st.i + 1, api.frames.length - 1)];
      const here = { lng: a.lng + (b.lng - a.lng) * st.tau, lat: a.lat + (b.lat - a.lat) * st.tau };
      map.setMaxZoom(STREET_MAX_ZOOM);
      if (flightRef.current) flightRef.current.cancel();
      map.jumpTo(cameraForEye(streetEye(here, st.yaw), H()));
      await mapIdle(map, 700);
      if (op !== opRef.current) return;
      setStreet((x) => x && { ...x, chrome: false });
      // narrow to the map's own view first, then dissolve: the two views match during the fade
      api.animateView({ yaw: st.yaw, pitch: STREET_LOOK, vfov: MAP_VFOV }, reducedRef.current ? 1 : 620);
      await waitFor(() => !api.getState().animating || op !== opRef.current, reducedRef.current ? 50 : 900);
      if (op !== opRef.current) return;
      setStreet((x) => x && { ...x, visible: false });
      await sleep(reducedRef.current ? 120 : 580);
      if (op !== opRef.current) return;
    }
    setStreet(null);
    walkApi.current = null;
    if (to === 'aerial') { await open3d(Math.floor(N_SHOTS / 2), { viaFlight: true }); }
    else {
      const back = returnRef.current;
      returnRef.current = null;
      let arrived;
      if (back) {
        arrived = await flyTo(eyeForCamera(back.camera, H()));
        if (arrived && op === opRef.current && back.drone) {
          // already standing where that view was: restore it without moving again
          if (back.drone.mode === 'photo') await openPhoto(back.drone.index, { keepCamera: true });
          else await open3d(back.drone.index, { keepCamera: true });
        }
      } else {
        const e = eyeForCamera(camNow(), H());
        arrived = await flyTo({ ...e, alt: 340, pitch: 0 });
      }
      if (!arrived && op === opRef.current) await levelOut();
    }
    if (!droneStateRef.current) restoreFocus();
    if (mapRef.current && mapRef.current.getZoom() <= MAP_MAX_ZOOM) mapRef.current.setMaxZoom(MAP_MAX_ZOOM);
  }
  const onStreetFrame = useCallback((f, st) => {
    const map = mapRef.current;
    const cur = streetRef.current;
    if (!map || !cur || !cur.visible || !cur.chrome) return;
    // keep the hidden map under the walker, so leaving starts exactly here
    const frames = cur.data && cur.data.frames;
    const a = frames && frames[st.i];
    const b = frames && frames[Math.min(st.i + 1, frames.length - 1)];
    const here = a && b ? { lng: a.lng + (b.lng - a.lng) * st.tau, lat: a.lat + (b.lat - a.lat) * st.tau } : f;
    if (!flyingRef.current) map.jumpTo(cameraForEye(streetEye(here, st.yaw), map.getContainer().clientHeight), { atlasQuiet: true });
    const qs = new URLSearchParams(window.location.search);
    qs.set('pId', String(f.id));
    writeUrl(qs);
    const nearNow = distanceM(f, site.centre) < 700;
    if (nearNow !== cur.near) setStreet((x) => x && { ...x, near: nearNow });
  }, []);
  useEffect(() => {
    if (street) return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.has('pId')) { qs.delete('pId'); writeUrl(qs); }
  }, [street]);

  // ------------------------------------------------------------- selection and peek
  const selectSequence = useCallback((seq, lngLat) => {
    const map = mapRef.current;
    if (!map || !seq) return;
    const req = ++pickReq.current; // a later click wins over a slower earlier answer
    setPick({ status: 'loading', seq, lngLat });
    setLens(null);
    const cached = seqCache.current.get(seq);
    (cached ? cached.then((d) => d || loadSequence(API, seq)) : loadSequence(API, seq))
      .then((data) => {
        if (req !== pickReq.current) return;
        if (!data || !data.frames.length) { setPick(null); say('That sequence has no photos to show.'); return; }
        const { frames, length } = data;
        const o = frames[0];
        const k = Math.cos((o.lat * Math.PI) / 180);
        const east = ((lngLat.lng - o.lng) * Math.PI / 180) * 6378137 * k;
        const north = ((lngLat.lat - o.lat) * Math.PI / 180) * 6378137;
        const i = Math.max(0, nearestFrame(frames, east, north));
        const f = frames[i];
        setPick({ status: 'ready', seq, data, lngLat: { lng: f.lng, lat: f.lat }, frame: f, index: i, count: frames.length, length, thumb: imageUrl(IMG, f, 240), user: null });
        loadUsername(API, f.userId).then((u) => setPick((p) => (p && p.seq === seq ? { ...p, user: u } : p)));
      })
      .catch(() => { if (req !== pickReq.current) return; setPick(null); say('We could not load that sequence.'); });
  }, [say]);

  function cachedSequence(seq) {
    const c = seqCache.current;
    if (!c.has(seq)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const p = loadSequence(API, seq, { signal: ctrl.signal })
        .then((d) => { seqData.current.set(seq, d); return d; })
        .catch(() => { if (c.get(seq) === p) c.delete(seq); seqData.current.delete(seq); return null; })
        .finally(() => clearTimeout(timer));
      c.set(seq, p);
      if (c.size > 40) { const k = c.keys().next().value; c.delete(k); seqData.current.delete(k); }
    }
    return c.get(seq);
  }
  /** Hover: a small photo of the street (or of the drone camera) under the pointer. */
  function peek(shotIdx, seq, e) {
    clearTimeout(lensTimer.current);
    const map = mapRef.current;
    if (!e || !map || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) { setLens(null); return; }
    const { width } = viewport();
    // keep the lens on screen: flip left near the right edge, below the pointer near the top
    const x = e.point.x + 214 > width ? e.point.x - 232 : e.point.x;
    const y = e.point.y < 170 ? e.point.y + 172 : e.point.y;
    if (shotIdx >= 0) {
      const sh = site.shots[shotIdx];
      setLens({ x, y, src: shotImage(site, sh, '480'), title: `Drone photo ${shotIdx + 1} of ${N_SHOTS}`, sub: `${sh.agl} m up · demo data`, pano: false });
      return;
    }
    if (!seq || map.getZoom() < 12.5) { setLens(null); return; }
    const show = (data) => {
      if (!data || !data.frames.length || hoverSeq.current !== seq) return;
      const o = data.frames[0];
      const k = Math.cos((o.lat * Math.PI) / 180);
      const east = ((e.lngLat.lng - o.lng) * Math.PI / 180) * 6378137 * k;
      const north = ((e.lngLat.lat - o.lat) * Math.PI / 180) * 6378137;
      const i = nearestFrame(data.frames, east, north);
      if (i < 0) return;
      const f = data.frames[i];
      setLens({ x, y, src: imageUrl(IMG, f, 240), title: `${f.pano ? '360° · ' : ''}${fmtDate(f.time)}`, sub: 'Click to step in', pano: f.pano });
    };
    const ready = seqData.current.get(seq);
    if (ready) { show(ready); return; }
    // only fetch when the pointer rests on a street for a moment
    lensTimer.current = setTimeout(() => { cachedSequence(seq).then(show); }, 160);
  }
  const peekRef = useRef(peek);
  peekRef.current = peek;
  const selectSequenceRef = useRef(selectSequence);
  selectSequenceRef.current = selectSequence;
  const openPhotoRef = useRef(openPhoto);
  openPhotoRef.current = openPhoto;
  const open3dRef = useRef(open3d);
  open3dRef.current = open3d;
  const enterStreetRef = useRef(enterStreet);
  enterStreetRef.current = enterStreet;

  // marker for the picked photo, and its sequence drawn in ink
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (!map || !gl) return undefined;
    if (map.getLayer('cov-pick')) map.setFilter('cov-pick', ['==', ['get', 'sequence_uuid'], pick && pick.seq ? pick.seq : '']);
    if (!pick || !pick.lngLat) { if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; } return undefined; }
    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = s.pickPin;
      markerRef.current = new gl.Marker({ element: el, anchor: 'center' });
    }
    markerRef.current.setLngLat([pick.lngLat.lng, pick.lngLat.lat]).addTo(map);
    return undefined;
  }, [pick]);

  const dropHere = () => {
    const map = mapRef.current;
    if (!map) return;
    if (pick && pick.status === 'ready') { descend({ seq: pick.seq, photoId: pick.frame.id, data: pick.data }); return; }
    const c = map.project(map.getCenter());
    const cov = map.queryRenderedFeatures([[c.x - 70, c.y - 70], [c.x + 70, c.y + 70]], { layers: ['cov-hit'] });
    if (!cov.length) { say('No street-level imagery at the centre of the map. Move over a blue line and try again.'); return; }
    selectSequence(cov[0].properties.sequence_uuid, map.getCenter());
    say('Found a street here. Press Step inside to walk it.');
  };

  // ----------------------------------------------------------------- the tour
  async function runTour() {
    if (!droneRef.current) { say('The tour needs WebGL 2, which this browser does not offer.'); return; }
    const token = {};
    tourRef.current = token;
    setTour(true);
    const alive = () => tourRef.current === token;
    const stop = () => { if (tourRef.current === token) { tourRef.current = null; setTour(false); } };
    keepFocus();
    const onInput = (ev) => { if (ev.isTrusted) stop(); };
    window.addEventListener('pointerdown', onInput, { capture: true });
    window.addEventListener('keydown', onInput, { capture: true });
    window.addEventListener('wheel', onInput, { capture: true, passive: true });
    try {
      await open3d(9);
      if (!alive()) return;
      startOrbit();
      await sleep(4200);
      if (!alive()) return;
      for (const i of [9, 10, 11]) {
        await openPhoto(i);
        if (!alive()) return;
        await sleep(i === 9 ? 2200 : 1500);
        if (!alive()) return;
      }
      await descend({ seq: site.street.sequence, photoId: site.street.photoId });
      if (!alive()) return;
      const api = walkApi.current;
      await sleep(900);
      if (!alive()) return;
      // a short drive along the street (not with reduced motion)
      if (api && walkApi.current === api && !reducedRef.current) api.play(true, 2);
      await sleep(reducedRef.current ? 1500 : 5200);
      if (!alive()) return;
      if (api && walkApi.current === api) api.play(false);
      await rise({ to: 'aerial' });
      if (alive()) say('That was the survey: 18 photos, a 3D model and the street beside it.');
    } finally {
      window.removeEventListener('pointerdown', onInput, { capture: true });
      window.removeEventListener('keydown', onInput, { capture: true });
      window.removeEventListener('wheel', onInput, { capture: true });
      stop();
    }
  }

  // ------------------------------------------------------ layers and years
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const year = yearFilter(range[0], range[1]);
    const kinds = [];
    if (layers.street) kinds.push(['!=', ['to-string', ['get', 'fov']], '360']);
    if (layers.pano) kinds.push(['==', ['to-string', ['get', 'fov']], '360']);
    const kind = kinds.length === 2 ? true : kinds.length === 1 ? kinds[0] : false;
    ['cov-line', 'cov-hit'].forEach((id) => map.setFilter(id, ['all', year, kind]));
    map.setFilter('cov-dots', ['all', year, kind]);
    ['drone-ortho', 'drone-foot-case', 'drone-foot', 'drone-foot-fill', 'drone-path', 'drone-shots'].forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', layers.drone ? 'visible' : 'none'); });
    if (droneRef.current) droneRef.current.setEnabled(layers.drone);
    if (map.getLayer('drone-ortho')) map.setPaintProperty('drone-ortho', 'raster-opacity', orthoOpacity);
  }, [ready, layers, range, orthoOpacity]);

  useEffect(() => {
    if (!playing) return undefined;
    const end = YEARS[YEARS.length - 1];
    setRange(([from]) => [from, from]);
    const t = setInterval(() => {
      setRange(([from, to]) => {
        if (to >= end) { setPlaying(false); return [from, to]; }
        return [from, to + 1];
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing]);

  // Escape closes the leaderboard, then clears the selection (the viewers handle their own keys)
  useEffect(() => {
    if (street || droneState) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || (e.target.closest && e.target.closest('input, textarea'))) return;
      if (board) setBoard(false);
      else if (pick) { pickReq.current += 1; setPick(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [street, droneState, board, pick]);

  const goStop = (key) => {
    const map = mapRef.current;
    if (!map) return;
    if (key === 'street') { dropHere(); return; }
    if (key === 'drone') {
      if (!layers.drone) setLayers((l) => ({ ...l, drone: true }));
      if (distanceM(map.getCenter(), site.centre) > 1500) say('Flying to the drone demo site: Brighton Beach, Duluth, Minnesota.');
      map.flyTo({ center: [site.centre.lng, site.centre.lat], zoom: 18.1, pitch: 0, bearing: 0, duration: 3200 });
      return;
    }
    const stop = STOPS.find((x) => x.key === key);
    map.easeTo({ zoom: stop.zoom, pitch: 0, duration: 1600 });
  };
  const railDrag = (e) => {
    const map = mapRef.current;
    const track = e.currentTarget;
    if (!map) return;
    const rect = track.getBoundingClientRect();
    const set = (y) => map.jumpTo({ zoom: zoomForRail(1 - (y - rect.top) / rect.height) }, { atlasQuiet: true });
    set(e.clientY);
    const move = (ev) => set(ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      settleRef.current();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onSearchGo = (it) => {
    const map = mapRef.current;
    if (!map) return;
    if (it.extent && it.extent.length === 4) map.fitBounds([[it.extent[0], it.extent[3]], [it.extent[2], it.extent[1]]], { padding: 80, duration: 2200, maxZoom: 16 });
    else map.flyTo({ center: [it.lng, it.lat], zoom: it.zoom, pitch: 0, duration: 2200 });
  };

  const mode = street ? 'street' : droneState ? droneState.mode : flying ? 'flight' : 'map';
  const chromeOff = mode !== 'map';
  const titleLen = (place.title || '').length;
  const titleScale = titleLen <= 10 ? 1 : titleLen <= 16 ? 0.76 : titleLen <= 24 ? 0.58 : 0.46;
  const statLine = stats.kind === 'dots'
    ? `${stats.count.toLocaleString('en-US')} photo locations in view`
    : `${stats.count.toLocaleString('en-US')} ${stats.count === 1 ? 'sequence' : 'sequences'} in view${stats.pano ? ` · ${stats.pano} in 360°` : ''}${nearSite && layers.drone ? ' · 1 drone survey' : ''}`;

  return (
    <div className={s.atlas} data-mode={mode} data-level={level} data-site={nearSite && layers.drone ? 'true' : 'false'} data-pick={pick && mode === 'map' ? 'true' : 'false'} data-tour={tour ? 'true' : 'false'}>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
        <meta name="theme-color" content="#e8edf1" />
      </Head>
      <div ref={containerRef} className={s.map} aria-label="Map of Mapilio street-level and drone imagery" role="application" inert={street && street.visible ? '' : undefined} />
      <p className={s.srOnly} role="status" aria-live="polite">{announce}</p>
      <div className={s.scrim} aria-hidden="true" />
      {!ready && !mapError && <p className={s.loading}>Loading the map…</p>}
      {mapError && <p className={s.loading} role="alert">The map could not start. <a href="/app/classic" onClick={toClassic}>Open the classic map</a></p>}

      <header className={s.top} inert={chromeOff ? '' : undefined}>
        <a className={s.logo} href="/" aria-label="Mapilio home"><MapilioLogo width={108} height={36} primaryColor="#0b1220" secondaryColor="#0056f1" /></a>
        <Search onGo={onSearchGo} />
        <nav className={s.topNav} aria-label="Map">
          <button type="button" onClick={() => setBoard((b) => !b)} aria-expanded={board}>Contributors</button>
          <a href="/app/play">{me ? `${me.name} · ${me.xp.toLocaleString('en-US')} XP` : 'Daily five'}</a>
          <a className={s.topCta} href={signedIn ? '/dashboard' : '/login'}>{signedIn ? 'Dashboard' : 'Sign in'}</a>
        </nav>
      </header>

      <div className={s.layers} role="group" aria-label="Imagery layers" inert={chromeOff ? '' : undefined}>
        <button type="button" aria-pressed={layers.street} onClick={() => setLayers((l) => ({ ...l, street: !l.street }))}><i data-k="street" aria-hidden="true" />Street-level</button>
        <button type="button" aria-pressed={layers.pano} onClick={() => setLayers((l) => ({ ...l, pano: !l.pano }))}><i data-k="pano" aria-hidden="true" />360°</button>
        <button type="button" aria-pressed={layers.drone} onClick={() => setLayers((l) => ({ ...l, drone: !l.drone }))}><i data-k="drone" aria-hidden="true" />Drone <small>demo</small></button>
        {/* on narrow screens the top bar has no room for these */}
        <button type="button" className={s.narrowOnly} onClick={() => setBoard((b) => !b)} aria-expanded={board}>Contributors</button>
        <a className={s.narrowOnly} href="/app/play">{me ? `${me.xp.toLocaleString('en-US')} XP` : 'Daily five'}</a>
      </div>

      <nav ref={railRef} className={s.rail} aria-label="Altitude" inert={chromeOff ? '' : undefined}>
        <div className={s.railReadout} aria-live="off"><span ref={chapterRef}>World</span><b ref={altRef}>—</b></div>
        <div className={s.railTrack} onPointerDown={railDrag}>
          <i className={s.railMarker} aria-hidden="true" />
        </div>
        <ol>
          {STOPS.map((st) => (
            <li key={st.key} style={{ '--at': railPosition(st.zoom) }}>
              <button type="button" onClick={() => goStop(st.key)}>{st.label}</button>
            </li>
          ))}
        </ol>
      </nav>

      <section className={s.where} aria-label="Where the map is" inert={chromeOff ? '' : undefined}>
        {nearSite && layers.drone && (
          <div className={s.survey} data-open={sheet ? 'true' : 'false'}>
            <button type="button" className={s.surveyHead} onClick={() => setSheet((v) => !v)} aria-expanded={sheet}>
              <span className={s.tag}>Drone survey · demo data</span>
              <b>{site.name}</b>
              <i aria-hidden="true">{sheet ? '–' : '+'}</i>
            </button>
            {sheet && (
              <>
                <dl className={s.facts}>
                  <div><dt>Photos</dt><dd>{facts.photos}</dd></div>
                  <div><dt>Above ground</dt><dd>{facts.aglMin}–{facts.aglMax} m</dd></div>
                  <div><dt>Detail</dt><dd>{facts.gsdCm} cm/px</dd></div>
                  <div><dt>Area</dt><dd>{facts.areaM2.toLocaleString('en-US')} m²</dd></div>
                </dl>
                <ol className={s.pipe} aria-label="OpenDroneMap pipeline for this survey">
                  {steps.map((st) => (
                    <li key={st.key}><span>{st.label}</span><b>{st.value}</b><small>{st.tool} · {st.note}</small></li>
                  ))}
                </ol>
                <p className={s.surveyNote}>Processed with OpenDroneMap {facts.version} in {facts.processing}. {site.source.label}, {site.source.copyright}, {site.source.licence}.</p>
              </>
            )}
            <div className={s.surveyActions}>
              <button type="button" className={s.btnSignal} onClick={runTour} disabled={!has3d}>▶ Fly the survey</button>
              <button type="button" className={s.btnInk} onClick={() => openPhoto(nearestShot(site, mapRef.current.getCenter().lng, mapRef.current.getCenter().lat))}>Photos</button>
              <button type="button" className={s.btnLine} onClick={() => open3d()} disabled={!has3d}>3D</button>
              <button type="button" className={s.btnLine} onClick={() => descend({ seq: site.street.sequence, photoId: site.street.photoId })}>Street <small>{site.street.distanceM} m</small></button>
            </div>
            {sheet && (
              <label className={s.opacity}>Orthophoto
                <input type="range" min={0} max={1} step={0.05} value={orthoOpacity} onChange={(e) => setOrthoOpacity(+e.target.value)} />
              </label>
            )}
            {sheet && <p className={s.surveyProgress}>{seen.size} of {N_SHOTS} photos seen{seen.size === N_SHOTS ? ' · survey explored' : ''}</p>}
          </div>
        )}
        <p className={s.coords}>{statLine}</p>
        <h1 className={s.placeTitle} style={{ '--k': titleScale }} aria-live="polite" aria-atomic="true">{place.title}</h1>
        {place.sub && <p className={s.placeSub}>{place.sub}</p>}
      </section>

      <div className={s.bottom} inert={chromeOff ? '' : undefined}>
        <TimeBar range={range} setRange={(r) => { setPlaying(false); setRange(r); }} hist={stats.hist || {}} playing={playing} onPlay={() => setPlaying((p) => !p)} />
        <a className={s.classic} href="/app/classic" onClick={toClassic}>Classic map</a>
      </div>

      {pick && mode === 'map' && (
        <div className={s.dock} role="dialog" aria-label="Selected street-level photo">
          {pick.status === 'loading' && <p className={s.dockNote}>Finding the nearest photo…</p>}
          {pick.status === 'ready' && (
            <>
              <span className={s.dockThumb} data-pano={pick.frame.pano ? 'true' : 'false'}><img src={pick.thumb} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /></span>
              <div className={s.dockText}>
                <b>{pick.frame.pano ? '360°' : 'Photo'}{pick.frame.pano && <span className={s.dockWord}> panorama</span>} {pick.index + 1} of {pick.count}</b>
                <span>{fmtDate(pick.frame.time)}{pick.user ? ` · by ${pick.user}` : ''} · {fmtLength(pick.length)} sequence</span>
              </div>
              <button type="button" className={s.btnBlue} onClick={() => descend({ seq: pick.seq, photoId: pick.frame.id, data: pick.data })}>Step inside</button>
              <button type="button" className={s.dockClose} onClick={() => { pickReq.current += 1; setPick(null); }} aria-label="Clear selection">×</button>
            </>
          )}
        </div>
      )}

      {board && mode === 'map' && <Board onClose={() => setBoard(false)} />}
      <LensLayer apiRef={lensApi} hidden={mode !== 'map'} />
      {toast && <p key={toast.k} className={s.toast} aria-hidden="true">{toast.text}</p>}
      {busy && <p className={s.busy} aria-hidden="true"><i aria-hidden="true" />{busy}</p>}
      {tour && <button type="button" className={s.tourStop} onClick={() => { tourRef.current = null; setTour(false); }}>Stop the tour</button>}

      {droneState && !street && (
        <DroneHud
          site={site}
          mode={droneState.mode}
          index={droneState.index}
          seen={seen}
          xpPop={xpPop}
          orbit={orbit}
          has3d={has3d}
          onIndex={setShot}
          onMode={(m) => (m === '3d' ? open3d(droneState.index) : openPhoto(droneState.index))}
          onOpen={(i) => openPhoto(i)}
          onExit={exitDrone}
          onOrbit={() => (orbit ? stopOrbit() : startOrbit())}
          onDropToStreet={() => descend({ seq: site.street.sequence, photoId: site.street.photoId })}
        />
      )}

      {street && (
        <div
          className={s.streetLayer}
          data-visible={street.visible ? 'true' : 'false'}
          inert={street.visible && street.chrome ? undefined : ''}
          aria-hidden={street.visible && street.chrome ? undefined : 'true'}
        >
          <Walk
            key={street.key}
            embedded
            initialSeq={street.seq}
            initialPhoto={street.photo}
            initialData={street.data}
            initialView={street.view}
            chrome={street.chrome}
            onClose={() => rise({ to: 'back' })}
            onFrame={onStreetFrame}
            onAerial={street.near && has3d ? () => rise({ to: 'aerial' }) : null}
            onReady={(st) => { streetReady.current = st || true; }}
            onApi={(api) => { walkApi.current = api; }}
            onFail={(msg) => { streetFail.current = msg || 'error'; }}
          />
        </div>
      )}
    </div>
  );
}
