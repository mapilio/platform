// Map layer of the homepage story: Mapilio coverage lines of the area (drawn in
// by capture time), OpenStreetMap context (roads, tracks, streams, park
// boundary), the walked sequence as a ribbon, a marker and a drone with its
// camera frustum and ground footprint.
// World frame: +x east, +y up, -z north, metres from the hero photo.

import * as THREE from 'three';
import { MAP_VFOV } from './timeline.mjs';

const R_EARTH = 6378137;
const DEG = Math.PI / 180;

function originOffset(from, to) {
  // metres east / north of `from` relative to `to`
  const east = (from.lng - to.lng) * DEG * R_EARTH * Math.cos(to.lat * DEG);
  const north = (from.lat - to.lat) * DEG * R_EARTH;
  return [east, north];
}

function decodePolyline(arr, start, unit, offE, offN) {
  const pts = [];
  let x = 0;
  let y = 0;
  for (let k = start; k + 1 < arr.length; k += 2) {
    if (k === start) { x = arr[k]; y = arr[k + 1]; } else { x += arr[k]; y += arr[k + 1]; }
    pts.push(x * unit + offE, y * unit + offN);
  }
  return pts;
}

// coverage line: [is360, x0, y0, r0, dx, dy, dr, ...]; x/y in `unit` metres,
// r = position in capture order (0..1) in 1/10000
function decodeCoverageLine(arr, unit, offE, offN) {
  const pts = [];
  let x = 0;
  let y = 0;
  let r = 0;
  for (let k = 1; k + 2 < arr.length; k += 3) {
    if (k === 1) { x = arr[k]; y = arr[k + 1]; r = arr[k + 2]; } else { x += arr[k]; y += arr[k + 1]; r += arr[k + 2]; }
    pts.push(x * unit + offE, y * unit + offN, r / 10000);
  }
  return pts;
}

// coverage lines are drawn as thin ribbons (a fixed width on screen), so a few
// walks stay readable from a kilometre up
const COVERAGE_VERT = /* glsl */ `
attribute float aReveal;
attribute float a360;
attribute vec2 aNormal;
attribute float aSide;
uniform float uWidth;
varying float vReveal;
varying float v360;
varying vec2 vXZ;
void main() {
  vReveal = aReveal;
  v360 = a360;
  vXZ = position.xz;
  vec3 p = position + vec3(aNormal.x, 0.0, aNormal.y) * aSide * uWidth * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const COVERAGE_FRAG = /* glsl */ `
