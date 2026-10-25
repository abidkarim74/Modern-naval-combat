import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createSkyCloudTexture, SKY_CLOUD_TILE_METERS, SKY_SUN_ANGULAR_RADIUS } from "./skyCloudTexture";

export function createDaylightMaterial(scene: Scene, sunDirection: Vector3, moonDirection: Vector3): ShaderMaterial {
  const webGpu = scene.getEngine().isWebGPU;
  const material = new ShaderMaterial("clear-maritime-sky", scene, {
    vertexSource: webGpu ? vertexWgsl : vertexGlsl,
    fragmentSource: webGpu ? fragmentWgsl : fragmentGlsl,
  }, {
    attributes: ["position"],
    uniforms: ["viewProjection", "eyePosition", "sunDirection", "moonDirection", "nightFactor", "starIntensity",
      "time", "cloudTileMeters", "sunAngularRadius"],
    samplers: ["cloudSampler"],
    defines: ["SKY_DETAIL_LEVEL 1"],
    shaderLanguage: webGpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  }, false);
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.setVector3("sunDirection", sunDirection);
  material.setVector3("moonDirection", moonDirection);
  material.setFloat("nightFactor", 0);
  material.setFloat("starIntensity", 1);
  material.setFloat("time", 0);
  material.setFloat("cloudTileMeters", SKY_CLOUD_TILE_METERS);
  material.setFloat("sunAngularRadius", SKY_SUN_ANGULAR_RADIUS);
  material.setTexture("cloudSampler", createSkyCloudTexture(scene));
  material.onBindObservable.add(() => {
    const eye = scene._forcedViewPosition ?? scene.activeCamera?.globalPosition;
    if (!eye) return;
    material.setVector3("eyePosition", eye);
    // Bind this pass immediately, including reflection faces and parented cameras.
    const effect = material.getEffect();
    effect?.setVector3("eyePosition", eye);
    // Pixel-sized stars would bloom into blotches in the 64 px reflection
    // probe; the water reflects moon, Milky Way and clouds instead.
    effect?.setFloat("starIntensity", scene._forcedViewPosition ? 0 : 1);
  });
  return material;
}

const vertexGlsl = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 eyePosition;
varying vec3 skyDirection;
void main() {
  skyDirection = position;
  gl_Position = viewProjection * vec4(position + eyePosition, 1.0);
  // Preserve the existing far-depth sky so terrain always occludes it.
  gl_Position.z = gl_Position.w * 0.99999;
}`;
const vertexWgsl = `
attribute position : vec3<f32>;
uniform viewProjection : mat4x4<f32>;
uniform eyePosition : vec3<f32>;
varying skyDirection : vec3<f32>;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.skyDirection = vertexInputs.position;
  vertexOutputs.position = uniforms.viewProjection * vec4<f32>(vertexInputs.position + uniforms.eyePosition, 1.0);
  vertexOutputs.position.z = vertexOutputs.position.w * 0.99999;
}`;
const fragmentGlsl = `
precision highp float;
uniform vec3 eyePosition;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
uniform float nightFactor;
uniform float starIntensity;
uniform float time;
uniform float cloudTileMeters;
uniform float sunAngularRadius;
uniform sampler2D cloudSampler;
varying vec3 skyDirection;

// Galactic plane and bulge used for the Milky Way band.
const vec3 GALACTIC_NORMAL = vec3(0.79, 0.27, -0.55);
const vec3 GALACTIC_CENTER = vec3(0.55, 0.12, 0.83);
const float MOON_RADIUS = 0.0085;

