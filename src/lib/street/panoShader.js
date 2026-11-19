// Shared full-screen panorama shader for the homepage story and the /app walk viewer.
//
// One pass renders an equirectangular panorama with:
// - a continuous morph between a rectilinear street view and a stereographic
//   "little planet" (uRect / uS / uGamma),
// - walking transitions between two neighbouring panoramas without depth data:
//   each panorama is re-projected onto a proxy (ground plane + sphere around the
//   capture point) seen from the moving camera (uOffA / uOffB), then crossfaded,
// - a nadir cap that hides the capture vehicle (uCoreAmt) and a bottom shade,
// - a sky fade that turns the planet into a floating disc (uFade), optionally
//   to transparency so another layer (a map) can show through (uAlphaOut).
//
// World frame: +x east, +y up, -z north. Compass bearing b -> (sin b, 0, -cos b).
// Texture convention: flipY = false, texture centre (u = 0.5) looks along the
// panorama's heading (uHeadA / uHeadB, radians).

import * as THREE from 'three';

export const PANO_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const PANO_FRAGMENT = /* glsl */ `
precision highp float;
#define PI 3.141592653589793
#define TAU 6.283185307179586

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform vec2 uRes;
uniform vec4 uViewport;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uS;
uniform float uT;
uniform float uRect;
uniform float uGamma;
uniform vec2 uCenter;
uniform float uHeadA;
uniform float uHeadB;
uniform vec3 uOffA;
uniform vec3 uOffB;
uniform float uH;
uniform float uBowl;
uniform vec3 uBg;
uniform float uEl0;
uniform float uEl1;
uniform float uFade;
uniform float uAlphaOut;
uniform float uNadir;
uniform vec3 uCore;
uniform float uCoreAmt;
uniform float uCoreSoft;
uniform float uRingAmt;
uniform vec3 uShade;
uniform float uShadeAmt;
uniform float uOpacity;
uniform float uExposure;
// perspective (non-360) photos: 1 = perspective, tan of half fov (h, v)
uniform float uPerspA;
uniform float uPerspB;
uniform vec2 uTanA;
uniform vec2 uTanB;
uniform vec3 uVoid;

vec2 equirectUV(vec3 d, float head) {
  float lon = atan(d.x, -d.z) - head;
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(lon / TAU + 0.5, 0.5 - lat / PI);
}

// Direction from the panorama centre to the point the camera ray hits on the
// proxy: a sphere of radius uBowl centred on the ground point under the
// capture position, cut by the ground plane y = -uH.
vec3 proxyDir(vec3 o, vec3 d) {
  vec3 oc = o - vec3(0.0, -uH, 0.0);
  float b = dot(oc, d);
  float c = dot(oc, oc) - uBowl * uBowl;
  float t = -b + sqrt(max(b * b - c, 0.0));
  vec3 P = o + t * d;
  if (P.y < -uH && d.y < 0.0) {
    float tg = (-uH - o.y) / d.y;
    P = o + tg * d;
  }
  return normalize(P);
}

vec4 samplePano(sampler2D tex, vec3 dir, float head) {
  vec2 uv = equirectUV(dir, head);
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5);
  gy.x -= floor(gy.x + 0.5);
  return textureGrad(tex, uv, gx, gy);
}

// A perspective photo is placed at its true direction: the camera looked along
// its heading with a level horizon. Returns rgb + coverage alpha.
vec4 samplePersp(sampler2D tex, vec3 dir, float head, vec2 tanHalf) {
  vec3 f = vec3(sin(head), 0.0, -cos(head));
  vec3 rt = vec3(cos(head), 0.0, sin(head));
  float z = dot(dir, f);
  // outside the photo: a heavily blurred continuation of its edges (ambient fill)
  vec2 ip = vec2(dot(dir, rt), dir.y) / max(z, 0.02);
  vec2 uv = vec2(0.5 + 0.5 * ip.x / tanHalf.x, 0.5 - 0.5 * ip.y / tanHalf.y);
  vec2 uvc = clamp(uv, 0.0, 1.0);
  float outside = length(max(abs(uv - 0.5) - 0.5, 0.0));
  float amb = 0.5 * exp(-outside * 2.2) * smoothstep(-0.2, 0.35, z);
  vec3 ambient = textureLod(tex, uvc, 7.0).rgb * amb + uVoid * (1.0 - amb);
  if (z < 0.02) return vec4(ambient, 1.0);
  vec2 e = min(uv, 1.0 - uv);
  float m = smoothstep(0.0, 0.006, min(e.x, e.y));
  vec3 sharp = m > 0.0 ? texture(tex, uvc).rgb : ambient;
  return vec4(mix(ambient, sharp, m), 1.0);
}

vec4 sampleAny(sampler2D tex, vec3 dir, float head, float persp, vec2 tanHalf) {
  if (persp > 0.5) return samplePersp(tex, dir, head, tanHalf);
  return vec4(samplePano(tex, dir, head).rgb, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy - uViewport.xy;
  vec2 p = (frag / uViewport.zw) * 2.0 - 1.0;
  p.x *= uViewport.z / uViewport.w;
  p -= uCenter;

  // generalised stereographic (uGamma < 1 shrinks the nadir region)
  vec2 q = p * uS;
  float r = length(q);
  // compress only inside the horizon (r < 2); keep plain stereographic outside
  float g = mix(uGamma, 1.0, smoothstep(1.3, 2.1, r));
  float theta = 2.0 * atan(pow(max(r, 1e-6) * 0.5, g));
  vec2 dirXY = r > 1e-6 ? q / r : vec2(0.0);
  vec3 ds = vec3(sin(theta) * dirXY, cos(theta));
  vec3 dr = normalize(vec3(p * uT, 1.0));
  vec3 dv = normalize(mix(ds, dr, uRect));
  vec3 d = normalize(uRight * dv.x + uUp * dv.y + uFwd * dv.z);

  vec4 ca = sampleAny(uTexA, proxyDir(uOffA, d), uHeadA, uPerspA, uTanA);
  if (uMix > 0.001) {
    vec4 cb = sampleAny(uTexB, proxyDir(uOffB, d), uHeadB, uPerspB, uTanB);
    ca = mix(ca, cb, uMix);
  }
  vec3 col = mix(uVoid, ca.rgb, ca.a) * uExposure;

  float el = asin(clamp(d.y, -1.0, 1.0));

  // bottom shade (street mode) hides the roof of the capture vehicle
  float shade = smoothstep(0.22, 0.62, -el) * uShadeAmt;
  col = mix(col, uShade, shade);

  // nadir cap with a crisp light ring (planet mode)
  float core = smoothstep(uNadir + uCoreSoft, uNadir - uCoreSoft, el) * uCoreAmt;
  float ring = (1.0 - smoothstep(0.0, 0.010, abs(el - uNadir))) * uRingAmt;
  col = mix(col, uCore, core);
  col = mix(col, vec3(1.0), ring * 0.92);

  float fade = smoothstep(uEl0, uEl1, el) * uFade;
  if (uAlphaOut > 0.5) {
    gl_FragColor = vec4(col, (1.0 - fade) * uOpacity);
  } else {
    gl_FragColor = vec4(mix(col, uBg, fade), uOpacity);
  }
}
`;