precision highp float;
uniform float uReveal;
uniform float uAlpha;
uniform vec3 uBg;
uniform vec3 uBlue;
uniform vec3 uViolet;
uniform vec3 uHot;
uniform vec4 uFoot;
uniform vec2 uFootDir;
uniform float uFootAmt;
varying float vReveal;
varying float v360;
varying vec2 vXZ;
void main() {
  if (vReveal > uReveal) discard;
  // the newest part of the drawing is hot, then settles into its colour
  float age = uReveal - vReveal;
  vec3 c = mix(uBlue, uViolet, v360);
  float fresh = (1.0 - smoothstep(0.0, 0.03, age)) * step(uReveal, 0.999);
  c = mix(c, uHot, fresh * 0.75);
  float k = 0.62 + 0.38 * fresh;
  vec2 d = vXZ - uFoot.xy;
  vec2 l = vec2(dot(d, uFootDir), dot(d, vec2(-uFootDir.y, uFootDir.x)));
  float inside = step(abs(l.y), uFoot.z) * step(abs(l.x), uFoot.w) * uFootAmt;
  c = mix(c, uHot, inside);
  k = max(k, inside);
  // strength is mixed against the paper colour so overlapping joins do not darken
  gl_FragColor = vec4(mix(uBg, c, k), uAlpha);
  #include <colorspace_fragment>
}
`;

const RIBBON_VERT = /* glsl */ `
attribute vec2 aNormal;
attribute float aSide;
attribute float aWalked;
uniform float uWidth;
varying float vWalked;
void main() {
  vWalked = aWalked;
  vec3 p = position + vec3(aNormal.x, 0.0, aNormal.y) * aSide * uWidth * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const RIBBON_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uWalkColor;
uniform float uAlpha;
varying float vWalked;
void main() {
  gl_FragColor = vec4(mix(uColor, uWalkColor, vWalked), uAlpha);
  #include <colorspace_fragment>
}
`;

function buildCoverage(lines) {
  // lines: [{ pts: [east, north, reveal, ...], is360 }]
  const pos = [];
  const nor = [];
  const side = [];
  const rev = [];
  const p360 = [];
  const idx = [];
  let base = 0;
  lines.forEach(({ pts, is360 }) => {
    const n = pts.length / 3;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 3;
      const b = Math.min(n - 1, i + 1) * 3;
      let dx = pts[b] - pts[a];
      let dz = -(pts[b + 1] - pts[a + 1]);
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      for (let sd = -1; sd <= 1; sd += 2) {
        pos.push(pts[i * 3], 0, -pts[i * 3 + 1]);
        nor.push(-dz, dx);
        side.push(sd);
        rev.push(pts[i * 3 + 2]);
        p360.push(is360);
      }
      if (i < n - 1) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    base += n * 2;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aNormal', new THREE.BufferAttribute(new Float32Array(nor), 2));
  g.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(side), 1));
  g.setAttribute('aReveal', new THREE.BufferAttribute(new Float32Array(rev), 1));
  g.setAttribute('a360', new THREE.BufferAttribute(new Float32Array(p360), 1));
  g.setIndex(base > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : idx);
  return g;
}

function buildRibbon(points2d, walkedFrom, walkedTo) {
  // points2d: [[east, north], ...]
  const n = points2d.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 2);
  const side = new Float32Array(n * 2);
  const walked = new Float32Array(n * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = points2d[Math.max(0, i - 1)];
    const b = points2d[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = -(b[1] - a[1]);
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const nx = -dz;
    const nz = dx;
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      pos[k * 3] = points2d[i][0];
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = -points2d[i][1];
      nor[k * 2] = nx;
      nor[k * 2 + 1] = nz;
      side[k] = s === 0 ? -1 : 1;
      walked[k] = i >= walkedFrom && i <= walkedTo ? 1 : 0;
    }
    if (i < n - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aNormal', new THREE.BufferAttribute(nor, 2));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aWalked', new THREE.BufferAttribute(walked, 1));
  g.setIndex(idx);
  return g;
}

function routeSample(route, t) {
  // t in [0, route.length - 1]
  const i = Math.max(0, Math.min(route.length - 2, Math.floor(t)));
  const f = Math.min(1, Math.max(0, t - i));
  const a = route[i];
  const b = route[i + 1];
  const east = a[0] + (b[0] - a[0]) * f;
  const north = a[1] + (b[1] - a[1]) * f;
  const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return { east, north, heading };
}

const CONTEXT_STYLE = {
  park: { color: 'park', opacity: 0.9, order: 1 },
  water: { color: 'water', opacity: 0.85, order: 1 },
  path: { color: 'path', opacity: 0.75, order: 1 },
  road: { color: 'coast', opacity: 0.9, order: 1 },
};

export function createMapLayer({ coverage, meta, colors }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(MAP_VFOV, 1, 1, 1e7);
  const C = {
    blue: new THREE.Color(colors.blue),
    violet: new THREE.Color(colors.violet),
    hot: new THREE.Color(colors.hot),
    coast: new THREE.Color(colors.coast),
    park: new THREE.Color(colors.park || colors.coast),
    water: new THREE.Color(colors.water || colors.coast),
    path: new THREE.Color(colors.path || colors.coast),
    ink: new THREE.Color(colors.ink),
    walk: new THREE.Color(colors.walk),
  };

  // ---- coverage lines
  const [offE, offN] = originOffset(coverage.origin, meta.origin);
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  const covLines = coverage.lines.map((line) => {
    const pts = decodeCoverageLine(line, coverage.unit, offE, offN);
    for (let k = 0; k < pts.length; k += 3) {
      minE = Math.min(minE, pts[k]); maxE = Math.max(maxE, pts[k]);
      minN = Math.min(minN, pts[k + 1]); maxN = Math.max(maxN, pts[k + 1]);
    }
    return { pts, is360: line[0] };
  });
  const covGeo = buildCoverage(covLines);
  const covUniforms = {
    uReveal: { value: 1 },
    uAlpha: { value: 1 },
    uWidth: { value: 2 },
    uBg: { value: new THREE.Color(colors.sky) },
    uBlue: { value: C.blue },
    uViolet: { value: C.violet },
    uHot: { value: C.hot },
    uFoot: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFootDir: { value: new THREE.Vector2(1, 0) },
    uFootAmt: { value: 0 },
  };
  const covMat = new THREE.ShaderMaterial({
    uniforms: covUniforms,
    vertexShader: COVERAGE_VERT,
    fragmentShader: COVERAGE_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coverageLines = new THREE.Mesh(covGeo, covMat);
  coverageLines.frustumCulled = false;
  coverageLines.renderOrder = 2;
  scene.add(coverageLines);
  const cityCenter = new THREE.Vector3((minE + maxE) / 2, 0, -(minN + maxN) / 2);

  // ---- OpenStreetMap context: one line set per kind
  const context = [];
  Object.keys(CONTEXT_STYLE).forEach((kind) => {
    const list = (coverage.context && coverage.context[kind]) || [];
    if (!list.length) return;
    const ctxSegs = [];
    list.forEach((line) => {
      const pts = decodePolyline(line, 0, coverage.contextUnit || coverage.unit, offE, offN);
      for (let k = 0; k + 3 < pts.length; k += 2) ctxSegs.push(pts[k], 0, -pts[k + 1], pts[k + 2], 0, -pts[k + 3]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ctxSegs), 3));
    const style = CONTEXT_STYLE[kind];
    const mat = new THREE.LineBasicMaterial({ color: C[style.color], transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = style.order;
    scene.add(lines);
    context.push({ mat, opacity: style.opacity });
  });

  // ---- the full sequence as a ribbon; the walked part highlighted
  // (route index = photo index in the sequence; the walk may run either way)
  const route = meta.route;
  const walkIdx = meta.frames.slice(Math.max(0, meta.frames.findIndex((f) => f.i === meta.hero))).map((f) => f.i);
  const walkFirst = Math.min(...walkIdx);
  const walkLast = walkIdx[walkIdx.length - 1];
  const walkMax = Math.max(...walkIdx);
  const ribbonUniforms = {
    uWidth: { value: 3 },
    uColor: { value: C.blue },
    uWalkColor: { value: C.walk },
    uAlpha: { value: 0 },
  };
  const ribbon = new THREE.Mesh(
    buildRibbon(route, walkFirst, walkMax),
    new THREE.ShaderMaterial({ uniforms: ribbonUniforms, vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  ribbon.frustumCulled = false;
  ribbon.renderOrder = 3;
  scene.add(ribbon);

  const end = meta.frames[meta.frames.length - 1];
  const endPos = new THREE.Vector3(end.x, 0, -end.y);

  // ---- marker at the photo we lifted off from
  const markerGroup = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(0.72, 1, 64).rotateX(-Math.PI / 2);
  const dotGeo = new THREE.CircleGeometry(0.34, 40).rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const dotMat = new THREE.MeshBasicMaterial({ color: C.hot, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const pulseMat = new THREE.MeshBasicMaterial({ color: C.hot, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, markerMat);
  const dot = new THREE.Mesh(dotGeo, dotMat);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2), pulseMat);
  [ring, dot, pulse].forEach((m) => { m.renderOrder = 6; m.frustumCulled = false; markerGroup.add(m); });
  markerGroup.position.copy(endPos);
  scene.add(markerGroup);

  // ---- drone, frustum and footprint
  const droneGroup = new THREE.Group();
  const droneMat = new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const armPts = [];
  const rotorR = 0.55;
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
    armPts.push(0, 0, 0, sx * 1.1, 0, sz * 1.1);
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * Math.PI * 2;
      const a1 = ((k + 1) / 24) * Math.PI * 2;
      armPts.push(sx * 1.1 + Math.cos(a0) * rotorR, 0, sz * 1.1 + Math.sin(a0) * rotorR, sx * 1.1 + Math.cos(a1) * rotorR, 0, sz * 1.1 + Math.sin(a1) * rotorR);
    }
  });
  armPts.push(-0.35, 0, -0.5, 0.35, 0, -0.5, 0.35, 0, -0.5, 0.35, 0, 0.5, 0.35, 0, 0.5, -0.35, 0, 0.5, -0.35, 0, 0.5, -0.35, 0, -0.5);
  const droneGeo = new THREE.BufferGeometry();
  droneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(armPts), 3));
  const droneLines = new THREE.LineSegments(droneGeo, droneMat);
  droneLines.renderOrder = 8;
  droneLines.frustumCulled = false;
  droneGroup.add(droneLines);
  scene.add(droneGroup);

  const frustumGeo = new THREE.BufferGeometry();
  frustumGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3 * 2), 3));
  const frustumMat = new THREE.LineBasicMaterial({ color: C.blue, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const frustum = new THREE.LineSegments(frustumGeo, frustumMat);
  frustum.frustumCulled = false;
  frustum.renderOrder = 7;
  scene.add(frustum);

  const footGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const footMat = new THREE.MeshBasicMaterial({ color: C.blue, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const foot = new THREE.Mesh(footGeo, footMat);
  foot.renderOrder = 4;
  foot.frustumCulled = false;
  scene.add(foot);

  const DRONE_AGL = 80;
  const FOOT_W = 2 * DRONE_AGL * Math.tan(36 * DEG);
  const FOOT_H = 2 * DRONE_AGL * Math.tan(27 * DEG);

  const tmpTarget = new THREE.Vector3();
  const tmpBear = new THREE.Vector3();
  let time = 0;

  function update(state, dt, width, height) {
    time += dt;
    const m = state.map;
    camera.aspect = width / Math.max(1, height);

    // drone along the route, beyond the walked part
    const routeT = walkLast + (Math.min(route.length - 2, walkLast + 90) - walkLast) * m.drone;
    const ds = routeSample(route, routeT);
    const dronePos = new THREE.Vector3(ds.east, DRONE_AGL, -ds.north);

    // camera target
    if (m.target === 'city') {
      const droneGround = new THREE.Vector3(ds.east, 0, -ds.north);
      tmpTarget.copy(endPos).lerp(droneGround, 0.55).lerp(cityCenter, m.targetMix || 0);
    } else if (m.drone > 0) {
      const droneGround = new THREE.Vector3(ds.east, 0, -ds.north);
      tmpTarget.copy(endPos).lerp(droneGround, 0.55 * Math.min(1, m.drone * 1.6));
    } else {
      tmpTarget.copy(endPos);
    }
    const b = m.bearing * DEG;
    tmpBear.set(Math.sin(b), 0, -Math.cos(b));
    const tilt = m.tilt * DEG;
    camera.position.set(
      tmpTarget.x - tmpBear.x * m.h * Math.tan(tilt),
      m.h,
      tmpTarget.z - tmpBear.z * m.h * Math.tan(tilt),
    );
    camera.up.copy(tmpBear);
    camera.lookAt(tmpTarget);
    camera.near = Math.max(0.5, m.h * 0.05);
    camera.far = m.h * 60 + 200000;
    // shift the composition right so it clears the text column
    if (m.shiftX) camera.setViewOffset(width, height, -width * m.shiftX, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();

    const pxPerMetre = height / (2 * m.h * Math.tan((MAP_VFOV * DEG) / 2));
    const a = m.alpha;

    covUniforms.uReveal.value = m.reveal;
    covUniforms.uAlpha.value = a * m.coverageAlpha;
    covUniforms.uWidth.value = 2.4 / Math.max(pxPerMetre, 1e-6);
    context.forEach((c) => { c.mat.opacity = a * m.contextAlpha * c.opacity; });
    ribbonUniforms.uAlpha.value = a * m.routeAlpha;
    ribbonUniforms.uWidth.value = 3.2 / Math.max(pxPerMetre, 1e-6);

    // marker keeps a constant on-screen size
    const markerScale = 9 / Math.max(pxPerMetre, 1e-6);
    markerGroup.scale.setScalar(markerScale);
    markerMat.opacity = a * m.markerAlpha;
    dotMat.opacity = a * m.markerAlpha;
    const ph = (time * 0.6) % 1;
    pulse.scale.setScalar(1 + ph * 2.6);
    pulseMat.opacity = a * m.markerAlpha * (1 - ph) * 0.8;

    // drone
    const da = a * m.droneAlpha;
    droneMat.opacity = da;
    frustumMat.opacity = da * 0.7;
    footMat.opacity = da * 0.1;
    const glyph = 28 / Math.max(pxPerMetre, 1e-6);
    droneGroup.position.copy(dronePos);
    droneGroup.rotation.y = -ds.heading;
    droneGroup.scale.setScalar(glyph);
    droneGroup.visible = da > 0.001;
    frustum.visible = da > 0.001;
    foot.visible = da > 0.001;
    const ch = Math.cos(ds.heading);
    const sh = Math.sin(ds.heading);
    // footprint axes: along-track (sin h, -cos h) and cross-track (cos h, sin h) in x/z
    const ax = [sh, -ch];
    const cx = [ch, sh];
    const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, v]) => [
      ds.east + ax[0] * u * FOOT_H / 2 + cx[0] * v * FOOT_W / 2,
      -ds.north + ax[1] * u * FOOT_H / 2 + cx[1] * v * FOOT_W / 2,
    ]);
    const fp = frustumGeo.attributes.position.array;
    let k = 0;
    corners.forEach(([x, z], ci) => {
      fp[k++] = dronePos.x; fp[k++] = dronePos.y; fp[k++] = dronePos.z;
      fp[k++] = x; fp[k++] = 0; fp[k++] = z;
      const [nx, nz] = corners[(ci + 1) % 4];
      fp[k++] = x; fp[k++] = 0; fp[k++] = z;
      fp[k++] = nx; fp[k++] = 0; fp[k++] = nz;
    });
    frustumGeo.attributes.position.needsUpdate = true;
    foot.position.set(ds.east, 0, -ds.north);
    foot.rotation.y = -ds.heading;
    foot.scale.set(FOOT_W, 1, FOOT_H);
    covUniforms.uFoot.value.set(ds.east, -ds.north, FOOT_W / 2, FOOT_H / 2);
    covUniforms.uFootDir.value.set(ax[0], ax[1]);
    covUniforms.uFootAmt.value = da > 0.2 ? 1 : 0;

    return { pxPerMetre, cityCenter };
  }

  function project(vec3, width, height) {
    const v = vec3.clone().project(camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (1 - (v.y * 0.5 + 0.5)) * height, behind: v.z > 1 };
  }

  function dispose() {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  return { scene, camera, update, project, endPos, cityCenter, dispose };
}
