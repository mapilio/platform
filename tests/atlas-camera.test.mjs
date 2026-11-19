import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAP_VFOV, EYE_HEIGHT, STREET_PITCH, STREET_LOOK, MIN_LOOK_DIST, smoother, shortestAngle, metresPerPixel, offsetLngLat,
  metresBetween, cameraDistancePx, cameraForEye, eyeForCamera, minPitchFor, streetEye, planFlight, photoCamera,
  surveyCamera, surveyTopCamera,
} from '../src/views/platformApp/Atlas/camera.mjs';
import { shadeAround, footprintLine, nearestShot } from '../src/lib/drone/drone.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/drone/brighton-beach.json'), 'utf8'));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);
const lookDist = (e) => e.alt / Math.cos((e.pitch * Math.PI) / 180);

test('basic angles and units', () => {
  near(Math.tan((MAP_VFOV * Math.PI) / 360), 1 / 3, 1e-12);
  near(MIN_LOOK_DIST, EYE_HEIGHT / Math.cos((85 * Math.PI) / 180), 1e-12);
  assert.equal(STREET_LOOK, -5);
  assert.equal(smoother(0), 0);
  assert.equal(smoother(1), 1);
  assert.equal(smoother(0.5), 0.5);
  assert.equal(shortestAngle(350, 10), 20);
  assert.equal(shortestAngle(10, 350), -20);
  assert.equal(shortestAngle(0, 180), 180);
  assert.equal(shortestAngle(90, 90), 0);
  near(cameraDistancePx(900), 1350, 1e-9);
  const [lng, lat] = offsetLngLat(29, 41, 100, -50);
  const d = metresBetween({ lng: 29, lat: 41 }, { lng, lat });
  near(d.east, 100, 0.05);
  near(d.north, -50, 0.05);
  near(metresPerPixel(0, 0), 78271.517, 0.01);
});

test('eye and Mapbox camera convert both ways', () => {
  const eyes = [
    { lng: 29.10992, lat: 41.13092, alt: 2, bearing: 130, pitch: 85 },
    { lng: -91.99389, lat: 46.84256, alt: 260, bearing: 0, pitch: 0 },
    { lng: -91.99389, lat: 46.84256, alt: 140, bearing: 328, pitch: 58 },
    { lng: 2.35, lat: 48.85, alt: 46000, bearing: 15, pitch: 30 },
  ];
  for (const H of [600, 900, 1440]) {
    for (const e of eyes) {
      const cam = cameraForEye(e, H);
      const back = eyeForCamera(cam, H);
      const d = metresBetween(e, back);
      assert.ok(Math.hypot(d.east, d.north) < Math.max(0.05, e.alt * 2e-4), `${JSON.stringify(e)} at ${H}px moved ${Math.hypot(d.east, d.north)} m`);
      near(back.alt, e.alt, e.alt * 1e-9 + 1e-9, 'alt');
      near(back.pitch, e.pitch, 1e-9, 'pitch');
      near(back.bearing, e.bearing, 1e-9, 'bearing');
    }
  }
  const street = cameraForEye(streetEye({ lng: -92.0, lat: 46.84 }, 20), 900);
  assert.equal(street.pitch, STREET_PITCH);
  assert.ok(street.zoom > 21.3 && street.zoom < 21.9, String(street.zoom));
  near(lookDist(eyeForCamera(street, 900)), MIN_LOOK_DIST, 1e-6);
  assert.equal(cameraForEye({ lng: 0, lat: 0, alt: 2, bearing: 0, pitch: 89 }, 900).pitch, 85);
});

test('the gaze lifts to the horizon only below the closest look distance', () => {
  assert.equal(minPitchFor(500), 0);
  assert.equal(minPitchFor(80), 0);
  near(minPitchFor(EYE_HEIGHT), STREET_PITCH, 0.05);
  assert.ok(minPitchFor(10) > 60 && minPitchFor(10) < STREET_PITCH);
  assert.ok(minPitchFor(MIN_LOOK_DIST) > 15 && minPitchFor(MIN_LOOK_DIST) < 30);
  for (let a = 1; a < 200; a += 0.25) assert.ok(Math.abs(minPitchFor(a + 0.25) - minPitchFor(a)) < 2.5, `at ${a} m`);
  for (let a = EYE_HEIGHT; a < 200; a += 0.5) assert.ok(a / Math.cos((minPitchFor(a) * Math.PI) / 180) >= MIN_LOOK_DIST - 0.3, `dist at ${a} m`);
});

