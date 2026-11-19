// Sequence data for the walk viewer: load, sort, convert to local metres.
// Pure helpers are exported for tests.

export const FEATURED = [
  { seq: '94057e66-f9ff-4d56-9405-7154e04200be', label: 'Beykoz, İstanbul', kind: '360°, car' },
  { seq: 'fbd33ef4-6f7a-476f-b5f9-7c2e557b3d04', label: 'Toowoomba, Australia', kind: '360°, on foot' },
  { seq: 'ed64fe99-0c42-4dcc-98b6-27a0ebba651f', label: 'Metz, France', kind: '360°, car' },
  { seq: '559fc722-b27e-4bbb-97ba-30698a5fcaab', label: 'Nundle, Australia', kind: '360°, on foot' },
];
export const DEFAULT_SEQUENCE = FEATURED[0].seq;

const R = 6378137;
const DEG = Math.PI / 180;

export function parseResolution(res) {
  const [a, b] = String(res || '').split('x').map((n) => parseInt(n, 10));
  if (!a || !b) return null;
  return { w: a, h: b };
}

export function is360(entry) {
  if (String(entry.fov) === '360') return true;
  const r = parseResolution(entry.resolution);
  return !!(r && Math.max(r.w, r.h) === 2 * Math.min(r.w, r.h) && !(parseFloat(entry.fov) > 0 && parseFloat(entry.fov) < 300));
}

/** Horizontal and vertical half-angle tangents for a perspective photo. */
export function perspTan(entry) {
  const r = parseResolution(entry.resolution) || { w: 4, h: 3 };
  let hfov = parseFloat(entry.fov);
  if (!(hfov > 10 && hfov < 179)) hfov = 70;
  const landscape = r.w >= r.h;
  const aspect = landscape ? r.w / r.h : r.h / r.w;
  // the stored fov is the horizontal fov of the landscape frame
  const tH = Math.tan((hfov * DEG) / 2);
  return landscape ? { x: tH, y: tH / aspect } : { x: tH / aspect, y: tH };
}

export function bearing(a, b) {
  const y = Math.sin((b.lng - a.lng) * DEG) * Math.cos(b.lat * DEG);
  const x = Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) - Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((b.lng - a.lng) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Normalise /api/embed entries into frames with local east/north metres. */
export function buildFrames(entries) {
  const list = (entries || [])
    .filter((e) => e && e.latitude != null && e.longitude != null && e.uploaded_hash && e.filename)
    .map((e) => ({ ...e, lat: parseFloat(e.latitude), lng: parseFloat(e.longitude) }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .sort((a, b) => (String(a.capture_time) + a.filename < String(b.capture_time) + b.filename ? -1 : 1));
  if (!list.length) return { frames: [], origin: null, length: 0 };
  const origin = { lat: list[0].lat, lng: list[0].lng };
  const k = Math.cos(origin.lat * DEG);
  let cum = 0;
  const frames = list.map((e, i) => {
    const east = (e.lng - origin.lng) * DEG * R * k;
    const north = (e.lat - origin.lat) * DEG * R;
    return {
      i,
      id: e.id,
      uuid: e.photo_uuid,
      hash: e.uploaded_hash,
      filename: e.filename,
      lat: e.lat,
      lng: e.lng,
      east,
      north,
      time: e.capture_time,
      heading: Number.isFinite(parseFloat(e.heading)) ? parseFloat(e.heading) : null,
      pano: is360(e),
      tan: is360(e) ? null : perspTan(e),
      userId: e.created_by_id,
      cum: 0,
    };
  });
  for (let i = 0; i < frames.length; i++) {
    // photos taken at a stop share one GPS fix; a token 5 cm keeps each reachable on its own
    if (i > 0) cum += Math.max(0.05, Math.hypot(frames[i].east - frames[i - 1].east, frames[i].north - frames[i - 1].north));
    frames[i].cum = cum;
    if (frames[i].heading == null) {
      const a = frames[Math.max(0, i - 1)];
      const b = frames[Math.min(frames.length - 1, i + 1)];
      frames[i].heading = a === b ? 0 : bearing(a, b);
    }
  }
  return { frames, origin, length: cum };
}

export function imageUrl(base, frame, height) {
  return `${base}/${frame.hash}/${frame.filename}/${height}`;
}

/** Index of the frame nearest to a local point (east, north). */
export function nearestFrame(frames, east, north, maxDist = Infinity) {
  let best = -1;
  let bd = maxDist;
  for (let i = 0; i < frames.length; i++) {
    const d = Math.hypot(frames[i].east - east, frames[i].north - north);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Index of the frame whose id or uuid matches, else 0. */
export function frameIndexFor(frames, key) {
  if (key == null || key === '') return 0;
  const k = String(key);
  const i = frames.findIndex((f) => String(f.id) === k || String(f.uuid) === k);
  if (i >= 0) return i;
  const n = parseInt(k, 10);
  return Number.isFinite(n) && n >= 0 && n < frames.length && String(n) === k && frames.length < 100000 ? n : 0;
}

export async function loadSequence(apiBase, seq, { signal } = {}) {
  const res = await fetch(`${apiBase}/api/embed/${encodeURIComponent(seq)}`, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`Sequence request failed (${res.status})`);
  const json = await res.json();
  const entries = json?.data?.entries || [];
  return { info: json?.data?.info || {}, ...buildFrames(entries) };
}

export async function loadUsername(apiBase, userId, { signal } = {}) {
  if (!userId) return null;
  try {
    const res = await fetch(`${apiBase}/api/search-user?options%5Bparameters%5D%5Bid%5D=${encodeURIComponent(userId)}`, { signal, credentials: 'omit' });
    const json = await res.json();
    const d = Array.isArray(json?.data) ? json.data[0] : json?.data;
    return d?.username || null;
  } catch (e) {
    return null;
  }
}

/** Place name from OpenStreetMap data (Photon). No credentials are sent. */
export async function reverseGeocode(lat, lng, { signal } = {}) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&limit=1`, { signal, credentials: 'omit' });
    const json = await res.json();
    const p = json?.features?.[0]?.properties;
    if (!p) return null;
    const street = p.street || p.name;
    const area = p.district || p.locality || p.city || p.county;
    const city = p.city && p.city !== area ? p.city : p.state;
    return { title: street || area || p.country, sub: [area !== street ? area : null, city, p.country].filter(Boolean).join(', ') };
  } catch (e) {
    return null;
  }
}
