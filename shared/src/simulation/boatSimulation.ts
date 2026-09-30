import { OCEAN_WAVES } from "../oceanWaves.js";

export const FIXED_SIMULATION_STEP = 1 / 60;

export const BOAT_SIMULATION_CONFIG = Object.freeze({
  // Flight IIA scale. Hydrodynamic coefficients are tuned approximations,
  // not measured Navy maneuvering data. All forces use SI units.
  massKg: 9_200_000,
  hullLengthMeters: 155.29,
  hullBeamMeters: 18,
  waterlineOffsetMeters: 0.6,
  forwardThrustNewtons: 2_600_000,
  reverseThrustNewtons: 850_000,
  linearDragNewtonsPerMps: 28_000,
  quadraticDragNewtonsPerMpsSquared: 9_100,
  waterDensityKgPerCubicMeter: 1025,
  addedSurgeMassFraction: 0.08,
  addedSwayMassFraction: 0.45,
  yawInertiaKgMetersSquared: 31_000_000_000,
  rudderAreaSquareMeters: 12,
  rudderLiftSlope: 2.1,
  rudderLeverMeters: 55,
  maximumRudderAngleRadians: 35 * Math.PI / 180,
  rudderSlewRadiansPerSecond: 2.4 * Math.PI / 180,
  yawDampingAtRest: 160_000_000,
  yawDampingPerMps: 185_000_000,
  throttleResponsePerSecond: 0.16,
  buoyancyStiffnessNewtonsPerMeter: 18_400_000,
  verticalDampingNewtonsPerMps: 20_240_000,
  pitchSpringPerSecondSquared: 0.65,
  pitchDampingPerSecond: 1.35,
  rollSpringPerSecondSquared: 0.48,
  rollDampingPerSecond: 0.78,
  maximumSpeedMetersPerSecond: 15.95,
  maximumReverseSpeedMetersPerSecond: 4.1,
});

export interface ControlInput {
  readonly throttle: number;
  readonly steering: number;
}

export interface BoatSimulationState {
  positionX: number;
  positionY: number;
  positionZ: number;
  previousPositionX: number;
  previousPositionY: number;
  previousPositionZ: number;
  velocityX: number;
  velocityZ: number;
  forwardSpeed: number;
  speed: number;
  heading: number;
  previousHeading: number;
  yawRate: number;
  throttle: number;
  steering: number;
  rudderAngleRadians: number;
  distanceTraveledMeters: number;
  verticalVelocity: number;
  pitch: number;
  previousPitch: number;
  pitchVelocity: number;
  roll: number;
  previousRoll: number;
  rollVelocity: number;
  elapsedTime: number;
  lastLongitudinalAcceleration: number;
}

// Waterplane strips: fine bow, full midbody, broad transom. Three probes per
// strip average short chop instead of balancing a 155 m hull on four points.
const WATERPLANE_STATIONS = [
  [-64, 6.4], [-43, 7.7], [-22, 8.4], [0, 8.4],
  [22, 7.8], [43, 5.8], [64, 2.4],
] as const;

export class BoatSimulation {
  readonly state: BoatSimulationState = {
    positionX: 0, positionY: BOAT_SIMULATION_CONFIG.waterlineOffsetMeters, positionZ: 0,
    previousPositionX: 0, previousPositionY: BOAT_SIMULATION_CONFIG.waterlineOffsetMeters, previousPositionZ: 0,
    velocityX: 0, velocityZ: 0, forwardSpeed: 0, speed: 0,
    heading: 0, previousHeading: 0, yawRate: 0, throttle: 0, steering: 0,
    rudderAngleRadians: 0, distanceTraveledMeters: 0,
    verticalVelocity: 0, pitch: 0, previousPitch: 0, pitchVelocity: 0,
    roll: 0, previousRoll: 0, rollVelocity: 0, elapsedTime: 0,
    lastLongitudinalAcceleration: 0,
  };

  update(input: ControlInput, stepSeconds = FIXED_SIMULATION_STEP): void {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return;
    // Substeps preserve elapsed time and stability for callers outside the
    // fixed-step client, including server updates at 20 Hz.
    const duration = Math.min(stepSeconds, 0.25);
    const count = Math.ceil(duration / FIXED_SIMULATION_STEP);
    const dt = duration / count;
    for (let index = 0; index < count; index++) this.integrate(input, dt);
  }