vec3 starHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = starHash(i).x;
  float n100 = starHash(i + vec3(1.0, 0.0, 0.0)).x;
  float n010 = starHash(i + vec3(0.0, 1.0, 0.0)).x;
  float n110 = starHash(i + vec3(1.0, 1.0, 0.0)).x;
  float n001 = starHash(i + vec3(0.0, 0.0, 1.0)).x;
  float n101 = starHash(i + vec3(1.0, 0.0, 1.0)).x;
  float n011 = starHash(i + vec3(0.0, 1.0, 1.0)).x;
  float n111 = starHash(i + vec3(1.0, 1.0, 1.0)).x;
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm3(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += noise3(p) * amplitude;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    amplitude *= 0.5;
  }
  return value / 0.9375;
}
// One star per occupied cell of a 3D lattice intersected by the unit sphere.
// Stars are rendered at a fixed pixel footprint, so they stay pin-sharp at any
// resolution and never shimmer into soft blobs.
vec3 starField(vec3 direction, float cells, float density, float pixel, float scintillation) {
  vec3 p = direction * cells;
  vec3 cell = floor(p);
  vec3 h = starHash(cell + 19.19);
  if (h.x > density) return vec3(0.0);
  vec3 starDirection = normalize(cell + 0.2 + 0.6 * starHash(cell + 47.7));
  vec3 local = starDirection * cells - cell;
  float margin = min(0.3, pixel * cells * 2.5);
  if (min(min(local.x, local.y), local.z) < margin || max(max(local.x, local.y), local.z) > 1.0 - margin) {
    return vec3(0.0);
  }
  float separation = length(direction - starDirection);
  // Steep magnitude distribution: many faint stars, a handful of bright ones.
  float magnitude = pow(h.y, 7.0);
  float radius = pixel * (0.72 + 1.15 * magnitude);
  float core = exp(-separation * separation / (radius * radius));
  float halo = exp(-separation / (pixel * 4.5)) * magnitude * 0.16;
  float twinkle = 1.0 + scintillation * sin(time * (2.1 + 5.3 * h.z) + h.y * 97.0)
    * (0.6 + 0.4 * sin(time * (0.7 + 1.9 * h.x) + h.z * 41.0));
  // Stellar colour temperature: blue-white, white, yellow and orange giants.
  float temperature = starHash(cell + 5.31).y;
  vec3 tint = mix(vec3(0.66, 0.78, 1.0), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.42, temperature));
  tint = mix(tint, vec3(1.0, 0.74, 0.50), smoothstep(0.74, 1.0, temperature));
  return tint * (core * (0.14 + 1.35 * magnitude) + halo) * max(twinkle, 0.0);
}

