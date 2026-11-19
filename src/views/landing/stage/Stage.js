// Homepage WebGL stage: little planet -> street walk -> lift -> drone -> city -> world.
// Driven by a story progress value supplied by the page (0..1). Never touches React state.
import * as THREE from 'three';
import {
  createPanoUniforms, createPanoMesh, setViewBasis, setProjection, setPlanetFade, textureFromBlob, srgb,
} from 'lib/street/panoShader';
import {
  stageState, cumulative, smoother, window01, SEGMENTS, angleDelta, walkFrames, lerp,
} from './timeline.mjs';
import { createMapLayer } from './mapLayer';
import { createGlobeLayer } from './globeLayer';

const DEG = Math.PI / 180;

export const STAGE_COLORS = {
  sky: '#e8edf1',
  ink: '#0b1220',
  blue: '#0056f1',
  violet: '#7a1ff2',
  hot: '#0b1220',
  walk: '#0b1220',
  coast: '#8e9aa6',
  path: '#a7b1bc',
  water: '#7fa3c4',
  park: '#5f9873',
  globe: '#f3f5f7',
  globeRim: '#b9c4cf',
  core: '#0056f1',
};

export function createStage({ canvas, meta, assets, reducedMotion = false, isMobile = false, onFrame, onHeroReady, onError }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch (e) {
    onError && onError(e);
    return null;
  }
  const posterMode = typeof window !== 'undefined' && /[?&]poster\b/.test(window.location.search);
  const maxDpr = isMobile ? 1.6 : 1.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.autoClear = false;
  renderer.setClearColor(new THREE.Color(STAGE_COLORS.sky), 1);

  const uniforms = createPanoUniforms();
  srgb(STAGE_COLORS.sky, uniforms.uBg.value);
  srgb('#0a0e16', uniforms.uShade.value);
  const coreBlue = srgb(STAGE_COLORS.core);
  const coreInk = srgb('#0a0e16');
  // nadir: the planet's core sits at -0.37 rad; on foot (no vehicle in the
  // frame) the walk can lower the cap and lighten the floor shade
  const NADIR_PLANET = -0.37;
  const nadirWalk = meta.view && typeof meta.view.nadir === 'number' ? meta.view.nadir : NADIR_PLANET;
  const shadeWalk = meta.view && typeof meta.view.shade === 'number' ? meta.view.shade : 1;
  uniforms.uNadir.value = NADIR_PLANET;
  const panoMesh = createPanoMesh(uniforms, { transparent: true });
  const panoScene = new THREE.Scene();
  panoScene.add(panoMesh);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- frames used for walking start at the hero frame
  // heading: compass bearing of each panorama's image centre;
  // yaw: where the walking camera looks (defaults to the heading)
  const walk = walkFrames(meta);
  const walkCum = cumulative(walk);
  const walkHeadings = walk.map((f) => f.heading);
  const walkYaws = walk.map((f) => (typeof f.yaw === 'number' ? f.yaw : f.heading));
  const walkPos = walk.map((f) => new THREE.Vector3(f.x, 0, -f.y));
  const areaH = (meta.area && meta.area.h) || 46000;

  // ---- textures: blobs are prefetched, textures decoded on demand in a window
  const blobs = new Map();
  const blobJobs = new Map();
  const textures = new Map(); // index -> { tex, ready, used }
  let heroTexture = null;
  let disposed = false;

  function frameUrl(idx, size) { return assets.frameUrl(walk[idx].file, size); }

  function fetchBlob(idx) {
    if (blobs.has(idx)) return Promise.resolve(blobs.get(idx));
    if (blobJobs.has(idx)) return blobJobs.get(idx);
    const job = fetch(frameUrl(idx, '2k'), { credentials: 'omit' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then((b) => { blobs.set(idx, b); blobJobs.delete(idx); return b; })
      .catch((e) => { blobJobs.delete(idx); throw e; });
    blobJobs.set(idx, job);
    return job;
  }

  function ensureTexture(idx) {
    const t = textures.get(idx);
    if (t) { t.used = performance.now(); return t.ready ? t.tex : null; }
    const entry = { tex: null, ready: false, used: performance.now() };
    textures.set(idx, entry);
    fetchBlob(idx)
      .then((b) => textureFromBlob(renderer, b))
      .then((tex) => {
        if (disposed) { tex.dispose(); return; }
        entry.tex = tex; entry.ready = true;
      })
      .catch(() => { textures.delete(idx); });
    return null;
  }

  function evict(keep) {
    if (textures.size <= 6) return;
    const entries = [...textures.entries()].filter(([i]) => !keep.has(i)).sort((a, b) => a[1].used - b[1].used);
    while (textures.size > 6 && entries.length) {
      const [i, e] = entries.shift();
      if (e.tex) e.tex.dispose();
      textures.delete(i);
    }
  }

  function nearestReady(idx) {
    for (let d = 0; d < walk.length; d++) {
      for (const j of [idx - d, idx + d]) {
        if (j >= 0 && j < walk.length) {
          const t = textures.get(j);
          if (t && t.ready) return j;
        }
      }
    }
    return -1;
  }

  // hero texture: 4k on capable desktops, else 2k
  const heroSize = !isMobile && Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1) > 1500 ? '4k' : '2k';
  const heroStart = performance.now();
  fetch(frameUrl(0, heroSize), { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
    .then((b) => textureFromBlob(renderer, b))
    .then((tex) => {
      if (disposed) { tex.dispose(); return; }
      heroTexture = tex;
      textures.set(0, { tex, ready: true, used: performance.now(), pinned: true });
      revealAt = performance.now();
      onHeroReady && onHeroReady(performance.now() - heroStart);
      // prefetch the rest of the walk at low priority
      let k = 1;
      const next = () => {
        if (disposed || k >= walk.length) return;
        const idx = k++;
        fetchBlob(idx).catch(() => {}).finally(() => setTimeout(next, 30));
      };
      setTimeout(next, isMobile ? 1200 : 300);
      setTimeout(next, isMobile ? 1600 : 450);
    })
    .catch((e) => onError && onError(e));

  // ---- lazy layers
  let mapLayer = null;
  let mapLoading = false;
  let globeLayer = null;
  let globeLoading = false;

  function loadMap() {
    if (mapLoading) return;
    mapLoading = true;
    fetch(assets.coverageUrl).then((r) => r.json()).then((coverage) => {
      if (disposed) return;
      mapLayer = createMapLayer({ coverage, meta, colors: STAGE_COLORS });
    }).catch(() => { mapLoading = false; });
  }
  function loadGlobe() {
    if (globeLoading) return;
    globeLoading = true;
    fetch(assets.worldUrl).then((r) => r.json()).then((world) => {
      if (disposed) return;
      globeLayer = createGlobeLayer({ world, colors: STAGE_COLORS, focus: meta.origin });
    }).catch(() => { globeLoading = false; });
  }

  // ---- interaction: drag to look / spin the planet
  const look = { yaw: 0, pitch: 0, vyaw: 0, dragging: false, lastX: 0, lastY: 0, lastT: 0, pointerId: null, active: false };
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    look.dragging = true;
    look.pointerId = e.pointerId;
    look.lastX = e.clientX;
    look.lastY = e.clientY;
    look.lastT = performance.now();
    look.vyaw = 0;
    look.active = false;
  }
  function onMove(e) {
    if (!look.dragging || e.pointerId !== look.pointerId) return;
    const dx = e.clientX - look.lastX;
    const dy = e.clientY - look.lastY;
    if (!look.active) {
      // touch: only claim mostly-horizontal gestures, let vertical ones scroll
      if (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) { look.dragging = false; return; }
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      look.active = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    const now = performance.now();
    const h = canvas.clientHeight || 1;
    const degPerPx = (state.pano.planet > 0.5 ? 220 : uniformsVfov()) / h;
    look.yaw -= dx * degPerPx * (state.pano.planet > 0.5 ? -1 : 1);
    look.pitch = Math.max(-35, Math.min(35, look.pitch + dy * degPerPx * (state.pano.planet > 0.5 ? 0 : 1)));
    look.vyaw = (-dx * degPerPx * (state.pano.planet > 0.5 ? -1 : 1)) / Math.max(1, now - look.lastT) * 16;
    look.lastX = e.clientX;
    look.lastY = e.clientY;
    look.lastT = now;
  }
  function onUp(e) {
    if (e.pointerId !== look.pointerId) return;
    look.dragging = false;
    look.active = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  function uniformsVfov() { return 64; }

  // ---- main loop
  let progressTarget = 0;
  let progress = 0;
  let last = performance.now();
  let raf = 0;
  let revealAt = 0;
  let heroYawBase = walkYaws[0] - 180;
  let state = stageState(0, { walkHeadings: walkYaws, walkCum, heroYaw: heroYawBase, areaH });
  let width = 1;
  let height = 1;
  let visible = true;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w !== width || h !== height) {
      width = w; height = h;
      renderer.setSize(w, h, false);
    }
  }

  const portrait = () => width < 761 || width / Math.max(1, height) < 0.8;
  function heroRadius() {
    const aspect = width / Math.max(1, height);
    if (portrait()) return (0.36 * width) / Math.max(1, height);
    return Math.min(0.25, aspect * 0.55);
  }
  // On portrait screens the planet sits under the first headline line (see landing.module.css)
  function heroOffsetY() {
    if (!portrait()) return 0;
    const headerH = width < 761 ? 58 : 64;
    const fontPx = 0.126 * width;
    const rPx = heroRadius() * (height / 2) * 2.14; // visual radius incl. the faded skyline
    const cy = headerH + 14 + 0.95 * fontPx + 8 + rPx;
    return (height / 2 - cy) / (height / 2);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) return;
    resize();

    // damped progress follows the scroll without hijacking it
    if (reducedMotion) progress = progressTarget;
    else progress += (progressTarget - progress) * (1 - Math.exp(-dt * 7));
    if (Math.abs(progressTarget - progress) < 1e-5) progress = progressTarget;

    // idle spin of the planet + inertia
    if (!look.dragging) {
      look.yaw += look.vyaw;
      look.vyaw *= Math.exp(-dt * 3.2);
      if (!reducedMotion && !posterMode && progress < SEGMENTS.dive[1]) heroYawBase += dt * 4.5;
      // ease look offsets back to the travel direction once the user scrolls the walk
      if (progress > SEGMENTS.walk[0] && progress < SEGMENTS.lift[0]) {
        look.pitch *= Math.exp(-dt * 0.6);
      }
    }

    state = stageState(progress, {
      walkHeadings: walkYaws,
      walkCum,
      heroYaw: heroYawBase + look.yaw,
      heroRadius: heroRadius(),
      streetVfov: width < height ? 78 : 64,
      areaH,
    });

    if (progress > SEGMENTS.walk[0] - 0.04) loadMap();
    if (progress > SEGMENTS.city[0] - 0.02) loadGlobe();

    // reveal: planet grows from a point when the hero texture lands
    const rv = revealAt ? smoother(Math.min(1, (now - revealAt) / (reducedMotion ? 1 : 1300))) : 0;

    renderer.setViewport(0, 0, width, height);
    renderer.clear();

    if (state.globe.visible && globeLayer) {
      globeLayer.update(state, dt, width, height, renderer.getPixelRatio());
      renderer.render(globeLayer.scene, globeLayer.camera);
    }
    let mapInfo = null;
    if (state.map.visible && mapLayer) {
      mapInfo = mapLayer.update(state, dt, width, height);
      renderer.render(mapLayer.scene, mapLayer.camera);
    }

    const P = state.pano;
    let planetPx = null;
    if (P.visible && heroTexture) {
      // pick panoramas
      const i = Math.min(P.frame, walk.length - 1);
      const j = Math.min(i + 1, walk.length - 1);
      let a = ensureTexture(i) ? i : nearestReady(i);
      const bReady = ensureTexture(j);
      ensureTexture(Math.min(j + 1, walk.length - 1));
      ensureTexture(Math.min(j + 2, walk.length - 1));
      if (a < 0) a = 0;
      evict(new Set([0, a, i, j, j + 1, j + 2]));
      const texA = (textures.get(a) || textures.get(0)).tex;
      const cam = walkPos[i].clone().lerp(walkPos[j], P.tau);
      uniforms.uTexA.value = texA;
      uniforms.uHeadA.value = walkHeadings[a] * DEG;
      uniforms.uOffA.value.copy(cam).sub(walkPos[a]);
      const mixW = smoother(window01(P.tau, 0.18, 0.82));
      if (bReady && j !== a && mixW > 0) {
        uniforms.uTexB.value = textures.get(j).tex;
        uniforms.uHeadB.value = walkHeadings[j] * DEG;
        uniforms.uOffB.value.copy(cam).sub(walkPos[j]);
        uniforms.uMix.value = mixW;
      } else {
        uniforms.uTexB.value = texA;
        uniforms.uMix.value = 0;
      }

      const grow = posterMode ? 1 : 0.82 + 0.18 * rv;
      const radius = P.radius * (state.segment === 'hero' || state.segment === 'dive' ? grow : 1);
      const lookYaw = P.planet > 0.5 ? 0 : look.yaw;
      const lookPitch = P.planet > 0.5 ? 0 : look.pitch;
      const yaw = state.segment === 'hero' || state.segment === 'dive' ? P.yaw : P.yaw + lookYaw;
      setViewBasis(uniforms, yaw, Math.max(-90, Math.min(89, P.pitch + lookPitch)));
      const ke = setProjection(uniforms, { planet: P.planet, vfov: P.vfov, planetRadius: radius, gamma: 0.6 });
      setPlanetFade(uniforms, P.planet);
      uniforms.uViewport.value.set(0, 0, width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
      uniforms.uCoreAmt.value = P.core;
      uniforms.uRingAmt.value = P.ring;
      uniforms.uCoreSoft.value = P.coreSoft;
      uniforms.uCore.value.copy(coreBlue).lerp(coreInk, P.coreInk);
      const onFoot = 1 - smoother(P.planet);
      uniforms.uNadir.value = lerp(NADIR_PLANET, nadirWalk, onFoot);
      uniforms.uShadeAmt.value = P.shade * lerp(1, shadeWalk, onFoot);
      uniforms.uAlphaOut.value = P.alphaOut ? 1 : 0;
      uniforms.uOpacity.value = P.opacity * (revealAt ? 1 : 0);
      const heroPhase = state.segment === 'hero' || state.segment === 'dive';
      const offY = heroPhase ? heroOffsetY() * P.planet : 0;
      uniforms.uCenter.value.set(0, offY);
      renderer.render(panoScene, orthoCam);
      planetPx = { x: width / 2, y: height / 2 - offY * (height / 2), r: radius * (height / 2), core: ke };
    }

    onFrame && onFrame({ progress, state, planetPx, mapInfo, reveal: rv, walkCount: walk.length });
  }

  function setProgress(p) { progressTarget = Math.min(1, Math.max(0, p)); }
  function setVisible(v) { visible = v; if (v) last = performance.now(); }
  function nudge(deg) { look.vyaw += deg; }

  raf = requestAnimationFrame(frame);

  function destroy() {
    disposed = true;
    cancelAnimationFrame(raf);
    canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    textures.forEach((t) => t.tex && t.tex.dispose());
    if (mapLayer) mapLayer.dispose();
    if (globeLayer) globeLayer.dispose();
    panoMesh.geometry.dispose();
    panoMesh.material.dispose();
    renderer.dispose();
  }

  return { setProgress, setVisible, nudge, destroy, walk, walkCum, angleDelta };
}