function checkFlight(from, to, label) {
  const plan = planFlight(from, to);
  assert.ok(plan.duration >= 0.55 && plan.duration <= 4.4, `${label} duration ${plan.duration}`);
  const a = plan.at(0);
  const b = plan.at(1);
  for (const k of ['lng', 'lat', 'alt', 'pitch']) {
    near(a[k], from[k], Math.abs(from[k]) * 1e-9 + 1e-9, `${label} start ${k}`);
    near(b[k], to[k], Math.abs(to[k]) * 1e-9 + 1e-9, `${label} end ${k}`);
  }
  near(shortestAngle(b.bearing, to.bearing), 0, 1e-9, `${label} end bearing`);
  let prev = a;
  for (let i = 1; i <= 400; i++) {
    const e = plan.at(i / 400);
    assert.ok(lookDist(e) >= MIN_LOOK_DIST - 0.3, `${label} look distance ${lookDist(e)} at ${i}`);
    assert.ok(e.pitch >= 0 && e.pitch <= STREET_PITCH, `${label} pitch ${e.pitch}`);
    const d = metresBetween(prev, e);
    assert.ok(Math.hypot(d.east, d.north) <= Math.max(3, plan.dist * 0.02) + prev.alt * 0.02, `${label} jump ${Math.hypot(d.east, d.north)} m at ${i}`);
    assert.ok(Math.abs(shortestAngle(prev.bearing, e.bearing)) < 3, `${label} turn at ${i}`);
    assert.ok(Math.abs(e.pitch - prev.pitch) < 3, `${label} tilt at ${i}`);
    assert.ok(Math.abs(Math.log(e.alt / prev.alt)) < 0.12, `${label} height at ${i}`);
    prev = e;
  }
  return plan;
}

test('flights: drone survey down to the street and back up', () => {
  const survey = eyeForCamera(surveyCamera(site, { width: 1440, height: 900 }), 900);
  const start = site.street.route.find((r) => r.id === site.street.photoId);
  const ground = streetEye(start, 250);
  const down = checkFlight(survey, ground, 'descent');
  assert.ok(down.descending && !down.rising);
  const mid = down.at(0.75);
  const left = metresBetween(mid, ground);
  assert.ok(Math.hypot(left.east, left.north) < 0.15 * down.dist + 5, `still ${Math.hypot(left.east, left.north)} m away at 75%`);
  const up = checkFlight(ground, survey, 'rise');
  assert.ok(up.rising && !up.descending);
  const early = up.at(0.25);
  const moved = metresBetween(ground, early);
  assert.ok(Math.hypot(moved.east, moved.north) < 0.2 * up.dist, `moved ${Math.hypot(moved.east, moved.north)} m by 25%`);
  assert.ok(early.alt > 2 * EYE_HEIGHT, `only ${early.alt} m up at 25%`);
  const half = down.at(0.5);
  const away = metresBetween(half, ground);
  assert.ok(Math.hypot(away.east, away.north) < 2.5 * half.alt + 10, `${Math.hypot(away.east, away.north)} m away at ${half.alt} m up`);
});

test('flights: from a city view to a street, and between drone photos', () => {
  const city = { lng: 29.02, lat: 41.03, alt: 46000, bearing: 0, pitch: 0 };
  const street = { lng: 29.10992, lat: 41.13092, alt: EYE_HEIGHT, bearing: 130, pitch: STREET_PITCH };
  const long = checkFlight(city, street, 'city to street');
  assert.ok(long.duration > 2.5);
  const vp = { width: 1440, height: 900, top: 120, bottom: 150, left: 90, right: 90 };
  const a = eyeForCamera(photoCamera(site.shots[3], vp), 900);
  const b = eyeForCamera(photoCamera(site.shots[4], vp), 900);
  const glide = checkFlight(a, b, 'photo to photo');
  assert.ok(glide.duration < 1.6, String(glide.duration));
});

