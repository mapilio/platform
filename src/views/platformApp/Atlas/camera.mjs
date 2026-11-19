// One camera for the whole Atlas. The street photo, the drone photo and the 3D
// survey are not separate screens: they are places the map camera flies to.
// These functions convert between Mapbox GL camera options and an "eye"
// (position, height above the ground, heading, tilt) and plan smooth flights
// between eyes. Pure, unit-tested in tests/atlas-camera.test.mjs.

/** Mapbox GL JS 2.x vertical field of view: tan(fov / 2) = 1/3. */
export const MAP_VFOV = 36.86989764584402;
/** Height of the walk viewer's camera above the ground, in metres. */
export const EYE_HEIGHT = 2;
/** The steepest Mapbox camera: 5 degrees below the horizon. */
export const STREET_PITCH = 85;
/** The walk-viewer pitch that matches it (negative looks down). */
export const STREET_LOOK = STREET_PITCH - 90;
/** How close the camera may get to what it looks at; at street level this is the final distance. */
export const MIN_LOOK_DIST = EYE_HEIGHT / Math.cos((STREET_PITCH * Math.PI) / 180);

const HALF_TAN = Math.tan((MAP_VFOV * Math.PI) / 360);
const EARTH_CIRC = 40075016.686;
const R = 6378137;
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const win = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

