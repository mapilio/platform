// The drone survey in 3D, drawn inside the map: a Mapbox GL custom layer that
// shares the map's WebGL 2 context and camera, so tilting the map is orbiting the
// reconstruction and there is no second viewer to switch to.
//  - the dense point cloud rises out of the orthophoto as the map tilts
//  - every camera floats where OpenDroneMap solved it, with its frustum
//  - the current photo hangs in its frustum, with rays down to its footprint
// Local frame: x east, y north, z up, metres from the survey centre, ground at 0.
import * as THREE from 'three';
import { parsePoints, cornerRays, siteAsset, shotImage, gridConvergence } from 'lib/drone/drone.mjs';

const DEG = Math.PI / 180;
const ramp = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const POINT_VERT = /* glsl */ `
attribute vec3 color;
uniform float uSize;   // point diameter in metres
uniform float uK;      // device pixels per metre at clip w = 1
uniform float uRise;   // 0 flat on the ground, 1 full height
varying vec3 vColor;
void main() {
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, position.z * uRise, 1.0);
  gl_PointSize = clamp(uSize * uK / gl_Position.w, 1.0, 12.0);
}
`;
const POINT_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vColor, uAlpha);
}
`;
const DOT_VERT = /* glsl */ `
attribute float aActive;
uniform float uDpr;
varying float vActive;
void main() {
  vActive = aActive;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (aActive > 0.5 ? 19.0 : 12.0) * uDpr;
}
`;
const DOT_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
varying float vActive;
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  vec3 fill = vActive > 0.5 ? vec3(1.0, 0.722, 0.110) : vec3(1.0);
  vec3 ink = vec3(0.043, 0.071, 0.125);
  vec3 col = mix(fill, ink, smoothstep(0.31, 0.35, r));
  gl_FragColor = vec4(col, uAlpha * (1.0 - smoothstep(0.46, 0.5, r)));
}
`;

