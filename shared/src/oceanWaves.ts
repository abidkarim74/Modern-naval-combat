export interface OceanWave {
  readonly directionX: number;
  readonly directionZ: number;
  readonly wavelength: number;
  readonly amplitude: number;
  readonly angularFrequency: number;
  readonly phase: number;
}

/** Shared by the water shader and the client/server boat buoyancy simulation. */
export const OCEAN_WAVES: readonly OceanWave[] = [
  {
    directionX: 0.86,
    directionZ: 0.51,
    wavelength: 42,
    amplitude: 0.52,
    angularFrequency: 1.12,
    phase: 0.25,
  },
  {
    directionX: -0.42,
    directionZ: 0.91,
    wavelength: 23,
    amplitude: 0.24,
    angularFrequency: 1.51,
    phase: 1.65,
  },
  {
    directionX: 0.13,
    directionZ: 0.99,
    wavelength: 12,
    amplitude: 0.10,
    angularFrequency: 2.06,
    phase: 3.1,
  },
];

const TWO_PI = Math.PI * 2;

export function sampleOceanHeight(x: number, z: number, timeSeconds: number): number {
  let height = 0;

  for (const wave of OCEAN_WAVES) {
    const waveNumber = TWO_PI / wave.wavelength;
    const phase =
      waveNumber * (wave.directionX * x + wave.directionZ * z) -
      wave.angularFrequency * timeSeconds +
      wave.phase;
    height += wave.amplitude * Math.sin(phase);
  }

  return height;
}