export function createPanoUniforms() {
  return {
    uTexA: { value: null },
    uTexB: { value: null },
    uMix: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uViewport: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uFwd: { value: new THREE.Vector3(0, 0, -1) },
    uS: { value: 1 },
    uT: { value: Math.tan((70 * Math.PI) / 360) },
    uRect: { value: 1 },
    uGamma: { value: 1 },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uHeadA: { value: 0 },
    uHeadB: { value: 0 },
    uOffA: { value: new THREE.Vector3() },
    uOffB: { value: new THREE.Vector3() },
    uH: { value: 2.1 },
    uBowl: { value: 18 },
    // raw sRGB triplets: the panorama texture is sampled raw, so these must be too
    uBg: { value: new THREE.Vector3(1, 1, 1) },
    uEl0: { value: 0.2 },
    uEl1: { value: 0.9 },
    uFade: { value: 0 },
    uAlphaOut: { value: 0 },
    uNadir: { value: -0.44 },
    uCore: { value: new THREE.Vector3(0, 0.337, 0.945) },
    uCoreAmt: { value: 0 },
    uCoreSoft: { value: 0.012 },
    uRingAmt: { value: 0 },
    uShade: { value: new THREE.Vector3(0.04, 0.06, 0.1) },
    uShadeAmt: { value: 0 },
    uOpacity: { value: 1 },
    uExposure: { value: 1 },
    uPerspA: { value: 0 },
    uPerspB: { value: 0 },
    uTanA: { value: new THREE.Vector2(1, 0.75) },
    uTanB: { value: new THREE.Vector2(1, 0.75) },
    uVoid: { value: new THREE.Vector3(0.04, 0.055, 0.086) },
  };
}

