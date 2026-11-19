// Helpers for a processed drone survey (an OpenDroneMap result stored in
// src/lib/drone/<site>.json and public/drone/<site>/).
// Pure functions: GeoJSON for the map, facts for the UI.

export const DRONE_BASE = '/drone';

export function siteAsset(site, file) {
  return `${DRONE_BASE}/${site.id}/${file}`;
}

export function shotImage(site, shot, size = '2k') {
  return siteAsset(site, `shots/${shot.name}-${size}.webp`);
}

/** Footprint polygons, camera points and the flight line, in capture order. */
export function siteGeoJSON(site) {
  const footprints = {
    type: 'FeatureCollection',
    features: site.shots.map((s, i) => ({
      type: 'Feature',
      id: i,
      properties: { index: i, name: s.name },
      geometry: { type: 'Polygon', coordinates: [[...s.footprint, s.footprint[0]]] },
    })),
  };
  const shots = {
    type: 'FeatureCollection',
    features: site.shots.map((s, i) => ({
      type: 'Feature',
      id: i,
      properties: { index: i, name: s.name, agl: s.agl, yaw: s.yaw },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  };
  const path = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: site.shots.map((s) => [s.lng, s.lat]) },
  };
  return { footprints, shots, path };
}

/** [west, south, east, north] of the orthophoto. */
export function siteBounds(site) {
  const xs = site.ortho.corners.map((c) => c[0]);
  const ys = site.ortho.corners.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const R = 6371008.8;
export function distanceM(a, b) {
  const d = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * d) / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(((b.lng - a.lng) * d) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function formatDuration(seconds) {
  const s = Math.round(seconds || 0);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

/** Headline facts for the site panel, all taken from the ODM report and log. */
export function siteFacts(site) {
  const agl = site.shots.map((s) => s.agl);
  const mean = agl.reduce((a, b) => a + b, 0) / (agl.length || 1);
  return {
    photos: site.shots.length,
    aglMean: Math.round(mean),
    aglMin: Math.round(Math.min(...agl)),
    aglMax: Math.round(Math.max(...agl)),
    gsdCm: site.odm.gsdCm,
    areaM2: site.odm.areaM2,
    densePoints: site.odm.densePoints,
    sparsePoints: site.odm.sparsePoints,
    reprojectionPx: site.odm.reprojectionPx,
    gpsErrorM: site.odm.gpsErrorM,
    processing: formatDuration(site.odm.totalSeconds),
    version: site.odm.version,
    camera: `${site.camera.make} ${site.camera.model}`.replace(/\s+/g, ' ').trim(),
  };
}

/** The pipeline as ODM ran it, with what each step produced for this survey. */
export function pipeline(site) {
  const f = siteFacts(site);
  const n = (x) => (typeof x === 'number' ? x.toLocaleString('en-US') : '—');
  return [
    { key: 'photos', label: 'Photos', tool: 'Upload', value: `${f.photos} JPEG`, note: f.camera },
    { key: 'sfm', label: 'Align', tool: 'OpenSfM', value: `${n(f.sparsePoints)} tie points`, note: `${f.reprojectionPx} px reprojection error` },
    { key: 'dense', label: 'Densify', tool: 'OpenMVS', value: `${n(f.densePoints)} points`, note: 'Dense point cloud' },
    { key: 'mesh', label: 'Mesh', tool: 'Poisson, mvs-texturing', value: 'Textured 3D model', note: 'OBJ' },
    { key: 'geo', label: 'Georeference', tool: 'GPS in EXIF', value: `${f.gpsErrorM} m mean GPS error`, note: 'No ground control points' },
    { key: 'ortho', label: 'Orthophoto', tool: 'odm_orthophoto', value: `${site.ortho.width} × ${site.ortho.height} px`, note: `${site.ortho.pixelCm} cm per pixel` },
  ];
}

/**
 * Parse the baked point cloud: Int16 xyz triplets followed by Uint8 rgb triplets.
 * frame 'enu' keeps east, north, up (the map layer); 'three' gives x east, y up, z south.
 */
export function parsePoints(buffer, count, unit, frame = 'three') {
  const xyz = new Int16Array(buffer, 0, count * 3);
  const rgb = new Uint8Array(buffer, count * 6, count * 3);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const enu = frame === 'enu';
  for (let i = 0; i < count; i++) {
    positions[i * 3] = xyz[i * 3] * unit;
    positions[i * 3 + 1] = (enu ? xyz[i * 3 + 1] : xyz[i * 3 + 2]) * unit;
    positions[i * 3 + 2] = (enu ? xyz[i * 3 + 2] : -xyz[i * 3 + 1]) * unit;
    colors[i * 3] = rgb[i * 3] / 255;
    colors[i * 3 + 1] = rgb[i * 3 + 1] / 255;
    colors[i * 3 + 2] = rgb[i * 3 + 2] / 255;
  }
  return { positions, colors };
}

/** lon/lat -> pixel position on the orthophoto (affine from three corners). */
export function toOrthoXY(site, lng, lat) {
  const [tl, tr, , bl] = site.ortho.corners;
  const ax = tr[0] - tl[0], ay = tr[1] - tl[1];
  const bx = bl[0] - tl[0], by = bl[1] - tl[1];
  const px = lng - tl[0], py = lat - tl[1];
  const det = ax * by - ay * bx;
  const a = (px * by - py * bx) / det;
  const b = (ax * py - ay * px) / det;
  return [a * site.ortho.width, b * site.ortho.height];
}

/** Unit ray directions (east, north, up) through the four image corners of a shot. */
export function cornerRays(site, shot) {
  const { width: W, height: H, focalRatio: f } = site.camera;
  const n = Math.max(W, H);
  const R = shot.rot;
  return [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v]) => {
    const c = [(u - W / 2) / n, (v - H / 2) / n, f];
    const d = [R[0] * c[0] + R[1] * c[1] + R[2] * c[2], R[3] * c[0] + R[4] * c[1] + R[5] * c[2], R[6] * c[0] + R[7] * c[1] + R[8] * c[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / L, d[1] / L, d[2] / L];
  });
}

/** Twice the signed area of a ring of [lng, lat] (positive when counter-clockwise). */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return -a;
}

/**
 * The shade laid over the map around a drone photo: a large square around the
 * survey with the photo's footprint cut out. The hole winds the other way round
 * from the outer ring, which is how the map tells holes from new polygons.
 */
export function shadeAround(site, shot, padDeg = 0.05) {
  const { lng, lat } = site.centre;
  const outer = [[lng - padDeg, lat - padDeg * 0.7], [lng + padDeg, lat - padDeg * 0.7], [lng + padDeg, lat + padDeg * 0.7], [lng - padDeg, lat + padDeg * 0.7]];
  outer.push(outer[0]);
  const rings = [outer];
  if (shot) {
    let hole = [...shot.footprint, shot.footprint[0]];
    if (Math.sign(ringArea(hole)) === Math.sign(ringArea(outer))) hole = hole.reverse();
    rings.push(hole);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } };
}

/** The outline of a photo's footprint, closed. */
export function footprintLine(shot) {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: shot ? [...shot.footprint, shot.footprint[0]] : [] } };
}

