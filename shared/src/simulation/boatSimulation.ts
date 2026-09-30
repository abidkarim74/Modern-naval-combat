import { sampleOceanHeight } from "../oceanWaves.js";

export const FIXED_SIMULATION_STEP = 1 / 60;

export const BOAT_SIMULATION_CONFIG = Object.freeze({
  // Flight IIA proportions; handling coefficients are a gameplay approximation,
  // not measured Navy maneuvering data. SI units throughout, without time scaling.
  massKg: 9_200_000,
  hullLengthMeters: 155.29,
  hullBeamMeters: 18,
  waterlineOffsetMeters: 0,
  forwardThrustNewtons: 2_600_000,
  reverseThrustNewtons: 850_000,
  linearDragNewtonsPerMps: 28_000,
  quadraticDragNewtonsPerMpsSquared: 9_100,
  lateralDampingPerSecond: 0.22,
  throttleResponsePerSecond: 0.16,
  rudderResponsePerSecond: 0.22,
  maximumYawRateRadiansPerSecond: 0.028,
  yawResponsePerSecond: 0.09,
  buoyancyStiffnessNewtonsPerMeter: 18_400_000,
  verticalDampingNewtonsPerMps: 20_240_000,
  pitchSpringPerSecondSquared: 0.65,
  pitchDampingPerSecond: 1.4,
  rollSpringPerSecondSquared: 0.48,
  rollDampingPerSecond: 0.85,
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

export class BoatSimulation {
  readonly state: BoatSimulationState = {
    positionX: 0,
    positionY: BOAT_SIMULATION_CONFIG.waterlineOffsetMeters,
    positionZ: 0,
    previousPositionX: 0,
    previousPositionY: BOAT_SIMULATION_CONFIG.waterlineOffsetMeters,
    previousPositionZ: 0,
    velocityX: 0,
    velocityZ: 0,
    forwardSpeed: 0,
    speed: 0,
    heading: 0,
    previousHeading: 0,
    yawRate: 0,
    throttle: 0,
    steering: 0,
    verticalVelocity: 0,
    pitch: 0,
    previousPitch: 0,
    pitchVelocity: 0,
    roll: 0,
    previousRoll: 0,
    rollVelocity: 0,
    elapsedTime: 0,
    lastLongitudinalAcceleration: 0,
  };

  update(input: ControlInput, stepSeconds = FIXED_SIMULATION_STEP): void {
    const dt = Math.min(Math.max(stepSeconds, 0), 0.05);
    if (dt === 0) return;

    const state = this.state;
    const config = BOAT_SIMULATION_CONFIG;
    state.previousPositionX = state.positionX;
    state.previousPositionY = state.positionY;
    state.previousPositionZ = state.positionZ;
    state.previousHeading = state.heading;
    state.previousPitch = state.pitch;
    state.previousRoll = state.roll;

    const targetThrottle = clamp(input.throttle, -1, 1);
    const targetSteering = clamp(input.steering, -1, 1);
    state.throttle += (targetThrottle - state.throttle) * Math.min(1, config.throttleResponsePerSecond * dt);
    state.steering += (targetSteering - state.steering) * Math.min(1, config.rudderResponsePerSecond * dt);

    const forwardX = Math.sin(state.heading);
    const forwardZ = Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = -Math.sin(state.heading);
    const longitudinalSpeed = state.velocityX * forwardX + state.velocityZ * forwardZ;
    const lateralSpeed = state.velocityX * rightX + state.velocityZ * rightZ;

    const engineForce =
      state.throttle >= 0
        ? state.throttle * config.forwardThrustNewtons
        : state.throttle * config.reverseThrustNewtons;
    const longitudinalDrag =
      config.linearDragNewtonsPerMps * longitudinalSpeed +
      config.quadraticDragNewtonsPerMpsSquared * longitudinalSpeed * Math.abs(longitudinalSpeed);
    const longitudinalAcceleration = (engineForce - longitudinalDrag) / config.massKg;
    const lateralAcceleration = -lateralSpeed * config.lateralDampingPerSecond;
    state.lastLongitudinalAcceleration = longitudinalAcceleration;

    const nextLongitudinalSpeed = clamp(
      longitudinalSpeed + longitudinalAcceleration * dt,
      -config.maximumReverseSpeedMetersPerSecond,
      config.maximumSpeedMetersPerSecond,
    );
    const nextLateralSpeed = lateralSpeed + lateralAcceleration * dt;
    // Rudders need water flow: no stationary pivot or sideways thrusters.
    // At full speed this yields a broad ~570 m turning radius; astern
    // steering is weaker and reverses direction. Yaw builds over several seconds.
    const speedFactor = longitudinalSpeed / config.maximumSpeedMetersPerSecond;
    const targetYawRate = state.steering * speedFactor *
      config.maximumYawRateRadiansPerSecond * (longitudinalSpeed < 0 ? 0.5 : 1);
    state.yawRate +=
      (targetYawRate - state.yawRate) * Math.min(1, config.yawResponsePerSecond * dt);
    state.heading += state.yawRate * dt;

    const nextForwardX = Math.sin(state.heading);
    const nextForwardZ = Math.cos(state.heading);
    const nextRightX = Math.cos(state.heading);
    const nextRightZ = -Math.sin(state.heading);
    // Preserve world-space momentum as the hull turns; lateral drag then brings it around.
    state.velocityX = forwardX * nextLongitudinalSpeed + rightX * nextLateralSpeed;
    state.velocityZ = forwardZ * nextLongitudinalSpeed + rightZ * nextLateralSpeed;
    state.positionX += state.velocityX * dt;
    state.positionZ += state.velocityZ * dt;
    state.forwardSpeed = nextLongitudinalSpeed;
    state.speed = Math.hypot(state.velocityX, state.velocityZ);

    this.updateBuoyancy(dt, nextForwardX, nextForwardZ, nextRightX, nextRightZ, state.elapsedTime + dt);
    state.elapsedTime += dt;
  }

  private updateBuoyancy(
    dt: number,
    forwardX: number,
    forwardZ: number,
    rightX: number,
    rightZ: number,
    time: number,
  ): void {
    const state = this.state;
    const config = BOAT_SIMULATION_CONFIG;
    const halfLength = config.hullLengthMeters * 0.39;
    const halfBeam = config.hullBeamMeters * 0.38;
    const bowHeight = sampleOceanHeight(
      state.positionX + forwardX * halfLength,
      state.positionZ + forwardZ * halfLength,
      time,
    );
    const sternHeight = sampleOceanHeight(
      state.positionX - forwardX * halfLength,
      state.positionZ - forwardZ * halfLength,
      time,
    );
    const starboardHeight = sampleOceanHeight(
      state.positionX + rightX * halfBeam,
      state.positionZ + rightZ * halfBeam,
      time,
    );
    const portHeight = sampleOceanHeight(
      state.positionX - rightX * halfBeam,
      state.positionZ - rightZ * halfBeam,
      time,
    );

    const averageWaterHeight = (bowHeight + sternHeight + starboardHeight + portHeight) * 0.25;
    const targetHeave = averageWaterHeight + config.waterlineOffsetMeters;
    const buoyancyPerMass = config.buoyancyStiffnessNewtonsPerMeter / config.massKg;
    const dampingPerMass = config.verticalDampingNewtonsPerMps / config.massKg;
    const verticalAcceleration =
      (targetHeave - state.positionY) * buoyancyPerMass - state.verticalVelocity * dampingPerMass;
    state.verticalVelocity += verticalAcceleration * dt;
    state.positionY += state.verticalVelocity * dt;

    const wavePitch = Math.atan2(bowHeight - sternHeight, config.hullLengthMeters);
    const accelerationPitch = clamp(state.lastLongitudinalAcceleration * 0.005, -0.004, 0.004);
    const targetPitch = wavePitch + accelerationPitch;
    const pitchAcceleration =
      (targetPitch - state.pitch) * config.pitchSpringPerSecondSquared -
      state.pitchVelocity * config.pitchDampingPerSecond;
    state.pitchVelocity += pitchAcceleration * dt;
    state.pitch += state.pitchVelocity * dt;

    const waveRoll = Math.atan2(starboardHeight - portHeight, config.hullBeamMeters);
    const turnRoll = clamp(state.yawRate * state.forwardSpeed * 0.12, -0.055, 0.055);
    const targetRoll = waveRoll + turnRoll;
    const rollAcceleration =
      (targetRoll - state.roll) * config.rollSpringPerSecondSquared -
      state.rollVelocity * config.rollDampingPerSecond;
    state.rollVelocity += rollAcceleration * dt;
    state.roll += state.rollVelocity * dt;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
