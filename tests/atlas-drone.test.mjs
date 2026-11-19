import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ZOOM_MIN, ZOOM_MAX, STOPS, metresPerPixel, altitudeForZoom, zoomForAltitude, railPosition, zoomForRail,
  chapterForZoom, formatAltitude, placeLevel, placeFromPhoton, yearRange, yearFilter,
} from '../src/views/platformApp/Atlas/altitude.mjs';
import {
  siteAsset, shotImage, siteGeoJSON, siteBounds, distanceM, formatDuration, siteFacts, pipeline, parsePoints,
  toOrthoXY, cornerRays, gridConvergence, localToLngLat,
} from '../src/lib/drone/drone.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/drone/brighton-beach.json'), 'utf8'));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

test('zoom and altitude are inverses and match the Mapbox camera', () => {
  near(metresPerPixel(0, 0), 78271.517, 0.01);
  near(metresPerPixel(10, 60), 78271.517 / 1024 / 2, 0.01);
  [[2, 0, 900], [11.2, 41, 800], [18.2, 46.84, 1080]].forEach(([z, lat, h]) => {
    near(zoomForAltitude(altitudeForZoom(z, lat, h), lat, h), z, 1e-9);
  });
  const alt = altitudeForZoom(18.2, 46.84, 1080);
  assert.ok(alt > 60 && alt < 400, String(alt));
});

test('the rail maps zoom to a 0-1 position and back, clamped', () => {
  assert.equal(railPosition(ZOOM_MAX), 0);
  assert.equal(railPosition(ZOOM_MIN), 1);
  assert.equal(railPosition(99), 0);
  assert.equal(railPosition(-5), 1);
  [1.4, 3, 11.2, 18.2, 20].forEach((z) => near(zoomForRail(railPosition(z)), z, 1e-9));
  assert.equal(zoomForRail(2), ZOOM_MIN);
  assert.equal(zoomForRail(-1), ZOOM_MAX);
  const pos = STOPS.map((st) => railPosition(st.zoom));
  assert.deepEqual([...pos].sort((a, b) => b - a), pos);
  assert.deepEqual(STOPS.map((st) => st.key), ['world', 'city', 'drone', 'street']);
});

test('chapters, place levels and altitude labels', () => {
  assert.deepEqual([2, 5, 10.6, 12, 16.2, 18.2].map(chapterForZoom), ['World', 'Country', 'Region', 'City', 'District', 'Drone height']);
  assert.deepEqual([2, 5, 9, 13, 17].map(placeLevel), ['world', 'country', 'region', 'city', 'street']);
  assert.equal(formatAltitude(2), '2.0 m');
  assert.equal(formatAltitude(120.4), '120 m');
  assert.equal(formatAltitude(4600), '4.6 km');
  assert.equal(formatAltitude(46000), '46 km');
  assert.equal(formatAltitude(12742000), '12,742 km');
  assert.equal(formatAltitude(NaN), '—');
});

test('place names come from the right level of a geocoder result', () => {
  const p = { name: 'Brighton Beach', street: 'Brighton Beach Road', district: 'Lakeside', city: 'Duluth', state: 'Minnesota', country: 'United States' };
  assert.equal(placeFromPhoton(null, 'city').title, 'The world');
  assert.deepEqual(placeFromPhoton(p, 'country'), { title: 'United States', sub: 'Minnesota' });
  assert.deepEqual(placeFromPhoton(p, 'region'), { title: 'Duluth', sub: 'Minnesota, United States' });
  assert.deepEqual(placeFromPhoton(p, 'city'), { title: 'Lakeside', sub: 'Duluth, Minnesota, United States' });
  assert.deepEqual(placeFromPhoton(p, 'street'), { title: 'Brighton Beach Road', sub: 'Lakeside, Duluth, United States' });
  assert.equal(placeFromPhoton({}, 'street').title, 'Unnamed street');
  assert.equal(placeFromPhoton({ country: 'Türkiye' }, 'country').sub, '');
});

test('capture-year window', () => {
  const years = yearRange(new Date('2026-11-18T00:00:00Z'));
  assert.equal(years[0], 2016);
  assert.equal(years[years.length - 1], 2026);
  assert.equal(years.length, 11);
  const f = yearFilter(2019, 2021);
  assert.equal(f[0], 'all');
  assert.equal(f[1][2], '2019');
  assert.equal(f[2][0], '<');
  assert.equal(f[2][2], '2022');
  assert.ok('2021-12-31 23:59:59' < '2022' && '2019-01-01 00:00:00' >= '2019');
});

test('every baked asset the manifest names exists', () => {
  const pub = (rel) => path.join(root, 'public', rel);
  assert.equal(siteAsset(site, 'ortho.webp'), '/drone/brighton-beach/ortho.webp');
  assert.ok(fs.existsSync(pub(siteAsset(site, site.ortho.url))));
  assert.ok(fs.existsSync(pub(siteAsset(site, site.points.url))));
  assert.equal(fs.statSync(pub(siteAsset(site, site.points.url))).size, site.points.count * 9);
  site.shots.forEach((shot) => {
    assert.ok(fs.existsSync(pub(shotImage(site, shot))), shot.name);
    assert.ok(fs.existsSync(pub(shotImage(site, shot, '480'))), shot.name);
  });
});

test('GeoJSON for the map: closed footprints, numbered features, flight line', () => {
  const g = siteGeoJSON(site);
  assert.equal(g.footprints.features.length, site.shots.length);
  assert.equal(g.shots.features.length, site.shots.length);
  assert.equal(g.path.geometry.coordinates.length, site.shots.length);
  g.footprints.features.forEach((f, i) => {
    const ring = f.geometry.coordinates[0];
    assert.equal(f.id, i);
    assert.equal(ring.length, 5);
    assert.deepEqual(ring[0], ring[4]);
  });
  assert.deepEqual(g.shots.features.map((f) => f.properties.index), site.shots.map((_, i) => i));
});

