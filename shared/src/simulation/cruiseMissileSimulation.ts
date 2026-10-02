/** World-space metres, with +Y above sea level. */
export interface MissileVector {
  x: number;
  y: number;
  z: number;
}

export type MissileFlightPhase = "boost" | "turn" | "cruise" | "expired";

export interface CruiseMissileLaunch {
  position: MissileVector;
  /** The ship's world-space deck normal, including its current roll/pitch. */
  direction: MissileVector;
  /** Same convention as BoatSimulation: zero follows +Z, positive turns to +X. */
  headingRadians: number;
  inheritedVelocity: MissileVector;
}

export interface CruiseMissileState {
  position: MissileVector;
  velocity: MissileVector;
  /** Unit nose direction, distinct from velocity while the missile pitches over. */
  direction: MissileVector;
  ageSeconds: number;
  phase: MissileFlightPhase;
  boosterBurning: boolean;
  boosterAttached: boolean;
  wingDeployment: number;
  distanceMeters: number;
}

const STEP_SECONDS = 1 / 120;
const UP: MissileVector = { x: 0, y: 1, z: 0 };
const GRAVITY = 9.81;
const VERTICAL_BOOST_THRUST_SCALE = 0.75;
const BOOSTER_CUTOFF_SECONDS = 4.4;
const CRUISE_ALTITUDE_METERS = 120;
const CRUISE_SPEED_MPS = 235;
const MAX_AGE_SECONDS = 30;
const MAX_DISTANCE_METERS = 8_000;

/**
 * Approximate visual flight physics for the game, not missile guidance or
 * operational performance data. A fixed-step force integration preserves
 * momentum through the launch, pitch-over, booster release and altitude
 * leveling. Thrust, drag, steering response and staging times are artistic
 * coefficients; public launch imagery does not establish their exact values.
 */
export class CruiseMissileSimulation {
  readonly state: CruiseMissileState;
  private readonly launchAxis: MissileVector;
  private readonly headingDirection: MissileVector;
  private readonly launchHeight: number;
  private accumulatorSeconds = 0;
  private turnStartSeconds: number | undefined;

