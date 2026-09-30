precision highp float;

attribute vec3 position;

uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float time;
uniform vec4 wave0;
uniform vec4 wave1;
uniform vec4 wave2;
uniform float waveFrequency0;
uniform float waveFrequency1;
uniform float waveFrequency2;
uniform float wavePhase0;
uniform float wavePhase1;
uniform float wavePhase2;
uniform vec3 boatPosition;
uniform float boatHeading;
uniform float boatSpeed;

varying vec3 vWorldPosition;
varying float vWaveHeight;

float waveContribution(vec2 worldXZ, vec4 wave, float frequency, float phaseShift, float clock) {
  float angle = wave.z * dot(worldXZ, wave.xy) - frequency * clock + phaseShift;
  return wave.w * sin(angle);
}

void main(void) {
  vec4 baseWorld = world * vec4(position, 1.0);
  vec2 worldXZ = baseWorld.xz;
  float height = waveContribution(worldXZ, wave0, waveFrequency0, wavePhase0, time) +
    waveContribution(worldXZ, wave1, waveFrequency1, wavePhase1, time) +
    waveContribution(worldXZ, wave2, waveFrequency2, wavePhase2, time);

  vec2 delta = worldXZ - boatPosition.xz;
  float movementHeading = boatHeading + (boatSpeed < 0.0 ? 3.14159265 : 0.0);
  vec2 forward = vec2(sin(movementHeading), cos(movementHeading));
  vec2 right = vec2(cos(boatHeading), -sin(boatHeading));
  float along = dot(delta, forward);
  float across = dot(delta, right);
  float halfBeam = max(0.3, 8.5 * (1.0 - smoothstep(25.0, 78.0, along)));
  float speedFactor = smoothstep(0.4, 12.0, abs(boatSpeed));
  // pow is undefined for negative bases, including even powers of signed coordinates.
  float bowMound = exp(-pow(abs(along - 77.0) / 7.0, 2.0)) * exp(-pow(abs(across) / 7.0, 2.0));
  float shoulder = exp(-pow(abs(abs(across) - halfBeam - 1.4) / 3.4, 2.0)) * exp(-pow(abs(along) / 69.0, 8.0));
  float transomTrough = exp(-pow(abs(along + 77.0) / 10.0, 2.0)) * exp(-pow(abs(across) / 12.0, 2.0));
  float wakeDistance = max(-along - 69.0, 0.0);
  float kelvinDistance = abs(across) - (8.0 + wakeDistance * 0.354);
  float kelvinEnvelope = smoothstep(0.0, 16.0, wakeDistance) * exp(-wakeDistance / 200.0)
    * exp(-pow(abs(kelvinDistance) / (3.5 + wakeDistance * 0.018), 2.0));
  float kelvinHeight = 0.24 * speedFactor * kelvinEnvelope * sin(wakeDistance * 0.38 - abs(across) * 0.29);
  height += speedFactor * (0.45 * bowMound + 0.12 * shoulder * sin(along * 0.31 - time * 3.1) - 0.16 * transomTrough) + kelvinHeight;

  vec4 displacedWorld = world * vec4(position.x, height, position.z, 1.0);
  vWorldPosition = displacedWorld.xyz;
  vWaveHeight = height;
  gl_Position = worldViewProjection * vec4(position.x, height, position.z, 1.0);
}
