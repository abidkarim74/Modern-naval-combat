precision highp float;
uniform float time;
uniform vec3 eyePosition;
uniform vec3 sunDirection;
uniform float detailStrength;
uniform float reflectionStrength;
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
uniform float boatYawRate;
varying vec3 vWorldPosition;
varying float vWaveHeight;

float hash(vec2 p) {
  vec3 h = fract(vec3(p.x, p.y, p.x) * 0.1031);
  h += vec3(dot(h, h.yzx + vec3(33.33)));
  return fract((h.x + h.y) * h.z);
}
float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (vec2(3.0) - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), u.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), u.x), u.y);
}
vec2 slope(vec2 p, vec4 wave, float frequency, float phase) {
  return wave.xy * wave.z * wave.w * cos(wave.z * dot(p, wave.xy) - frequency * time + phase);
}
void main(void) {
  vec2 p = vWorldPosition.xz;
  vec2 shipDelta = p - boatPosition.xz;
  float movementHeading = boatHeading + (boatSpeed < 0.0 ? 3.14159265 : 0.0);
  vec2 shipForward = vec2(sin(movementHeading), cos(movementHeading));
  vec2 shipRight = vec2(cos(boatHeading), -sin(boatHeading));
  float shipAlong = dot(shipDelta, shipForward);
  float shipAcross = dot(shipDelta, shipRight);
  float shipHalfBeam = max(0.3, 8.5 * (1.0 - smoothstep(25.0, 78.0, shipAlong)));
  float speedFactor = smoothstep(0.4, 12.0, abs(boatSpeed));
  float range = length(eyePosition - vWorldPosition);
  float rippleFade = exp(-range * 0.0025);
  float drift = noise(p * 0.13 + vec2(time * 0.04, -time * 0.02));
  float a = dot(p, vec2(1.32, 0.84)) - time * 2.1 + drift * 2.8;
  float b = dot(p, vec2(-0.67, 1.91)) - time * 2.6 + sin(a) * 0.5;
  float c = dot(p, vec2(3.8, 2.4)) - time * 3.2;
  vec2 ripples = (vec2(0.075, 0.045) * cos(a) + vec2(-0.035, 0.065) * cos(b)
    + vec2(0.024, 0.016) * cos(c)) * detailStrength * rippleFade;
  vec2 gradient = slope(p, wave0, waveFrequency0, wavePhase0)
    + slope(p, wave1, waveFrequency1, wavePhase1)
    + slope(p, wave2, waveFrequency2, wavePhase2) + ripples;
  vec2 hullFlow = vec2(abs(shipAcross) * 0.8, shipAlong * 0.35 + time * abs(boatSpeed) * 0.48);
  float froth = noise(hullFlow * 0.75) * 0.6 + noise(hullFlow * 2.4) * 0.4;
  float bubbles = smoothstep(0.25, 0.68, froth);
  float turnBias = clamp(1.0 + sign(shipAcross) * boatYawRate * abs(boatSpeed) * 0.8, 0.7, 1.35);
  float shoulderDistance = abs(shipAcross) - shipHalfBeam;
  // Keep even-power envelopes valid on both sides of the ship.
  float shoulderEnvelope = exp(-pow(abs(shoulderDistance) / 4.8, 2.0)) * exp(-pow(abs(shipAlong) / 75.0, 8.0));
  float sidePhase = abs(shipAcross) * 1.8 - shipAlong * 0.32 - time * 3.2 + drift * 2.0;
  float shipRipple = shoulderEnvelope * sin(sidePhase) * speedFactor * 0.46;
  float bowEnvelope = exp(-pow(abs(shipAlong - 77.0) / 9.0, 2.0)) * exp(-pow(abs(shipAcross) / 10.0, 2.0));
  gradient += shipRight * sign(shipAcross) * shipRipple;
  vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
  vec3 view = normalize(eyePosition - vWorldPosition);
  vec3 reflected = reflect(-view, normal);
  float fresnel = 0.035 + 0.965 * pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 5.0);
  vec3 horizon = vec3(0.69, 0.81, 0.87);
  vec3 blueSky = vec3(0.15, 0.43, 0.73);
  vec3 sky = mix(horizon, blueSky, pow(clamp(reflected.y, 0.0, 1.0), 0.45));
  float reflectedCloud = smoothstep(0.69, 0.91, noise(reflected.xz / max(reflected.y, 0.12) * 2.5));
  sky = mix(sky, vec3(0.9, 0.93, 0.94), reflectedCloud * 0.36);
  float crest = smoothstep(-0.55, 0.7, vWaveHeight);
  vec3 body = mix(vec3(0.008, 0.065, 0.22), vec3(0.019, 0.23, 0.40), crest * 0.56);
  float light = 0.65 + 0.35 * max(dot(normal, sunDirection), 0.0);
  vec3 color = mix(body * light, sky, fresnel * reflectionStrength);
  vec3 halfway = normalize(view + sunDirection);
  float glint = pow(max(dot(normal, halfway), 0.0), 180.0) * 0.5;
  glint += pow(max(dot(normal, halfway), 0.0), 850.0) * 1.1;
  color += vec3(1.0, 0.92, 0.76) * glint;
  float foam = smoothstep(0.56, 0.83, vWaveHeight) * smoothstep(0.61, 0.82, noise(p * 1.7 + vec2(time * 0.4))) * rippleFade;
  color = mix(color, vec3(0.78, 0.91, 0.94), foam * 0.45);
  float bowFoam = bowEnvelope * smoothstep(0.3, 0.74, noise(shipDelta * 0.62 + vec2(time * 0.85, -time * 0.47)))
    * smoothstep(0.24, 0.72, noise(shipDelta * 1.8 + vec2(-time * 0.45, time * 0.72)));
  float sideFoam = shoulderEnvelope * (0.22 + bubbles * 0.78) * turnBias;
  float bowDistance = clamp(77.0 - shipAlong, 0.0, 120.0);
  float bowV = exp(-pow(abs(abs(shipAcross) - (1.0 + bowDistance * 0.39)) / (1.5 + bowDistance * 0.028), 2.0))
    * smoothstep(-35.0, 18.0, shipAlong) * (1.0 - smoothstep(74.0, 80.0, shipAlong))
    * exp(-bowDistance / 100.0);
  float sternDistance = max(-shipAlong - 78.0, 0.0);
  float sternNoise = noise(vec2(shipAlong * 0.19 + time * 0.35, shipAcross * 0.3 - time * 0.12));
  float sternEnvelope = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 120.0)
    * exp(-pow(abs(shipAcross) / (9.0 + sternDistance * 0.22), 2.0));
  float propTrack = 3.7 + sternDistance * 0.095;
  float propDistance = abs(abs(shipAcross) - propTrack);
  float propWash = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 105.0)
    * exp(-pow(propDistance / (2.4 + sternDistance * 0.035), 2.0));
  float bowBreakup = smoothstep(0.28, 0.72, noise(p * 0.25 + vec2(time * 0.5)))
    * smoothstep(0.32, 0.74, noise(p * 0.83 + vec2(-time * 0.43, time * 0.29)));
  float shipFoam = clamp((bowFoam * 1.15 + bowV * 0.95 * bowBreakup
    + sideFoam * 1.05 + sternEnvelope * (0.26 + 0.52 * sternNoise) + propWash * (0.35 + 0.60 * sternNoise)) * speedFactor, 0.0, 0.9);
  color = mix(color, vec3(0.93, 0.98, 1.0), shipFoam);
  float haze = smoothstep(800.0, 3400.0, range);
  color = mix(color, horizon, haze);
  gl_FragColor = vec4(color, 1.0);
}