void main() {
  vec3 direction = normalize(skyDirection);
  float elevation = max(direction.y, 0.0);
  float alignment = clamp(dot(direction, sunDirection), -1.0, 1.0);
  // Blue molecular scattering and longer haze paths toward the sea horizon.
  float airMass = 1.0 / (elevation + 0.16);
  float horizonHaze = 1.0 - exp(-pow(1.0 - elevation, 4.0) * 2.6);
  float rayleighPhase = 0.75 * (1.0 + alignment * alignment);
  vec3 zenith = vec3(0.105, 0.345, 0.735) * (0.88 + rayleighPhase * 0.12);
  vec3 color = mix(zenith, vec3(0.69, 0.81, 0.87), horizonHaze);
  float phaseDenominator = max(1.0 + 0.76 * 0.76 - 2.0 * 0.76 * alignment, 0.025);
  float miePhase = (1.0 - 0.76 * 0.76) / (phaseDenominator * sqrt(phaseDenominator));
  vec3 sunTint = vec3(1.0, 0.965, 0.88);
  color += sunTint * miePhase * 0.010 * (0.65 + airMass * 0.04);
  float separation = length(direction - sunDirection);
  color += sunTint * exp(-separation * 42.0) * 0.075;
  float sunPixelWidth = max(fwidth(separation), 0.00008);
  float disc = 1.0 - smoothstep(sunAngularRadius - sunPixelWidth, sunAngularRadius + sunPixelWidth, separation);
  color = mix(color, vec3(1.0, 0.995, 0.965), disc);

  // Derivatives stay in uniform control flow for both GLSL and WGSL builds.
  float pixel = max(length(fwidth(direction)), 0.00004);
  float moonSeparation = length(direction - moonDirection);
  float moonPixel = max(fwidth(moonSeparation), 0.00004);
  float moonAlignment = max(dot(direction, moonDirection), 0.0);
  vec3 nightHorizon = vec3(0.030, 0.044, 0.074);
  vec3 night = nightHorizon;
  if (nightFactor > 0.001) {
    // Deep zenith and faint airglow toward the horizon.
    night = mix(vec3(0.0035, 0.0075, 0.020), nightHorizon, pow(1.0 - elevation, 5.0));
    // Moonlight scattered in the atmosphere, then the tight lunar aureole.
    night += vec3(0.040, 0.062, 0.115) * pow(moonAlignment, 5.0) * 0.6;
    night += vec3(0.30, 0.36, 0.47) * exp(-moonSeparation * 34.0) * 0.18;
    night += vec3(0.62, 0.68, 0.80) * exp(-moonSeparation * 150.0) * 0.32;
    // Faint stars wash out near the horizon and in the moon's glare.
    float visibility = smoothstep(0.0, 0.2, direction.y) * (1.0 - 0.85 * exp(-moonSeparation * 4.5));
    float scintillation = 0.12 + 0.38 * (1.0 - smoothstep(0.0, 0.5, elevation));
    float galactic = dot(direction, GALACTIC_NORMAL);
    float band = exp(-galactic * galactic / 0.075);
    if (band > 0.02) {
      float clumps = fbm3(direction * 4.3 + vec3(3.1, 7.7, 1.3));
      float lanes = fbm3(direction * 9.5 + vec3(11.0, 2.0, 5.0));
      float bulge = pow(max(dot(direction, GALACTIC_CENTER), 0.0), 2.5);
      float rift = exp(-galactic * galactic / 0.006) * smoothstep(0.44, 0.66, lanes);
      float milkyWay = band * (0.30 + 0.70 * clumps * clumps) * (0.55 + 1.1 * bulge) * (1.0 - 0.75 * rift);
      night += mix(vec3(0.30, 0.35, 0.50), vec3(0.58, 0.51, 0.42), bulge) * milkyWay * 0.075 * visibility;
      // Unresolved star clouds that make up the band.
      night += starField(direction, 240.0, 0.22 * band * clumps, pixel, scintillation)
        * 0.5 * visibility * starIntensity;
    }
    night += starField(direction, 96.0, 0.13, pixel, scintillation) * visibility * starIntensity;
    // Full moon with limb darkening and dark lunar maria.
    float moonDisc = 1.0 - smoothstep(MOON_RADIUS - moonPixel, MOON_RADIUS + moonPixel, moonSeparation);
    if (moonDisc > 0.0) {
      vec3 moonRight = normalize(cross(vec3(0.0, 1.0, 0.0), moonDirection));
      vec3 moonUp = cross(moonDirection, moonRight);
      vec2 moonUv = vec2(dot(direction, moonRight), dot(direction, moonUp)) / MOON_RADIUS;
      float limb = sqrt(max(1.0 - dot(moonUv, moonUv), 0.0));
      float maria = noise3(vec3(moonUv * 2.2, 4.7)) * 0.65 + noise3(vec3(moonUv * 5.3, 9.1)) * 0.35;
      float craters = noise3(vec3(moonUv * 12.0, 1.3));
      vec3 lunar = vec3(0.98, 0.97, 0.93) * (0.78 + 0.22 * limb);
      lunar *= 1.0 - 0.30 * smoothstep(0.40, 0.66, maria) - 0.07 * craters;
      night = mix(night, lunar, moonDisc);
    }
  }

  // Conformal dome projection preserves rounded silhouettes toward the horizon.
  // Unlike a flat cloud plane it cannot stretch puffs into columns at grazing rays.
  vec2 cloudUv = direction.xz / (1.0 + elevation) * (10240.0 / cloudTileMeters) + vec2(0.31, 0.57);
  cloudUv -= vec2(0.00045, 0.00022) * time;
  vec4 cloud = texture2D(cloudSampler, cloudUv);
  float grain = cloud.b;
  float shadow = 0.0;
#if SKY_DETAIL_LEVEL > 0
  float sunDensity = texture2D(cloudSampler, cloudUv + sunDirection.xz * 0.012).r;
  shadow = max(sunDensity - cloud.r, 0.0) * 0.42;
#endif
#if SKY_DETAIL_LEVEL > 1
  grain = grain * 0.6 + texture2D(cloudSampler, cloudUv * 4.13 + vec2(0.19, 0.37)).b * 0.4;
#endif
  float coverage = smoothstep(0.14, 0.55, cloud.r - (grain - 0.5) * 0.075);
  coverage *= smoothstep(0.035, 0.095, direction.y);
  float lighting = clamp(0.48 + cloud.g * 0.67 - shadow, 0.38, 1.0);
  vec3 cloudColor = mix(vec3(0.42, 0.51, 0.63), vec3(0.975, 0.985, 1.0), lighting);
  cloudColor *= 0.88 + smoothstep(0.025, 0.45, elevation) * 0.12;
  float silverLining = pow(max(alignment, 0.0), 18.0) * (1.0 - cloud.a) * 0.23;
  cloudColor += sunTint * silverLining;
  cloudColor = mix(cloudColor, color, horizonHaze * 0.32);
  // Moonlit cloud: dark slate bodies with bright edges close to the moon.
  vec3 nightCloud = mix(vec3(0.016, 0.021, 0.035), vec3(0.075, 0.085, 0.112), lighting);
  float moonLining = pow(moonAlignment, 36.0);
  nightCloud += vec3(0.50, 0.56, 0.68) * moonLining * ((1.0 - cloud.a) * 0.85 + 0.2);
  nightCloud = mix(nightCloud, night, horizonHaze * 0.32);
  color = mix(color, night, nightFactor);
  cloudColor = mix(cloudColor, nightCloud, nightFactor);
  coverage *= 1.0 - 0.28 * nightFactor;
  color = mix(color, cloudColor, coverage * (0.84 + cloud.a * 0.14));
  gl_FragColor = vec4(color, 1.0);
}`;
const fragmentWgsl = `
uniform eyePosition : vec3<f32>;
uniform sunDirection : vec3<f32>;
uniform moonDirection : vec3<f32>;
uniform nightFactor : f32;
uniform starIntensity : f32;
uniform time : f32;
uniform cloudTileMeters : f32;
uniform sunAngularRadius : f32;
var cloudSamplerSampler : sampler;
var cloudSampler : texture_2d<f32>;
varying skyDirection : vec3<f32>;

