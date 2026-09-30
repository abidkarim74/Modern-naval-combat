import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

export function createDaylightMaterial(scene: Scene, sunDirection: Vector3): ShaderMaterial {
  const webGpu = scene.getEngine().isWebGPU;
  const material = new ShaderMaterial("clear-maritime-sky", scene, {
    vertexSource: webGpu ? vertexWgsl : vertexGlsl,
    fragmentSource: webGpu ? fragmentWgsl : fragmentGlsl,
  }, {
    attributes: ["position"],
    uniforms: ["world", "worldViewProjection", "eyePosition", "sunDirection"],
    shaderLanguage: webGpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.setVector3("sunDirection", sunDirection);
  material.onBindObservable.add(() => {
    if (scene.activeCamera) material.setVector3("eyePosition", scene.activeCamera.position);
  });
  return material;
}

const vertexGlsl = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 skyPosition;
void main() {
  skyPosition = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
const vertexWgsl = `
attribute position : vec3<f32>;
uniform world : mat4x4<f32>;
uniform worldViewProjection : mat4x4<f32>;
varying skyPosition : vec3<f32>;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.skyPosition = (uniforms.world * vec4<f32>(vertexInputs.position, 1.0)).xyz;
  vertexOutputs.position = uniforms.worldViewProjection * vec4<f32>(vertexInputs.position, 1.0);
}`;
const fragmentGlsl = `
precision highp float;
uniform vec3 eyePosition;
uniform vec3 sunDirection;
varying vec3 skyPosition;
void main() {
  vec3 direction = normalize(skyPosition - eyePosition);
  float elevation = max(direction.y, 0.0);
  vec3 color = mix(vec3(0.69, 0.81, 0.87), vec3(0.12, 0.43, 0.79), pow(smoothstep(0.0, 0.65, elevation), 0.45));
  float alignment = dot(direction, sunDirection);
  float halo = exp((alignment - 1.0) * 100.0) * 0.35;
  color = mix(color, vec3(1.0, 0.96, 0.84), halo);
  float disc = smoothstep(0.99991, 0.99995, alignment);
  color = mix(color, vec3(1.0, 0.99, 0.92), disc);
  gl_FragColor = vec4(color, 1.0);
}`;
const fragmentWgsl = `
uniform eyePosition : vec3<f32>;
uniform sunDirection : vec3<f32>;
varying skyPosition : vec3<f32>;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let direction = normalize(fragmentInputs.skyPosition - uniforms.eyePosition);
  let elevation = max(direction.y, 0.0);
  var color = mix(vec3<f32>(0.69, 0.81, 0.87), vec3<f32>(0.12, 0.43, 0.79), pow(smoothstep(0.0, 0.65, elevation), 0.45));
  let alignment = dot(direction, uniforms.sunDirection);
  let halo = exp((alignment - 1.0) * 100.0) * 0.35;
  color = mix(color, vec3<f32>(1.0, 0.96, 0.84), halo);
  let disc = smoothstep(0.99991, 0.99995, alignment);
  color = mix(color, vec3<f32>(1.0, 0.99, 0.92), disc);
  fragmentOutputs.color = vec4<f32>(color, 1.0);
}`;