/** Smootherstep: zero velocity and acceleration at both ends. */
export function smoother(t) {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Signed shortest turn from bearing a to bearing b, in degrees (-180, 180]. */
export function shortestAngle(a, b) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Metres per CSS pixel on 512-px Mapbox tiles. */
export function metresPerPixel(zoom, lat) {
  return (EARTH_CIRC * Math.cos(lat * DEG)) / (512 * 2 ** zoom);
}

export function offsetLngLat(lng, lat, east, north) {
  const lat2 = lat + north / R / DEG;
  return [lng + east / (R * Math.cos(((lat + lat2) / 2) * DEG)) / DEG, lat2];
}

/** East and north metres from a to b (local approximation, fine within tens of km). */
export function metresBetween(a, b) {
  const k = Math.cos(((a.lat + b.lat) / 2) * DEG);
  return { east: (b.lng - a.lng) * DEG * R * k, north: (b.lat - a.lat) * DEG * R };
}

/** Distance from the Mapbox camera to the point it looks at, in CSS pixels. */
export function cameraDistancePx(viewportHeight) {
  return (0.5 * viewportHeight) / HALF_TAN;
}

/** Mapbox camera options that put the eye at a position and height, facing `bearing`, tilted `pitch`. */
export function cameraForEye(eye, viewportHeight) {
  const pitch = clamp(eye.pitch, 0, STREET_PITCH);
  const p = pitch * DEG;
  const b = eye.bearing * DEG;
  const dist = eye.alt / Math.cos(p);
  const ahead = eye.alt * Math.tan(p);
  const [lng, lat] = offsetLngLat(eye.lng, eye.lat, Math.sin(b) * ahead, Math.cos(b) * ahead);
  const mpp = dist / cameraDistancePx(viewportHeight);
  const zoom = Math.log2((EARTH_CIRC * Math.cos(lat * DEG)) / (512 * mpp));
  return { center: [lng, lat], zoom, pitch, bearing: ((eye.bearing % 360) + 360) % 360 };
}

/** The eye of a Mapbox camera: where it is, how high, which way it faces. */
export function eyeForCamera(cam, viewportHeight) {
  const [lng, lat] = cam.center;
  const dist = cameraDistancePx(viewportHeight) * metresPerPixel(cam.zoom, lat);
  const p = cam.pitch * DEG;
  const b = cam.bearing * DEG;
  const back = dist * Math.sin(p);
  const [elng, elat] = offsetLngLat(lng, lat, -Math.sin(b) * back, -Math.cos(b) * back);
  return { lng: elng, lat: elat, alt: dist * Math.cos(p), bearing: ((cam.bearing % 360) + 360) % 360, pitch: cam.pitch };
}

/**
 * Shallowest tilt for an eye at `alt`: low down the camera has to look ahead
 * rather than at its feet, or the map would have to zoom in without limit. A
 * smooth version of acos(alt / minDist): no tilt high up, the street view's tilt
 * at eye height, and no sudden lift in between.
 */
export function minPitchFor(alt, minDist = MIN_LOOK_DIST) {
  const a = Math.max(1e-3, alt);
  // a smooth maximum of the height and minDist
  const d = Math.max(a, minDist) * (1 + (Math.min(a, minDist) / Math.max(a, minDist)) ** 12) ** (1 / 12);
  const p = Math.acos(Math.min(1, a / d)) / DEG;
  return p < 0.1 ? 0 : Math.min(STREET_PITCH, p);
}

/** The eye of someone standing at a street photo. */
export function streetEye(frame, yaw) {
  return { lng: frame.lng, lat: frame.lat, alt: EYE_HEIGHT, bearing: yaw, pitch: STREET_PITCH };
}

/**
 * A flight between two eyes. Height changes on a log scale (each halving takes
 * about the same time, so the ground approaches at a steady pace). Sideways
 * travel is spent where the camera is high: going down it arrives above the
 * target before it gets low, going up it leaves vertically and travels once it
 * is high, which keeps the speed on screen even. Low down the tilt follows the
 * height (minPitchFor), so the gaze settles on the horizon as you land. A
 * target far away compared with the height adds a climb, like map flyTo.
 */
export function planFlight(from, to, { speed = 1 } = {}) {
  const C = 5; // metres added before taking logs, so the last metres are not rushed
  const d = metresBetween(from, to);
  const dist = Math.hypot(d.east, d.north);
  const a0 = Math.max(0.5, from.alt);
  const a1 = Math.max(0.5, to.alt);
  const l0 = Math.log(a0 + C);
  const l1 = Math.log(a1 + C);
  const bump = Math.max(0, Math.log((dist * 0.6) / Math.max(a0, a1)));
  const db = shortestAngle(from.bearing, to.bearing);
  const descending = to.pitch > from.pitch + 15 || (a1 < a0 * 0.25 && to.pitch >= 60);
  const rising = !descending && (from.pitch > to.pitch + 15 || (a1 > a0 * 4 && from.pitch >= 60));
  const ease = (t) => t * t * (3 - 2 * t);
  // a flat camera already very low (zoomed far into the map) is lifted into the tilt gradually
  const d0 = Math.max(0, minPitchFor(a0) - clamp(from.pitch, 0, STREET_PITCH));
  const d1 = Math.max(0, minPitchFor(a1) - clamp(to.pitch, 0, STREET_PITCH));
  const altAt = (t) => Math.exp(l0 + (l1 - l0) * ease(t) + bump * Math.sin(Math.PI * t)) - C;
  // sideways progress: the integral of height times a bell-shaped weight
  const N = 240;
  const cum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const t = (i - 0.5) / N;
    cum[i] = cum[i - 1] + (altAt(t) + C) * 6 * t * (1 - t);
  }
  const travel = (t) => {
    const x = clamp(t, 0, 1) * N;
    const i = Math.min(N - 1, Math.floor(x));
    return (cum[i] + (cum[i + 1] - cum[i]) * (x - i)) / cum[N];
  };
  const turn = Math.abs(db) / 180;
  const duration = clamp(
    (1.0 + 0.24 * Math.abs(l1 - l0) + 0.45 * bump + Math.min(0.8, dist / 700) + 0.35 * turn) / speed,
    0.55,
    4.4,
  );

  function at(t) {
    if (t <= 0) return { ...from, pitch: clamp(from.pitch, 0, STREET_PITCH) };
    if (t >= 1) return { ...to, pitch: clamp(to.pitch, 0, STREET_PITCH), bearing: ((to.bearing % 360) + 360) % 360 };
    const alt = altAt(t);
    const h = travel(t);
    // tilt: going down keep looking down, then lift the gaze; going up level out early
    let sched;
    if (descending) sched = from.pitch + (to.pitch - from.pitch) * smoother(win(t, 0.45, 1));
    else if (rising) sched = from.pitch + (to.pitch - from.pitch) * smoother(win(t, 0, 0.55));
    else sched = from.pitch + (to.pitch - from.pitch) * smoother(t);
    const pitch = clamp(Math.max(sched, minPitchFor(alt)) - d0 * (1 - smoother(win(t, 0, 0.3))) - d1 * smoother(win(t, 0.7, 1)), 0, STREET_PITCH);
    const bearing = (((from.bearing + db * smoother(win(t, 0.08, 0.92))) % 360) + 360) % 360;
    return { lng: from.lng + (to.lng - from.lng) * h, lat: from.lat + (to.lat - from.lat) * h, alt, pitch, bearing };
  }
  return { duration, at, dist, descending, rising };
}

