import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stageState, cumulative, locate, SEGMENTS, overlayAlpha, formatAltitude, planetRadiusAt, angleDelta, walkFrames,
} from '../src/views/landing/stage/timeline.mjs';
import {
  applyEvent, defaultState, levelFor, roundScore, haversineKm, dailyPick, LEVELS, BADGES,
} from '../src/lib/game/progress.mjs';

const frames = [
  { x: 0, y: 0 }, { x: 0, y: -10 }, { x: 5, y: -20 }, { x: 5, y: -30 },
];
const walkCum = cumulative(frames);
const walkHeadings = [180, 170, 180, 185];
const opts = { walkHeadings, walkCum, heroYaw: 40 };

test('segments are contiguous and cover 0..1', () => {
  const names = Object.keys(SEGMENTS);
  assert.equal(SEGMENTS[names[0]][0], 0);
  assert.equal(SEGMENTS[names[names.length - 1]][1], 1);
  for (let i = 1; i < names.length; i++) assert.equal(SEGMENTS[names[i]][0], SEGMENTS[names[i - 1]][1]);
});

test('hero is a little planet, walk is a street view', () => {
  const hero = stageState(0, opts);
  assert.equal(hero.pano.planet, 1);
  assert.equal(hero.pano.pitch, -90);
  const walk = stageState((SEGMENTS.walk[0] + SEGMENTS.walk[1]) / 2, opts);
  assert.equal(walk.pano.planet, 0);
  assert.ok(walk.pano.frame >= 0 && walk.pano.frame < frames.length - 1);
});

test('walk ends on the last frame and lift raises the camera', () => {
  const end = stageState(SEGMENTS.walk[1] - 1e-6, opts);
  assert.equal(end.pano.frame, frames.length - 2);
  assert.ok(end.pano.tau > 0.99);
  const lift = stageState(SEGMENTS.lift[1] - 1e-6, opts);
  assert.ok(lift.map.visible);
  assert.ok(lift.map.h > 100);
  assert.ok(Math.abs(lift.pano.radius - planetRadiusAt(lift.map.h)) < 1e-9);
});

test('area draws coverage forward in capture order, world shows the globe', () => {
  const a = stageState(SEGMENTS.city[0] + 0.02, opts);
  const b = stageState(SEGMENTS.city[1] - 0.02, opts);
  assert.ok(b.map.reveal > a.map.reveal);
  assert.equal(stageState(SEGMENTS.drone[0] + 0.05, opts).map.reveal, 1);
  const w = stageState(0.99, opts);
  assert.ok(w.globe.visible && w.globe.alpha > 0.9);
  assert.ok(w.alt > 1e6);
  assert.equal(w.map.reveal, 1);
});

test('the area chapter climbs to the place\'s height', () => {
  const end = stageState(SEGMENTS.city[1] - 1e-6, { ...opts, areaH: 8000 });
  assert.ok(Math.abs(end.map.h - 8000) < 1);
  const w = stageState(SEGMENTS.world[0] + 1e-6, { ...opts, areaH: 8000 });
  assert.ok(Math.abs(w.alt - 8000) < 1);
  assert.ok(Math.abs(stageState(SEGMENTS.city[1] - 1e-6, opts).map.h - 46000) < 5);
});

test('walk frames start at the hero, in manifest order', () => {
  const meta = { hero: 8, frames: [{ i: 8 }, { i: 7 }, { i: 3 }, { i: 0 }] };
  assert.deepEqual(walkFrames(meta).map((f) => f.i), [8, 7, 3, 0]);
  const ascending = { hero: 88, frames: [{ i: 84 }, { i: 88 }, { i: 89 }] };
  assert.deepEqual(walkFrames(ascending).map((f) => f.i), [88, 89]);
});

test('locate and cumulative distances', () => {
  assert.deepEqual(walkCum.map((v) => Math.round(v * 100) / 100), [0, 10, 21.18, 31.18]);
  const l = locate(walkCum, 15);
  assert.equal(l.i, 1);
  assert.ok(l.tau > 0.4 && l.tau < 0.5);
});

test('overlay windows and labels', () => {
  assert.equal(overlayAlpha(0.5, [0.4, 0.45, 0.6, 0.65]), 1);
  assert.equal(overlayAlpha(0.3, [0.4, 0.45, 0.6, 0.65]), 0);
  assert.equal(overlayAlpha(0, [-1, 0, 0.02, 0.07]), 1);
  assert.equal(formatAltitude(2.1), '2.1 m');
  assert.equal(formatAltitude(120), '120 m');
  assert.equal(formatAltitude(46000), '46 km');
  assert.equal(formatAltitude(2e7), '20,000 km');
  assert.equal(angleDelta(350, 10), 20);
  assert.equal(angleDelta(10, 350), -20);
});

