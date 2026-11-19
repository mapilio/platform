// Globe layer: Mapilio coverage as points on a pale sphere, the story's place marked.
import * as THREE from 'three';

const DEG = Math.PI / 180;

function toSphere(latDeg, lonDeg, r = 1) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return new THREE.Vector3(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
}

const SPHERE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const SPHERE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uBase;
uniform vec3 uRim;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
  vec3 c = mix(uBase, uRim, pow(f, 2.2));
  gl_FragColor = vec4(c, uAlpha);
  #include <colorspace_fragment>
}
`;
const POINT_VERT = /* glsl */ `
attribute float aSize;
uniform float uPx;
varying float vFront;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normalize(position));
  vFront = dot(n, normalize(-mv.xyz));
  gl_PointSize = aSize * uPx;
  gl_Position = projectionMatrix * mv;
}
`;
const POINT_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAlpha;
varying float vFront;
void main() {
  if (vFront < 0.02) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.32, d) * uAlpha * smoothstep(0.02, 0.25, vFront);
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

export function createGlobeLayer({ world, colors, focus }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  tilt.add(spin);
  scene.add(tilt);

  const sphereU = {
    uBase: { value: new THREE.Color(colors.globe) },
    uRim: { value: new THREE.Color(colors.globeRim) },
    uAlpha: { value: 0 },
  };
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.ShaderMaterial({ uniforms: sphereU, vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG, transparent: true, depthWrite: true }),
  );
  sphere.renderOrder = 1;
  spin.add(sphere);

  // graticule every 15 degrees
  const grat = [];
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let lon = -180; lon < 180; lon += 3) {
      const a = toSphere(lat, lon, 1.001);
      const b = toSphere(lat, lon + 3, 1.001);
      grat.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  for (let lon = -180; lon < 180; lon += 15) {
    for (let lat = -84; lat < 84; lat += 3) {
      const a = toSphere(lat, lon, 1.001);
      const b = toSphere(lat + 3, lon, 1.001);
      grat.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const gratGeo = new THREE.BufferGeometry();
  gratGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grat), 3));
  const gratMat = new THREE.LineBasicMaterial({ color: new THREE.Color(colors.globeRim), transparent: true, opacity: 0, depthTest: true, depthWrite: false });
  const graticule = new THREE.LineSegments(gratGeo, gratMat);
  graticule.renderOrder = 2;
  spin.add(graticule);

  // coverage points
  const pts = world.points;
  const pos = new Float32Array((pts.length / 3) * 3);
  const size = new Float32Array(pts.length / 3);
  for (let i = 0, j = 0; i < pts.length; i += 3, j++) {
    const v = toSphere(pts[i + 1] * world.cell, pts[i] * world.cell, 1.003);
    pos[j * 3] = v.x; pos[j * 3 + 1] = v.y; pos[j * 3 + 2] = v.z;
    size[j] = 1.6 + Math.log2(1 + pts[i + 2]) * 0.55;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const pU = { uColor: { value: new THREE.Color(colors.blue) }, uAlpha: { value: 0 }, uPx: { value: 1 } };
  const points = new THREE.Points(pGeo, new THREE.ShaderMaterial({ uniforms: pU, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthTest: true, depthWrite: false }));
  points.renderOrder = 3;
  spin.add(points);

  // focus marker
  const fGeo = new THREE.BufferGeometry();
  const fv = toSphere(focus.lat, focus.lng, 1.006);
  fGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([fv.x, fv.y, fv.z]), 3));
  fGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([9]), 1));
  const fU = { uColor: { value: new THREE.Color(colors.hot) }, uAlpha: { value: 0 }, uPx: { value: 1 } };
  const focusPt = new THREE.Points(fGeo, new THREE.ShaderMaterial({ uniforms: fU, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthTest: true, depthWrite: false }));
  focusPt.renderOrder = 4;
  spin.add(focusPt);

  // orientation: bring the focus to face the camera (+z)
  tilt.rotation.x = focus.lat * DEG;
  const baseSpin = -focus.lng * DEG;
  let time = 0;

  function update(state, dt, width, height, dpr) {
    time += dt;
    const g = state.globe;
    camera.aspect = width / Math.max(1, height);
    // keep the globe inside the width on portrait screens
    const fit = Math.min(1, (0.88 * width) / Math.max(1, height) / 0.62);
    camera.position.set(0, 0, g.dist / fit);
    camera.lookAt(0, 0, 0);
    // lift the globe a little above the numbers row
    camera.setViewOffset(width, height, 0, height * 0.07, width, height);
    camera.updateProjectionMatrix();
    spin.rotation.y = baseSpin + g.spin * 0.9 + time * 0.035 * g.alpha;
    sphereU.uAlpha.value = g.alpha;
    gratMat.opacity = g.alpha * 0.35;
    pU.uAlpha.value = g.alpha;
    pU.uPx.value = dpr * (height / 900);
    fU.uAlpha.value = g.alpha;
    fU.uPx.value = dpr * (height / 900) * (1 + 0.25 * Math.sin(time * 3));
  }

  function dispose() {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  return { scene, camera, update, dispose };
}