export function createDroneLayer({ mapboxgl, site, id = 'drone-3d', onReady, onChange }) {
  const origin = mapboxgl.MercatorCoordinate.fromLngLat([site.centre.lng, site.centre.lat], 0);
  const sc = origin.meterInMercatorCoordinateUnits();
  // OpenDroneMap's local frame follows the UTM grid, whose north differs from true north by the
  // grid convergence (about 0.7 degrees here); the orthophoto's top edge runs along grid east
  const gamma = gridConvergence(site);
  // local grid metres -> true east/north -> mercator units (mercator y grows southwards)
  const model = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(sc, -sc, sc))
    .multiply(new THREE.Matrix4().makeRotationZ(gamma));
  const pm = new THREE.Matrix4();
  const tmp = new THREE.Vector4();

  let map = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let disposed = false;
  let cloud = null;
  let loading = false;
  const st = { enabled: 1, target: 1, active: -1, last: 0, cssW: 1, cssH: 1, vis: 0 };

  const pointUniforms = { uSize: { value: 0.26 }, uK: { value: 600 }, uRise: { value: 0 }, uAlpha: { value: 0 } };
  const dotUniforms = { uDpr: { value: 1 }, uAlpha: { value: 0 } };
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const pathMat = new THREE.LineDashedMaterial({ color: 0xffb81c, dashSize: 1.4, gapSize: 1.2, transparent: true, opacity: 0, depthWrite: false });
  const rayMat = new THREE.LineBasicMaterial({ color: 0xffb81c, transparent: true, opacity: 0, depthWrite: false });
  const planeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false });

  const camPos = site.shots.map((s) => new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]));
  const DEPTH = 6.5;
  const corners = site.shots.map((s, i) => {
    const rays = cornerRays(site, s);
    const down = Math.max(0.2, Math.abs(rays.reduce((a, r) => a + r[2], 0) / 4));
    return rays.map((r) => camPos[i].clone().add(new THREE.Vector3(r[0], r[1], r[2]).multiplyScalar(DEPTH / down)));
  });
  let dotGeo = null;
  let planeGeo = null;
  let rayGeo = null;
  const loader = new THREE.TextureLoader();

  function build() {
    scene = new THREE.Scene();
    camera = new THREE.Camera();

    // frustums
    const segs = [];
    corners.forEach((cs, i) => {
      const o = camPos[i];
      cs.forEach((c, k) => {
        const n = cs[(k + 1) % 4];
        segs.push(o.x, o.y, o.z, c.x, c.y, c.z, c.x, c.y, c.z, n.x, n.y, n.z);
      });
    });
    const frGeo = new THREE.BufferGeometry();
    frGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    const fr = new THREE.LineSegments(frGeo, lineMat);
    fr.frustumCulled = false;
    fr.renderOrder = 2; // after the cloud has written depth: hidden only where really behind it
    scene.add(fr);

    // flight line
    const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(camPos), pathMat);
    path.computeLineDistances();
    path.frustumCulled = false;
    path.renderOrder = 2;
    scene.add(path);

    // camera dots
    dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(camPos.flatMap((p) => [p.x, p.y, p.z])), 3));
    dotGeo.setAttribute('aActive', new THREE.BufferAttribute(new Float32Array(camPos.length), 1));
    const dots = new THREE.Points(dotGeo, new THREE.ShaderMaterial({ uniforms: dotUniforms, vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false }));
    dots.frustumCulled = false;
    dots.renderOrder = 3;
    scene.add(dots);

    // the current photo in its frustum, and rays to its footprint
    planeGeo = new THREE.BufferGeometry();
    planeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    planeGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    planeGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.frustumCulled = false;
    plane.renderOrder = 2;
    scene.add(plane);
    rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const rays = new THREE.LineSegments(rayGeo, rayMat);
    rays.frustumCulled = false;
    rays.renderOrder = 2;
    scene.add(rays);

    loadCloud();
  }

  /** The dense cloud (2.5 MB); fetched when the layer is added, and again later if that failed. */
  function loadCloud() {
    if (cloud || loading || disposed || !scene) return;
    loading = true;
    fetch(siteAsset(site, site.points.url))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((buf) => {
        if (disposed || !scene) return;
        const { positions, colors } = parsePoints(buf, site.points.count, site.points.unit, 'enu');
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        cloud = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: pointUniforms, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true }));
        cloud.frustumCulled = false;
        cloud.renderOrder = 1;
        scene.add(cloud);
        if (onReady) onReady(null);
        if (map) map.triggerRepaint();
      })
      .catch((e) => { if (!disposed && onReady) onReady(e); })
      .finally(() => { loading = false; });
  }

  function setActive(i) {
    if (!dotGeo || i === st.active) return;
    st.active = i;
    const a = dotGeo.attributes.aActive.array;
    a.fill(0);
    if (i >= 0) a[i] = 1;
    dotGeo.attributes.aActive.needsUpdate = true;
    if (i < 0) { if (map) map.triggerRepaint(); return; }
    const cs = corners[i];
    const p = planeGeo.attributes.position.array;
    cs.forEach((c, k) => { p[k * 3] = c.x; p[k * 3 + 1] = c.y; p[k * 3 + 2] = c.z; });
    planeGeo.attributes.position.needsUpdate = true;
    const s = site.shots[i];
    const o = camPos[i];
    const gz = s.pos[2] - s.agl;
    const g = s.footprintLocal.map(([e, n]) => new THREE.Vector3(e, n, gz));
    const r = rayGeo.attributes.position.array;
    let q = 0;
    g.forEach((c, k) => {
      const n = g[(k + 1) % 4];
      [o, c, c, n].forEach((v) => { r[q++] = v.x; r[q++] = v.y; r[q++] = v.z; });
    });
    rayGeo.attributes.position.needsUpdate = true;
    // never show the previous camera's photo in this camera's frustum
    if (planeMat.map) { planeMat.map.dispose(); planeMat.map = null; planeMat.needsUpdate = true; }
    loader.load(shotImage(site, s, '480'), (tex) => {
      if (disposed || st.active !== i) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      if (planeMat.map) planeMat.map.dispose();
      planeMat.map = tex;
      planeMat.needsUpdate = true;
      if (map) map.triggerRepaint();
    }, undefined, () => { if (map) map.triggerRepaint(); });
    if (map) map.triggerRepaint();
  }

  /** Index of the camera dot under a screen point (CSS px), or -1. */
  function pick(x, y, radius = 16) {
    if (st.vis < 0.3) return -1;
    let best = -1;
    let bd = radius;
    camPos.forEach((p, i) => {
      tmp.set(p.x, p.y, p.z, 1).applyMatrix4(pm);
      if (tmp.w <= 0) return;
      const sx = (tmp.x / tmp.w * 0.5 + 0.5) * st.cssW;
      const sy = (1 - (tmp.y / tmp.w * 0.5 + 0.5)) * st.cssH;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  const layer = {
    id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      map = m;
      // three.js creates empty 3D textures when it starts, which WebGL refuses while
      // the map's image-upload flags are set; clear them for that moment only
      const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
      const premult = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try {
        renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
        renderer.autoClear = false;
      } finally {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premult);
      }
      build();
    },
    render(gl, matrix) {
      if (!renderer || !scene) return;
      const now = performance.now();
      const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0;
      st.last = now;
      let animating = false;
      if (st.enabled !== st.target) {
        st.enabled += Math.sign(st.target - st.enabled) * Math.min(Math.abs(st.target - st.enabled), dt * 2.4);
        animating = true;
      }
      const zoom = map.getZoom();
      const pitch = map.getPitch();
      // the reconstruction stands up as the map tilts; seen from straight above it would only hide the orthophoto
      const rise = ramp(8, 32, pitch) * ramp(14.5, 15.5, zoom) * st.enabled;
      const frus = ramp(16, 38, pitch) * ramp(15, 16, zoom) * st.enabled;
      st.vis = frus;
      onChange && onChange(rise, frus);
      if (rise < 0.002 && frus < 0.002) { st.last = animating ? now : 0; if (animating) map.triggerRepaint(); return; }

      pm.fromArray(matrix).multiply(model);
      camera.projectionMatrix.copy(pm);
      camera.projectionMatrixInverse.copy(pm).invert();
      const canvas = map.getCanvas();
      st.cssW = canvas.clientWidth || 1;
      st.cssH = canvas.clientHeight || 1;
      // device pixels per metre at the survey centre, times its clip w
      const b = map.getBearing() * DEG;
      const c0 = new THREE.Vector4(0, 0, 3, 1).applyMatrix4(pm);
      const c1 = new THREE.Vector4(Math.cos(b), -Math.sin(b), 3, 1).applyMatrix4(pm);
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const px = Math.hypot((c1.x / c1.w - c0.x / c0.w) * W * 0.5, (c1.y / c1.w - c0.y / c0.w) * H * 0.5);
      pointUniforms.uK.value = px * c0.w;
      pointUniforms.uRise.value = rise;
      pointUniforms.uAlpha.value = Math.min(1, rise * 1.4);
      dotUniforms.uDpr.value = W / st.cssW;
      dotUniforms.uAlpha.value = frus;
      lineMat.opacity = 0.5 * frus;
      pathMat.opacity = 0.85 * frus;
      rayMat.opacity = 0.95 * frus * (st.active >= 0 ? 1 : 0);
      planeMat.opacity = 0.96 * frus * (st.active >= 0 && planeMat.map ? 1 : 0);

      renderer.resetState();
      renderer.render(scene, camera);
      if (animating) map.triggerRepaint();
    },
    onRemove() {
      disposed = true;
      if (scene) scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      // the context belongs to the map; only drop three.js's own caches
      if (renderer) renderer.dispose();
      renderer = null;
      scene = null;
      map = null;
    },
  };

  return {
    layer,
    setActive,
    pick,
    /** Show or hide the reconstruction (fades); retries the point cloud if it did not load. */
    setEnabled(on) { st.target = on ? 1 : 0; if (on) loadCloud(); if (map) map.triggerRepaint(); },
    get visible() { return st.vis; },
  };
}