export function createPanoMesh(uniforms, { transparent = false } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PANO_VERTEX,
    fragmentShader: PANO_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    transparent,
  });
  const geometry = new THREE.BufferGeometry();
  // one oversized triangle covers the viewport
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

const DEG = Math.PI / 180;

/** '#rrggbb' -> raw sRGB Vector3 (no colour management). */
export function srgb(hex, target = new THREE.Vector3()) {
  const h = hex.replace('#', '');
  return target.set(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

/** Camera basis for compass yaw (deg, clockwise from north) and pitch (deg, up positive). */
export function setViewBasis(uniforms, yawDeg, pitchDeg) {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  uniforms.uFwd.value.set(sy * cp, sp, -cy * cp);
  uniforms.uRight.value.set(cy, 0, sy);
  uniforms.uUp.value.set(-sy * sp, cp, cy * sp);
}

/**
 * Projection state.
 *  planet: 0 = rectilinear street view, 1 = stereographic little planet
 *  vfov:   vertical field of view of the street view (deg)
 *  planetRadius: horizon radius of the planet in half-viewport-height units
 *  gamma:  radial compression of the planet's nadir (1 = plain stereographic)
 */
export function setProjection(uniforms, { planet, vfov, planetRadius, gamma = 0.62 }) {
  const k = Math.min(1, Math.max(0, planet));
  const ke = k * k * (3 - 2 * k);
  const tHalf = Math.tan((vfov * DEG) / 2);
  // in the stereographic branch a direction at angle a from the axis lands at
  // r = 2 tan(a/2); matching the street view's half-height gives sStreet
  const sStreet = 2 * Math.tan((vfov * DEG) / 4);
  const sPlanet = 2 / Math.max(planetRadius, 1e-4);
  uniforms.uS.value = Math.exp(Math.log(sStreet) * (1 - ke) + Math.log(sPlanet) * ke);
  uniforms.uT.value = tHalf;
  uniforms.uRect.value = 1 - Math.min(1, k / 0.22);
  uniforms.uGamma.value = 1 + (gamma - 1) * ke;
  return ke;
}

/** Shortest signed angle difference b - a in degrees. */
export function angleDelta(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Sky fade that turns the planet into a floating disc. */
export function setPlanetFade(uniforms, planet) {
  const kf = Math.min(1, Math.max(0, (planet - 0.3) / 0.7));
  const e = kf * kf * (3 - 2 * kf);
  uniforms.uFade.value = e;
  uniforms.uEl0.value = (40 - 37 * kf) * DEG;
  uniforms.uEl1.value = (90 - 52 * kf) * DEG;
  return e;
}

/** Load a panorama into a mipmapped texture (flipY = false, wraps horizontally). */
export async function loadPanoTexture(renderer, src, { signal } = {}) {
  const res = await fetch(src, { signal, mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
  const blob = await res.blob();
  return textureFromBlob(renderer, blob);
}

export async function textureFromBlob(renderer, blob, { wrap = true } = {}) {
  let image;
  if (typeof createImageBitmap === 'function') {
    image = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  } else {
    image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }
  const tex = new THREE.Texture(image);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  renderer.initTexture(tex);
  if (image.close && tex.source) {
    // keep the bitmap: three may need it again after context loss
  }
  return tex;
}
