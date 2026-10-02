import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";

/** Paint detail stays in the texture so that hundreds of fittings can share a material. */
const random = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
type CanvasContext = ReturnType<DynamicTexture["getContext"]>;

function paintGrain(context: CanvasContext, width: number, height: number, seed: number, amount: number) {
  const image = context.getImageData(0, 0, width, height);
  const next = random(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    const variation = Math.round((next() - .5) * amount);
    image.data[i] += variation;
    image.data[i + 1] += variation;
    image.data[i + 2] += variation;
  }
  context.putImageData(image, 0, 0);
}

/** Longitudinal hull UVs are z / 155.29 m and (y + 6.4) / 14 m.
 * update(false) deliberately maps canvas rows directly to increasing v: row zero
 * is the keel, not the weather deck. This keeps the boot topping at the waterline.
 */
export function createDestroyerHullPaint(scene: Scene): PBRMaterial {
  const material = new PBRMaterial("weathered-hull-steel", scene);
  material.albedoColor = Color3.White();
  material.roughness = .86;
  material.metallic = .035;
  const width = 4096, height = 512;
  const texture = new DynamicTexture("hull-paint-welds-and-runoff", { width, height }, scene, true);
  texture.anisotropicFilteringLevel = 8;
  const c = texture.getContext();
  const x = (z: number) => (z + 77.645) / 155.29 * width;
  const y = (h: number) => (h + 6.4) / 14 * height;
  const next = random(8051);
  const base = c.createLinearGradient(0, y(-.5), 0, y(7.5));
  base.addColorStop(0, "#929d9f");
  base.addColorStop(.3, "#9da7a9");
  base.addColorStop(1, "#a5adb0");
  c.fillStyle = base;
  c.fillRect(0, 0, width, height);

  // Repairs are repainted in almost the same shade, without a checkerboard pattern.
  for (let i = 0; i < 28; i++) {
    const z = -74 + next() * 142, h = .6 + next() * 4.3;
    const w = (2.4 + next() * 7.5) / 155.29 * width;
    const ph = (.7 + next() * 1.4) / 14 * height;
    c.fillStyle = next() > .4 ? "rgba(222,228,228,.075)" : "rgba(63,79,83,.035)";
    c.fillRect(x(z), y(h), w, ph);
    c.strokeStyle = "rgba(71,83,87,.065)";
    c.lineWidth = .7;
    c.strokeRect(x(z), y(h), w, ph);
  }

  // Fine welded seams have staggered ends and a shallow painted highlight.
  for (const h of [1.1, 2.85, 4.4, 6.15]) {
    let z = -77.6 + next() * 3;
    while (z < 77.6) {
      const length = 5.4 + next() * 8.1;
      const sx = x(z), ex = x(Math.min(77.6, z + length));
      c.strokeStyle = "rgba(48,65,71,.08)";
      c.lineWidth = .85;
      c.beginPath(); c.moveTo(sx, y(h)); c.lineTo(ex, y(h)); c.stroke();
      c.strokeStyle = "rgba(224,231,231,.1)";
      c.beginPath(); c.moveTo(sx, y(h) + 1.1); c.lineTo(ex, y(h) + 1.1); c.stroke();
      c.strokeStyle = "rgba(54,69,74,.075)";
      c.beginPath(); c.moveTo(sx, y(h)); c.lineTo(sx + next() * 2, y(h + 1.6)); c.stroke();
      z += length;
    }
  }

  const sheerStations = [[-77.645, 4.3], [-42, 4.5], [0, 5], [30, 5.5], [52, 6.15], [68, 6.85], [77.645, 7.5]];
  const sheer = (z: number) => {
    for (let i = 1; i < sheerStations.length; i++) if (z <= sheerStations[i][0]) {
      const a = sheerStations[i - 1], b = sheerStations[i];
      return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]);
    }
    return 7.5;
  };
  // Narrow drains and deck fittings leave sparse fading salt/rust runoff.
  for (let i = 0; i < 110; i++) {
    const z = -74 + next() * 147;
    const start = sheer(z) - .16 - next() * .6;
    const end = Math.max(.3, start - .45 - next() * 2.3);
    const px = x(z), spread = .8 + next() * 3.8;
    const streak = c.createLinearGradient(px, y(start), px, y(end));
    const rusty = i % 11 === 0;
    streak.addColorStop(0, rusty ? "rgba(94,76,59,.15)" : "rgba(48,66,73,.105)");
    streak.addColorStop(.23, rusty ? "rgba(111,89,67,.085)" : "rgba(61,78,84,.065)");
    streak.addColorStop(1, "rgba(70,85,90,0)");
    c.fillStyle = streak;
    c.fillRect(px - spread / 2, y(end), spread, y(start) - y(end));
    c.fillStyle = "rgba(226,231,229,.12)";
    c.fillRect(px + spread / 2 + .7, y(end), .6, (y(start) - y(end)) * .7);
  }
  // Restrained deck-edge grime tracks the rising forecastle rather than a level stripe.
  c.strokeStyle = "rgba(49,64,69,.16)"; c.lineWidth = 2.5;
  c.beginPath();
  for (let z = -77.6; z <= 77.6; z += .5) c.lineTo(x(z), y(sheer(z) - .13));
  c.stroke();
  // Small welded studs, paint chips, and discharge stains are visible only close up.
  for (let i = 0; i < 230; i++) {
    const z = -75 + next() * 149, h = .65 + next() * Math.max(1, sheer(z) - 1.2);
    c.fillStyle = "rgba(44,60,67,.12)";
    c.fillRect(x(z), y(h), 1.1, 1.1);
    c.fillStyle = "rgba(227,233,232,.12)";
    c.fillRect(x(z) + .9, y(h) + .9, 1, 1);
  }
  for (const z of [-37, -9, 12, 37]) {
    const px = x(z), py = y(.95);
    const discharge = c.createLinearGradient(px, py, px, y(.1));
    discharge.addColorStop(0, "rgba(54,70,74,.19)"); discharge.addColorStop(1, "rgba(54,70,74,0)");
    c.fillStyle = discharge; c.fillRect(px - 2.5, y(.1), 5, py - y(.1));
  }

  // Antifouling and boot topping sit below the normal sea surface; swell reveals them.
  c.fillStyle = "#67413c"; c.fillRect(0, 0, width, y(-1.22));
  c.fillStyle = "#303a3b"; c.fillRect(0, y(-1.22), width, y(.08) - y(-1.22));
  const waterWear = c.createLinearGradient(0, y(-.2), 0, y(.42));
  waterWear.addColorStop(0, "rgba(117,129,120,.11)"); waterWear.addColorStop(1, "rgba(117,129,120,0)");
  c.fillStyle = waterWear; c.fillRect(0, y(-.2), width, y(.42) - y(-.2));
  paintGrain(c, width, height, 5147, 4);
  texture.update(false);
  material.albedoTexture = texture;
  return material;
}