const GALACTIC_NORMAL = vec3<f32>(0.79, 0.27, -0.55);
const GALACTIC_CENTER = vec3<f32>(0.55, 0.12, 0.83);
const MOON_RADIUS = 0.0085;

fn starHash(pIn: vec3<f32>) -> vec3<f32> {
  var p = fract(pIn * vec3<f32>(0.1031, 0.1030, 0.0973));
  p += vec3<f32>(dot(p, p.yxz + vec3<f32>(33.33)));
  return fract((p.xxy + p.yxx) * p.zyx);
}
fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec3<f32>(3.0) - 2.0 * f);
  let n000 = starHash(i).x;
  let n100 = starHash(i + vec3<f32>(1.0, 0.0, 0.0)).x;
  let n010 = starHash(i + vec3<f32>(0.0, 1.0, 0.0)).x;
  let n110 = starHash(i + vec3<f32>(1.0, 1.0, 0.0)).x;
  let n001 = starHash(i + vec3<f32>(0.0, 0.0, 1.0)).x;
  let n101 = starHash(i + vec3<f32>(1.0, 0.0, 1.0)).x;
  let n011 = starHash(i + vec3<f32>(0.0, 1.0, 1.0)).x;
  let n111 = starHash(i + vec3<f32>(1.0, 1.0, 1.0)).x;
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
fn fbm3(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var value = 0.0;
  var amplitude = 0.5;
  for (var octave = 0; octave < 4; octave++) {
    value += noise3(p) * amplitude;
    p = p * 2.03 + vec3<f32>(1.7, 9.2, 3.1);
    amplitude *= 0.5;
  }
  return value / 0.9375;
}
fn starField(direction: vec3<f32>, cells: f32, density: f32, pixel: f32, scintillation: f32) -> vec3<f32> {
  let p = direction * cells;
  let cell = floor(p);
  let h = starHash(cell + vec3<f32>(19.19));
  if (h.x > density) { return vec3<f32>(0.0); }
  let starDirection = normalize(cell + vec3<f32>(0.2) + 0.6 * starHash(cell + vec3<f32>(47.7)));
  let local = starDirection * cells - cell;
  let margin = min(0.3, pixel * cells * 2.5);
  if (min(min(local.x, local.y), local.z) < margin || max(max(local.x, local.y), local.z) > 1.0 - margin) {
    return vec3<f32>(0.0);
  }
  let separation = length(direction - starDirection);
  let magnitude = pow(h.y, 7.0);
  let radius = pixel * (0.72 + 1.15 * magnitude);
  let core = exp(-separation * separation / (radius * radius));
  let halo = exp(-separation / (pixel * 4.5)) * magnitude * 0.16;
  let twinkle = 1.0 + scintillation * sin(uniforms.time * (2.1 + 5.3 * h.z) + h.y * 97.0)
    * (0.6 + 0.4 * sin(uniforms.time * (0.7 + 1.9 * h.x) + h.z * 41.0));
  let temperature = starHash(cell + vec3<f32>(5.31)).y;
  var tint = mix(vec3<f32>(0.66, 0.78, 1.0), vec3<f32>(1.0, 0.97, 0.92), smoothstep(0.0, 0.42, temperature));
  tint = mix(tint, vec3<f32>(1.0, 0.74, 0.50), smoothstep(0.74, 1.0, temperature));
  return tint * (core * (0.14 + 1.35 * magnitude) + halo) * max(twinkle, 0.0);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let direction = normalize(fragmentInputs.skyDirection);
  let elevation = max(direction.y, 0.0);
  let alignment = clamp(dot(direction, uniforms.sunDirection), -1.0, 1.0);
  let airMass = 1.0 / (elevation + 0.16);
  let horizonHaze = 1.0 - exp(-pow(1.0 - elevation, 4.0) * 2.6);
  let rayleighPhase = 0.75 * (1.0 + alignment * alignment);
  let zenith = vec3<f32>(0.105, 0.345, 0.735) * (0.88 + rayleighPhase * 0.12);
  var color = mix(zenith, vec3<f32>(0.69, 0.81, 0.87), horizonHaze);
  let phaseDenominator = max(1.0 + 0.76 * 0.76 - 2.0 * 0.76 * alignment, 0.025);
  let miePhase = (1.0 - 0.76 * 0.76) / (phaseDenominator * sqrt(phaseDenominator));
  let sunTint = vec3<f32>(1.0, 0.965, 0.88);
  color += sunTint * miePhase * 0.010 * (0.65 + airMass * 0.04);
  let separation = length(direction - uniforms.sunDirection);
  color += sunTint * exp(-separation * 42.0) * 0.075;
  let sunPixelWidth = max(fwidth(separation), 0.00008);
  let disc = 1.0 - smoothstep(uniforms.sunAngularRadius - sunPixelWidth, uniforms.sunAngularRadius + sunPixelWidth, separation);
  color = mix(color, vec3<f32>(1.0, 0.995, 0.965), disc);

  let pixel = max(length(fwidth(direction)), 0.00004);
  let moonSeparation = length(direction - uniforms.moonDirection);
  let moonPixel = max(fwidth(moonSeparation), 0.00004);
  let moonAlignment = max(dot(direction, uniforms.moonDirection), 0.0);
  let nightHorizon = vec3<f32>(0.030, 0.044, 0.074);
  var night = nightHorizon;
  if (uniforms.nightFactor > 0.001) {
    night = mix(vec3<f32>(0.0035, 0.0075, 0.020), nightHorizon, pow(1.0 - elevation, 5.0));
    night += vec3<f32>(0.040, 0.062, 0.115) * pow(moonAlignment, 5.0) * 0.6;
    night += vec3<f32>(0.30, 0.36, 0.47) * exp(-moonSeparation * 34.0) * 0.18;
    night += vec3<f32>(0.62, 0.68, 0.80) * exp(-moonSeparation * 150.0) * 0.32;
    let visibility = smoothstep(0.0, 0.2, direction.y) * (1.0 - 0.85 * exp(-moonSeparation * 4.5));
    let scintillation = 0.12 + 0.38 * (1.0 - smoothstep(0.0, 0.5, elevation));
    let galactic = dot(direction, GALACTIC_NORMAL);
    let band = exp(-galactic * galactic / 0.075);
    if (band > 0.02) {
      let clumps = fbm3(direction * 4.3 + vec3<f32>(3.1, 7.7, 1.3));
      let lanes = fbm3(direction * 9.5 + vec3<f32>(11.0, 2.0, 5.0));
      let bulge = pow(max(dot(direction, GALACTIC_CENTER), 0.0), 2.5);
      let rift = exp(-galactic * galactic / 0.006) * smoothstep(0.44, 0.66, lanes);
      let milkyWay = band * (0.30 + 0.70 * clumps * clumps) * (0.55 + 1.1 * bulge) * (1.0 - 0.75 * rift);
      night += mix(vec3<f32>(0.30, 0.35, 0.50), vec3<f32>(0.58, 0.51, 0.42), bulge) * milkyWay * 0.075 * visibility;
      night += starField(direction, 240.0, 0.22 * band * clumps, pixel, scintillation)
        * 0.5 * visibility * uniforms.starIntensity;
    }
    night += starField(direction, 96.0, 0.13, pixel, scintillation) * visibility * uniforms.starIntensity;
    let moonDisc = 1.0 - smoothstep(MOON_RADIUS - moonPixel, MOON_RADIUS + moonPixel, moonSeparation);
    if (moonDisc > 0.0) {
      let moonRight = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), uniforms.moonDirection));
      let moonUp = cross(uniforms.moonDirection, moonRight);
      let moonUv = vec2<f32>(dot(direction, moonRight), dot(direction, moonUp)) / MOON_RADIUS;
      let limb = sqrt(max(1.0 - dot(moonUv, moonUv), 0.0));
      let maria = noise3(vec3<f32>(moonUv * 2.2, 4.7)) * 0.65 + noise3(vec3<f32>(moonUv * 5.3, 9.1)) * 0.35;
      let craters = noise3(vec3<f32>(moonUv * 12.0, 1.3));
      var lunar = vec3<f32>(0.98, 0.97, 0.93) * (0.78 + 0.22 * limb);
      lunar *= 1.0 - 0.30 * smoothstep(0.40, 0.66, maria) - 0.07 * craters;
      night = mix(night, lunar, moonDisc);
    }
  }

  var cloudUv = direction.xz / (1.0 + elevation) * (10240.0 / uniforms.cloudTileMeters) + vec2<f32>(0.31, 0.57);
  cloudUv -= vec2<f32>(0.00045, 0.00022) * uniforms.time;
  let cloud = textureSample(cloudSampler, cloudSamplerSampler, cloudUv);
  var grain = cloud.b;
  var shadow = 0.0;
