// Walk viewer engine: one shader pass (lib/street/panoShader), textures streamed
// from the image CDN at increasing resolution, a camera that travels along the
// sequence polyline, ground picking and screen projection for overlays.
import * as THREE from 'three';
import {
  createPanoUniforms, createPanoMesh, setViewBasis, setProjection, setPlanetFade, textureFromBlob, srgb, angleDelta,
} from 'lib/street/panoShader';
import { imageUrl } from './sequence.mjs';

const DEG = Math.PI / 180;
const CAM_H = 2.0;
const smoother = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * x * (x * (x * 6 - 15) + 10); };
const win = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

export function createWalkViewer({
  canvas, frames, imageBase, startIndex = 0, startYaw = null, startPitch = 0, startVfov = null, isMobile = false, onChange, onWalk, onFrameError,
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 1.75));
  renderer.setClearColor(new THREE.Color('#0a0e16'), 1);
  const uniforms = createPanoUniforms();
  srgb('#0a0e16', uniforms.uBg.value);
  srgb('#0a0e16', uniforms.uVoid.value);
  srgb('#0a0e16', uniforms.uShade.value);
  srgb('#0056f1', uniforms.uCore.value);
  uniforms.uH.value = CAM_H;
  uniforms.uBowl.value = 16;
  uniforms.uNadir.value = -0.42;
  const mesh = createPanoMesh(uniforms, { transparent: false });
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const pos = frames.map((f) => new THREE.Vector3(f.east, 0, -f.north));
  const cum = frames.map((f) => f.cum);
  const total = cum[cum.length - 1] || 0;
  const maxHeight = !isMobile && (window.devicePixelRatio || 1) * window.innerHeight > 1000 ? 2080 : 1080;

  // ---------------------------------------------------------------- textures
  const tex = new Map(); // i -> { size, texture, loading: Set, failed }
  const queue = [];
  const ctrls = new Set();
  let inflight = 0;
  let disposed = false;

  function entry(i) {
    if (!tex.has(i)) tex.set(i, { size: 0, texture: null, loading: new Set(), failed: false, used: 0 });
    return tex.get(i);
  }
  function want(i, size, priority) {
    if (i < 0 || i >= frames.length) return;
    const e = entry(i);
    e.used = performance.now();
    if (e.failed || e.size >= size || e.loading.has(size)) return;
    if (queue.some((q) => q.i === i && q.size === size)) return;
    queue.push({ i, size, priority });
    queue.sort((a, b) => a.priority - b.priority);
    pump();
  }
  function pump() {
    if (disposed) return;
    while (inflight < 3 && queue.length) {
      const job = queue.shift();
      const e = entry(job.i);
      if (e.size >= job.size || e.failed) continue;
      inflight++;
      e.loading.add(job.size);
      const ctrl = new AbortController();
      ctrls.add(ctrl);
      const timer = setTimeout(() => ctrl.abort(), job.size >= 2080 ? 25000 : 15000);
      fetch(imageUrl(imageBase, frames[job.i], job.size), { signal: ctrl.signal, credentials: 'omit' })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
        .then((b) => { if (disposed) throw new Error('disposed'); return textureFromBlob(renderer, b, { wrap: frames[job.i].pano }); })
        .then((t) => {
          if (disposed) { t.dispose(); return; }
          if (e.size < job.size) {
            if (e.texture) e.texture.dispose();
            e.texture = t;
            e.size = job.size;
            dirty = true;
          } else t.dispose();
        })
        .catch(() => {
          if (disposed) return;
          if (!e.texture && job.size <= 1080) { e.failed = true; onFrameError && onFrameError(job.i); dirty = true; }
        })
        .finally(() => {
          ctrls.delete(ctrl);
          clearTimeout(timer);
          e.loading.delete(job.size);
          inflight--;
          pump();
        });
    }
  }
  function evict(keep) {
    if (tex.size <= 10) return;
    [...tex.entries()]
      .filter(([i]) => !keep.has(i))
      .sort((a, b) => a[1].used - b[1].used)
      .slice(0, tex.size - 10)
      .forEach(([i, e]) => { if (e.texture) e.texture.dispose(); if (!e.loading.size) tex.delete(i); });
  }
  function ready(i) { const e = tex.get(i); return e && e.texture ? e : null; }
  function nearestReady(i) {
    for (let d = 0; d < frames.length; d++) {
      for (const j of [i - d, i + d]) if (j >= 0 && j < frames.length && ready(j)) return j;
    }
    return -1;
  }

  // ------------------------------------------------------------------ camera
  const baseVfov = isMobile ? 82 : 72;
  const view = {
    s: cum[startIndex] || 0,
    yaw: startYaw != null ? startYaw : frames[startIndex]?.heading || 0,
    pitch: startPitch || 0,
    vfov: startVfov || baseVfov,
    planet: 0,
    planetTarget: 0,
    playing: false,
    speed: 1,
    follow: false,
  };
  let anim = null; // { from, to, t0, dur }
  let viewAnim = null; // { from: {yaw, pitch, vfov}, to, t0, dur, ease }
  let dirty = true;
  let lastIndex = startIndex;
  let restSince = performance.now();

  function locate(s) {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] <= s) i++;
    const span = cum[i + 1] - cum[i];
    const tau = span > 1e-6 ? Math.min(1, Math.max(0, (s - cum[i]) / span)) : 0;
    return { i, tau };
  }
  function indexAt(s) { const { i, tau } = locate(s); return tau > 0.5 ? Math.min(i + 1, frames.length - 1) : i; }
  function travelHeading(i) {
    const a = frames[Math.max(0, i)];
    const b = frames[Math.min(frames.length - 1, i + 1)];
    if (a === b) return a.heading || 0;
    return (Math.atan2(b.east - a.east, b.north - a.north) / DEG + 360) % 360;
  }

  function goTo(index, { duration } = {}) {
    const j = Math.max(0, Math.min(frames.length - 1, index));
    const to = cum[j];
    const d = Math.abs(to - view.s);
    if (d < 0.01) return;
    const dur = duration != null ? duration : Math.min(2.4, Math.max(0.5, d / 11));
    anim = { from: view.s, to, t0: performance.now(), dur: dur * 1000 };
    want(j, 1080, 0);
    dirty = true;
  }
  function step(dir) {
    // forward means the neighbour closest to where you are looking
    const i = indexAt(view.s);
    const fwd = Math.abs(angleDelta(view.yaw, travelHeading(i))) <= 90 ? 1 : -1;
    goTo(i + dir * fwd);
  }
  function teleport(index) {
    const j = Math.max(0, Math.min(frames.length - 1, index));
    anim = null;
    view.s = cum[j];
    want(j, 480, -1);
    want(j, 1080, 0);
    dirty = true;
  }

  // ------------------------------------------------------------- projection
  const basis = { r: new THREE.Vector3(), u: new THREE.Vector3(), f: new THREE.Vector3() };
  function updateBasis() {
    basis.r.copy(uniforms.uRight.value);
    basis.u.copy(uniforms.uUp.value);
    basis.f.copy(uniforms.uFwd.value);
  }
  function camWorld() {
    const { i, tau } = locate(view.s);
    return pos[i].clone().lerp(pos[Math.min(i + 1, pos.length - 1)], tau);
  }
  /** screen -> ground point (local east/north) in street mode */
  function pickGround(clientX, clientY) {
    if (view.planet > 0.05) return null;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const px = (((clientX - rect.left) / rect.width) * 2 - 1) * aspect;
    const py = 1 - ((clientY - rect.top) / rect.height) * 2;
    const t = uniforms.uT.value;
    const dv = new THREE.Vector3(px * t, py * t, 1).normalize();
    const d = basis.r.clone().multiplyScalar(dv.x).add(basis.u.clone().multiplyScalar(dv.y)).add(basis.f.clone().multiplyScalar(dv.z));
    if (d.y > -0.02) return null;
    const dist = -CAM_H / d.y;
    if (dist > 80) return null;
    const c = camWorld();
    const hit = c.clone().add(d.multiplyScalar(dist));
    return { east: hit.x, north: -hit.z, dist };
  }
  /** local east/north (+ height above ground) -> screen px, or null if behind */
  function project(east, north, height = 0) {
    if (view.planet > 0.05) return null;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const c = camWorld();
    const v = new THREE.Vector3(east - c.x, height - CAM_H, -north - c.z);
    const z = v.dot(basis.f);
    if (z < 0.4) return null;
    const t = uniforms.uT.value;
    const x = v.dot(basis.r) / z / t / aspect;
    const y = v.dot(basis.u) / z / t;
    return { x: (x * 0.5 + 0.5) * rect.width, y: (1 - (y * 0.5 + 0.5)) * rect.height, z };
  }

  // ------------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let width = 0;
  let height = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w !== width || h !== height) { width = w; height = h; renderer.setSize(w, h, false); dirty = true; }

    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      view.s = anim.from + (anim.to - anim.from) * smoother(t);
      if (t >= 1) anim = null;
      dirty = true;
    } else if (view.playing) {
      view.s += dt * 7 * view.speed;
      if (view.s >= total) { view.s = total; view.playing = false; }
      dirty = true;
    }
    if (view.follow || view.playing) {
      const { i, tau } = locate(view.s);
      const target = travelHeading(i) + angleDelta(travelHeading(i), travelHeading(Math.min(i + 1, frames.length - 2))) * tau;
      view.yaw += angleDelta(view.yaw, target) * (1 - Math.exp(-dt * 2.5));
      dirty = true;
    }
    if (viewAnim) {
      const t = Math.min(1, (now - viewAnim.t0) / viewAnim.dur);
      const e = viewAnim.ease(t);
      const { from: a, to: b } = viewAnim;
      if (b.yaw != null) view.yaw = (a.yaw + angleDelta(a.yaw, b.yaw) * e + 360) % 360;
      if (b.pitch != null) view.pitch = a.pitch + (b.pitch - a.pitch) * e;
      if (b.vfov != null) view.vfov = a.vfov + (b.vfov - a.vfov) * e;
      if (t >= 1) viewAnim = null;
      dirty = true;
    }
    if (Math.abs(view.planetTarget - view.planet) > 0.001) {
      view.planet += (view.planetTarget - view.planet) * (1 - Math.exp(-dt * 4));
      if (Math.abs(view.planetTarget - view.planet) < 0.002) view.planet = view.planetTarget;
      dirty = true;
    }

    const { i, tau } = locate(view.s);
    const j = Math.min(i + 1, frames.length - 1);
    // streaming priorities
    want(i, 480, 0);
    want(i, 1080, 1);
    want(j, 1080, 2);
    want(j + 1, 1080, 4);
    want(i - 1, 1080, 5);
    want(j + 2, 1080, 6);
    const moving = !!anim || view.playing;
    if (moving) restSince = now;
    const idx = tau > 0.5 ? j : i;
    if (!moving && now - restSince > 600 && maxHeight > 1080) want(idx, maxHeight, 3);
    evict(new Set([i, j, j + 1, j + 2, i - 1]));

    if (idx !== lastIndex) {
      const metres = Math.abs(cum[idx] - cum[lastIndex]);
      lastIndex = idx;
      onWalk && onWalk(metres, idx);
      onChange && onChange();
    }
    if (!dirty) return;
    dirty = false;

    let a = ready(i) ? i : nearestReady(i);
    if (a < 0) { renderer.clear(); onChange && onChange(); return; }
    const camPos = pos[i].clone().lerp(pos[j], tau);
    const A = ready(a);
    uniforms.uTexA.value = A.texture;
    uniforms.uHeadA.value = frames[a].heading * DEG;
    uniforms.uOffA.value.copy(camPos).sub(pos[a]);
    uniforms.uPerspA.value = frames[a].pano ? 0 : 1;
    if (!frames[a].pano) uniforms.uTanA.value.set(frames[a].tan.x, frames[a].tan.y);
    const B = j !== a ? ready(j) : null;
    const mixW = smoother(win(tau, 0.15, 0.85));
    if (B && mixW > 0) {
      uniforms.uTexB.value = B.texture;
      uniforms.uHeadB.value = frames[j].heading * DEG;
      uniforms.uOffB.value.copy(camPos).sub(pos[j]);
      uniforms.uPerspB.value = frames[j].pano ? 0 : 1;
      if (!frames[j].pano) uniforms.uTanB.value.set(frames[j].tan.x, frames[j].tan.y);
      uniforms.uMix.value = mixW;
    } else {
      uniforms.uTexB.value = A.texture;
      uniforms.uMix.value = 0;
    }
    const aspect = width / Math.max(1, height);
    const planetR = Math.min(0.42, aspect * 0.42);
    setViewBasis(uniforms, view.yaw, view.pitch + (-90 - view.pitch) * smoother(view.planet));
    setProjection(uniforms, { planet: view.planet, vfov: view.vfov, planetRadius: planetR, gamma: 0.6 });
    setPlanetFade(uniforms, view.planet);
    const pano = frames[a].pano;
    uniforms.uCoreAmt.value = pano ? 1 : 0;
    uniforms.uCoreSoft.value = 0.012 + (1 - view.planet) * 0.2;
    uniforms.uRingAmt.value = pano ? view.planet : 0;
    srgb(view.planet > 0.5 ? '#0056f1' : '#0a0e16', uniforms.uCore.value);
    uniforms.uShadeAmt.value = pano ? 0.5 * (1 - view.planet) : 0;
    uniforms.uViewport.value.set(0, 0, width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
    updateBasis();
    renderer.render(scene, cam);
    onChange && onChange();
  }
  raf = requestAnimationFrame(frame);
  teleport(startIndex);

  function getState() {
    const { i, tau } = locate(view.s);
    const idx = tau > 0.5 ? Math.min(i + 1, frames.length - 1) : i;
    const c = camWorld();
    const e = tex.get(idx);
    return {
      index: idx, i, tau, s: view.s, total, east: c.x, north: -c.z,
      yaw: ((view.yaw % 360) + 360) % 360, pitch: view.pitch, vfov: view.vfov,
      planet: view.planetTarget > 0.5, playing: view.playing, speed: view.speed, moving: !!anim || view.playing,
      loadedSize: e ? e.size : 0, failed: !!(e && e.failed), hasAny: [...tex.values()].some((x) => x.texture),
      baseVfov, animating: !!viewAnim,
    };
  }

  return {
    goTo, step, teleport, pickGround, project, getState,
    look(dxDeg, dyDeg) {
      viewAnim = null;
      view.yaw = (view.yaw + dxDeg + 360) % 360;
      view.pitch = Math.max(-60, Math.min(60, view.pitch + dyDeg));
      view.follow = false;
      dirty = true;
    },
    setYaw(y) { view.yaw = y; dirty = true; },
    zoom(delta) { viewAnim = null; view.vfov = Math.max(30, Math.min(100, view.vfov + delta)); dirty = true; },
    /** Ease the view to { yaw, pitch, vfov } (any subset) over `ms`; `ease` 'out' decelerates only. */
    animateView(target, ms = 600, ease = 'inOut') {
      const fn = ease === 'out' ? (t) => 1 - (1 - t) ** 3 : smoother;
      const to = { ...target };
      if (to.pitch != null) to.pitch = Math.max(-60, Math.min(60, to.pitch));
      if (to.vfov != null) to.vfov = Math.max(25, Math.min(100, to.vfov));
      viewAnim = { from: { yaw: view.yaw, pitch: view.pitch, vfov: view.vfov }, to, t0: performance.now(), dur: Math.max(16, ms), ease: fn };
      view.follow = false;
      dirty = true;
    },
    setPlanet(on) { view.planetTarget = on ? 1 : 0; dirty = true; },
    play(on, speed) {
      view.playing = on;
      if (speed) view.speed = speed;
      if (on && view.s >= total - 0.01) view.s = 0;
      view.follow = on;
      dirty = true;
    },
    setSpeed(sp) { view.speed = sp; },
    seek(s) { anim = null; view.s = Math.max(0, Math.min(total, s)); dirty = true; },
    invalidate() { dirty = true; },
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      queue.length = 0;
      ctrls.forEach((c) => c.abort());
      tex.forEach((e) => e.texture && e.texture.dispose());
      mesh.geometry.dispose();
      mesh.material.dispose();
      renderer.dispose();
      // each street visit makes a new viewer; give its WebGL context back at once
      renderer.forceContextLoss();
    },
  };
}
