
attribute position : vec3<f32>;
#ifdef WAKE_SURFACE
attribute uv : vec2<f32>;
attribute color : vec4<f32>;
varying vFoamUv : vec2<f32>;
varying vFoamColor : vec4<f32>;
#else
attribute waterCellSize : f32;
varying vWorldPosition : vec3<f32>;
varying vWaveHeight : f32;
varying vSurfaceSlope : vec2<f32>;
#endif

uniform world : mat4x4<f32>;
uniform worldViewProjection : mat4x4<f32>;
uniform time : f32;
uniform wave0 : vec4<f32>;
uniform wave1 : vec4<f32>;
uniform wave2 : vec4<f32>;
uniform wave3 : vec4<f32>;
uniform wave4 : vec4<f32>;
uniform wave5 : vec4<f32>;
uniform waveFrequency0 : f32;
uniform waveFrequency1 : f32;
uniform waveFrequency2 : f32;
uniform waveFrequency3 : f32;
uniform waveFrequency4 : f32;
uniform waveFrequency5 : f32;
uniform wavePhase0 : f32;
uniform wavePhase1 : f32;
uniform wavePhase2 : f32;
uniform wavePhase3 : f32;
uniform wavePhase4 : f32;
uniform wavePhase5 : f32;
uniform boatPosition : vec3<f32>;
uniform boatHeading : f32;
uniform boatSpeed : f32;
#ifdef WAKE_SURFACE
uniform waterGrid : vec4<f32>;
#endif

// World-space phase stays continuous while the static mesh follows the camera.
// Fade undersampled displacement before coarse horizon cells can alias.
fn waveContribution(worldXZ: vec2<f32>, wave: vec4<f32>, frequency: f32, phaseShift: f32, cellSize: f32) -> vec3<f32> {
  var angle = wave.z * dot(worldXZ, wave.xy) - frequency * uniforms.time + phaseShift;
  var sine = sin(angle);
  var resolvable = 1.0 - smoothstep(1.25, 2.8, wave.z * cellSize);
  var height = wave.w * sine - 0.5 * wave.z * wave.w * wave.w * (1.0 - 2.0 * sine * sine);
  var slope = wave.xy * wave.z * wave.w * cos(angle) * (1.0 + 2.0 * wave.z * wave.w * sine);
  return vec3<f32>(height, slope.x, slope.y) * resolvable;
}

fn gaussian(value: f32) -> f32 {
  return exp(-value * value);
}

// Approximate the waterline's broad transom and fine, raked bow in hull space.
fn hullDistance(hullXZ: vec2<f32>) -> f32 {
  var bowTaper = pow(clamp((hullXZ.y - 25.0) / 49.0, 0.0, 1.0), 1.3);
  var halfBeam = mix(7.7, 0.15, bowTaper)
    - 1.7 * (1.0 - smoothstep(-77.0, -60.0, hullXZ.y));
  var edge = vec2<f32>(abs(hullXZ.x) - halfBeam, max(-77.0 - hullXZ.y, hullXZ.y - 74.0));
  return length(max(edge, vec2<f32>(0.0))) + min(max(edge.x, edge.y), 0.0);
}

fn restingHullDisplacement(hullXZ: vec2<f32>) -> f32 {
  var distance = max(0.0, hullDistance(hullXZ));
  var meniscus = 0.085 * gaussian(distance / 1.8);
  var ripple = 0.032 * sin(distance * 1.25 - uniforms.time * 1.15 + hullXZ.y * 0.055)
    * exp(-distance / 5.0);
  return (meniscus + ripple) * (1.0 - smoothstep(10.0, 16.0, distance));
}