test('round score curve', () => {
  assert.equal(roundScore(0), 5000);
  assert.equal(roundScore(0.02), 5000);
  assert.ok(Math.abs(roundScore(1035) - 2500) < 15);
  assert.ok(roundScore(20000) < 10);
  assert.equal(roundScore(NaN), 0);
});

test('haversine', () => {
  const ist = { lat: 41.0082, lng: 28.9784 };
  const ank = { lat: 39.9334, lng: 32.8597 };
  const km = haversineKm(ist, ank);
  assert.ok(km > 345 && km < 355, String(km));
});

test('levels', () => {
  assert.equal(levelFor(0).name, LEVELS[0].name);
  assert.equal(levelFor(100).name, 'Scout');
  assert.equal(levelFor(99999).name, 'Atlas');
  assert.equal(levelFor(99999).progress, 1);
});

test('streaks, XP and badges', () => {
  let s = defaultState();
  const d1 = new Date(2026, 10, 10, 12);
  const d2 = new Date(2026, 10, 11, 12);
  const d4 = new Date(2026, 10, 13, 12);
  let r = applyEvent(s, { type: 'round', score: 4950, km: 1, country: 'TR' }, d1);
  assert.equal(r.state.streak, 1);
  assert.ok(r.newBadges.some((b) => b.id === 'bullseye'));
  assert.ok(r.gained >= 10 + 5 + 19);
  s = r.state;
  r = applyEvent(s, { type: 'round', score: 100, km: 3000, country: 'FR' }, d2);
  assert.equal(r.state.streak, 2);
  assert.deepEqual(r.state.countriesNear, ['TR']);
  s = r.state;
  r = applyEvent(s, { type: 'round', score: 100, km: 3000 }, d4);
  assert.equal(r.state.streak, 1);
  assert.equal(r.state.bestStreak, 2);
});

test('walk XP is capped per day', () => {
  const d = new Date(2026, 10, 10, 12);
  let r = applyEvent(defaultState(), { type: 'walk', metres: 20000 }, d);
  assert.equal(r.gained, 90 + 10);
  r = applyEvent(r.state, { type: 'walk', metres: 500 }, d);
  assert.equal(r.gained, 0);
  assert.ok(r.state.badges['first-steps'] && r.state.badges['street-walker']);
});

test('daily game counted once per day', () => {
  const d = new Date(2026, 10, 10, 12);
  let r = applyEvent(defaultState(), { type: 'game', total: 24100, daily: true, day: '2026-11-10' }, d);
  assert.equal(r.gained, 20 + 40);
  assert.ok(r.newBadges.some((b) => b.id === 'perfect-day'));
  r = applyEvent(r.state, { type: 'game', total: 24100, daily: true, day: '2026-11-10' }, d);
  assert.equal(r.gained, 20);
});

test('contributor badges come from statistics only', () => {
  const r = applyEvent(defaultState(), { type: 'contributor' }, new Date(), { images: 12, km: 150, has360: true });
  const ids = r.newBadges.map((b) => b.id).sort();
  assert.deepEqual(ids, ['century', 'first-light', 'full-circle']);
  assert.ok(BADGES.find((b) => b.id === 'lift-off').comingSoon);
});

test('daily pick is deterministic and distinct', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const a = dailyPick(items, 5, '2026-11-17');
  const b = dailyPick(items, 5, '2026-11-17');
  const c = dailyPick(items, 5, '2026-11-18');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(new Set(a).size, 5);
});

test('drone survey photos earn XP once each, plus a bonus for the whole survey', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  let r = applyEvent(defaultState(), { type: 'survey', site: 'brighton-beach', photos: [0, 1, 2], total: 18 }, now);
  assert.equal(r.gained, 10 + 3 * 2);
  assert.deepEqual(r.state.surveys['brighton-beach'], [0, 1, 2]);
  r = applyEvent(r.state, { type: 'survey', site: 'brighton-beach', photos: [1, 2], total: 18 }, now);
  assert.equal(r.gained, 0);
  const rest = Array.from({ length: 15 }, (_, i) => i + 3);
  r = applyEvent(r.state, { type: 'survey', site: 'brighton-beach', photos: [...rest, 99, -1, 2.5], total: 18 }, now);
  assert.equal(r.gained, 15 * 2 + 25);
  assert.equal(r.state.surveys['brighton-beach'].length, 18);
  r = applyEvent(r.state, { type: 'survey', site: 'brighton-beach', photos: [5], total: 18 }, now);
  assert.equal(r.gained, 0);
  const legacy = { ...defaultState() };
  delete legacy.surveys;
  assert.equal(applyEvent(legacy, { type: 'survey', site: 'x', photos: [0], total: 2 }, now).state.surveys.x.length, 1);
});
