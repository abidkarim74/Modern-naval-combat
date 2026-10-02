import type { BirdAudioSnapshot } from "./seabirdAudio";

export const GULL_CAPACITY = 12;
export const GULL_PASS_PERIOD_SECONDS = 58;
export const GULL_PASS_DURATION_SECONDS = 32;

type MutableSnapshot = { -readonly [Key in keyof BirdAudioSnapshot]: BirdAudioSnapshot[Key] };

export interface GullFlightPose extends MutableSnapshot {
  yaw: number;
  pitch: number;
  bank: number;
  wingLift: number;
  wingTipLift: number;
  wingSweep: number;
  scale: number;
}

interface FlockAnchor {
  cycle: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

/** Analytic flight keeps motion smooth at any frame rate and reuses every pose. */
export class GullFlockFlight {
  readonly birds: GullFlightPose[] = Array.from({ length: GULL_CAPACITY }, (_, id) => ({
    id, visible: false, callEligible: false, x: 0, y: 0, z: 0,
    velocityX: 0, velocityY: 0, velocityZ: 0,
    yaw: 0, pitch: 0, bank: 0, wingLift: .1, wingTipLift: .03,
    wingSweep: 0, scale: .94 + (id % 4) * .035,
  }));
  private readonly flocks: FlockAnchor[] = [
    { cycle: NaN, x: 0, y: 0, z: 0, heading: 0 },
    { cycle: NaN, x: 0, y: 0, z: 0, heading: 0 },
  ];
  private birdsPerFlock = 6;
  activeBirdCount = 0;

  setBirdCount(count: number): void {
    this.birdsPerFlock = Math.ceil(Math.max(0, Math.min(GULL_CAPACITY, count)) / 2);
  }

  update(timeSeconds: number, focusX: number, focusZ: number, heading: number, focusY = 0): void {
    this.activeBirdCount = 0;
    for (let group = 0; group < this.flocks.length; group++) {
      // Start one group midway through its first pass so a new session has birds.
      const flightTime = timeSeconds + GULL_PASS_DURATION_SECONDS / 2 + group * GULL_PASS_PERIOD_SECONDS / 2;
      const cycle = Math.floor(flightTime / GULL_PASS_PERIOD_SECONDS);
      const age = flightTime - cycle * GULL_PASS_PERIOD_SECONDS;
      const flock = this.flocks[group]!;
      if (cycle !== flock.cycle) {
        flock.cycle = cycle;
        flock.x = focusX;
        flock.y = Math.max(9, focusY + 6);
        flock.z = focusZ;
        flock.heading = heading;
      }
      const cosine = Math.cos(flock.heading), sine = Math.sin(flock.heading);
      const direction = group === 0 ? 1 : -1;
      for (let lane = 0; lane < 6; lane++) {
        const bird = this.birds[group * 6 + lane]!;
        bird.visible = lane < this.birdsPerFlock && age < GULL_PASS_DURATION_SECONDS;
        bird.callEligible = bird.visible && (lane === 0 || lane === 3) && age > 4 && age < 28;
        if (!bird.visible) continue;
        this.activeBirdCount++;
        const phase = bird.id * 2.399;
        const turnPhase = age * .22 + phase;
        const heightPhase = age * .43 + phase;
        const cross = direction * ((age - 16) * 11.8 - lane * 4.1);
        const forward = 22 + lane * 2.1 + Math.sin(turnPhase) * 8;
        const crossVelocity = direction * 11.8;
        const forwardVelocity = Math.cos(turnPhase) * 1.76;
        const verticalVelocity = Math.cos(heightPhase) * .43 * .9;
        bird.x = flock.x + cross * cosine + forward * sine;
        bird.z = flock.z - cross * sine + forward * cosine;
        bird.y = flock.y + lane * .75 + Math.sin(heightPhase) * .9;
        bird.velocityX = crossVelocity * cosine + forwardVelocity * sine;
        bird.velocityZ = -crossVelocity * sine + forwardVelocity * cosine;
        bird.velocityY = verticalVelocity;
        const horizontalSpeed = Math.hypot(crossVelocity, forwardVelocity);
        bird.yaw = Math.atan2(bird.velocityX, bird.velocityZ);
        bird.pitch = -Math.atan2(verticalVelocity, horizontalSpeed);
        // Coordinated bank follows path curvature rather than arbitrary wobble.
        const forwardAcceleration = -Math.sin(turnPhase) * .3872;
        bird.bank = Math.atan2(crossVelocity * forwardAcceleration / horizontalSpeed, 9.81);

        // A short, smoothly entered burst of wingbeats between longer glides.
        const burstPeriod = 7.1 + (bird.id % 3) * .53;
        const burstTime = ((timeSeconds + phase) % burstPeriod + burstPeriod) % burstPeriod;
        const flapWeight = smoothstep(0, .18, burstTime) * (1 - smoothstep(1.15, 1.65, burstTime));
        const flapPhase = timeSeconds * (2.05 + (bird.id % 4) * .075) * Math.PI * 2 + phase;
        const beat = Math.sin(flapPhase);
        bird.wingLift = .105 + Math.sin(timeSeconds * .71 + phase) * .018 + beat * .64 * flapWeight;
        bird.wingTipLift = .025 + Math.sin(flapPhase - .62) * .34 * flapWeight;
        bird.wingSweep = .025 + Math.max(0, beat) * .11 * flapWeight;
      }
    }
  }
}
