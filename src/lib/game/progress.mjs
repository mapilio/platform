// Explorer progress: XP, levels, streak and badges kept in localStorage.
// Contributor badges come from the upload statistics the API returns.
// Pure functions; storage is injected so this runs in node tests.

export const STORAGE_KEY = 'mapilio:explorer:v2';

export const LEVELS = [
  { name: 'Wanderer', xp: 0 },
  { name: 'Scout', xp: 100 },
  { name: 'Pathfinder', xp: 300 },
  { name: 'Navigator', xp: 700 },
  { name: 'Cartographer', xp: 1500 },
  { name: 'Surveyor', xp: 3000 },
  { name: 'Atlas', xp: 6000 },
];

export const XP = {
  roundBase: 5,
  roundPer1000: 4, // + 4 XP per 1,000 round points
  gameComplete: 20,
  dailyComplete: 40,
  walkPer100m: 3,
  walkDailyCap: 90,
  firstOfDay: 10,
  surveyPhoto: 2, // each drone photo seen for the first time
  surveyComplete: 25, // every photo of a survey seen
};

export const BADGES = [
  // explorer track (computed in the browser)
  { id: 'first-steps', name: 'First Steps', glyph: 'firstlight', rarity: 'common', track: 'explorer', criterion: 'Walk 100 m of any street in the viewer', test: (s) => s.walkedM >= 100 },
  { id: 'street-walker', name: 'Street Walker', glyph: 'pathfinder', rarity: 'rare', track: 'explorer', criterion: 'Walk 5 km in the viewer', test: (s) => s.walkedM >= 5000 },
  { id: 'bullseye', name: 'Bullseye', glyph: 'bullseye', rarity: 'rare', track: 'explorer', criterion: 'Score 4,900+ in one Where am I? round', test: (s) => s.bestRound >= 4900 },
  { id: 'globetrotter', name: 'Globetrotter', glyph: 'globetrotter', rarity: 'epic', track: 'explorer', criterion: 'Guess within 500 km in 10 different countries', test: (s) => (s.countriesNear || []).length >= 10 },
  { id: 'seven-days', name: 'Seven Days', glyph: 'streak', rarity: 'rare', track: 'explorer', criterion: 'Play on 7 days in a row', test: (s) => s.bestStreak >= 7 },
  { id: 'perfect-day', name: 'Perfect Day', glyph: 'century', rarity: 'legendary', track: 'explorer', criterion: 'Score 24,000+ in a daily five', test: (s) => s.bestDaily >= 24000 },
  // contributor track (from /api/leaderboard or profile statistics)
  { id: 'first-light', name: 'First Light', glyph: 'firstlight', rarity: 'common', track: 'contributor', criterion: 'Upload your first sequence', test: (s, c) => (c?.images || 0) > 0 },
  { id: 'full-circle', name: 'Full Circle', glyph: 'fullcircle', rarity: 'rare', track: 'contributor', criterion: 'Upload a 360° sequence', test: (s, c) => !!c?.has360 },
  { id: 'century', name: 'Century', glyph: 'century', rarity: 'rare', track: 'contributor', criterion: 'Capture 100 km of streets', test: (s, c) => (c?.km || 0) >= 100 },
  { id: 'thousand-roads', name: 'Thousand Roads', glyph: 'pathfinder', rarity: 'epic', track: 'contributor', criterion: 'Capture 1,000 km of streets', test: (s, c) => (c?.km || 0) >= 1000 },
  { id: 'ground-truth', name: 'Ground Truth', glyph: 'groundtruth', rarity: 'epic', track: 'contributor', criterion: 'Link your OpenStreetMap account', test: (s, c) => !!c?.osmLinked },
  { id: 'lift-off', name: 'Lift-off', glyph: 'liftoff', rarity: 'legendary', track: 'contributor', criterion: 'Upload a drone set (when drone uploads open)', test: () => false, comingSoon: true },
];

export function defaultState() {
  return {
    v: 2,
    xp: 0,
    walkedM: 0,
    walkDay: '',
    walkDayM: 0,
    rounds: 0,
    games: 0,
    bestRound: 0,
    bestGame: 0,
    bestDaily: 0,
    dailyDone: {},
    countriesNear: [],
    lastDay: '',
    streak: 0,
    bestStreak: 0,
    badges: {},
    surveys: {},
  };
}

export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return localDay(dt);
}