/** Index of the shot whose footprint centre is nearest to a point. */
export function nearestShot(site, lng, lat) {
  let best = 0;
  let bd = Infinity;
  site.shots.forEach((sh, i) => {
    const c = sh.footprint.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const d = distanceM({ lng, lat }, { lng: c[0], lat: c[1] });
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/**
 * Angle (radians, counter-clockwise) from true east to the survey's grid east.
 * OpenDroneMap works in UTM, whose grid north is turned from true north by the
 * grid convergence; the orthophoto's top edge runs along grid east.
 */
export function gridConvergence(site) {
  const [tl, tr] = site.ortho.corners;
  return Math.atan2(tr[1] - tl[1], (tr[0] - tl[0]) * Math.cos((site.centre.lat * Math.PI) / 180));
}

/** A point of the survey's local grid frame (east, north metres from the centre) as [lng, lat]. */
export function localToLngLat(site, east, north) {
  const g = gridConvergence(site);
  const e = east * Math.cos(g) - north * Math.sin(g);
  const n = east * Math.sin(g) + north * Math.cos(g);
  const lat = site.centre.lat + (n / R) * (180 / Math.PI);
  const lng = site.centre.lng + (e / (R * Math.cos((((site.centre.lat + lat) / 2) * Math.PI) / 180))) * (180 / Math.PI);
  return [lng, lat];
}
