export interface AudioVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Reused by the bird renderer and audio; coordinates and velocity are SI units. */
export interface BirdAudioSnapshot extends AudioVector3 {
  readonly id: number;
  readonly visible: boolean;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly velocityZ: number;
  readonly callEligible: boolean;
}

export interface SeabirdSpatialSample {
  distance: number;
  gain: number;
  pan: number;
  doppler: number;
}

export const GULL_CALL_VARIANTS = Object.freeze([
  Object.freeze({ offset: 0, duration: .85 }),
  Object.freeze({ offset: .85, duration: .8 }),
  Object.freeze({ offset: 1.65, duration: .85 }),
]);

/** Inverse-distance amplitude, fading smoothly to silence before 220 metres. */
export function seabirdDistanceGain(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.min(1, 18 / Math.max(18, distance)) * (1 - smoothstep(150, 220, distance));
}

/** Allocation-free spatial math, including a modest subsonic Doppler shift. */
export function sampleSeabirdSpatial(
  bird: BirdAudioSnapshot,
  listener: AudioVector3,
  forward: AudioVector3,
  listenerVelocity: AudioVector3,
  out: SeabirdSpatialSample,
): SeabirdSpatialSample {
  const x = bird.x - listener.x, y = bird.y - listener.y, z = bird.z - listener.z;
  const distance = Math.hypot(x, y, z);
  if (!Number.isFinite(distance)) {
    out.distance = Infinity; out.gain = 0; out.pan = 0; out.doppler = 1;
    return out;
  }
  const inverseDistance = 1 / Math.max(.001, distance);
  const horizontalForwardLength = Math.hypot(forward.x, forward.z);
  const rightX = horizontalForwardLength > .001 ? forward.z / horizontalForwardLength : 1;
  const rightZ = horizontalForwardLength > .001 ? -forward.x / horizontalForwardLength : 0;
  const radialVelocity = ((bird.velocityX - listenerVelocity.x) * x +
    (bird.velocityY - listenerVelocity.y) * y + (bird.velocityZ - listenerVelocity.z) * z) * inverseDistance;
  out.distance = distance;
  out.gain = bird.visible ? seabirdDistanceGain(distance) : 0;
  out.pan = clamp((x * rightX + z * rightZ) * inverseDistance, -1, 1);
  out.doppler = Number.isFinite(radialVelocity) ? clamp(343 / (343 + clamp(radialVelocity, -30, 30)), .94, 1.06) : 1;
  return out;
}

/** Sparse per-bird calls are tied to visible, nearby members of a passing flock. */
export class GullCallScheduler {
  private nextGlobalTime = 0;
  private sequence = 0;
  private readonly nextBirdTimes = new Map<number, number>();

  select(birds: readonly BirdAudioSnapshot[], listener: AudioVector3, clock: number, activeIdA = -1, activeIdB = -1): BirdAudioSnapshot | undefined {
    if (!Number.isFinite(clock) || clock < this.nextGlobalTime) return undefined;
    let closest: BirdAudioSnapshot | undefined;
    let closestSquared = 180 * 180;
    for (let index = 0; index < birds.length; index++) {
      const bird = birds[index];
      if (!bird.visible || !bird.callEligible || bird.id === activeIdA || bird.id === activeIdB ||
        clock < (this.nextBirdTimes.get(bird.id) ?? 0)) continue;
      const x = bird.x - listener.x, y = bird.y - listener.y, z = bird.z - listener.z;
      const distanceSquared = x * x + y * y + z * z;
      if (Number.isFinite(distanceSquared) && distanceSquared < closestSquared) {
        closest = bird;
        closestSquared = distanceSquared;
      }
    }
    return closest;
  }

  started(birdId: number, clock: number): number {
    const sequence = this.sequence++;
    const variation = ((birdId * 17 + sequence * 13) % 11) / 10;
    this.nextGlobalTime = clock + 2.8 + variation * 1.5;
    this.nextBirdTimes.set(birdId, clock + 9 + (birdId % 3) * 1.7 + variation * 2);
    return sequence;
  }
}

/** Cached fallback: rough harmonic/formant-rich flight call, never a live chirp oscillator. */
export function fillSynthesizedGullCall(samples: Float32Array, sampleRate: number, variant: number): void {
  let phase = 0, previousNoise = 0, seed = 1039 + variant * 327;
  const duration = samples.length / sampleRate;
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    const progress = time / duration;
    const attack = smoothstep(0, .035, time);
    const release = 1 - smoothstep(duration - .14, duration, time);
    const throatPulse = .72 + .28 * Math.sin(2 * Math.PI * (31 + variant * 2.7) * time);
    const pitch = (790 + variant * 55) * (1 + .42 * Math.exp(-(((progress - .19) / .12) ** 2)) - .29 * progress) +
      14 * Math.sin(time * 91) + 8 * Math.sin(time * 173);
    phase += 2 * Math.PI * pitch / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = (seed >>> 0) / 2147483648 - 1;
    const rasp = noise - previousNoise * .78;
    previousNoise = noise;
    const harmonics = Math.sin(phase) * .23 + Math.sin(phase * 2 + .6) * .29 +
      Math.sin(phase * 3 + .17) * .22 + Math.sin(phase * 4) * .09 + Math.sin(phase * 6 + 1.1) * .05;
    samples[index] = (harmonics * throatPulse + rasp * .095) * attack * release * Math.exp(-progress * .8) * .8;
  }
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
