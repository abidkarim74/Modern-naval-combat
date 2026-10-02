precision highp float;

attribute vec3 position;
#ifdef WAKE_SURFACE
attribute vec2 uv;
attribute vec4 color;
varying vec2 vFoamUv;
varying vec4 vFoamColor;
#else
attribute float waterCellSize;
varying vec3 vWorldPosition;
varying float vWaveHeight;
varying vec2 vSurfaceSlope;
#endif

uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float time;
uniform vec4 wave0;
uniform vec4 wave1;
uniform vec4 wave2;
uniform vec4 wave3;
uniform vec4 wave4;
uniform vec4 wave5;
uniform float waveFrequency0;
uniform float waveFrequency1;
uniform float waveFrequency2;
uniform float waveFrequency3;
uniform float waveFrequency4;
uniform float waveFrequency5;
uniform float wavePhase0;
uniform float wavePhase1;
uniform float wavePhase2;
uniform float wavePhase3;
uniform float wavePhase4;
uniform float wavePhase5;
uniform vec3 boatPosition;
uniform float boatHeading;
uniform float boatSpeed;
#ifdef WAKE_SURFACE
uniform vec4 waterGrid;
#endif

// World-space phase stays continuous while the static mesh follows the camera.
// Fade undersampled displacement before coarse horizon cells can alias.
vec3 waveContribution(vec2 worldXZ, vec4 wave, float frequency, float phaseShift, float cellSize) {
  float angle = wave.z * dot(worldXZ, wave.xy) - frequency * time + phaseShift;
  float sine = sin(angle);
  float resolvable = 1.0 - smoothstep(1.25, 2.8, wave.z * cellSize);
  float height = wave.w * sine - 0.5 * wave.z * wave.w * wave.w * (1.0 - 2.0 * sine * sine);
  vec2 slope = wave.xy * wave.z * wave.w * cos(angle) * (1.0 + 2.0 * wave.z * wave.w * sine);
  return vec3(height, slope.x, slope.y) * resolvable;
}

float gaussian(float value) {
  return exp(-value * value);
}

// Approximate the waterline's broad transom and fine, raked bow in hull space.
float hullDistance(vec2 hullXZ) {
  float bowTaper = pow(clamp((hullXZ.y - 25.0) / 49.0, 0.0, 1.0), 1.3);
  float halfBeam = mix(7.7, 0.15, bowTaper)
    - 1.7 * (1.0 - smoothstep(-77.0, -60.0, hullXZ.y));
  vec2 edge = vec2(abs(hullXZ.x) - halfBeam, max(-77.0 - hullXZ.y, hullXZ.y - 74.0));
  return length(max(edge, vec2(0.0))) + min(max(edge.x, edge.y), 0.0);
}

float restingHullDisplacement(vec2 hullXZ) {
  float distance = max(0.0, hullDistance(hullXZ));
  float meniscus = 0.085 * gaussian(distance / 1.8);
  float ripple = 0.032 * sin(distance * 1.25 - time * 1.15 + hullXZ.y * 0.055)
    * exp(-distance / 5.0);
  return (meniscus + ripple) * (1.0 - smoothstep(10.0, 16.0, distance));
}

float shipDisplacement(vec2 worldXZ) {
  vec2 delta = worldXZ - boatPosition.xz;
  vec2 hullForward = vec2(sin(boatHeading), cos(boatHeading));
  vec2 right = vec2(cos(boatHeading), -sin(boatHeading));
  // Water displaced around the hull persists at rest and keeps its orientation
  // when propulsion changes direction. Only the travelling wake depends on speed.
  float restingHeight = restingHullDisplacement(vec2(dot(delta, right), dot(delta, hullForward)));
  float movementHeading = boatHeading + (boatSpeed < 0.0 ? 3.14159265 : 0.0);
  vec2 forward = vec2(sin(movementHeading), cos(movementHeading));
  float along = dot(delta, forward);
  float across = dot(delta, right);
  float halfBeam = max(0.3, 8.5 * (1.0 - smoothstep(25.0, 78.0, along)));
  float speedFactor = smoothstep(0.4, 12.0, abs(boatSpeed));
  float bowMound = gaussian((along - 77.0) / 7.0) * gaussian(across / 7.0);
  float alongSquared = (along / 69.0) * (along / 69.0);
  float shoulder = gaussian((abs(across) - halfBeam - 1.4) / 3.4)
    * exp(-alongSquared * alongSquared * alongSquared * alongSquared);
  float transomTrough = gaussian((along + 77.0) / 10.0) * gaussian(across / 12.0);
  float wakeDistance = max(-along - 69.0, 0.0);
  float kelvinDistance = abs(across) - (8.0 + wakeDistance * 0.354);
  float kelvinEnvelope = smoothstep(0.0, 16.0, wakeDistance) * exp(-wakeDistance / 200.0)
    * gaussian(kelvinDistance / (3.5 + wakeDistance * 0.018));
  float kelvinHeight = 0.24 * kelvinEnvelope * sin(wakeDistance * 0.38 - abs(across) * 0.29);
  return restingHeight + speedFactor * (0.45 * bowMound + 0.12 * shoulder * sin(along * 0.31 - time * 3.1)
    - 0.16 * transomTrough + kelvinHeight);
}

void main(void) {
  vec4 baseWorld = world * vec4(position, 1.0);
  vec2 worldXZ = baseWorld.xz;
#ifdef WAKE_SURFACE
  // Match the ocean's camera-centred rings. Blend into the coarser ring over
  // its two boundary cells, so foam does not jump at a detail transition.
  vec2 gridDelta = abs(worldXZ - waterGrid.xy);
  float gridRadius = max(gridDelta.x, gridDelta.y);
  float gridLevel = max(0.0, floor(log2(max(gridRadius / waterGrid.z, 0.5))) + 1.0);
  float gridSpacing = waterGrid.w * exp2(gridLevel);
  float gridBoundary = waterGrid.z * exp2(gridLevel);
  float cellSize = mix(gridSpacing, gridSpacing * 2.0,
    smoothstep(gridBoundary - gridSpacing * 2.0, gridBoundary, gridRadius));
#else
  float cellSize = waterCellSize;
#endif
  vec3 surface = waveContribution(worldXZ, wave0, waveFrequency0, wavePhase0, cellSize)
    + waveContribution(worldXZ, wave1, waveFrequency1, wavePhase1, cellSize)
    + waveContribution(worldXZ, wave2, waveFrequency2, wavePhase2, cellSize)
    + waveContribution(worldXZ, wave3, waveFrequency3, wavePhase3, cellSize)
    + waveContribution(worldXZ, wave4, waveFrequency4, wavePhase4, cellSize)
    + waveContribution(worldXZ, wave5, waveFrequency5, wavePhase5, cellSize);
  float height = surface.x;
  height += shipDisplacement(worldXZ) * (1.0 - smoothstep(12.0, 45.0, cellSize));
#ifdef WAKE_SURFACE
  height += position.y;
  vFoamUv = uv;
  vFoamColor = color;
#else
  vWorldPosition = vec3(worldXZ.x, height, worldXZ.y);
  vWaveHeight = height;
  vSurfaceSlope = surface.yz;
#endif
  gl_Position = worldViewProjection * vec4(position.x, height, position.z, 1.0);
}