/**
 * Camera that lays a drone photo flat on the map exactly as the drone saw it:
 * straight down, the photo's top towards the top of the screen, fitted into the
 * free area between the interface insets.
 */
export function photoCamera(shot, { width, height, top = 0, bottom = 0, left = 0, right = 0 }, margin = 1.04) {
  const fp = shot.footprint; // image corners on the ground: top-left, top-right, bottom-right, bottom-left
  const mid = (a, b) => ({ lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 });
  const upper = mid(fp[0], fp[1]);
  const lower = mid(fp[3], fp[2]);
  const ref = { lng: (upper.lng + lower.lng) / 2, lat: (upper.lat + lower.lat) / 2 };
  // "up" is the photo's centre line, bottom edge to top edge, as it lies on the ground
  const up = metresBetween(lower, upper);
  const bearing = ((Math.atan2(up.east, up.north) / DEG) + 360) % 360;
  const b = bearing * DEG;
  const cos = Math.cos(b);
  const sin = Math.sin(b);
  // corners in screen axes (metres): x to the right, y downwards
  const pts = fp.map(([lng, lat]) => {
    const g = metresBetween(ref, { lng, lat });
    return { x: g.east * cos - g.north * sin, y: -(g.east * sin + g.north * cos) };
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const availW = Math.max(120, width - left - right);
  const availH = Math.max(120, height - top - bottom);
  const mpp = Math.max((maxX - minX) / availW, (maxY - minY) / availH) * margin;
  // the photo's box goes to the middle of the free area, not of the screen
  const sx = (minX + maxX) / 2 - ((left - right) / 2) * mpp;
  const sy = (minY + maxY) / 2 - ((top - bottom) / 2) * mpp;
  const [lng, lat] = offsetLngLat(ref.lng, ref.lat, sx * cos - sy * sin, -sx * sin - sy * cos);
  const zoom = Math.log2((EARTH_CIRC * Math.cos(lat * DEG)) / (512 * mpp));
  return { center: [lng, lat], zoom, pitch: 0, bearing };
}

/** An oblique view of the whole survey for the 3D reconstruction. */
export function surveyCamera(site, { width, height }, bearing = -32, pitch = 58) {
  const [w0, s0, e0, n0] = site.ortho.local || [-60, -50, 60, 50];
  const size = Math.max(e0 - w0, n0 - s0);
  const mpp = Math.max(size / (width * 0.6), size / (height * 0.62));
  const zoom = Math.log2((EARTH_CIRC * Math.cos(site.centre.lat * DEG)) / (512 * mpp)) - 0.15;
  return { center: [site.centre.lng, site.centre.lat], zoom, pitch, bearing: ((bearing % 360) + 360) % 360 };
}

/** The straight-down view of the whole survey (the map with its orthophoto). */
export function surveyTopCamera(site, { width, height }) {
  const [w0, s0, e0, n0] = site.ortho.local || [-60, -50, 60, 50];
  const mpp = Math.max((e0 - w0) / (width * 0.62), (n0 - s0) / (height * 0.62));
  const zoom = Math.log2((EARTH_CIRC * Math.cos(site.centre.lat * DEG)) / (512 * mpp));
  return { center: [site.centre.lng, site.centre.lat], zoom, pitch: 0, bearing: 0 };
}
