import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrames, is360, perspTan, frameIndexFor, nearestFrame, imageUrl, bearing,
} from '../src/views/platformApp/Walk/sequence.mjs';

const entries = [
  { id: 3, photo_uuid: 'c', capture_time: '2024-01-01 10:00:20', filename: 'c.jpg', latitude: '41.0002', longitude: '29.0000', uploaded_hash: 'h', heading: 0, resolution: '4096x2048', fov: '360' },
  { id: 1, photo_uuid: 'a', capture_time: '2024-01-01 10:00:00', filename: 'a.jpg', latitude: '41.0000', longitude: '29.0000', uploaded_hash: 'h', heading: null, resolution: '4096x2048', fov: '360' },
  { id: 2, photo_uuid: 'b', capture_time: '2024-01-01 10:00:10', filename: 'b.jpg', latitude: '41.0001', longitude: '29.0000', uploaded_hash: 'h', heading: 0, resolution: '4096x2048', fov: '360' },
  { id: 9, capture_time: '2024-01-01 10:00:30', filename: 'x.jpg', latitude: null, longitude: '29', uploaded_hash: 'h' },
];

test('frames are sorted by time, invalid rows dropped, distances accumulate', () => {
  const { frames, origin, length } = buildFrames(entries);
  assert.deepEqual(frames.map((f) => f.id), [1, 2, 3]);
  assert.equal(origin.lat, 41);
  assert.ok(Math.abs(frames[1].north - 11.13) < 0.05, String(frames[1].north));
  assert.ok(Math.abs(length - 22.26) < 0.1, String(length));
  assert.equal(frames[0].heading, 0);
});

test('360 detection and perspective field of view', () => {
  assert.equal(is360({ fov: '360', resolution: '5376x2688' }), true);
  assert.equal(is360({ fov: '94.5', resolution: '4000x2000' }), false);
  assert.equal(is360({ fov: null, resolution: '4096x2048' }), true);
  assert.equal(is360({ fov: '70', resolution: '1920x1080' }), false);
  const t = perspTan({ fov: '90', resolution: '1920x1080' });
  assert.ok(Math.abs(t.x - 1) < 1e-9);
  assert.ok(Math.abs(t.y - 1080 / 1920) < 1e-9);
  const portrait = perspTan({ fov: '90', resolution: '1080x1920' });
  assert.ok(portrait.y > portrait.x);
  assert.ok(perspTan({ fov: 'abc', resolution: '' }).x > 0.6);
});

test('lookups', () => {
  const { frames } = buildFrames(entries);
  assert.equal(frameIndexFor(frames, '2'), 1);
  assert.equal(frameIndexFor(frames, 'c'), 2);
  assert.equal(frameIndexFor(frames, null), 0);
  assert.equal(nearestFrame(frames, 0, 20), 2);
  assert.equal(nearestFrame(frames, 500, 500, 30), -1);
  assert.equal(imageUrl('https://cdn.mapilio.com/im', frames[0], 1080), 'https://cdn.mapilio.com/im/h/a.jpg/1080');
  assert.ok(Math.abs(bearing({ lat: 41, lng: 29 }, { lat: 41, lng: 29.001 }) - 90) < 0.01);
});

test('photos sharing one GPS fix stay separately reachable', () => {
  const same = [
    { id: 1, capture_time: '2024-01-01 10:00:00', filename: 'a.jpg', latitude: '41', longitude: '29', uploaded_hash: 'h', heading: 0, fov: '90', resolution: '4000x3000' },
    { id: 2, capture_time: '2024-01-01 10:00:01', filename: 'b.jpg', latitude: '41', longitude: '29', uploaded_hash: 'h', heading: 0, fov: '90', resolution: '4000x3000' },
    { id: 3, capture_time: '2024-01-01 10:00:02', filename: 'c.jpg', latitude: '41.0001', longitude: '29', uploaded_hash: 'h', heading: 0, fov: '90', resolution: '4000x3000' },
  ];
  const { frames } = buildFrames(same);
  assert.ok(frames[1].cum > frames[0].cum, 'distance grows even without movement');
  assert.ok(frames[1].cum - frames[0].cum < 0.1);
  assert.equal(frameIndexFor(frames, 2), 1);
});