test('flights that start or end flat and very low ease into the tilt instead of snapping', () => {
  const low = { lng: 29.1099, lat: 41.1309, alt: 19, bearing: 40, pitch: 0 };
  const street = { lng: 29.1101, lat: 41.1311, alt: EYE_HEIGHT, bearing: 130, pitch: STREET_PITCH };
  for (const [from, to, label] of [[low, street, 'low map to street'], [street, low, 'street to low map']]) {
    const plan = planFlight(from, to);
    let prev = plan.at(0);
    near(prev.pitch, from.pitch, 1e-9, `${label} start`);
    for (let i = 1; i <= 400; i++) {
      const e = plan.at(i / 400);
      assert.ok(Math.abs(e.pitch - prev.pitch) < 2.5, `${label} tilt step ${Math.abs(e.pitch - prev.pitch)} at ${i}`);
      prev = e;
    }
    near(prev.pitch, to.pitch, 1e-9, `${label} end`);
  }
});

test('a drone photo is laid on the map upright and inside the free area', () => {
  const vp = { width: 1440, height: 900, top: 120, bottom: 150, left: 90, right: 90 };
  site.shots.forEach((shot) => {
    const cam = photoCamera(shot, vp);
    assert.equal(cam.pitch, 0);
    assert.ok(Math.abs(shortestAngle(cam.bearing, shot.yaw)) < 4, `${shot.name} bearing ${cam.bearing} vs yaw ${shot.yaw}`);
    const mpp = metresPerPixel(cam.zoom, cam.center[1]);
    const b = (cam.bearing * Math.PI) / 180;
    const pts = shot.footprint.map(([lng, lat]) => {
      const d = metresBetween({ lng: cam.center[0], lat: cam.center[1] }, { lng, lat });
      return { x: (d.east * Math.cos(b) - d.north * Math.sin(b)) / mpp, y: -(d.east * Math.sin(b) + d.north * Math.cos(b)) / mpp };
    });
    pts.forEach((p) => {
      assert.ok(p.x > -vp.width / 2 + vp.left - 1 && p.x < vp.width / 2 - vp.right + 1, `${shot.name} x ${p.x}`);
      assert.ok(p.y > -vp.height / 2 + vp.top - 1 && p.y < vp.height / 2 - vp.bottom + 1, `${shot.name} y ${p.y}`);
    });
    assert.ok(pts[0].y < pts[3].y && pts[0].x < pts[1].x, shot.name);
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    assert.ok(w > 0.85 * (vp.width - vp.left - vp.right) || h > 0.85 * (vp.height - vp.top - vp.bottom), `${shot.name} ${w}x${h}`);
  });
});

test('survey cameras and the shade around a photo', () => {
  const vp = { width: 1440, height: 900 };
  const top = surveyTopCamera(site, vp);
  const obl = surveyCamera(site, vp);
  assert.ok(top.zoom > 17 && top.zoom < 20, String(top.zoom));
  assert.equal(obl.pitch, 58);
  assert.ok(obl.zoom < top.zoom + 0.5);
  const shade = shadeAround(site, site.shots[0]);
  const [outer, hole] = shade.geometry.coordinates;
  const area = (r) => r.slice(0, -1).reduce((a, p, i, arr) => { const q = arr[(i + 1) % arr.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0);
  assert.ok(Math.sign(area(outer)) !== Math.sign(area(hole)), 'the hole winds the other way');
  assert.deepEqual(hole[0], hole[hole.length - 1]);
  assert.equal(shadeAround(site, null).geometry.coordinates.length, 1);
  assert.equal(footprintLine(site.shots[2]).geometry.coordinates.length, 5);
  site.shots.forEach((sh, i) => {
    const c = sh.footprint.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    assert.equal(nearestShot(site, c[0], c[1]), i);
  });
});
