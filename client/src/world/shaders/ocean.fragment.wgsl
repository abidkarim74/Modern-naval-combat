uniform time : f32;
uniform eyePosition : vec3<f32>;
uniform sunDirection : vec3<f32>;
uniform detailStrength : f32;
uniform reflectionStrength : f32;
var skySamplerSampler : sampler;
var skySampler : texture_cube<f32>;
var detailSamplerSampler : sampler;
var detailSampler : texture_2d<f32>;
uniform boatPosition : vec3<f32>;
uniform boatHeading : f32;
uniform boatSpeed : f32;
uniform boatYawRate : f32;
uniform islandCenter : vec3<f32>;
uniform islandRadii : vec3<f32>;
uniform lagoonShape : vec4<f32>;
varying vWorldPosition : vec3<f32>;
varying vWaveHeight : f32;
varying vSurfaceSlope : vec2<f32>;

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
fn gaussian(value: f32) -> f32 {
  return exp(-value * value);
}

fn hullDistance(hullXZ: vec2<f32>) -> f32 {
  var bowTaper = pow(clamp((hullXZ.y - 25.0) / 49.0, 0.0, 1.0), 1.3);
  var halfBeam = mix(7.7, 0.15, bowTaper)
    - 1.7 * (1.0 - smoothstep(-77.0, -60.0, hullXZ.y));
  var edge = vec2<f32>(abs(hullXZ.x) - halfBeam, max(-77.0 - hullXZ.y, hullXZ.y - 74.0));
  return length(max(edge, vec2<f32>(0.0))) + min(max(edge.x, edge.y), 0.0);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var p = fragmentInputs.vWorldPosition.xz;
  var range = length(uniforms.eyePosition - fragmentInputs.vWorldPosition);
  var rippleFade = 1.0 - smoothstep(180.0, 1700.0, range);
  // A cached periodic wind spectrum carries irregular fine waves. Hardware
  // mipmaps filter frequencies smaller than a pixel without per-pixel trig.
  var detail = textureSample(detailSampler, detailSamplerSampler, p / 32.0 - vec2<f32>(.019, .013) * uniforms.time).rgb;
  var ripples = (detail.rg * 2.0 - 1.0) * .35;
#if WATER_DETAIL_LEVEL > 0
  var crossUv = vec2<f32>(.8 * p.x - .6 * p.y, .6 * p.x + .8 * p.y) / 17.3 + vec2<f32>(.011, -.009) * uniforms.time;
  var crossRipple = (textureSample(detailSampler, detailSamplerSampler, crossUv).rg * 2.0 - 1.0) * .35;
  ripples = ripples * .72 + vec2<f32>(.8 * crossRipple.x + .6 * crossRipple.y, -.6 * crossRipple.x + .8 * crossRipple.y) * .48;
#endif
  ripples *= uniforms.detailStrength * rippleFade;
  var gradient = fragmentInputs.vSurfaceSlope + ripples;
  var hullDelta = p - uniforms.boatPosition.xz;
  var hullForward = vec2<f32>(sin(uniforms.boatHeading), cos(uniforms.boatHeading));
  var hullRight = vec2<f32>(cos(uniforms.boatHeading), -sin(uniforms.boatHeading));
  var hullXZ = vec2<f32>(dot(hullDelta, hullRight), dot(hullDelta, hullForward));
  var waterlineDistance = 1000.0;
  if (abs(hullXZ.x) < 28.0 && abs(hullXZ.y) < 95.0) {
    waterlineDistance = max(0.0, hullDistance(hullXZ));
  }
  var restingHullBand = 1.0 - smoothstep(0.0, 9.0, waterlineDistance);

  // Catch the gentle waterline rise at rest as well as the moving bow and wake.
  var geometricNormal = normalize(cross(dpdy(fragmentInputs.vWorldPosition), dpdx(fragmentInputs.vWorldPosition)));
  if (geometricNormal.y < 0.0) { geometricNormal = -geometricNormal; }
  var geometricSlope = -geometricNormal.xz / max(geometricNormal.y, 0.2);
  var nearHull = 1.0 - smoothstep(110.0, 320.0, length(p - uniforms.boatPosition.xz));
  var displacementNormal = max(restingHullBand * 0.55,
    nearHull * smoothstep(0.4, 12.0, abs(uniforms.boatSpeed)) * 0.35);
  gradient = mix(gradient, geometricSlope + ripples, displacementNormal);
  var normal = normalize(vec3<f32>(-gradient.x, 1.0, -gradient.y));
  var view = normalize(uniforms.eyePosition - fragmentInputs.vWorldPosition);
  var reflected = reflect(-view, normal);
  var normalView = max(dot(normal, view), 0.001);
  // Air/seawater Fresnel F0 = ((1.333 - 1) / (1.333 + 1))^2.
  var fresnel = 0.02037 + 0.97963 * pow(1.0 - min(normalView, 1.0), 5.0);
  var horizon = vec3<f32>(0.69, 0.81, 0.87);
  var sky = textureSample(skySampler, skySamplerSampler, vec3<f32>(reflected.x, abs(reflected.y), reflected.z)).rgb;
  var crest = smoothstep(-0.8, 1.15, fragmentInputs.vWaveHeight);
  var body = mix(vec3<f32>(0.008, 0.055, 0.12), vec3<f32>(0.016, 0.19, 0.23), crest * 0.63);
  var shallow = 0.0;
  var coastDistance = 1000.0;
  var lagoonRadius = 10.0;
  var lagoonUv = vec2<f32>(0.0);
  var coastalDelta = p - uniforms.islandCenter.xz;
  // Avoid coastline trig/noise across open water; this branch covers the full island.
  if (length(coastalDelta) < max(uniforms.islandRadii.x, uniforms.islandRadii.z) * 1.65 + 120.0) {
    var coastalUv = coastalDelta / uniforms.islandRadii.xz;
    var coastalAngle = atan2(coastalUv.y, coastalUv.x);
    var bayAngle = atan2(sin(coastalAngle + 1.57079633), cos(coastalAngle + 1.57079633));
    var capeAngle = atan2(sin(coastalAngle + 2.62), cos(coastalAngle + 2.62));
    var coastRadius = .94 + .055 * sin(3.0 * coastalAngle + .4)
      + .032 * sin(7.0 * coastalAngle - .8) + .020 * sin(15.0 * coastalAngle + 1.8)
      + .009 * sin(27.0 * coastalAngle + 1.2)
      - .67 * gaussian(bayAngle / .72) + .07 * gaussian(capeAngle / .30);
    coastDistance = (length(coastalUv) - coastRadius)
      * length(coastalDelta) / max(length(coastalUv), .001);
    lagoonUv = (p - uniforms.lagoonShape.xy) / uniforms.lagoonShape.zw;
    lagoonRadius = length(lagoonUv);
    var lagoon = 1.0 - smoothstep(.48, 1.32, lagoonRadius);
    shallow = max(1.0 - smoothstep(8.0, 82.0, max(0.0, coastDistance)), lagoon);
    var coral = noise(p * .055);
#if WATER_DETAIL_LEVEL > 0
    coral = coral * .65 + noise(p * .17) * .35;
#endif
    var coastalWater = mix(vec3<f32>(.018, .35, .36), vec3<f32>(.065, .65, .57), coral * .7 + lagoon * .3);
    body = mix(body, coastalWater, shallow * .94);
  }
  var scatter = pow(max(dot(view, -uniforms.sunDirection), 0.0), 4.0) * crest * (1.0 - fresnel);
  body += vec3<f32>(0.015, 0.06, 0.045) * scatter;
  var light = 0.65 + 0.35 * max(dot(normal, uniforms.sunDirection), 0.0);
  var color = mix(body * light, sky, fresnel * uniforms.reflectionStrength);
  var halfway = normalize(view + uniforms.sunDirection);
  var normalLight = max(dot(normal, uniforms.sunDirection), 0.0);
  var normalHalf = max(dot(normal, halfway), 0.0);
  var viewHalf = max(dot(view, halfway), 0.0);
  var slopeFootprint = fwidth(gradient);
  var roughness = clamp(0.095 + dot(slopeFootprint, slopeFootprint) * 1.5, 0.095, 0.38);
  var alpha = roughness * roughness;
  var alphaSquared = alpha * alpha;
  var distributionDenominator = normalHalf * normalHalf * (alphaSquared - 1.0) + 1.0;
  var distribution = alphaSquared / max(3.14159265 * distributionDenominator * distributionDenominator, 0.00001);
  var visibilityView = normalLight * sqrt(normalView * normalView * (1.0 - alphaSquared) + alphaSquared);
  var visibilityLight = normalView * sqrt(normalLight * normalLight * (1.0 - alphaSquared) + alphaSquared);
  var visibility = 0.5 / max(visibilityView + visibilityLight, 0.0001);
  var sunFresnel = 0.02037 + 0.97963 * pow(1.0 - viewHalf, 5.0);
  var glint = min(distribution * visibility * sunFresnel * normalLight * 1.2, 2.0);
  color += vec3<f32>(1.0, 0.92, 0.76) * glint * (1.0 - shallow * .55);

#if WATER_DETAIL_LEVEL > 0
  // Sparse whitecaps follow local steepness and overlapping crests.
  var steepness = length(gradient);
  var foamPatch = detail.b;
  var foam = smoothstep(.16, .29, steepness) * smoothstep(.45, .9, crest)
    * smoothstep(.60, .85, foamPatch) * rippleFade;
  color = mix(color, vec3<f32>(.85, .94, .93), foam * .46);
#endif
  if (shallow > .01) {
    var shoreBreak = (1.0 - smoothstep(1.5, 8.0, abs(coastDistance - 2.7)))
      * smoothstep(.18, .72, noise(p * .4 + vec2<f32>(uniforms.time * .18, -uniforms.time * .13)))
      * (.55 + .45 * sin(coastDistance * 1.15 - uniforms.time * 1.8));
    var reefBand = gaussian((lagoonRadius - 1.04) / .048)
      * smoothstep(-.10, .35, -lagoonUv.y) * smoothstep(.47, .77, noise(p * .037))
      * (.55 + .45 * sin(lagoonRadius * 32.0 - uniforms.time * 1.3));
    color = mix(color, vec3<f32>(.87, .96, .94), clamp(shoreBreak * .70 + reefBand * .72, 0.0, .85));
  }

  // A faint broken contact line remains while swell laps a stationary hull.
  if (waterlineDistance < 3.0) {
    var lapping = 0.5 + 0.5 * sin(uniforms.time * 1.15 - hullXZ.y * 0.055);
    var contact = gaussian(waterlineDistance / 0.95)
      * smoothstep(0.28, 0.78, detail.b) * (0.055 + 0.045 * lapping);
    color = mix(color, vec3<f32>(0.72, 0.86, 0.87), contact);
  }

  // Strong bubbly hull shading builds with vessel speed.
  var shipDelta = p - uniforms.boatPosition.xz;
  var speedFactor = smoothstep(0.4, 12.0, abs(uniforms.boatSpeed));
  if (speedFactor > .001 && length(shipDelta) < 580.0) {
    var movementHeading = uniforms.boatHeading + select(0.0, 3.14159265, uniforms.boatSpeed < 0.0);
    var shipForward = vec2<f32>(sin(movementHeading), cos(movementHeading));
    var shipRight = vec2<f32>(cos(uniforms.boatHeading), -sin(uniforms.boatHeading));
    var shipAlong = dot(shipDelta, shipForward);
    var shipAcross = dot(shipDelta, shipRight);
    // Include the full bow V (centre up to 48 m, plus its Gaussian width).
    // A narrow hull-only cutoff otherwise slices visible bow foam into a sheet.
    var foamWidth = max(64.0, 24.0 + max(-shipAlong, 0.0) * .24);
    if (shipAlong < 110.0 && shipAlong > -560.0 && abs(shipAcross) < foamWidth) {
    var shipHalfBeam = max(0.3, 8.5 * (1.0 - smoothstep(25.0, 78.0, shipAlong)));
    var hullFlow = vec2<f32>(abs(shipAcross) * 0.8, shipAlong * 0.35 + uniforms.time * abs(uniforms.boatSpeed) * 0.48);
    var froth = noise(hullFlow * .75);
#if WATER_DETAIL_LEVEL > 0
    froth = froth * .6 + noise(hullFlow * 2.4) * .4;
#endif
    var bubbles = smoothstep(.25, .68, froth);
    var turnBias = clamp(1.0 + sign(shipAcross) * uniforms.boatYawRate * abs(uniforms.boatSpeed) * .8, .7, 1.35);
    var alongSquared = (shipAlong / 75.0) * (shipAlong / 75.0);
    var shoulderEnvelope = gaussian((abs(shipAcross) - shipHalfBeam) / 4.8)
      * exp(-alongSquared * alongSquared * alongSquared * alongSquared);
    var bowEnvelope = gaussian((shipAlong - 77.0) / 9.0) * gaussian(shipAcross / 10.0);
    var bowFoam = bowEnvelope * smoothstep(.3, .74, noise(shipDelta * .62 + vec2<f32>(uniforms.time * .85, -uniforms.time * .47)));
    var sideFoam = shoulderEnvelope * (.22 + bubbles * .78) * turnBias;
    var bowDistance = clamp(77.0 - shipAlong, 0.0, 120.0);
    var bowV = gaussian((abs(shipAcross) - (1.0 + bowDistance * .39)) / (1.5 + bowDistance * .028))
      * smoothstep(-35.0, 18.0, shipAlong) * (1.0 - smoothstep(74.0, 80.0, shipAlong)) * exp(-bowDistance / 100.0);
    var sternDistance = max(-shipAlong - 78.0, 0.0);
    var sternNoise = noise(vec2<f32>(shipAlong * .19 + uniforms.time * .35, shipAcross * .3 - uniforms.time * .12));
    var sternEnvelope = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 120.0)
      * gaussian(shipAcross / (9.0 + sternDistance * .22));
    var propDistance = abs(shipAcross) - (3.7 + sternDistance * .095);
    var propWash = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 105.0)
      * gaussian(propDistance / (2.4 + sternDistance * .035));
    var bowBreakup = smoothstep(.28, .72, noise(p * .25 + vec2<f32>(uniforms.time * .5)));
    var shipFoam = clamp((bowFoam * 1.15 + bowV * .95 * bowBreakup + sideFoam * 1.05
      + sternEnvelope * (.26 + .52 * sternNoise) + propWash * (.35 + .60 * sternNoise)) * speedFactor, 0.0, .9);
    shipFoam *= (1.0 - smoothstep(foamWidth - 12.0, foamWidth, abs(shipAcross)))
      * smoothstep(-560.0, -510.0, shipAlong) * (1.0 - smoothstep(90.0, 110.0, shipAlong))
      * (1.0 - smoothstep(520.0, 580.0, length(shipDelta)));
    color = mix(color, vec3<f32>(.93, .98, 1.0), shipFoam);
    }
  }
  var haze = smoothstep(800.0, 4800.0, range);
  color = mix(color, horizon, haze);
  fragmentOutputs.color = vec4<f32>(color, 1.0);
}
