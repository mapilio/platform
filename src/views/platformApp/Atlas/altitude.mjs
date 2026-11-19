// Altitude <-> zoom for the Atlas map. The altimeter rail is a real control:
// its position is the map zoom on a log-altitude scale. Pure, unit-tested.

export const ZOOM_MIN = 1.4;
export const ZOOM_MAX = 20;
// Mapbox GL's default vertical field of view is 36.87 degrees: tan(fov / 2) = 1 / 3
const HALF_FOV_TAN = 1 / 3;
const EARTH_CIRC = 40075016.686;

/** Metres per CSS pixel for 512-px tiles (Mapbox GL zoom levels). */
export function metresPerPixel(zoom, lat) {
  return (EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Camera height above the ground for a top-down view. */
export function altitudeForZoom(zoom, lat, viewportHeight) {
  return ((viewportHeight / 2) * metresPerPixel(zoom, lat)) / HALF_FOV_TAN;
}

export function zoomForAltitude(alt, lat, viewportHeight) {
  const mpp = (alt * HALF_FOV_TAN) / (viewportHeight / 2);
  return Math.log2((EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (512 * mpp));
}

/** 0 at street level (max zoom) to 1 at the widest view. */
export function railPosition(zoom) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  return (ZOOM_MAX - z) / (ZOOM_MAX - ZOOM_MIN);
}

export function zoomForRail(pos) {
  const p = Math.min(1, Math.max(0, pos));
  return ZOOM_MAX * (1 - p) + ZOOM_MIN * p; // exact at both ends
}

export const STOPS = [
  { key: 'world', label: 'World', zoom: 1.8 },
  { key: 'city', label: 'City', zoom: 11.2 },
  { key: 'drone', label: 'Drone', zoom: 18.2 },
  { key: 'street', label: 'Street', zoom: ZOOM_MAX },
];

/** Name of the altitude band shown above the readout. */
export function chapterForZoom(zoom) {
  if (zoom < 3.6) return 'World';
  if (zoom < 7) return 'Country';
  if (zoom < 11.5) return 'Region';
  if (zoom < 15) return 'City';
  if (zoom < 17.3) return 'District';
  return 'Drone height';
}

export function formatAltitude(m) {
  if (!(m >= 0)) return '—';
  if (m < 10) return `${m.toFixed(1)} m`;
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
}

/** Which place-name granularity to show for a zoom level. */
export function placeLevel(zoom) {
  if (zoom < 3.6) return 'world';
  if (zoom < 7) return 'country';
  if (zoom < 11.5) return 'region';
  if (zoom < 15) return 'city';
  return 'street';
}

/** Pick title and subtitle from a Photon reverse-geocoding result. */
export function placeFromPhoton(props, level) {
  if (!props || level === 'world') return { title: 'The world', sub: 'Street-level imagery by Mapilio contributors' };
  const { name, street, district, locality, city, county, state, country } = props;
  const town = city || locality || county;
  if (level === 'country') return { title: country || state || 'Open water', sub: state && country && state !== country ? state : '' };
  if (level === 'region') return { title: town || state || country || 'Unnamed place', sub: [state !== town ? state : null, country].filter(Boolean).join(', ') };
  if (level === 'city') return { title: district || town || state || 'Unnamed place', sub: [district ? town : null, state !== town ? state : null, country].filter(Boolean).join(', ') };
  return { title: street || name || district || town || 'Unnamed street', sub: [district, town, country].filter(Boolean).join(', ') };
}

/** Years covered by the time scrubber. */
export function yearRange(now = new Date()) {
  const out = [];
  for (let y = 2016; y <= now.getFullYear(); y++) out.push(y);
  return out;
}

/** Mapbox filter for a capture-year window on features with a capture_time string. */
export function yearFilter(from, to) {
  return ['all',
    ['>=', ['to-string', ['get', 'capture_time']], String(from)],
    ['<', ['to-string', ['get', 'capture_time']], String(to + 1)],
  ];
}
