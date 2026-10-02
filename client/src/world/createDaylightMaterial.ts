import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createSkyCloudTexture, SKY_CLOUD_TILE_METERS, SKY_SUN_ANGULAR_RADIUS } from "./skyCloudTexture";

export function createDaylightMaterial(scene: Scene, sunDirection: Vector3): ShaderMaterial {
  const webGpu = scene.getEngine().isWebGPU;
  const material = new ShaderMaterial("clear-maritime-sky", scene, {
    vertexSource: webGpu ? vertexWgsl : vertexGlsl,
    fragmentSource: webGpu ? fragmentWgsl : fragmentGlsl,
  }, {
    attributes: ["position"],
    uniforms: ["viewProjection", "eyePosition", "sunDirection", "time", "cloudTileMeters", "sunAngularRadius"],
    samplers: ["cloudSampler"],
    defines: ["SKY_DETAIL_LEVEL 1"],
    shaderLanguage: webGpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  }, false);
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.setVector3("sunDirection", sunDirection);
  material.setFloat("time", 0);
  material.setFloat("cloudTileMeters", SKY_CLOUD_TILE_METERS);
  material.setFloat("sunAngularRadius", SKY_SUN_ANGULAR_RADIUS);
  material.setTexture("cloudSampler", createSkyCloudTexture(scene));
  material.onBindObservable.add(() => {
    const eye = scene._forcedViewPosition ?? scene.activeCamera?.globalPosition;
    if (!eye) return;
    material.setVector3("eyePosition", eye);
    // Bind this pass immediately, including reflection faces and parented cameras.
    material.getEffect()?.setVector3("eyePosition", eye);
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
uniform float time;
uniform float cloudTileMeters;
uniform float sunAngularRadius;
uniform sampler2D cloudSampler;
varying vec3 skyDirection;
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
  color = mix(color, cloudColor, coverage * (0.84 + cloud.a * 0.14));
  gl_FragColor = vec4(color, 1.0);
}`;
const fragmentWgsl = `
uniform eyePosition : vec3<f32>;
uniform sunDirection : vec3<f32>;
uniform time : f32;
uniform cloudTileMeters : f32;
uniform sunAngularRadius : f32;
var cloudSamplerSampler : sampler;
var cloudSampler : texture_2d<f32>;
varying skyDirection : vec3<f32>;
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
  color = mix(color, cloudColor, coverage * (0.84 + cloud.a * 0.14));
  fragmentOutputs.color = vec4<f32>(color, 1.0);
}`;