export function levelFor(xp) {
  let i = 0;
  while (i < LEVELS.length - 1 && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  const progress = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1;
  return { index: i, name: cur.name, xp, floor: cur.xp, next: next ? next.xp : null, nextName: next ? next.name : null, progress: Math.max(0, Math.min(1, progress)) };
}

const R = 6371.0088;
export function haversineKm(a, b) {
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** World-map round score: 5,000 at the spot, half at about 1,035 km. */
export function roundScore(km) {
  if (!(km >= 0)) return 0;
  if (km <= 0.025) return 5000;
  return Math.round(5000 * Math.exp(-km / 1492.7));
}

function touchDay(state, now) {
  const today = localDay(now);
  let gained = 0;
  if (state.lastDay !== today) {
    state.streak = state.lastDay === dayBefore(today) ? state.streak + 1 : 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.lastDay = today;
    gained += XP.firstOfDay;
  }
  return gained;
}

function checkBadges(state, contributor, now) {
  const fresh = [];
  BADGES.forEach((b) => {
    if (state.badges[b.id]) return;
    if (b.test(state, contributor)) {
      state.badges[b.id] = now.toISOString();
      fresh.push(b);
    }
  });
  return fresh;
}

/**
 * Apply an event. Returns { state, gained, newBadges, level, levelUp }.
 * Events:
 *  { type: 'round', score, km, country }        one guessed photo
 *  { type: 'game', total, daily: boolean, day }  a finished game
 *  { type: 'walk', metres }                      distance walked in the viewer
 *  { type: 'survey', site, photos, total }       drone photos seen (indices) in a survey of `total` photos
 *  { type: 'contributor', stats }                re-check contributor badges
 */
export function applyEvent(prev, event, now = new Date(), contributor = null) {
  const state = { ...defaultState(), ...prev, badges: { ...(prev?.badges || {}) }, countriesNear: [...(prev?.countriesNear || [])], dailyDone: { ...(prev?.dailyDone || {}) }, surveys: { ...(prev?.surveys || {}) } };
  const before = levelFor(state.xp);
  let gained = 0;
  if (event.type === 'round') {
    gained += touchDay(state, now);
    state.rounds += 1;
    state.bestRound = Math.max(state.bestRound, event.score || 0);
    gained += XP.roundBase + Math.floor(((event.score || 0) / 1000) * XP.roundPer1000);
    if (event.country && event.km <= 500 && !state.countriesNear.includes(event.country)) state.countriesNear.push(event.country);
  } else if (event.type === 'game') {
    state.games += 1;
    state.bestGame = Math.max(state.bestGame, event.total || 0);
    gained += XP.gameComplete;
    if (event.daily) {
      const day = event.day || localDay(now);
      if (!state.dailyDone[day]) {
        state.dailyDone[day] = event.total || 0;
        state.bestDaily = Math.max(state.bestDaily, event.total || 0);
        gained += XP.dailyComplete;
      }
    }
  } else if (event.type === 'walk') {
    const today = localDay(now);
    if (state.walkDay !== today) { state.walkDay = today; state.walkDayM = 0; }
    const m = Math.max(0, event.metres || 0);
    const beforeXp = Math.min(XP.walkDailyCap, Math.floor(state.walkDayM / 100) * XP.walkPer100m);
    state.walkDayM += m;
    state.walkedM += m;
    const afterXp = Math.min(XP.walkDailyCap, Math.floor(state.walkDayM / 100) * XP.walkPer100m);
    gained += afterXp - beforeXp;
    if (m > 0) gained += touchDay(state, now);
  } else if (event.type === 'survey' && event.site) {
    const seen = new Set((state.surveys[event.site] || []).filter((i) => Number.isInteger(i) && i >= 0));
    const before = seen.size;
    (event.photos || []).forEach((i) => { if (Number.isInteger(i) && i >= 0 && (!event.total || i < event.total)) seen.add(i); });
    const added = seen.size - before;
    if (added > 0) {
      gained += touchDay(state, now);
      gained += added * XP.surveyPhoto;
      if (event.total && before < event.total && seen.size >= event.total) gained += XP.surveyComplete;
    }
    state.surveys[event.site] = [...seen].sort((a, b) => a - b);
  }
  state.xp += gained;
  const newBadges = checkBadges(state, contributor, now);
  const level = levelFor(state.xp);
  return { state, gained, newBadges, level, levelUp: level.index > before.index };
}

export function loadProgress(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch (e) {
    return defaultState();
  }
}

export function saveProgress(storage, state) {
  try { storage && storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
}

/** Deterministic pick of n items for a given day (same for everyone that day). */
export function dailyPick(items, n, day) {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) { h ^= day.charCodeAt(i); h = Math.imul(h, 16777619); }
  const idx = items.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const j = Math.abs(h) % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => items[i]);
}
