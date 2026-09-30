uniform time : f32;
uniform eyePosition : vec3<f32>;
uniform sunDirection : vec3<f32>;
uniform detailStrength : f32;
uniform reflectionStrength : f32;
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

fn hash(p: vec2<f32>) -> f32 {
  var h = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  h += vec3<f32>(dot(h, h.yzx + vec3<f32>(33.33)));
  return fract((h.x + h.y) * h.z);
}
fn noise(p: vec2<f32>) -> f32 {
  var cell = floor(p);
  var f = fract(p);
  var u = f * f * (vec2<f32>(3.0) - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash(cell + vec2<f32>(0.0, 1.0)), hash(cell + vec2<f32>(1.0)), u.x), u.y);
}
fn slope(p: vec2<f32>, wave: vec4<f32>, frequency: f32, phase: f32) -> vec2<f32> {
  return wave.xy * wave.z * wave.w * cos(wave.z * dot(p, wave.xy) - frequency * uniforms.time + phase);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var p = fragmentInputs.vWorldPosition.xz;
  var shipDelta = p - uniforms.boatPosition.xz;
  var movementHeading = uniforms.boatHeading + select(0.0, 3.14159265, uniforms.boatSpeed < 0.0);
  var shipForward = vec2<f32>(sin(movementHeading), cos(movementHeading));
  var shipRight = vec2<f32>(cos(uniforms.boatHeading), -sin(uniforms.boatHeading));
  var shipAlong = dot(shipDelta, shipForward);
  var shipAcross = dot(shipDelta, shipRight);
  var shipHalfBeam = mix(0.7, 9.0, smoothstep(0.0, 30.0, 78.0 - abs(shipAlong)));
  var speedFactor = smoothstep(0.4, 12.0, abs(uniforms.boatSpeed));
  var range = length(uniforms.eyePosition - fragmentInputs.vWorldPosition);
  var rippleFade = exp(-range * 0.0025);
  var drift = noise(p * 0.13 + vec2<f32>(uniforms.time * 0.04, -uniforms.time * 0.02));
  var a = dot(p, vec2<f32>(1.32, 0.84)) - uniforms.time * 2.1 + drift * 2.8;
  var b = dot(p, vec2<f32>(-0.67, 1.91)) - uniforms.time * 2.6 + sin(a) * 0.5;
  var c = dot(p, vec2<f32>(3.8, 2.4)) - uniforms.time * 3.2;
  var ripples = (vec2<f32>(0.075, 0.045) * cos(a) + vec2<f32>(-0.035, 0.065) * cos(b)
    + vec2<f32>(0.024, 0.016) * cos(c)) * uniforms.detailStrength * rippleFade;
  var gradient = slope(p, uniforms.wave0, uniforms.waveFrequency0, uniforms.wavePhase0)
    + slope(p, uniforms.wave1, uniforms.waveFrequency1, uniforms.wavePhase1)
    + slope(p, uniforms.wave2, uniforms.waveFrequency2, uniforms.wavePhase2) + ripples;
  var shoulderDistance = abs(shipAcross) - shipHalfBeam;
  var shoulderEnvelope = exp(-pow(shoulderDistance / 3.0, 2.0)) * exp(-pow(shipAlong / 69.0, 8.0));
  var sidePhase = abs(shipAcross) * 1.8 - shipAlong * 0.32 - uniforms.time * 3.2 + drift * 2.0;
  var shipRipple = shoulderEnvelope * sin(sidePhase) * speedFactor * 0.34;
  var bowEnvelope = exp(-pow((shipAlong - 77.0) / 9.0, 2.0)) * exp(-pow(shipAcross / 10.0, 2.0));
  gradient += shipRight * sign(shipAcross) * shipRipple;
  var normal = normalize(vec3<f32>(-gradient.x, 1.0, -gradient.y));
  var view = normalize(uniforms.eyePosition - fragmentInputs.vWorldPosition);
  var reflected = reflect(-view, normal);
  var fresnel = 0.035 + 0.965 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  var horizon = vec3<f32>(0.69, 0.81, 0.87);
  var blueSky = vec3<f32>(0.15, 0.43, 0.73);
  var sky = mix(horizon, blueSky, pow(clamp(reflected.y, 0.0, 1.0), 0.45));
  var reflectedCloud = smoothstep(0.69, 0.91, noise(reflected.xz / max(reflected.y, 0.12) * 2.5));
  sky = mix(sky, vec3<f32>(0.9, 0.93, 0.94), reflectedCloud * 0.36);
  var crest = smoothstep(-0.55, 0.7, fragmentInputs.vWaveHeight);
  var body = mix(vec3<f32>(0.008, 0.12, 0.30), vec3<f32>(0.023, 0.30, 0.52), crest * 0.58);
  var light = 0.65 + 0.35 * max(dot(normal, uniforms.sunDirection), 0.0);
  var color = mix(body * light, sky, fresnel * uniforms.reflectionStrength);
  var halfway = normalize(view + uniforms.sunDirection);
  var glint = pow(max(dot(normal, halfway), 0.0), 180.0) * 1.0;
  glint += pow(max(dot(normal, halfway), 0.0), 850.0) * 1.7;
  color += vec3<f32>(1.0, 0.92, 0.76) * glint;
  var foam = smoothstep(0.56, 0.83, fragmentInputs.vWaveHeight) * smoothstep(0.61, 0.82, noise(p * 1.7 + vec2<f32>(uniforms.time * 0.4))) * rippleFade;
  color = mix(color, vec3<f32>(0.78, 0.91, 0.94), foam * 0.45);
  var bowFoam = bowEnvelope * smoothstep(0.3, 0.74, noise(shipDelta * 0.62 + vec2<f32>(uniforms.time * 0.85, -uniforms.time * 0.47)))
    * smoothstep(0.24, 0.72, noise(shipDelta * 1.8 + vec2<f32>(-uniforms.time * 0.45, uniforms.time * 0.72)));
  var sideFoam = shoulderEnvelope * smoothstep(0.4, 0.76, noise(vec2<f32>(shipAlong * 0.37, abs(shipAcross) * 1.1) + vec2<f32>(uniforms.time * 1.2, -uniforms.time * 0.6)));
  var bowDistance = clamp(77.0 - shipAlong, 0.0, 120.0);
  var bowV = exp(-pow((abs(shipAcross) - (1.0 + bowDistance * 0.39)) / (1.5 + bowDistance * 0.028), 2.0))
    * smoothstep(-35.0, 18.0, shipAlong) * (1.0 - smoothstep(74.0, 80.0, shipAlong))
    * exp(-bowDistance / 100.0);
  var sternDistance = max(-shipAlong - 78.0, 0.0);
  var sternNoise = noise(vec2<f32>(shipAlong * 0.19 + uniforms.time * 0.35, shipAcross * 0.3 - uniforms.time * 0.12));
  var sternEnvelope = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 92.0)
    * exp(-pow(shipAcross / (8.0 + sternDistance * 0.24), 2.0));
  var propTrack = 3.7 + sternDistance * 0.095;
  var propDistance = abs(abs(shipAcross) - propTrack);
  var propWash = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 105.0)
    * exp(-pow(propDistance / (2.4 + sternDistance * 0.035), 2.0));
  var bowBreakup = smoothstep(0.28, 0.72, noise(p * 0.25 + vec2<f32>(uniforms.time * 0.5)))
    * smoothstep(0.32, 0.74, noise(p * 0.83 + vec2<f32>(-uniforms.time * 0.43, uniforms.time * 0.29)));
  var shipFoam = clamp((bowFoam * 1.0 + bowV * 0.76 * bowBreakup
    + sideFoam * 0.54 + sternEnvelope * (0.18 + 0.44 * sternNoise) + propWash * (0.18 + 0.42 * sternNoise)) * speedFactor, 0.0, 0.9);
  color = mix(color, vec3<f32>(0.93, 0.98, 1.0), shipFoam);
  var haze = smoothstep(800.0, 3400.0, range);
  color = mix(color, horizon, haze);
  fragmentOutputs.color = vec4<f32>(color, 1.0);
}