fn shipDisplacement(worldXZ: vec2<f32>) -> f32 {
  var delta = worldXZ - uniforms.boatPosition.xz;
  var hullForward = vec2<f32>(sin(uniforms.boatHeading), cos(uniforms.boatHeading));
  var right = vec2<f32>(cos(uniforms.boatHeading), -sin(uniforms.boatHeading));
  // Water displaced around the hull persists at rest and keeps its orientation
  // when propulsion changes direction. Only the travelling wake depends on speed.
  var restingHeight = restingHullDisplacement(vec2<f32>(dot(delta, right), dot(delta, hullForward)));
  var movementHeading = uniforms.boatHeading + select(0.0, 3.14159265, uniforms.boatSpeed < 0.0);
  var forward = vec2<f32>(sin(movementHeading), cos(movementHeading));
  var along = dot(delta, forward);
  var across = dot(delta, right);
  var halfBeam = max(0.3, 8.5 * (1.0 - smoothstep(25.0, 78.0, along)));
  var speedFactor = smoothstep(0.4, 12.0, abs(uniforms.boatSpeed));
  var bowMound = gaussian((along - 77.0) / 7.0) * gaussian(across / 7.0);
  var alongSquared = (along / 69.0) * (along / 69.0);
  var shoulder = gaussian((abs(across) - halfBeam - 1.4) / 3.4)
    * exp(-alongSquared * alongSquared * alongSquared * alongSquared);
  var transomTrough = gaussian((along + 77.0) / 10.0) * gaussian(across / 12.0);
  var wakeDistance = max(-along - 69.0, 0.0);
  var kelvinDistance = abs(across) - (8.0 + wakeDistance * 0.354);
  var kelvinEnvelope = smoothstep(0.0, 16.0, wakeDistance) * exp(-wakeDistance / 200.0)
    * gaussian(kelvinDistance / (3.5 + wakeDistance * 0.018));
  var kelvinHeight = 0.24 * kelvinEnvelope * sin(wakeDistance * 0.38 - abs(across) * 0.29);
  return restingHeight + speedFactor * (0.45 * bowMound + 0.12 * shoulder * sin(along * 0.31 - uniforms.time * 3.1)
    - 0.16 * transomTrough + kelvinHeight);
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var baseWorld = uniforms.world * vec4<f32>(vertexInputs.position, 1.0);
  var worldXZ = baseWorld.xz;
#ifdef WAKE_SURFACE
  // Match the ocean's camera-centred rings. Blend into the coarser ring over
  // its two boundary cells, so foam does not jump at a detail transition.
  var gridDelta = abs(worldXZ - uniforms.waterGrid.xy);
  var gridRadius = max(gridDelta.x, gridDelta.y);
  var gridLevel = max(0.0, floor(log2(max(gridRadius / uniforms.waterGrid.z, 0.5))) + 1.0);
  var gridSpacing = uniforms.waterGrid.w * exp2(gridLevel);
  var gridBoundary = uniforms.waterGrid.z * exp2(gridLevel);
  var cellSize = mix(gridSpacing, gridSpacing * 2.0,
    smoothstep(gridBoundary - gridSpacing * 2.0, gridBoundary, gridRadius));
#else
  var cellSize = vertexInputs.waterCellSize;
#endif
  var surface = waveContribution(worldXZ, uniforms.wave0, uniforms.waveFrequency0, uniforms.wavePhase0, cellSize)
    + waveContribution(worldXZ, uniforms.wave1, uniforms.waveFrequency1, uniforms.wavePhase1, cellSize)
    + waveContribution(worldXZ, uniforms.wave2, uniforms.waveFrequency2, uniforms.wavePhase2, cellSize)
    + waveContribution(worldXZ, uniforms.wave3, uniforms.waveFrequency3, uniforms.wavePhase3, cellSize)
    + waveContribution(worldXZ, uniforms.wave4, uniforms.waveFrequency4, uniforms.wavePhase4, cellSize)
    + waveContribution(worldXZ, uniforms.wave5, uniforms.waveFrequency5, uniforms.wavePhase5, cellSize);
  var height = surface.x;
  height += shipDisplacement(worldXZ) * (1.0 - smoothstep(12.0, 45.0, cellSize));
#ifdef WAKE_SURFACE
  height += vertexInputs.position.y;
  vertexOutputs.vFoamUv = vertexInputs.uv;
  vertexOutputs.vFoamColor = vertexInputs.color;
#else
  vertexOutputs.vWorldPosition = vec3<f32>(worldXZ.x, height, worldXZ.y);
  vertexOutputs.vWaveHeight = height;
  vertexOutputs.vSurfaceSlope = surface.yz;
#endif
  vertexOutputs.position = uniforms.worldViewProjection * vec4<f32>(vertexInputs.position.x, height, vertexInputs.position.z, 1.0);
}
