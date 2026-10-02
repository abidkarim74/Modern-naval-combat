export interface OceanWave {
  readonly directionX: number;
  readonly directionZ: number;
  readonly wavelength: number;
  readonly waveNumber: number;
  readonly amplitude: number;
  /** Positive magnitude of the crest-sharpening second harmonic. */
  readonly harmonicAmplitude: number;
  readonly angularFrequency: number;
  readonly phase: number;
}

export interface OceanSurfaceSample {
  height: number;
  slopeX: number;
  slopeZ: number;
  /** Surface height rate at a stationary or moving query, in metres/second. */
  verticalVelocity: number;
}

const TWO_PI = Math.PI * 2;
const GRAVITY_METERS_PER_SECOND_SQUARED = 9.81;

function createWave(directionDegrees: number, wavelength: number, amplitude: number, phase: number): OceanWave {
  const direction = directionDegrees * Math.PI / 180;
  const waveNumber = TWO_PI / wavelength;
  return Object.freeze({
    directionX: Math.cos(direction),
    directionZ: Math.sin(direction),
    wavelength,
    waveNumber,
    amplitude,
    harmonicAmplitude: 0.5 * waveNumber * amplitude * amplitude,
    // Deep-water gravity-wave dispersion: long swell travels faster than chop.
    angularFrequency: Math.sqrt(GRAVITY_METERS_PER_SECOND_SQUARED * waveNumber),
    phase,
  });
}

/**
 * Deterministic fair-weather swell and wind sea shared by rendering and physics.
 * Directions spread around the prevailing wind instead of crossing arbitrarily.
 * Low steepness keeps the second-order Stokes approximation within its range.
 */
export const OCEAN_WAVES: readonly OceanWave[] = Object.freeze([
  createWave(30, 180, 0.62, 0.25),
  createWave(43, 95, 0.42, 1.65),
  createWave(24, 48, 0.30, 3.1),
  createWave(51, 26, 0.20, 0.8),
  createWave(34, 14, 0.115, 4.2),
  createWave(58, 8, 0.055, 2.4),
]);

/** Allocation-free height, analytic slope and encounter-velocity query. */
export function sampleOceanSurface(
  x: number,
  z: number,
  timeSeconds: number,
  out: OceanSurfaceSample,
  velocityX = 0,
  velocityZ = 0,
): OceanSurfaceSample {
  let height = 0, slopeX = 0, slopeZ = 0, verticalVelocity = 0;
  for (let index = 0; index < OCEAN_WAVES.length; index++) {
    const wave = OCEAN_WAVES[index];
    const phase = wave.waveNumber * (wave.directionX * x + wave.directionZ * z) -
      wave.angularFrequency * timeSeconds + wave.phase;
    const sine = Math.sin(phase), cosine = Math.cos(phase);
    // Double-angle identities reuse the primary pair of trigonometric calls.
    height += wave.amplitude * sine - wave.harmonicAmplitude * (cosine * cosine - sine * sine);
    const phaseDerivative = wave.amplitude * cosine + 4 * wave.harmonicAmplitude * sine * cosine;
    const gradient = wave.waveNumber * phaseDerivative;
    slopeX += wave.directionX * gradient;
    slopeZ += wave.directionZ * gradient;
    verticalVelocity += phaseDerivative * (wave.waveNumber *
      (wave.directionX * velocityX + wave.directionZ * velocityZ) - wave.angularFrequency);
  }
  out.height = height;
  out.slopeX = slopeX;
  out.slopeZ = slopeZ;
  out.verticalVelocity = verticalVelocity;
  return out;
}

export function sampleOceanHeight(x: number, z: number, timeSeconds: number): number {
  let height = 0;
  for (let index = 0; index < OCEAN_WAVES.length; index++) {
    const wave = OCEAN_WAVES[index];
    const phase = wave.waveNumber * (wave.directionX * x + wave.directionZ * z) -
      wave.angularFrequency * timeSeconds + wave.phase;
    const sine = Math.sin(phase);
    height += wave.amplitude * sine - wave.harmonicAmplitude * (1 - 2 * sine * sine);
  }
  return height;
}