  constructor(launch: CruiseMissileLaunch) {
    this.launchAxis = normalize(launch.direction, UP);
    const heading = finite(launch.headingRadians);
    this.headingDirection = { x: Math.sin(heading), y: 0, z: Math.cos(heading) };
    const position = finiteVector(launch.position);
    this.launchHeight = position.y;
    const inherited = finiteVector(launch.inheritedVelocity, 150);
    this.state = {
      position,
      velocity: {
        x: inherited.x + this.launchAxis.x * 8,
        y: inherited.y + this.launchAxis.y * 8,
        z: inherited.z + this.launchAxis.z * 8,
      },
      direction: { ...this.launchAxis },
      ageSeconds: 0,
      phase: "boost",
      boosterBurning: true,
      boosterAttached: true,
      wingDeployment: 0,
      distanceMeters: 0,
    };
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || this.isExpired()) return;
    // Accept elapsed time after a paused/slow frame, but never simulate beyond
    // this object's bounded lifetime. Fractional steps carry into the next call.
    this.accumulatorSeconds += Math.min(deltaSeconds, MAX_AGE_SECONDS);
    while (this.accumulatorSeconds + 1e-10 >= STEP_SECONDS && !this.isExpired()) {
      this.integrate(STEP_SECONDS);
      this.accumulatorSeconds = Math.max(0, this.accumulatorSeconds - STEP_SECONDS);
    }
    if (this.isExpired()) this.accumulatorSeconds = 0;
  }

  private isExpired(): boolean {
    return this.state.phase === "expired";
  }

  private integrate(dt: number): void {
    const state = this.state;
    const age = state.ageSeconds + dt;
    if (this.turnStartSeconds === undefined && age >= 1.2 && state.position.y - this.launchHeight >= 55) {
      this.turnStartSeconds = state.ageSeconds;
    }
    state.phase = this.turnStartSeconds === undefined ? "boost" : age < 6 ? "turn" : "cruise";
    state.boosterBurning = age < BOOSTER_CUTOFF_SECONDS;
    state.boosterAttached = state.boosterBurning;
    state.wingDeployment = smoothstep(2.5, 4.5, age);

    const targetDirection = this.desiredDirection(age);
    const nextDirection = rotateToward(state.direction, targetDirection, 52 * Math.PI / 180 * dt);
    copyVector(state.direction, nextDirection);

    const velocity = state.velocity;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const velocityDirection = normalize(velocity, state.direction);
    const drag = 0.0013 * speed * speed;
    const engineBlend = smoothstep(3.9, BOOSTER_CUTOFF_SECONDS, age);
    // Ease the deck exit and vertical climb, then restore thrust smoothly as
    // the nose pitches forward so the outbound flight still picks up speed.
    const outboundBlend = this.turnStartSeconds === undefined ? 0 : smoothstep(0, 0.8, age - this.turnStartSeconds);
    const boostAcceleration = lerp(VERTICAL_BOOST_THRUST_SCALE, 1, outboundBlend)
      * (78 + 12 * smoothstep(0, 1.2, age)) * (1 - 0.45 * smoothstep(1.2, 1.8, age));
    const cruiseAcceleration = clamp((CRUISE_SPEED_MPS - speed) * 0.8, -25, 35);
    const axialAcceleration = lerp(boostAcceleration - drag, cruiseAcceleration, engineBlend);

    // A finite aerodynamic normal force bends existing velocity toward the
    // nose. Neither orientation changes nor stage transitions rotate momentum
    // instantaneously. Thrust acts along the nose and gravity always acts down.
    const steering = {
      x: (state.direction.x * speed - velocity.x) * 3.2,
      y: (state.direction.y * speed - velocity.y) * 3.2,
      z: (state.direction.z * speed - velocity.z) * 3.2,
    };
    const alongVelocity = dot(steering, velocityDirection);
    steering.x -= velocityDirection.x * alongVelocity;
    steering.y -= velocityDirection.y * alongVelocity;
    steering.z -= velocityDirection.z * alongVelocity;
    const steeringMagnitude = Math.hypot(steering.x, steering.y, steering.z);
    const steeringFade = this.turnStartSeconds === undefined ? 0 : smoothstep(0, 0.4, age - this.turnStartSeconds);
    const steeringLimit = Math.min(1, 160 / Math.max(steeringMagnitude, 1e-9)) * steeringFade;
    const lift = GRAVITY * state.wingDeployment;
    velocity.x += (state.direction.x * axialAcceleration + steering.x * steeringLimit) * dt;
    velocity.y += (state.direction.y * axialAcceleration + steering.y * steeringLimit + lift - GRAVITY) * dt;
    velocity.z += (state.direction.z * axialAcceleration + steering.z * steeringLimit) * dt;
    state.position.x += velocity.x * dt;
    state.position.y += velocity.y * dt;
    state.position.z += velocity.z * dt;
    state.distanceMeters += Math.hypot(velocity.x, velocity.y, velocity.z) * dt;
    state.ageSeconds = age;

    if (age + 1e-10 >= MAX_AGE_SECONDS || state.distanceMeters >= MAX_DISTANCE_METERS) {
      state.phase = "expired";
      state.boosterBurning = false;
      state.boosterAttached = false;
    }
  }

  private desiredDirection(age: number): MissileVector {
    if (this.turnStartSeconds === undefined) return this.launchAxis;
    const turnFraction = smoothstep(0, 1.9, age - this.turnStartSeconds);
    const levelDirection = sphericalInterpolate(this.launchAxis, this.headingDirection, turnFraction);
    // Damped altitude capture changes forces through the nose target rather
    // than snapping position to a cruise plane. Capture fades in after the
    // initial curve, allowing a natural climb, crest, then gradual leveling.
    const capture = smoothstep(2.4, 4.8, age);
    const desiredVerticalSpeed = clamp((CRUISE_ALTITUDE_METERS - this.state.position.y) * 0.8, -62, 35);
    const pitch = Math.atan2(desiredVerticalSpeed, CRUISE_SPEED_MPS);
    const cruiseDirection = {
      x: this.headingDirection.x * Math.cos(pitch),
      y: Math.sin(pitch),
      z: this.headingDirection.z * Math.cos(pitch),
    };
    return sphericalInterpolate(levelDirection, cruiseDirection, capture);
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteVector(vector: MissileVector, limit = 1e9): MissileVector {
  return { x: clamp(finite(vector.x), -limit, limit), y: clamp(finite(vector.y), -limit, limit), z: clamp(finite(vector.z), -limit, limit) };
}

function normalize(vector: MissileVector, fallback: MissileVector): MissileVector {
  const clean = { x: finite(vector.x), y: finite(vector.y), z: finite(vector.z) };
  // Scaling first avoids overflow for large valid vectors and preserves the
  // direction of very small valid vectors instead of mistaking them for zero.
  const scale = Math.max(Math.abs(clean.x), Math.abs(clean.y), Math.abs(clean.z));
  if (scale === 0) return { ...fallback };
  const scaled = { x: clean.x / scale, y: clean.y / scale, z: clean.z / scale };
  const length = Math.hypot(scaled.x, scaled.y, scaled.z);
  return { x: scaled.x / length, y: scaled.y / length, z: scaled.z / length };
}

function copyVector(target: MissileVector, source: MissileVector): void {
  target.x = source.x; target.y = source.y; target.z = source.z;
}

function dot(a: MissileVector, b: MissileVector): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function rotateToward(from: MissileVector, to: MissileVector, maxAngle: number): MissileVector {
  const angle = Math.acos(clamp(dot(from, to), -1, 1));
  return sphericalInterpolate(from, to, angle > 1e-9 ? Math.min(1, maxAngle / angle) : 1);
}

function sphericalInterpolate(from: MissileVector, to: MissileVector, fraction: number): MissileVector {
  const cosine = clamp(dot(from, to), -1, 1);
  if (cosine > 0.9999999999) return normalize({ x: lerp(from.x, to.x, fraction), y: lerp(from.y, to.y, fraction), z: lerp(from.z, to.z, fraction) }, from);
  // A valid launch deck normal and horizontal heading are far from opposite.
  // Still provide a deterministic arc for arbitrary caller-supplied axes.
  if (cosine < -0.9999) {
    const perpendicular = normalize(Math.abs(from.y) < 0.9 ? { x: -from.z, y: 0, z: from.x } : { x: from.y, y: -from.x, z: 0 }, { x: 1, y: 0, z: 0 });
    const angle = Math.PI * fraction;
    return { x: from.x * Math.cos(angle) + perpendicular.x * Math.sin(angle), y: from.y * Math.cos(angle) + perpendicular.y * Math.sin(angle), z: from.z * Math.cos(angle) + perpendicular.z * Math.sin(angle) };
  }
  const angle = Math.acos(cosine);
  const inverseSine = 1 / Math.sin(angle);
  const a = Math.sin((1 - fraction) * angle) * inverseSine;
  const b = Math.sin(fraction * angle) * inverseSine;
  return normalize({ x: from.x * a + to.x * b, y: from.y * a + to.y * b, z: from.z * a + to.z * b }, from);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction;
}

function smoothstep(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}