test('the orthophoto corners map to its pixel corners and cameras fall on it', () => {
  const { width: W, height: H, corners } = site.ortho;
  const want = [[0, 0], [W, 0], [W, H], [0, H]];
  corners.forEach(([lng, lat], i) => {
    const [x, y] = toOrthoXY(site, lng, lat);
    near(x, want[i][0], 2, `corner ${i} x`);
    near(y, want[i][1], 2, `corner ${i} y`);
  });
  const [w, s, e, n] = siteBounds(site);
  assert.ok(w < e && s < n);
  assert.ok(site.centre.lng > w && site.centre.lng < e && site.centre.lat > s && site.centre.lat < n);
  site.shots.forEach((shot) => {
    const [x, y] = toOrthoXY(site, shot.lng, shot.lat);
    assert.ok(x > -0.25 * W && x < 1.25 * W && y > -0.25 * H && y < 1.25 * H, `${shot.name} ${x},${y}`);
  });
  const [lw, ls, le, ln] = site.ortho.local;
  near(le - lw, (W * site.ortho.pixelCm) / 100, 0.05, 'local width');
  near(ln - ls, (H * site.ortho.pixelCm) / 100, 0.05, 'local height');
  site.shots.forEach((shot) => {
    const [x, y] = toOrthoXY(site, shot.lng, shot.lat);
    near(lw + (x / W) * (le - lw), shot.pos[0], 0.25, `${shot.name} east`);
    near(ln - (y / H) * (ln - ls), shot.pos[1], 0.25, `${shot.name} north`);
  });
  const widthM = distanceM({ lng: corners[0][0], lat: corners[0][1] }, { lng: corners[1][0], lat: corners[1][1] });
  near((widthM / W) * 100, site.ortho.pixelCm, 0.1, 'cm per pixel');
});

test('camera poses: corner rays look down and hit the baked footprints', () => {
  site.shots.forEach((shot) => {
    const rays = cornerRays(site, shot);
    assert.equal(rays.length, 4);
    rays.forEach((d, i) => {
      near(Math.hypot(d[0], d[1], d[2]), 1, 1e-9, 'unit');
      assert.ok(d[2] < -0.3, `${shot.name} ray ${i} points down: ${d[2]}`);
      const fx = shot.footprintLocal[i][0] - shot.pos[0];
      const fy = shot.footprintLocal[i][1] - shot.pos[1];
      const cross = fx * d[1] - fy * d[0];
      const dot = fx * d[0] + fy * d[1];
      assert.ok(dot > 0, `${shot.name} corner ${i} in front`);
      assert.ok(Math.abs(cross) / Math.hypot(fx, fy) < 0.02, `${shot.name} corner ${i} off the ray: ${cross}`);
      const drop = (-d[2] / Math.hypot(d[0], d[1])) * Math.hypot(fx, fy);
      near(drop, shot.agl, 0.6, `${shot.name} corner ${i} height`);
    });
  });
});

test('facts and pipeline come straight from the OpenDroneMap report', () => {
  const f = siteFacts(site);
  assert.equal(f.photos, 18);
  assert.equal(f.camera, 'DJI FC300S');
  assert.ok(!/[\u0000-\u001f]/.test(JSON.stringify(site.camera)), 'no control characters in EXIF strings');
  assert.equal(f.gsdCm, site.odm.gsdCm);
  assert.equal(f.densePoints, site.odm.densePoints);
  assert.ok(f.aglMin <= f.aglMean && f.aglMean <= f.aglMax);
  assert.equal(f.processing, '2 min 59 s');
  assert.equal(formatDuration(42), '42 s');
  assert.equal(formatDuration(undefined), '0 s');
  const steps = pipeline(site);
  assert.deepEqual(steps.map((x) => x.key), ['photos', 'sfm', 'dense', 'mesh', 'geo', 'ortho']);
  steps.forEach((x) => assert.ok(x.label && x.tool && x.value && x.note));
  assert.match(steps[2].value, /1,038,417/);
});

test('point cloud parsing: east/north/up shorts to three.js axes, colours 0-1', () => {
  const count = 2;
  const buf = new ArrayBuffer(count * 9);
  new Int16Array(buf, 0, count * 3).set([200, 400, 600, -200, -400, -600]);
  new Uint8Array(buf, count * 6, count * 3).set([255, 0, 51, 0, 255, 102]);
  const { positions, colors } = parsePoints(buf, count, 0.005);
  [1, 3, -2, -1, -3, 2].forEach((v, i) => near(positions[i], v, 1e-6, `pos ${i}`));
  [1, 0, 0.2, 0, 1, 0.4].forEach((v, i) => near(colors[i], v, 1e-6, `col ${i}`));
});

test('distance and the street-level link', () => {
  near(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 111195, 5);
  assert.equal(site.street.route.length > 10, true);
  const start = site.street.route.find((r) => r.id === site.street.photoId);
  assert.ok(start, 'the linked photo is on the route');
  near(distanceM(start, site.centre), site.street.distanceM, 25, 'distance to the survey');
});

test('the 3D frame follows the UTM grid: turned by the grid convergence, cameras land on their GPS positions', () => {
  const g = (gridConvergence(site) * 180) / Math.PI;
  assert.ok(Math.abs(Math.abs(g) - 0.73) < 0.05, String(g));
  site.shots.forEach((shot) => {
    const [lng, lat] = localToLngLat(site, shot.pos[0], shot.pos[1]);
    assert.ok(distanceM({ lng, lat }, shot) < 0.2, `${shot.name} off by ${distanceM({ lng, lat }, shot)} m`);
  });
});
