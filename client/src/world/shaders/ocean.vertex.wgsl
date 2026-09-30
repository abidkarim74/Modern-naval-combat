attribute position : vec3<f32>;

uniform world : mat4x4<f32>;
uniform worldViewProjection : mat4x4<f32>;
uniform time : f32;
uniform wave0 : vec4<f32>;
uniform wave1 : vec4<f32>;
uniform wave2 : vec4<f32>;
uniform waveFrequency0 : f32;
uniform waveFrequency1 : f32;
uniform waveFrequency2 : f32;
uniform wavePhase0 : f32;
uniform wavePhase1 : f32;
uniform wavePhase2 : f32;
uniform boatPosition : vec3<f32>;
uniform boatHeading : f32;
uniform boatSpeed : f32;

varying vWorldPosition : vec3<f32>;
varying vWaveHeight : f32;

fn waveContribution(worldXZ: vec2<f32>, wave: vec4<f32>, frequency: f32, phaseShift: f32, clock: f32) -> f32 {
  let angle = wave.z * dot(worldXZ, wave.xy) - frequency * clock + phaseShift;
  return wave.w * sin(angle);
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let baseWorld = uniforms.world * vec4<f32>(vertexInputs.position, 1.0);
  let worldXZ = baseWorld.xz;
  let height = waveContribution(worldXZ, uniforms.wave0, uniforms.waveFrequency0, uniforms.wavePhase0, uniforms.time) +
    waveContribution(worldXZ, uniforms.wave1, uniforms.waveFrequency1, uniforms.wavePhase1, uniforms.time) +
    waveContribution(worldXZ, uniforms.wave2, uniforms.waveFrequency2, uniforms.wavePhase2, uniforms.time);
  let delta = worldXZ - uniforms.boatPosition.xz;
  let movementHeading = uniforms.boatHeading + select(0.0, 3.14159265, uniforms.boatSpeed < 0.0);
  let forward = vec2<f32>(sin(movementHeading), cos(movementHeading));
  let right = vec2<f32>(cos(uniforms.boatHeading), -sin(uniforms.boatHeading));
  let along = dot(delta, forward);
  let across = dot(delta, right);
  let halfBeam = max(0.3, 8.5 * (1.0 - smoothstep(25.0, 78.0, along)));
  let speedFactor = smoothstep(0.4, 12.0, abs(uniforms.boatSpeed));
  // pow is undefined for negative bases, including even powers of signed coordinates.
  let bowMound = exp(-pow(abs(along - 77.0) / 7.0, 2.0)) * exp(-pow(abs(across) / 7.0, 2.0));
  let shoulder = exp(-pow(abs(abs(across) - halfBeam - 1.4) / 3.4, 2.0)) * exp(-pow(abs(along) / 69.0, 8.0));
  let transomTrough = exp(-pow(abs(along + 77.0) / 10.0, 2.0)) * exp(-pow(abs(across) / 12.0, 2.0));
  let wakeDistance = max(-along - 69.0, 0.0);
  let kelvinDistance = abs(across) - (8.0 + wakeDistance * 0.354);
  let kelvinEnvelope = smoothstep(0.0, 16.0, wakeDistance) * exp(-wakeDistance / 200.0)
    * exp(-pow(abs(kelvinDistance) / (3.5 + wakeDistance * 0.018), 2.0));
  let kelvinHeight = 0.24 * speedFactor * kelvinEnvelope * sin(wakeDistance * 0.38 - abs(across) * 0.29);
  let disturbedHeight = height + speedFactor * (0.45 * bowMound + 0.12 * shoulder * sin(along * 0.31 - uniforms.time * 3.1) - 0.16 * transomTrough) + kelvinHeight;

  let displacedWorld = uniforms.world * vec4<f32>(vertexInputs.position.x, disturbedHeight, vertexInputs.position.z, 1.0);
  vertexOutputs.position = uniforms.worldViewProjection * vec4<f32>(vertexInputs.position.x, disturbedHeight, vertexInputs.position.z, 1.0);
  vertexOutputs.vWorldPosition = displacedWorld.xyz;
  vertexOutputs.vWaveHeight = disturbedHeight;
}