/** The upperworks share a lightly aged paint finish without a repeated wall grid.
 * A mostly white modulation texture preserves the caller's chosen haze-gray shade.
 */
export function createDestroyerUpperworksPaint(scene: Scene, name: string, baseColor: string | Color3): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = typeof baseColor === "string" ? Color3.FromHexString(baseColor) : baseColor.clone();
  material.roughness = .84;
  material.metallic = .035;
  const size = 512;
  const texture = new DynamicTexture(name + "-paint-age", { width: size, height: size }, scene, true);
  texture.anisotropicFilteringLevel = 4;
  const c = texture.getContext(), next = random(29681);
  c.fillStyle = "#fafafa"; c.fillRect(0, 0, size, size);
  for (let i = 0; i < 32; i++) {
    const px = next() * size, py = next() * size;
    const radius = 12 + next() * 65;
    const tone = c.createRadialGradient(px, py, 0, px, py, radius);
    tone.addColorStop(0, "rgba(99,114,118,.025)"); tone.addColorStop(1, "rgba(99,114,118,0)");
    c.fillStyle = tone; c.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < 36; i++) {
    const px = next() * size, high = size * (.68 + next() * .29), low = high - 25 - next() * 90;
    const streak = c.createLinearGradient(px, high, px, low);
    streak.addColorStop(0, "rgba(68,85,93,.055)"); streak.addColorStop(1, "rgba(68,85,93,0)");
    c.fillStyle = streak; c.fillRect(px, low, .6 + next() * 1.3, high - low);
  }
  paintGrain(c, size, size, 14661, 3);
  texture.update(false);
  material.albedoTexture = texture;
  return material;
}
