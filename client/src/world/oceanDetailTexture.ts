import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

export const OCEAN_DETAIL_TILE_METERS = 32;
export const OCEAN_DETAIL_SLOPE_SCALE = 0.35;
export const OCEAN_DETAIL_TEXTURE_SIZE = 256;

let cachedDetailData: Uint8Array | undefined;

/**
 * A small, repeatable wind-sea spectrum. Integer spatial frequencies make the
 * tile periodic in both directions, including its slope across the wrap seam.
 * RG stores physical height gradients; B stores the irregular crest field.
 */
export function generateOceanDetailData(): Uint8Array {
  if (cachedDetailData) return cachedDetailData;
  const size = OCEAN_DETAIL_TEXTURE_SIZE;
  const pixelCount = size * size;
  const slopeX = new Float32Array(pixelCount);
  const slopeZ = new Float32Array(pixelCount);
  const height = new Float32Array(pixelCount);
  const twoPi = Math.PI * 2;
  let seed = 731_219;
  const random = (): number => {
    seed = seed * 16_807 % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  let heightVariance = 0;
  for (let band = 0; band < 24; band++) {
    // Closely spaced but different directions prevent regular parallel ridges.
    const fraction = (band + random() * 0.65) / 24;
    const wavelength = 6 * (0.6 / 6) ** fraction;
    const angle = Math.atan2(0.6, 0.8) + (random() * 2 - 1) * (0.62 + fraction * 0.48);
    const cycles = OCEAN_DETAIL_TILE_METERS / wavelength;
    const frequencyX = Math.round(Math.cos(angle) * cycles);
    const frequencyZ = Math.round(Math.sin(angle) * cycles);
    const frequency = Math.hypot(frequencyX, frequencyZ);
    const waveNumber = twoPi * frequency / OCEAN_DETAIL_TILE_METERS;
    const directionX = frequencyX / frequency;
    const directionZ = frequencyZ / frequency;
    // Most slope energy lies in the small wind waves, with less at either end.
    const logWavelength = Math.log(wavelength / 2.0) / 0.72;
    const slopeAmplitude = 0.007 + 0.024 * Math.exp(-0.5 * logWavelength * logWavelength);
    const heightAmplitude = slopeAmplitude / waveNumber;
    heightVariance += heightAmplitude * heightAmplitude * 0.5;
    const phase = random() * twoPi;
    const step = twoPi * frequencyX / size;
    const stepCosine = Math.cos(step), stepSine = Math.sin(step);
    for (let row = 0; row < size; row++) {
      const rowPhase = phase + twoPi * frequencyZ * row / size;
      let sine = Math.sin(rowPhase), cosine = Math.cos(rowPhase);
      const offset = row * size;
      for (let column = 0; column < size; column++) {
        const index = offset + column;
        const gradient = slopeAmplitude * cosine;
        slopeX[index] += directionX * gradient;
        slopeZ[index] += directionZ * gradient;
        height[index] += heightAmplitude * sine;
        // Angle addition avoids trigonometric calls for every texel/band pair.
        const nextSine = sine * stepCosine + cosine * stepSine;
        cosine = cosine * stepCosine - sine * stepSine;
        sine = nextSine;
      }
    }
  }
  const data = new Uint8Array(pixelCount * 4);
  const encode = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  const heightScale = Math.sqrt(heightVariance) * 3.2;
  for (let index = 0; index < pixelCount; index++) {
    data[index * 4] = encode(0.5 + slopeX[index] / (OCEAN_DETAIL_SLOPE_SCALE * 2));
    data[index * 4 + 1] = encode(0.5 + slopeZ[index] / (OCEAN_DETAIL_SLOPE_SCALE * 2));
    data[index * 4 + 2] = encode(0.5 + height[index] / (heightScale * 2));
    data[index * 4 + 3] = 255;
  }
  cachedDetailData = data;
  return data;
}

/** One immutable upload, with mips filtering away subpixel ripples at distance. */
export function createOceanDetailTexture(scene: Scene): RawTexture {
  const texture = RawTexture.CreateRGBATexture(
    generateOceanDetailData(),
    OCEAN_DETAIL_TEXTURE_SIZE,
    OCEAN_DETAIL_TEXTURE_SIZE,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.name = "cached-wind-sea-slopes";
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.gammaSpace = false;
  texture.anisotropicFilteringLevel = 4;
  return texture;
}
