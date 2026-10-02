precision highp float;
uniform float time;
uniform vec3 eyePosition;
uniform vec3 sunDirection;
uniform float detailStrength;
uniform float reflectionStrength;
uniform samplerCube skySampler;
uniform sampler2D detailSampler;
uniform vec3 boatPosition;
uniform float boatHeading;
uniform float boatSpeed;
uniform float boatYawRate;
uniform vec3 islandCenter;
uniform vec3 islandRadii;
uniform vec4 lagoonShape;
varying vec3 vWorldPosition;
varying float vWaveHeight;
varying vec2 vSurfaceSlope;

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
float gaussian(float value) {
  return exp(-value * value);
}

float hullDistance(vec2 hullXZ) {
  float bowTaper = pow(clamp((hullXZ.y - 25.0) / 49.0, 0.0, 1.0), 1.3);
  float halfBeam = mix(7.7, 0.15, bowTaper)
    - 1.7 * (1.0 - smoothstep(-77.0, -60.0, hullXZ.y));
  vec2 edge = vec2(abs(hullXZ.x) - halfBeam, max(-77.0 - hullXZ.y, hullXZ.y - 74.0));
  return length(max(edge, vec2(0.0))) + min(max(edge.x, edge.y), 0.0);
}

void main(void) {
  vec2 p = vWorldPosition.xz;
  float range = length(eyePosition - vWorldPosition);
  float rippleFade = 1.0 - smoothstep(180.0, 1700.0, range);
  // A cached periodic wind spectrum carries irregular fine waves. Hardware
  // mipmaps filter frequencies smaller than a pixel without per-pixel trig.
  vec3 detail = texture2D(detailSampler, p / 32.0 - vec2(.019, .013) * time).rgb;
  vec2 ripples = (detail.rg * 2.0 - 1.0) * .35;
#if WATER_DETAIL_LEVEL > 0
  vec2 crossUv = vec2(.8 * p.x - .6 * p.y, .6 * p.x + .8 * p.y) / 17.3 + vec2(.011, -.009) * time;
  vec2 crossRipple = (texture2D(detailSampler, crossUv).rg * 2.0 - 1.0) * .35;
  ripples = ripples * .72 + vec2(.8 * crossRipple.x + .6 * crossRipple.y, -.6 * crossRipple.x + .8 * crossRipple.y) * .48;
#endif
  ripples *= detailStrength * rippleFade;
  vec2 gradient = vSurfaceSlope + ripples;
  vec2 hullDelta = p - boatPosition.xz;
  vec2 hullForward = vec2(sin(boatHeading), cos(boatHeading));
  vec2 hullRight = vec2(cos(boatHeading), -sin(boatHeading));
  vec2 hullXZ = vec2(dot(hullDelta, hullRight), dot(hullDelta, hullForward));
  float waterlineDistance = 1000.0;
  if (abs(hullXZ.x) < 28.0 && abs(hullXZ.y) < 95.0) {
    waterlineDistance = max(0.0, hullDistance(hullXZ));
  }
  float restingHullBand = 1.0 - smoothstep(0.0, 9.0, waterlineDistance);

  // Catch the gentle waterline rise at rest as well as the moving bow and wake.
  vec3 geometricNormal = normalize(cross(dFdy(vWorldPosition), dFdx(vWorldPosition)));
  if (geometricNormal.y < 0.0) { geometricNormal = -geometricNormal; }
  vec2 geometricSlope = -geometricNormal.xz / max(geometricNormal.y, 0.2);
  float nearHull = 1.0 - smoothstep(110.0, 320.0, length(p - boatPosition.xz));
  float displacementNormal = max(restingHullBand * 0.55,
    nearHull * smoothstep(0.4, 12.0, abs(boatSpeed)) * 0.35);
  gradient = mix(gradient, geometricSlope + ripples, displacementNormal);
  vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
  vec3 view = normalize(eyePosition - vWorldPosition);
  vec3 reflected = reflect(-view, normal);
  float normalView = max(dot(normal, view), 0.001);
  // Air/seawater Fresnel F0 = ((1.333 - 1) / (1.333 + 1))^2.
  float fresnel = 0.02037 + 0.97963 * pow(1.0 - min(normalView, 1.0), 5.0);
  vec3 horizon = vec3(0.69, 0.81, 0.87);
  vec3 sky = textureCube(skySampler, vec3(reflected.x, abs(reflected.y), reflected.z)).rgb;
  float crest = smoothstep(-0.8, 1.15, vWaveHeight);
  vec3 body = mix(vec3(0.008, 0.055, 0.12), vec3(0.016, 0.19, 0.23), crest * 0.63);
  float shallow = 0.0;
  float coastDistance = 1000.0;
  float lagoonRadius = 10.0;
  vec2 lagoonUv = vec2(0.0);
  vec2 coastalDelta = p - islandCenter.xz;
  // Avoid coastline trig/noise across open water; this branch covers the full island.
  if (length(coastalDelta) < max(islandRadii.x, islandRadii.z) * 1.65 + 120.0) {
    vec2 coastalUv = coastalDelta / islandRadii.xz;
    float coastalAngle = atan(coastalUv.y, coastalUv.x);
    float bayAngle = atan(sin(coastalAngle + 1.57079633), cos(coastalAngle + 1.57079633));
    float capeAngle = atan(sin(coastalAngle + 2.62), cos(coastalAngle + 2.62));
    float coastRadius = .94 + .055 * sin(3.0 * coastalAngle + .4)
      + .032 * sin(7.0 * coastalAngle - .8) + .020 * sin(15.0 * coastalAngle + 1.8)
      + .009 * sin(27.0 * coastalAngle + 1.2)
      - .67 * gaussian(bayAngle / .72) + .07 * gaussian(capeAngle / .30);
    coastDistance = (length(coastalUv) - coastRadius)
      * length(coastalDelta) / max(length(coastalUv), .001);
    lagoonUv = (p - lagoonShape.xy) / lagoonShape.zw;
    lagoonRadius = length(lagoonUv);
    float lagoon = 1.0 - smoothstep(.48, 1.32, lagoonRadius);
    shallow = max(1.0 - smoothstep(8.0, 82.0, max(0.0, coastDistance)), lagoon);
    float coral = noise(p * .055);
#if WATER_DETAIL_LEVEL > 0
    coral = coral * .65 + noise(p * .17) * .35;
#endif
    vec3 coastalWater = mix(vec3(.018, .35, .36), vec3(.065, .65, .57), coral * .7 + lagoon * .3);
    body = mix(body, coastalWater, shallow * .94);
  }
  float scatter = pow(max(dot(view, -sunDirection), 0.0), 4.0) * crest * (1.0 - fresnel);
  body += vec3(0.015, 0.06, 0.045) * scatter;
  float light = 0.65 + 0.35 * max(dot(normal, sunDirection), 0.0);
  vec3 color = mix(body * light, sky, fresnel * reflectionStrength);
  vec3 halfway = normalize(view + sunDirection);
  float normalLight = max(dot(normal, sunDirection), 0.0);
  float normalHalf = max(dot(normal, halfway), 0.0);
  float viewHalf = max(dot(view, halfway), 0.0);
  vec2 slopeFootprint = fwidth(gradient);
  float roughness = clamp(0.095 + dot(slopeFootprint, slopeFootprint) * 1.5, 0.095, 0.38);
  float alpha = roughness * roughness;
  float alphaSquared = alpha * alpha;
  float distributionDenominator = normalHalf * normalHalf * (alphaSquared - 1.0) + 1.0;
  float distribution = alphaSquared / max(3.14159265 * distributionDenominator * distributionDenominator, 0.00001);
  float visibilityView = normalLight * sqrt(normalView * normalView * (1.0 - alphaSquared) + alphaSquared);
  float visibilityLight = normalView * sqrt(normalLight * normalLight * (1.0 - alphaSquared) + alphaSquared);
  float visibility = 0.5 / max(visibilityView + visibilityLight, 0.0001);
  float sunFresnel = 0.02037 + 0.97963 * pow(1.0 - viewHalf, 5.0);
  float glint = min(distribution * visibility * sunFresnel * normalLight * 1.2, 2.0);
  color += vec3(1.0, 0.92, 0.76) * glint * (1.0 - shallow * .55);

#if WATER_DETAIL_LEVEL > 0
  // Sparse whitecaps follow local steepness and overlapping crests.
  float steepness = length(gradient);
  float foamPatch = detail.b;
  float foam = smoothstep(.16, .29, steepness) * smoothstep(.45, .9, crest)
    * smoothstep(.60, .85, foamPatch) * rippleFade;
  color = mix(color, vec3(.85, .94, .93), foam * .46);
#endif
  if (shallow > .01) {
    float shoreBreak = (1.0 - smoothstep(1.5, 8.0, abs(coastDistance - 2.7)))
      * smoothstep(.18, .72, noise(p * .4 + vec2(time * .18, -time * .13)))
      * (.55 + .45 * sin(coastDistance * 1.15 - time * 1.8));
    float reefBand = gaussian((lagoonRadius - 1.04) / .048)
      * smoothstep(-.10, .35, -lagoonUv.y) * smoothstep(.47, .77, noise(p * .037))
      * (.55 + .45 * sin(lagoonRadius * 32.0 - time * 1.3));
    color = mix(color, vec3(.87, .96, .94), clamp(shoreBreak * .70 + reefBand * .72, 0.0, .85));
  }

  // A faint broken contact line remains while swell laps a stationary hull.
  if (waterlineDistance < 3.0) {
    float lapping = 0.5 + 0.5 * sin(time * 1.15 - hullXZ.y * 0.055);
    float contact = gaussian(waterlineDistance / 0.95)
      * smoothstep(0.28, 0.78, detail.b) * (0.055 + 0.045 * lapping);
    color = mix(color, vec3(0.72, 0.86, 0.87), contact);
  }

  // Strong bubbly hull shading builds with vessel speed.
  vec2 shipDelta = p - boatPosition.xz;
  float speedFactor = smoothstep(0.4, 12.0, abs(boatSpeed));
  if (speedFactor > .001 && length(shipDelta) < 580.0) {
    float movementHeading = boatHeading + (boatSpeed < 0.0 ? 3.14159265 : 0.0);
    vec2 shipForward = vec2(sin(movementHeading), cos(movementHeading));
    vec2 shipRight = vec2(cos(boatHeading), -sin(boatHeading));
    float shipAlong = dot(shipDelta, shipForward);
    float shipAcross = dot(shipDelta, shipRight);
    // Include the full bow V (centre up to 48 m, plus its Gaussian width).
    // A narrow hull-only cutoff otherwise slices visible bow foam into a sheet.
    float foamWidth = max(64.0, 24.0 + max(-shipAlong, 0.0) * .24);
    if (shipAlong < 110.0 && shipAlong > -560.0 && abs(shipAcross) < foamWidth) {
    float shipHalfBeam = max(0.3, 8.5 * (1.0 - smoothstep(25.0, 78.0, shipAlong)));
    vec2 hullFlow = vec2(abs(shipAcross) * 0.8, shipAlong * 0.35 + time * abs(boatSpeed) * 0.48);
    float froth = noise(hullFlow * .75);
#if WATER_DETAIL_LEVEL > 0
    froth = froth * .6 + noise(hullFlow * 2.4) * .4;
#endif
    float bubbles = smoothstep(.25, .68, froth);
    float turnBias = clamp(1.0 + sign(shipAcross) * boatYawRate * abs(boatSpeed) * .8, .7, 1.35);
    float alongSquared = (shipAlong / 75.0) * (shipAlong / 75.0);
    float shoulderEnvelope = gaussian((abs(shipAcross) - shipHalfBeam) / 4.8)
      * exp(-alongSquared * alongSquared * alongSquared * alongSquared);
    float bowEnvelope = gaussian((shipAlong - 77.0) / 9.0) * gaussian(shipAcross / 10.0);
    float bowFoam = bowEnvelope * smoothstep(.3, .74, noise(shipDelta * .62 + vec2(time * .85, -time * .47)));
    float sideFoam = shoulderEnvelope * (.22 + bubbles * .78) * turnBias;
    float bowDistance = clamp(77.0 - shipAlong, 0.0, 120.0);
    float bowV = gaussian((abs(shipAcross) - (1.0 + bowDistance * .39)) / (1.5 + bowDistance * .028))
      * smoothstep(-35.0, 18.0, shipAlong) * (1.0 - smoothstep(74.0, 80.0, shipAlong)) * exp(-bowDistance / 100.0);
    float sternDistance = max(-shipAlong - 78.0, 0.0);
    float sternNoise = noise(vec2(shipAlong * .19 + time * .35, shipAcross * .3 - time * .12));
    float sternEnvelope = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 120.0)
      * gaussian(shipAcross / (9.0 + sternDistance * .22));
    float propDistance = abs(shipAcross) - (3.7 + sternDistance * .095);
    float propWash = smoothstep(72.0, 82.0, -shipAlong) * exp(-sternDistance / 105.0)
      * gaussian(propDistance / (2.4 + sternDistance * .035));
    float bowBreakup = smoothstep(.28, .72, noise(p * .25 + vec2(time * .5)));
    float shipFoam = clamp((bowFoam * 1.15 + bowV * .95 * bowBreakup + sideFoam * 1.05
      + sternEnvelope * (.26 + .52 * sternNoise) + propWash * (.35 + .60 * sternNoise)) * speedFactor, 0.0, .9);
    shipFoam *= (1.0 - smoothstep(foamWidth - 12.0, foamWidth, abs(shipAcross)))
      * smoothstep(-560.0, -510.0, shipAlong) * (1.0 - smoothstep(90.0, 110.0, shipAlong))
      * (1.0 - smoothstep(520.0, 580.0, length(shipDelta)));
    color = mix(color, vec3(.93, .98, 1.0), shipFoam);
    }
  }
  float haze = smoothstep(800.0, 4800.0, range);
  color = mix(color, horizon, haze);
  gl_FragColor = vec4(color, 1.0);
}