  private integrate(input: ControlInput, dt: number): void {
    const state = this.state;
    const config = BOAT_SIMULATION_CONFIG;
    state.previousPositionX = state.positionX;
    state.previousPositionY = state.positionY;
    state.previousPositionZ = state.positionZ;
    state.previousHeading = state.heading;
    state.previousPitch = state.pitch;
    state.previousRoll = state.roll;

    const targetThrottle = Number.isFinite(input.throttle) ? clamp(input.throttle, -1, 1) : 0;
    const targetRudder = (Number.isFinite(input.steering) ? clamp(input.steering, -1, 1) : 0) * config.maximumRudderAngleRadians;
    state.throttle += (targetThrottle - state.throttle) * (1 - Math.exp(-config.throttleResponsePerSecond * dt));
    state.rudderAngleRadians += clamp(targetRudder - state.rudderAngleRadians,
      -config.rudderSlewRadiansPerSecond * dt, config.rudderSlewRadiansPerSecond * dt);
    state.steering = state.rudderAngleRadians / config.maximumRudderAngleRadians;

    const forwardX = Math.sin(state.heading), forwardZ = Math.cos(state.heading);
    const rightX = forwardZ, rightZ = -forwardX;
    const surge = state.velocityX * forwardX + state.velocityZ * forwardZ;
    const sway = state.velocityX * rightX + state.velocityZ * rightZ;
    const engineForce = state.throttle * (state.throttle >= 0 ? config.forwardThrustNewtons : config.reverseThrustNewtons);
    const hullDrag = config.linearDragNewtonsPerMps * surge + config.quadraticDragNewtonsPerMpsSquared * surge * Math.abs(surge);
    // Twin rudders apply lateral force at the stern and a moment about the
    // center of mass. Flow reverses astern; at rest there is no pivot force.
    const rudderLift = 0.5 * config.waterDensityKgPerCubicMeter * config.rudderAreaSquareMeters *
      config.rudderLiftSlope * surge * Math.abs(surge) * Math.sin(state.rudderAngleRadians) * (surge < 0 ? 0.55 : 1);
    const rudderDrag = Math.abs(rudderLift * Math.sin(state.rudderAngleRadians)) * 0.45 * Math.sign(surge);
    const surgeAcceleration = (engineForce - hullDrag - rudderDrag) / (config.massKg * (1 + config.addedSurgeMassFraction));
    const lateralHullForce = -config.massKg * (0.15 + 0.018 * Math.abs(surge)) * sway - 190_000 * sway * Math.abs(sway);
    const swayAcceleration = (lateralHullForce - rudderLift) / (config.massKg * (1 + config.addedSwayMassFraction));
    const yawDamping = config.yawDampingAtRest + config.yawDampingPerMps * Math.abs(surge);
    const yawMoment = rudderLift * config.rudderLeverMeters - yawDamping * state.yawRate;
    state.yawRate += yawMoment / config.yawInertiaKgMetersSquared * dt;
    state.heading += state.yawRate * dt;
    state.lastLongitudinalAcceleration = surgeAcceleration;

    const nextSurge = clamp(surge + surgeAcceleration * dt, -config.maximumReverseSpeedMetersPerSecond, config.maximumSpeedMetersPerSecond);
    const nextSway = sway + swayAcceleration * dt;
    // Resolve forces in the old hull basis: changing heading must not rotate
    // the existing world velocity. The hull develops sideslip through a turn.
    state.velocityX = forwardX * nextSurge + rightX * nextSway;
    state.velocityZ = forwardZ * nextSurge + rightZ * nextSway;
    state.speed = Math.hypot(state.velocityX, state.velocityZ);
    state.forwardSpeed = state.velocityX * Math.sin(state.heading) + state.velocityZ * Math.cos(state.heading);
    state.positionX += state.velocityX * dt;
    state.positionZ += state.velocityZ * dt;
    state.distanceTraveledMeters += state.speed * dt;
    this.updateBuoyancy(dt, state.elapsedTime + dt);
    state.elapsedTime += dt;
  }

  private updateBuoyancy(dt: number, time: number): void {
    const state = this.state, config = BOAT_SIMULATION_CONFIG;
    const forwardX = Math.sin(state.heading), forwardZ = Math.cos(state.heading);
    let totalWeight = 0, heave = 0, waterVelocity = 0;
    let sumZ = 0, sumZZ = 0, sumZH = 0, sumXX = 0, sumXH = 0;
    for (const [localZ, halfBeam] of WATERPLANE_STATIONS) {
      for (const fraction of [-0.75, 0, 0.75]) {
        const localX = halfBeam * fraction;
        const weight = halfBeam * (fraction === 0 ? 2 : 1);
        const worldX = state.positionX + forwardX * localZ + forwardZ * localX;
        const worldZ = state.positionZ + forwardZ * localZ - forwardX * localX;
        let height = 0, velocity = 0;
        for (const wave of OCEAN_WAVES) {
          const k = Math.PI * 2 / wave.wavelength;
          const phase = k * (wave.directionX * worldX + wave.directionZ * worldZ) - wave.angularFrequency * time + wave.phase;
          height += wave.amplitude * Math.sin(phase);
          // Encounter velocity includes passage through the fixed world waves.
          velocity += wave.amplitude * Math.cos(phase) *
            (k * (wave.directionX * state.velocityX + wave.directionZ * state.velocityZ) - wave.angularFrequency);
        }
        totalWeight += weight;
        heave += weight * height;
        waterVelocity += weight * velocity;
        sumZ += weight * localZ; sumZZ += weight * localZ * localZ;
        sumZH += weight * localZ * height;
        sumXX += weight * localX * localX; sumXH += weight * localX * height;
      }
    }
    const meanHeight = heave / totalWeight;
    const pitchSlope = (sumZH - sumZ * meanHeight) / (sumZZ - sumZ * sumZ / totalWeight);
    const targetHeave = meanHeight + config.waterlineOffsetMeters;
    const verticalAcceleration = (targetHeave - state.positionY) * config.buoyancyStiffnessNewtonsPerMeter / config.massKg -
      (state.verticalVelocity - waterVelocity / totalWeight * 0.45) * config.verticalDampingNewtonsPerMps / config.massKg;
    state.verticalVelocity += verticalAcceleration * dt;
    state.positionY += state.verticalVelocity * dt;
    const targetPitch = Math.atan(pitchSlope) + clamp(state.lastLongitudinalAcceleration * 0.006, -0.005, 0.005);
    state.pitchVelocity += ((targetPitch - state.pitch) * config.pitchSpringPerSecondSquared - state.pitchVelocity * config.pitchDampingPerSecond) * dt;
    state.pitch += state.pitchVelocity * dt;
    const targetRoll = Math.atan(sumXH / sumXX) + clamp(state.yawRate * state.forwardSpeed * 0.13, -0.065, 0.065);
    state.rollVelocity += ((targetRoll - state.roll) * config.rollSpringPerSecondSquared - state.rollVelocity * config.rollDampingPerSecond) * dt;
    state.roll += state.rollVelocity * dt;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
