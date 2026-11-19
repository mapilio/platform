// Pure mapping from story progress (0..1) to stage state. No DOM, no three.js,
// so it can be unit-tested with node --test.

export const SEGMENTS = {
  hero: [0.0, 0.06],
  dive: [0.06, 0.15],
  walk: [0.15, 0.45],
  lift: [0.45, 0.56],
  drone: [0.56, 0.68],
  city: [0.68, 0.85],
  world: [0.85, 1.0],
};

export const ORDER = ['hero', 'dive', 'walk', 'lift', 'drone', 'city', 'world'];

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
export const smoother = (t) => { const x = clamp01(t); return x * x * x * (x * (x * 6 - 15) + 10); };
export const loglerp = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));
export const local = (name, p) => { const [a, b] = SEGMENTS[name]; return clamp01((p - a) / (b - a)); };
export const window01 = (t, a, b) => clamp01((t - a) / (b - a));

export function segmentAt(p) {
  for (const name of ORDER) {
    const b = SEGMENTS[name][1];
    if (p < b || name === 'world') return name;
  }
  return 'world';
}

/** Cumulative distance along walk frames ([{x, y}] metres). */
export function cumulative(frames) {
  const out = [0];
  for (let i = 1; i < frames.length; i++) {
    out.push(out[i - 1] + Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y));
  }
  return out;
}

/**
 * Locate a distance s along the walk: returns {i, tau} so that the camera is
 * between frame i and i + 1 at fraction tau.
 */
export function locate(cum, s) {
  const total = cum[cum.length - 1];
  const d = Math.min(Math.max(s, 0), total);
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  const span = cum[i + 1] - cum[i] || 1;
  return { i, tau: clamp01((d - cum[i]) / span) };
}

export const angleDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
export const lerpAngle = (a, b, t) => a + angleDelta(a, b) * t;

// Ground radius (m) that the little planet represents when it sits on the map.
export const PLANET_GROUND_RADIUS = 13;
export const MAP_VFOV = 48;
export const ALT_STREET = 2.1;

/** Horizon radius (half-viewport-height units) of a planet resting on the map seen from height h. */
export function planetRadiusAt(h, vfovDeg = MAP_VFOV) {
  return PLANET_GROUND_RADIUS / (h * Math.tan((vfovDeg * Math.PI) / 360));
}

/** Frames used for walking: from the hero frame on, in manifest order. */
export function walkFrames(meta) {
  const k = meta.frames.findIndex((f) => f.i === meta.hero);
  return meta.frames.slice(Math.max(0, k));
}

/**
 * Stage state for progress p.
 * opts: { heroRadius, walkHeadings: view direction per walk frame [deg],
 *         walkCum: [m], heroYaw: deg (idle yaw), streetVfov: deg,
 *         areaH: height (m) the area chapter climbs to }
 */
