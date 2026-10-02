import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

export const SKY_CLOUD_TEXTURE_SIZE = 512;
export const SKY_CLOUD_TILE_METERS = 12_800;
// The Sun's apparent diameter is approximately 0.53 degrees at Earth.
export const SKY_SUN_ANGULAR_RADIUS = 0.53 * Math.PI / 360;

let cachedCloudData: Uint8Array | undefined;

function periodicNoise(x: number, z: number, period: number): number {
  const cellX = Math.floor(x), cellZ = Math.floor(z);
  const fractionX = x - cellX, fractionZ = z - cellZ;
  const blendX = fractionX * fractionX * (3 - 2 * fractionX);
  const blendZ = fractionZ * fractionZ * (3 - 2 * fractionZ);
  const hash = (ix: number, iz: number): number => {
    const wrappedX = (ix % period + period) % period;
    const wrappedZ = (iz % period + period) % period;
    let value = Math.imul(wrappedX, 374_761_393) ^ Math.imul(wrappedZ, 668_265_263) ^ 83_719;
    value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
    return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
  };
  const a = hash(cellX, cellZ), b = hash(cellX + 1, cellZ);
  const c = hash(cellX, cellZ + 1), d = hash(cellX + 1, cellZ + 1);
  return (a + (b - a) * blendX) * (1 - blendZ) + (c + (d - c) * blendX) * blendZ;
}

/**
 * Sparse cumulus clusters built from overlapping rounded puffs. R is density,
 * G is the light-facing puff surface, B is fine erosion, A is puff thickness.
 * All fields wrap continuously; the GPU filters this immutable tile with mips.
 */
export function generateSkyCloudData(): Uint8Array {
  if (cachedCloudData) return cachedCloudData;
  const size = SKY_CLOUD_TEXTURE_SIZE;
  const volume = new Float32Array(size * size);
  const illumination = new Float32Array(size * size);
  const lightWeights = new Float32Array(size * size);
  let seed = 918_731;
  const random = (): number => {
    seed = seed * 16_807 % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let cluster = 0; cluster < 18; cluster++) {
    const centreX = random() * size, centreZ = random() * size;
    const spread = (0.030 + random() * 0.028) * size;
    for (let puff = 0; puff < 7; puff++) {
      const angle = random() * Math.PI * 2;
      const offset = Math.sqrt(random()) * spread;
      const x = centreX + Math.cos(angle) * offset;
      const z = centreZ + Math.sin(angle) * offset * 0.7;
      const radiusX = (0.023 + random() * 0.022) * size;
      const radiusZ = radiusX * (0.68 + random() * 0.44);
      const thickness = 0.65 + random() * 0.35;
      for (let row = Math.floor(z - radiusZ); row <= Math.ceil(z + radiusZ); row++) {
        for (let column = Math.floor(x - radiusX); column <= Math.ceil(x + radiusX); column++) {
          const dx = (column - x) / radiusX, dz = (row - z) / radiusZ;
          const radiusSquared = dx * dx + dz * dz;
          if (radiusSquared >= 1) continue;
          const dome = Math.sqrt(1 - radiusSquared);
          const density = dome * thickness;
          const index = ((row % size + size) % size) * size + (column % size + size) % size;
          volume[index] += density;
          // A rounded surface lit by the same midday sun as the sea and hull.
          const normalLength = Math.sqrt(dx * dx * 0.64 + dz * dz * 0.64 + dome * dome);
          const lightWeight = density * density;
          illumination[index] += Math.max(0, (-0.42 * dx * 0.8 + 0.68 * dome + 0.60 * dz * 0.8) / normalLength) * lightWeight;
          lightWeights[index] += lightWeight;
        }
      }
    }
  }
  for (let index = 0; index < volume.length; index++) {
    volume[index] = 1 - Math.exp(-volume[index] * 0.75);
    illumination[index] /= Math.max(lightWeights[index], 0.0001);
  }
  const sample = (field: Float32Array, x: number, z: number): number => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ax = (ix % size + size) % size, az = (iz % size + size) % size;
    const bx = (ax + 1) % size, bz = (az + 1) % size;
    return (field[az * size + ax] * (1 - fx) + field[az * size + bx] * fx) * (1 - fz)
      + (field[bz * size + ax] * (1 - fx) + field[bz * size + bx] * fx) * fz;
  };
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const index = row * size + column;
    const u = column / size, v = row / size;
    const grain = periodicNoise(u * 48, v * 48, 48) * 0.55
      + periodicNoise(u * 128, v * 128, 128) * 0.30
      + periodicNoise(u * 224, v * 224, 224) * 0.15;
    // Coherent domain warp breaks exact ellipse contours without a visible seam.
    const warpX = (periodicNoise(u * 31, v * 31, 31) - 0.5) * size * 0.022;
    const warpZ = (periodicNoise(u * 37 + 8, v * 37 + 11, 37) - 0.5) * size * 0.022;
    const thickness = sample(volume, column + warpX, row + warpZ);
    const light = sample(illumination, column + warpX, row + warpZ);
    const density = Math.max(0, thickness - (grain - 0.28) * 0.33);
    data[index * 4] = Math.round(Math.min(1, density) * 255);
    data[index * 4 + 1] = Math.round(Math.min(1, light) * 255);
    data[index * 4 + 2] = Math.round(grain * 255);
    data[index * 4 + 3] = Math.round(thickness * 255);
  }
  cachedCloudData = data;
  return data;
}

export function createSkyCloudTexture(scene: Scene): RawTexture {
  const texture = RawTexture.CreateRGBATexture(generateSkyCloudData(),
    SKY_CLOUD_TEXTURE_SIZE, SKY_CLOUD_TEXTURE_SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "cached-cumulus-density-and-light";
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.gammaSpace = false;
  texture.anisotropicFilteringLevel = 4;
  return texture;
}
