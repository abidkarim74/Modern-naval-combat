import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

type DetailKind = "ground" | "bark" | "rock" | "leaf" | "plaster";
const cache = new Map<string, Uint8Array>();
const SIZE = 256;
const fract = (x: number) => x - Math.floor(x);

/** Small, deterministic, mipmapped textures. All variants share one CPU copy. */
export function islandDetailTexture(scene: Scene, kind: DetailKind, normal = false): RawTexture {
  const key = kind + (normal ? "-normal" : "");
  let data = cache.get(key);
  if (!data) {
    data = new Uint8Array(SIZE * SIZE * 4);
    const height = (x: number, y: number) => {
      const u = ((x + SIZE) % SIZE) / SIZE, v = ((y + SIZE) % SIZE) / SIZE;
      const grain = fract(Math.sin((x + SIZE) % SIZE * 127.1 + (y + SIZE) % SIZE * 311.7) * 43758.5453);
      if (kind === "bark") return .5 + .19 * Math.sin(u * Math.PI * 48 + Math.sin(v * Math.PI * 8) * .8)
        + .13 * Math.sin(u * Math.PI * 102 + Math.sin(v * Math.PI * 12)) + grain * .14;
      if (kind === "plaster") return .38 + grain * .4
        + .06 * Math.sin(u * Math.PI * 6 + Math.sin(v * Math.PI * 4))
        + .04 * Math.sin(v * Math.PI * 8 + Math.sin(u * Math.PI * 6));
      return .40 + Math.sin(u * Math.PI * 14 + Math.sin(v * Math.PI * 10)) * .035
        + Math.sin(v * Math.PI * 28 + Math.sin(u * Math.PI * 8)) * .025 + grain * .40;
    };
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const index = (y * SIZE + x) * 4;
      const h = height(x, y);
      if (normal) {
        const nx = (height(x - 1, y) - height(x + 1, y)) * .8;
        const ny = (height(x, y - 1) - height(x, y + 1)) * .8;
        const length = Math.hypot(nx, ny, 1);
        data[index] = (nx / length * .5 + .5) * 255;
        data[index + 1] = (ny / length * .5 + .5) * 255;
        data[index + 2] = (1 / length * .5 + .5) * 255;
        data[index + 3] = 255;
      } else if (kind === "leaf") {
        const u = x / SIZE, v = y / SIZE;
        const width = Math.sin(v * Math.PI) ** .8 * .47;
        const edge = Math.abs(u - .5);
        const vein = Math.abs(u - .5) < .012 || Math.abs(fract(v * 9 - edge * 7) - .5) < .027;
        const shade = .68 + h * .32 + (vein ? .12 : 0);
        data[index] = shade * 166;
        data[index + 1] = shade * 214;
        data[index + 2] = shade * 120;
        data[index + 3] = edge < width && v > .01 && v < .99 ? 255 : 0;
      } else if (kind === "plaster") {
        const shade = .88 + h * .12;
        data[index] = data[index + 1] = data[index + 2] = shade * 255;
        data[index + 3] = 255;
      } else {
        const shade = .72 + h * .38;
        data[index] = shade * 236;
        data[index + 1] = shade * (kind === "ground" ? 241 : 225);
        data[index + 2] = shade * (kind === "bark" ? 201 : 222);
        data[index + 3] = 255;
      }
    }
    cache.set(key, data);
  }
  const texture = RawTexture.CreateRGBATexture(data, SIZE, SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = `island-${key}-detail`;
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.gammaSpace = !normal;
  texture.anisotropicFilteringLevel = 4;
  texture.hasAlpha = kind === "leaf";
  return texture;
}
