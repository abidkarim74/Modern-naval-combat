import type { Particle } from "@babylonjs/core/Particles/particle";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";

/** Keep overlapping weapon sprites from saturating or covering a close camera. */
export function configureWeaponParticles(system: ParticleSystem, scene: Scene, blendMode = ParticleSystem.BLENDMODE_STANDARD): void {
  system.blendMode = blendMode;
  system.forceDepthWrite = false;
  // The maritime atmosphere renders in group 1. Transparent exhaust must draw
  // afterwards while preserving the ship's depth, or sky overwrites the plume.
  system.renderingGroupId = 2;
  scene.setRenderingAutoClearDepthStencil(2, false);
  const updateParticles = system.updateFunction;
  const unfaded = new WeakMap<Particle, { alpha: number; age: number }>();

  system.updateFunction = particles => {
    // Restore simulation opacity before aging it; fading must not accumulate
    // across frames or leak into a particle recycled by Babylon.
    for (const particle of particles) {
      const previous = unfaded.get(particle);
      if (previous?.age === particle.age) particle.color.a = previous.alpha;
    }
    updateParticles(particles);

    const camera = scene.activeCamera;
    if (!camera) return;
    const eye = camera.globalPosition;
    for (const particle of particles) {
      const alpha = particle.color.a;
      const previous = unfaded.get(particle);
      if (previous) {
        previous.alpha = alpha;
        previous.age = particle.age;
      } else {
        unfaded.set(particle, { alpha, age: particle.age });
      }
      const dx = particle.position.x - eye.x;
      const dy = particle.position.y - eye.y;
      const dz = particle.position.z - eye.z;
      const distance = Math.hypot(dx, dy, dz);
      const diameter = particle.size * Math.max(particle.scale.x, particle.scale.y);
      const near = Math.max(.5, camera.minZ * 4, diameter * 1.25);
      const fade = Math.max(0, Math.min(1, (distance - near) / near));
      particle.color.a = alpha * fade * fade * (3 - 2 * fade);
    }
  };
}

let smokePixels: Uint8ClampedArray | undefined;
let firePixels: Uint8ClampedArray | undefined;

/** Dense, shaded exhaust with soft turbulent edges. Pixels are reused across scenes. */
export function createWeaponSmokeTexture(scene: Scene, name: string): DynamicTexture {
  const size = 256;
  smokePixels ??= generatePlumePixels(size, true);
  return createParticleTexture(scene, name, size, smokePixels);
}

/** A white-hot interior and broken amber fringe for short flashes and rocket exhaust. */
export function createWeaponFireTexture(scene: Scene, name: string): DynamicTexture {
  const size = 128;
  firePixels ??= generatePlumePixels(size, false);
  return createParticleTexture(scene, name, size, firePixels);
}

function createParticleTexture(scene: Scene, name: string, size: number, data: Uint8ClampedArray): DynamicTexture {
  // Each controller owns a texture, so disposing one effect cannot invalidate
  // another. Only the deterministic CPU pixels are shared.
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, false);
  texture.hasAlpha = true;
  const context = texture.getContext();
  const pixels = context.getImageData(0, 0, size, size);
  pixels.data.set(data);
  context.putImageData(pixels, 0, 0);
  texture.update();
  return texture;
}

// Broad overlapping lobes establish a cloud outline. Warped noise breaks up
// the volume inside it; the silhouette does not expose a circular sprite rim.
const smokeLobes = [
  [0, 0, .66], [-.37, -.25, .42], [.3, -.37, .43], [.39, .12, .39],
  [.18, .41, .42], [-.34, .36, .43], [-.47, .04, .31], [-.05, -.48, .34],
] as const;

function generatePlumePixels(size: number, smoke: boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + .5) / size * 2 - 1, ny = (y + .5) / size * 2 - 1;
    const warpX = (fractalNoise(nx * 3 + 17, ny * 3 + 41) - .5) * .22;
    const warpY = (fractalNoise(nx * 3 + 73, ny * 3 + 11) - .5) * .22;
    const px = nx + warpX, py = ny + warpY;
    const coarse = fractalNoise(px * 4 + 31, py * 4 + 19);
    const detail = fractalNoise(px * 13 + 9, py * 13 + 53);
    const radius = Math.hypot(px, py);
    let alpha: number, red: number, green: number, blue: number;
    if (smoke) {
      let edgeDistance = -1;
      for (const [cx, cy, lobeRadius] of smokeLobes) {
        edgeDistance = Math.max(edgeDistance, lobeRadius - Math.hypot(px - cx, py - cy));
      }
      const edge = smoothstep((edgeDistance + (detail - .5) * .09) / .18);
      const density = .58 + .36 * smoothstep((coarse - .2) / .62) + .06 * detail;
      // The directional difference gives the turbulence light crowns and
      // darker folds, instead of printing noise over a uniformly white disk.
      const lightSample = fractalNoise(px * 4 + 30.87, py * 4 + 18.83);
      const relief = (lightSample - coarse) * 2.7;
      const shade = clamp01(.52 + coarse * .42 + relief + (1 - radius) * .10);
      red = green = blue = 153 + 102 * shade;
      alpha = edge * density;
    } else {
      const turbulence = .80 + coarse * .25 + (detail - .5) * .12;
      const envelope = smoothstep((.94 - radius * turbulence) / .52);
      const core = smoothstep((.56 - radius) / .39);
      red = 255;
      green = 161 + 94 * core;
      blue = 55 + 200 * core;
      alpha = envelope ** 1.6 * (.65 + .28 * core + .07 * detail);
    }
    // Keep a transparent border even where a warped lobe nears a corner.
    // Bilinear sampling cannot turn it into an opaque square at distance.
    alpha *= smoothstep((1 - Math.max(Math.abs(nx), Math.abs(ny))) / .10);
    const offset = (y * size + x) * 4;
    data[offset] = Math.round(red);
    data[offset + 1] = Math.round(green);
    data[offset + 2] = Math.round(blue);
    data[offset + 3] = Math.round(alpha * 255);
  }
  return data;
}

function fractalNoise(x: number, y: number): number {
  let value = 0, amplitude = .5;
  for (let octave = 0; octave < 4; octave++) {
    value += valueNoise(x, y) * amplitude;
    x = x * 2.03 + 19.1; y = y * 2.03 + 7.7;
    amplitude *= .5;
  }
  return value / .9375;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const top = latticeNoise(ix, iy) * (1 - sx) + latticeNoise(ix + 1, iy) * sx;
  const bottom = latticeNoise(ix, iy + 1) * (1 - sx) + latticeNoise(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

function latticeNoise(x: number, y: number): number {
  let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  hash = Math.imul(hash ^ hash >>> 13, 1274126177);
  return ((hash ^ hash >>> 16) >>> 0) / 4294967295;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
