// Runtime helpers for camera moves on the Atlas map: a frame-by-frame flight
// along a planned path (camera.mjs), awaitable map easing, and waiting for the
// map or an image source to be ready. Every move can be interrupted by the user.
import { cameraForEye } from './camera.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INPUTS = ['wheel', 'pointerdown', 'touchstart', 'dblclick'];

/**
 * Fly the map camera along `plan` (planFlight). Resolves true when it arrives,
 * false when the user grabs the map or `cancel()` is called.
 */
export function runFlight(map, plan, { height, reduced = false, onFrame } = {}) {
  let raf = 0;
  let finished = false;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const el = map.getCanvasContainer();
  const duration = reduced ? 0 : plan.duration * 1000;
  const t0 = performance.now();
  const onInput = () => stop(false);
  function stop(ok) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    INPUTS.forEach((n) => el.removeEventListener(n, onInput));
    resolve(ok);
  }
  INPUTS.forEach((n) => el.addEventListener(n, onInput, { passive: true }));
  function step(now) {
    const t = duration ? Math.min(1, (now - t0) / duration) : 1;
    const eye = plan.at(t);
    const cam = cameraForEye(eye, height());
    map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing });
    if (onFrame) onFrame(eye, t);
    if (t >= 1) stop(true);
    else raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
  return { promise, cancel: () => stop(false) };
}

/** map.easeTo that can be awaited; resolves when the move ends (or is interrupted). */
export function easeCamera(map, options, { reduced = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); map.off('moveend', finish); resolve(); };
    const duration = reduced ? 0 : options.duration != null ? options.duration : 1200;
    // stopping a running ease fires its moveend at once; do that before listening for ours
    map.stop();
    const timer = setTimeout(finish, duration + 400);
    map.once('moveend', finish);
    map.easeTo({ ...options, duration, easing: options.easing || ((t) => t * t * t * (t * (t * 6 - 15) + 10)) });
  });
}

/** Resolves when the map has drawn everything it needs, or after `timeout` ms. */
export function mapIdle(map, timeout = 800) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); map.off('idle', finish); resolve(); };
    const timer = setTimeout(finish, timeout);
    map.once('idle', finish);
    map.triggerRepaint();
  });
}

/** Load a new picture into an image source; resolves after the map has drawn with it. */
export async function loadImageSource(map, sourceId, url, coordinates, timeout = 5000) {
  const src = map.getSource(sourceId);
  if (!src) return false;
  // an image source ignores updates until its first picture has arrived
  if (!src.image) await waitFor(() => !!src.image, 2500);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('sourcedata', onData);
      // the texture is uploaded on the next frame
      map.once('render', () => resolve(ok));
      map.triggerRepaint();
    };
    const onData = (e) => { if (e.sourceId === sourceId && e.sourceDataType === 'metadata') finish(true); };
    const timer = setTimeout(() => finish(false), timeout);
    map.on('sourcedata', onData);
    src.updateImage({ url, coordinates });
  });
}

/** Resolves with the value once `test()` is truthy (checked every frame), or null after `timeout` ms. */
export function waitFor(test, timeout = 8000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const v = test();
      if (v) resolve(v);
      else if (performance.now() - t0 > timeout) resolve(null);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}