#if SKY_DETAIL_LEVEL > 0
  let sunDensity = textureSample(cloudSampler, cloudSamplerSampler, cloudUv + uniforms.sunDirection.xz * 0.012).r;
  shadow = max(sunDensity - cloud.r, 0.0) * 0.42;
#endif
#if SKY_DETAIL_LEVEL > 1
  grain = grain * 0.6 + textureSample(cloudSampler, cloudSamplerSampler, cloudUv * 4.13 + vec2<f32>(0.19, 0.37)).b * 0.4;
#endif
  var coverage = smoothstep(0.14, 0.55, cloud.r - (grain - 0.5) * 0.075);
  coverage *= smoothstep(0.035, 0.095, direction.y);
  let lighting = clamp(0.48 + cloud.g * 0.67 - shadow, 0.38, 1.0);
  var cloudColor = mix(vec3<f32>(0.42, 0.51, 0.63), vec3<f32>(0.975, 0.985, 1.0), lighting);
  cloudColor *= 0.88 + smoothstep(0.025, 0.45, elevation) * 0.12;
  let silverLining = pow(max(alignment, 0.0), 18.0) * (1.0 - cloud.a) * 0.23;
  cloudColor += sunTint * silverLining;
  cloudColor = mix(cloudColor, color, horizonHaze * 0.32);
  var nightCloud = mix(vec3<f32>(0.016, 0.021, 0.035), vec3<f32>(0.075, 0.085, 0.112), lighting);
  let moonLining = pow(moonAlignment, 36.0);
  nightCloud += vec3<f32>(0.50, 0.56, 0.68) * moonLining * ((1.0 - cloud.a) * 0.85 + 0.2);
  nightCloud = mix(nightCloud, night, horizonHaze * 0.32);
  color = mix(color, night, uniforms.nightFactor);
  cloudColor = mix(cloudColor, nightCloud, uniforms.nightFactor);
  coverage *= 1.0 - 0.28 * uniforms.nightFactor;
  color = mix(color, cloudColor, coverage * (0.84 + cloud.a * 0.14));
  fragmentOutputs.color = vec4<f32>(color, 1.0);
}`;