export function stageState(p, opts) {
  const {
    heroRadius = 0.36,
    walkHeadings,
    walkCum,
    heroYaw = 0,
    streetVfov = 64,
    areaH = 46000,
  } = opts;
  const total = walkCum[walkCum.length - 1];
  const s = {
    segment: segmentAt(p),
    pano: { visible: true, opacity: 1, planet: 1, pitch: -90, yaw: heroYaw, vfov: streetVfov, radius: heroRadius, frame: 0, tau: 0, alphaOut: false, core: 1, coreInk: 0, ring: 1, coreSoft: 0.012, shade: 0 },
    // reveal: how much of the area's coverage is drawn, in capture order (0..1)
    map: { visible: false, alpha: 0, h: 120, tilt: 0, bearing: 0, target: 'end', drone: 0, reveal: 0, droneAlpha: 0, markerAlpha: 0, routeAlpha: 0, coverageAlpha: 0, contextAlpha: 0, shiftX: 0 },
    globe: { visible: false, alpha: 0, dist: 5.2, spin: 0 },
    alt: ALT_STREET,
  };

  const walkStartYaw = walkHeadings[0];
  const walkEndYaw = walkHeadings[walkHeadings.length - 1];

  // hero + dive
  const tDive = smoother(local('dive', p));
  s.pano.planet = 1 - tDive;
  s.pano.pitch = lerp(-90, 1.5, tDive);
  s.pano.yaw = lerpAngle(heroYaw, walkStartYaw, tDive);
  s.pano.radius = heroRadius;
  // the blue core slides out of view as the camera pitches up, turning into a soft ink floor
  s.pano.core = 1;
  s.pano.coreInk = window01(tDive, 0.2, 0.7);
  s.pano.ring = 1 - window01(tDive, 0.0, 0.35);
  s.pano.coreSoft = lerp(0.012, 0.26, window01(tDive, 0.08, 0.55));
  s.pano.shade = window01(tDive, 0.45, 1.0) * 0.9;

  // walk
  const tWalk = local('walk', p);
  if (p >= SEGMENTS.walk[0]) {
    const { i, tau } = locate(walkCum, smooth(tWalk) * total);
    s.pano.frame = i;
    s.pano.tau = tau;
    s.pano.planet = 0;
    s.pano.pitch = 1.5;
    s.pano.yaw = lerpAngle(walkHeadings[i], walkHeadings[Math.min(i + 1, walkHeadings.length - 1)], smooth(tau));
    s.pano.core = 1;
    s.pano.coreInk = 1;
    s.pano.ring = 0;
    s.pano.coreSoft = 0.18;
    s.pano.shade = 0.9;
  }

  // lift: street -> planet resting on the map, seen from rising height
  const tLift = local('lift', p);
  if (p >= SEGMENTS.lift[0]) {
    s.pano.frame = walkHeadings.length - 1;
    s.pano.tau = 0;
    const tMorph = smoother(window01(tLift, 0, 0.55));
    const tRise = smoother(window01(tLift, 0.45, 1));
    const h = loglerp(22, 120, tRise);
    s.pano.planet = tMorph;
    s.pano.pitch = lerp(1.5, -90, tMorph);
    s.pano.yaw = walkEndYaw;
    s.pano.radius = planetRadiusAt(h);
    s.pano.core = 1;
    s.pano.coreInk = 1 - window01(tMorph, 0.35, 0.85);
    s.pano.ring = window01(tMorph, 0.6, 1);
    s.pano.coreSoft = lerp(0.18, 0.012, window01(tMorph, 0.35, 0.9));
    s.pano.shade = 0.9 * (1 - window01(tMorph, 0, 0.35));
    s.pano.alphaOut = true;
    s.map.visible = true;
    s.map.alpha = window01(tLift, 0.35, 0.8);
    s.map.h = h;
    s.map.bearing = walkEndYaw;
    s.map.routeAlpha = window01(tLift, 0.55, 0.95);
    s.map.coverageAlpha = window01(tLift, 0.6, 1);
    s.map.contextAlpha = 0;
    s.map.reveal = 1;
    s.alt = loglerp(ALT_STREET, 120, smoother(tLift));
  }

  // drone: rise to drone altitude, tilt, a drone sweeps the route
  const tDrone = local('drone', p);
  if (p >= SEGMENTS.drone[0]) {
    const h = loglerp(120, 340, smoother(tDrone));
    s.pano.radius = planetRadiusAt(h);
    s.pano.planet = 1;
    s.pano.pitch = -90;
    s.pano.core = 1;
    s.pano.coreInk = 0;
    s.pano.ring = 1;
    s.pano.coreSoft = 0.012;
    s.pano.shade = 0;
    s.pano.opacity = 1 - window01(tDrone, 0.0, 0.3);
    s.pano.visible = s.pano.opacity > 0.001;
    s.map.alpha = 1;
    s.map.h = h;
    s.map.tilt = 40 * smoother(window01(tDrone, 0.05, 0.6));
    s.map.bearing = lerpAngle(walkEndYaw, walkEndYaw - 25, smoother(tDrone));
    s.map.drone = tDrone;
    s.map.droneAlpha = window01(tDrone, 0.12, 0.3) * (1 - window01(tDrone, 0.9, 1));
    s.map.markerAlpha = window01(tDrone, 0.1, 0.3);
    s.map.routeAlpha = 1;
    s.map.coverageAlpha = 0.3;
    s.map.shiftX = 0.17 * smoother(window01(tDrone, 0.28, 0.6));
    s.alt = h;
  }

  // city: climb to see the whole area; coverage draws in by capture time
  const tCity = local('city', p);
  if (p >= SEGMENTS.city[0]) {
    const e = smoother(tCity);
    const h = loglerp(340, areaH, e);
    s.pano.visible = false;
    s.map.h = h;
    s.map.tilt = lerp(40, 18, e);
    s.map.bearing = lerpAngle(walkEndYaw - 25, -8, e);
    s.map.target = 'city';
    s.map.targetMix = smoother(window01(tCity, 0.1, 0.8));
    s.map.drone = 1;
    s.map.droneAlpha = 0;
    s.map.markerAlpha = 1;
    s.map.routeAlpha = 1 - window01(tCity, 0.3, 0.6);
    s.map.contextAlpha = window01(tCity, 0.05, 0.35);
    s.map.reveal = window01(tCity, 0.2, 0.88);
    s.map.coverageAlpha = lerp(0.3, 1, window01(tCity, 0.0, 0.25));
    s.map.shiftX = lerp(0.17, 0.2, e);
    s.alt = h;
  } else {
    s.map.targetMix = 0;
  }

  // world: the map recedes, the globe of Mapilio coverage takes over
  const tWorld = local('world', p);
  if (p >= SEGMENTS.world[0]) {
    const e = smoother(tWorld);
    s.map.alpha = 1 - window01(tWorld, 0.0, 0.3);
    s.map.visible = s.map.alpha > 0.001;
    s.map.h = loglerp(areaH, areaH * 3.5, e);
    s.map.reveal = 1;
    s.globe.visible = true;
    s.globe.alpha = window01(tWorld, 0.08, 0.4);
    s.globe.dist = loglerp(1.3, 5.2, smoother(window01(tWorld, 0.05, 0.75)));
    s.globe.spin = e;
    s.alt = loglerp(areaH, 20000000, e);
  }
  return s;
}

/** Overlay opacity for a [in0, in1, out0, out1] progress window. */
export function overlayAlpha(p, win) {
  const [a, b, c, d] = win;
  const up = b > a ? clamp01((p - a) / (b - a)) : p >= a ? 1 : 0;
  const down = d > c ? 1 - clamp01((p - c) / (d - c)) : p < c ? 1 : 0;
  return Math.min(up, down);
}

/** Human altitude label. */
export function formatAltitude(m) {
  if (m < 10) return `${m.toFixed(1)} m`;
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
}
