import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

/** A short-lived incandescent source (booster flame, muzzle flash, impact fireball). */
export interface FireGlow {
  readonly position: Vector3;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Peak multiplier applied to nearby lit surfaces at zero distance. */
  readonly intensity: number;
  /** Distance in metres at which the glow has fallen to half strength. */
  readonly radius: number;
}

/**
 * Per-scene time-of-day state shared by effects that are not lit by Babylon's
 * light list (custom water shaders and unlit particle sprites).
 */
export class SceneLighting {
  /** 0 = clear daylight, 1 = moonlit night. */
  night = 0;
  /** Moonlit multiplier for unlit sprites (smoke, spray, debris) at full night. */
  readonly nightAmbient = { r: .085, g: .1, b: .145 };
  readonly glows: FireGlow[] = [];

  /** Effects republish their glows during each game update. */
  beginFrame(): void {
    this.glows.length = 0;
  }

  addGlow(position: Vector3, r: number, g: number, b: number, intensity: number, radius: number): void {
    if (intensity <= .001) return;
    this.glows.push({ position: position.clone(), r, g, b, intensity, radius });
  }

  /** The glow that most strongly lights the area around `focus`. */
  strongestGlowNear(focus: Vector3): FireGlow | null {
    let best: FireGlow | null = null;
    let bestScore = 0;
    for (const glow of this.glows) {
      const distanceSquared = Vector3.DistanceSquared(glow.position, focus);
      if (distanceSquared > glow.radius * glow.radius * 2.25) continue;
      const score = glow.intensity / (1 + distanceSquared / (glow.radius * glow.radius));
      if (score > bestScore) {
        bestScore = score;
        best = glow;
      }
    }
    return best;
  }

  /** Light multiplier for an unlit sprite at a world position; day returns 1. */
  sampleInto(x: number, y: number, z: number, out: { r: number; g: number; b: number }): void {
    const night = this.night;
    if (night <= .001) {
      out.r = out.g = out.b = 1;
      return;
    }
    // Ambient for unlit smoke against the night sky
    let r = this.nightAmbient.r * 0.65, g = this.nightAmbient.g * 0.65, b = this.nightAmbient.b * 0.65;
    for (const glow of this.glows) {
      const dx = glow.position.x - x, dy = glow.position.y - y, dz = glow.position.z - z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const radius = glow.radius;
      if (distSq >= radius * radius) continue; // STRICT CUTOFF: light cannot reach past radius
      const dist = Math.sqrt(distSq);
      const falloff = 1 - dist / radius;
      const smoothFalloff = falloff * falloff * (3 - 2 * falloff);
      const k = (glow.intensity * smoothFalloff) / (1 + distSq * 0.035);
      r += glow.r * k; g += glow.g * k; b += glow.b * k;
    }
    // Daylight already dominates any flame; blend toward the night response.
    out.r = Math.min(2.8, 1 + (r - 1) * night);
    out.g = Math.min(2.8, 1 + (g - 1) * night);
    out.b = Math.min(2.8, 1 + (b - 1) * night);
  }
}

const lightingByScene = new WeakMap<Scene, SceneLighting>();

export function getSceneLighting(scene: Scene): SceneLighting {
  let lighting = lightingByScene.get(scene);
  if (!lighting) {
    lighting = new SceneLighting();
    lightingByScene.set(scene, lighting);
  }
  return lighting;
}
