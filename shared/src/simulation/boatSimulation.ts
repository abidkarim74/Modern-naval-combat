import { sampleOceanSurface, type OceanSurfaceSample } from "../oceanWaves.js";
import { resolveIslandHullMotion } from "../world/islandCollision.js";

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
  addedHeaveMassFraction: 0.35,
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

// Quadrature and least-squares waterplane moments depend only on the hull.
// Precompute them once, including the asymmetric bow/stern buoyancy centroid.
const WATERPLANE_PROBES = (() => {
  const probes: { x: number; z: number; weight: number; pitchWeight: number; rollWeight: number }[] = [];
  let totalWeight = 0, sumZ = 0, sumZZ = 0, sumXX = 0;
  for (const [z, halfBeam] of WATERPLANE_STATIONS) {
    for (const fraction of [-0.75, 0, 0.75]) {
      const x = halfBeam * fraction, weight = halfBeam * (fraction === 0 ? 2 : 1);
      probes.push({ x, z, weight, pitchWeight: 0, rollWeight: 0 });
      totalWeight += weight;
      sumZ += weight * z;
      sumZZ += weight * z * z;
      sumXX += weight * x * x;
    }
  }
  const centroidZ = sumZ / totalWeight;
  const pitchMoment = sumZZ - sumZ * centroidZ;
  for (const probe of probes) {
    probe.pitchWeight = probe.weight * (probe.z - centroidZ) / pitchMoment;
    probe.rollWeight = probe.weight * probe.x / sumXX;
    probe.weight /= totalWeight;
    Object.freeze(probe);
  }
  return Object.freeze(probes);
})();

export class BoatSimulation {
  private readonly oceanSample: OceanSurfaceSample = { height: 0, slopeX: 0, slopeZ: 0, verticalVelocity: 0 };
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
    const motion = resolveIslandHullMotion(
      { x: state.previousPositionX, z: state.previousPositionZ, heading: state.previousHeading },
      { x: state.positionX + state.velocityX * dt, z: state.positionZ + state.velocityZ * dt, heading: state.heading },
      { x: state.velocityX, z: state.velocityZ },
      { length: config.hullLengthMeters, beam: config.hullBeamMeters },
    );
    state.positionX = motion.pose.x;
    state.positionZ = motion.pose.z;
    state.heading = motion.pose.heading;
    state.previousPositionX = motion.previousPose.x;
    state.previousPositionZ = motion.previousPose.z;
    state.velocityX = motion.velocity.x;
    state.velocityZ = motion.velocity.z;
    if (motion.rotationBlocked) state.yawRate = 0;
    state.speed = Math.hypot(state.velocityX, state.velocityZ);
    state.forwardSpeed = state.velocityX * Math.sin(state.heading) + state.velocityZ * Math.cos(state.heading);
    state.distanceTraveledMeters += motion.distance;
    this.updateBuoyancy(dt, state.elapsedTime + dt);
    state.elapsedTime += dt;
  }

  private updateBuoyancy(dt: number, time: number): void {
    const state = this.state, config = BOAT_SIMULATION_CONFIG;
    const forwardX = Math.sin(state.heading), forwardZ = Math.cos(state.heading);
    let meanHeight = 0, waterVelocity = 0, pitchSlope = 0, rollSlope = 0;
    let pitchSlopeVelocity = 0, rollSlopeVelocity = 0;
    for (let index = 0; index < WATERPLANE_PROBES.length; index++) {
      const probe = WATERPLANE_PROBES[index];
      const offsetX = forwardX * probe.z + forwardZ * probe.x;
      const offsetZ = forwardZ * probe.z - forwardX * probe.x;
      // Rotating hull probes encounter water at their own velocity, including yaw.
      const sample = sampleOceanSurface(state.positionX + offsetX, state.positionZ + offsetZ, time,
        this.oceanSample, state.velocityX + state.yawRate * offsetZ, state.velocityZ - state.yawRate * offsetX);
      meanHeight += probe.weight * sample.height;
      waterVelocity += probe.weight * sample.verticalVelocity;
      pitchSlope += probe.pitchWeight * sample.height;
      rollSlope += probe.rollWeight * sample.height;
      pitchSlopeVelocity += probe.pitchWeight * sample.verticalVelocity;
      rollSlopeVelocity += probe.rollWeight * sample.verticalVelocity;
    }
    const targetHeave = meanHeight + config.waterlineOffsetMeters;
    const effectiveHeaveMass = config.massKg * (1 + config.addedHeaveMassFraction);
    // Linearized hydrostatic restoring force plus damping relative to the water.
    // Spatial averaging lets a long, heavy hull bridge short waves without jitter.
    const verticalAcceleration = ((targetHeave - state.positionY) * config.buoyancyStiffnessNewtonsPerMeter -
      (state.verticalVelocity - waterVelocity) * config.verticalDampingNewtonsPerMps) / effectiveHeaveMass;
    state.verticalVelocity += verticalAcceleration * dt;
    state.positionY += state.verticalVelocity * dt;
    const targetPitch = Math.atan(pitchSlope) + clamp(state.lastLongitudinalAcceleration * 0.006, -0.005, 0.005);
    const waterPitchVelocity = pitchSlopeVelocity / (1 + pitchSlope * pitchSlope);
    state.pitchVelocity += ((targetPitch - state.pitch) * config.pitchSpringPerSecondSquared -
      (state.pitchVelocity - waterPitchVelocity) * config.pitchDampingPerSecond) * dt;
    state.pitch += state.pitchVelocity * dt;
    const targetRoll = Math.atan(rollSlope) + clamp(state.yawRate * state.forwardSpeed * 0.13, -0.065, 0.065);
    const waterRollVelocity = rollSlopeVelocity / (1 + rollSlope * rollSlope);
    state.rollVelocity += ((targetRoll - state.roll) * config.rollSpringPerSecondSquared -
      (state.rollVelocity - waterRollVelocity) * config.rollDampingPerSecond) * dt;
    state.roll += state.rollVelocity * dt;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
