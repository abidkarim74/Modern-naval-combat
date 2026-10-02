import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { MAST_FOOT_Y } from "./destroyerMounts";

type Paints = Record<"gray" | "light" | "deck" | "dark" | "radar" | "glass" | "white" | "orange", PBRMaterial>;

/** Open tripod and two signal yards observed in the supplied bow and broadside photographs. */
export function addDestroyerMast(scene: Scene, root: Mesh, casters: Mesh[], paints: Paints): Mesh {
  const { gray, light, deck, dark, radar, white } = paints;
  const register = (mesh: Mesh, material = gray) => {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; casters.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = gray) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const cylinder = (name: string, diameter: number, height: number, x: number, y: number, z: number,
    material = gray, top = diameter, sides = 12) => {
    const mesh = register(CreateCylinder(name, { diameterBottom: diameter, diameterTop: top, height,
      tessellation: sides }, scene), material); mesh.position.set(x, y, z); return mesh;
  };
  const sphere = (name: string, diameter: number, x: number, y: number, z: number, material = white) => {
    const mesh = register(CreateSphere(name, { diameter, segments: 10 }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const tube = (name: string, points: number[][], radius = .025, material = light) => register(CreateTube(name, {
    path: points.map(p => new Vector3(p[0], p[1], p[2])), radius, tessellation: 5, cap: Mesh.CAP_ALL,
  }, scene), material);
  const beam = (name: string, a: number[], b: number[], width: number, depth: number, material = gray) => {
    const p = Vector3.FromArray(a), q = Vector3.FromArray(b), direction = q.subtract(p).normalize();
    const across = Vector3.Cross(direction, Math.abs(direction.z) > .95 ? Vector3.Up() : Vector3.Forward()).normalize();
    const outward = Vector3.Cross(across, direction).normalize();
    const mesh = box(name, width, Vector3.Distance(p, q), depth, 0, 0, 0, material);
    mesh.position.copyFrom(p.add(q).scale(.5));
    mesh.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(across, direction, outward); return mesh;
  };
  const taperedLeg = (name: string, a: number[], b: number[]) => {
    const p = Vector3.FromArray(a), q = Vector3.FromArray(b), direction = q.subtract(p).normalize();
    const across = Vector3.Cross(direction, Vector3.Forward()).normalize();
    const mesh = cylinder(name, .84, Vector3.Distance(p, q), 0, 0, 0, gray, .43, 4);
    mesh.position.copyFrom(p.add(q).scale(.5));
    mesh.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(across, direction, Vector3.Cross(across, direction));
    return mesh;
  };
  const rail = (name: string, a: number[], b: number[], y: number, fullHeight = .87) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), count = Math.max(1, Math.ceil(length / 1.05));
    for (const h of [.43, fullHeight]) tube(name, [[a[0], y + h, a[1]], [b[0], y + h, b[1]]], .022);
    for (let i = 0; i <= count; i++) {
      const t = i / count, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      tube(name + "-stanchion", [[x, y, z], [x, y + fullHeight + .04, z]], .027);
    }
  };
  const platform = (name: string, y: number, width: number, depth: number) => {
    box(name + "-deck", width, .14, depth, 0, y, 20, deck);
    box(name + "-rim-front", width, .20, .09, 0, y, 20 + depth / 2, gray);
    box(name + "-rim-aft", width, .20, .09, 0, y, 20 - depth / 2, gray);
    rail(name + "-guardrail", [-width / 2, 20 - depth / 2], [width / 2, 20 - depth / 2], y + .08);
    rail(name + "-guardrail", [-width / 2, 20 + depth / 2], [width / 2, 20 + depth / 2], y + .08);
    for (const side of [-1, 1]) rail(name + "-guardrail", [side * width / 2, 20 - depth / 2], [side * width / 2, 20 + depth / 2], y + .08);
  };

  box("tripod-mast-foundation", 6.0, .23, 5.4, 0, MAST_FOOT_Y + .1, 20, gray);
  const mastBase = MAST_FOOT_Y + .21;
  for (const side of [-1, 1]) {
    box("mast-leg-foot", 1.05, .22, 1.25, side * 2.65, mastBase + .1, 21.5, gray);
    taperedLeg("mast-splayed-forward-leg", [side * 2.65, mastBase, 21.5], [side * .53, 34.7, 20]);
    beam("tripod-lower-transverse-brace", [side * 1.76, 26.0, 20.87], [0, 27.65, 18.55], .20, .21);
    beam("tripod-upper-transverse-brace", [side * 1.08, 30.6, 20.38], [0, 32.0, 19.45], .17, .18);
  }
  box("mast-aft-leg-foot", 1.05, .22, 1.25, 0, mastBase + .1, 17.25, gray);
  taperedLeg("mast-splayed-aft-leg", [0, mastBase, 17.25], [0, 34.7, 20]);
  cylinder("mast-equipment-trunk-lower", 1.75, 3.2, 0, 30.0, 20, gray, 1.27, 4).rotation.y = Math.PI / 4;
  cylinder("mast-equipment-trunk-upper", 1.32, 5.05, 0, 36.6, 20, gray, .89, 4).rotation.y = Math.PI / 4;
  for (const y of [28.5, 30.0, 31.5, 34.2, 36.3]) box("mast-trunk-access-panel", .73, .48, .045, 0, y, 20.68, light);

  // Only the central access galleries are broad; each yard is a narrow walkway.
  platform("mast-lower-access-gallery", 26.35, 4.0, 3.6);
  platform("mast-upper-access-gallery", 34.45, 3.4, 3.1);
  for (const [y, span] of [[30.05, 14.1], [36.0, 12.4]]) {
    const half = span / 2;
    box("signal-yard-top-walkway", span, .095, .69, 0, y, 20, deck);
    box("signal-yard-forward-girder", span, .20, .075, 0, y - .10, 20.32, gray);
    box("signal-yard-aft-girder", span, .20, .075, 0, y - .10, 19.68, gray);
    rail("signal-yard-front-lifeline", [-half, 20.34], [half, 20.34], y + .04, .65);
    rail("signal-yard-aft-lifeline", [-half, 19.66], [half, 19.66], y + .04, .65);
    for (const side of [-1, 1]) {
      for (const z of [19.76, 20.24]) {
        beam("signal-yard-diagonal-strut", [side * .73, y - 3.1, 20], [side * (half - .35), y - .14, z], .20, .15, gray);
        beam("signal-yard-inner-strut", [side * .63, y - 1.55, 20], [side * 2.65, y - .14, z], .13, .12, light);
      }
      for (let x = 1.2; x < half; x += 1.05) box("signal-yard-cross-tie", .06, .12, .65, side * x, y - .055, 20, gray);
      cylinder("yard-end-aerial-base", .21, .27, side * (half - .22), y + .16, 20, gray);
      cylinder("yard-end-whip", .055, 1.60, side * (half - .22), y + 1.08, 20, light, .014, 6);
      cylinder("yard-navigation-sensor-foot", .15, .26, side * (half - 1.05), y + .2, 20, light);
      cylinder("yard-navigation-sensor", .22, .32, side * (half - 1.05), y + .48, 20, white, .13, 8);
      cylinder("yard-inner-whip", .043, .82, side * 2.6, y + .46, 20, light, .012, 6);
      // Delicate halyards form the characteristic triangular curtain below the yards.
      for (const fraction of [.56, .79, .96]) {
        const anchorX = side * (fraction * half);
        tube("signal-yard-halyard", [[anchorX, y - .1, 19.77], [side * 1.62, 25.35, 18.88]], .011, dark);
        tube("signal-yard-return-halyard", [[anchorX + side * .10, y - .1, 19.77], [side * 1.69, 25.35, 18.88]], .009, radar);
      }
    }
  }
  for (const side of [-1, 1]) {
    tube("mast-standing-stay", [[side * 3.8, mastBase, 22.75], [side * .2, 38.15, 20]], .017, dark);
    tube("mast-aft-standing-stay", [[side * 2.45, mastBase, 16.75], [0, 37.5, 20]], .015, dark);
    for (const y of [26.8, 34.9]) {
      cylinder("mast-gallery-electronics-foot", .23, .43, side * 1.36, y, 20.62, gray);
      cylinder("mast-gallery-electronics-head", .42, .48, side * 1.36, y + .37, 20.62, light, .20, 8);
    }
  }

  // The access ladder follows the forward starboard leg instead of floating in space.
  const ladderPoint = (y: number, offset: number) => {
    const t = (y - mastBase) / (34.7 - mastBase);
    return [2.65 - 2.12 * t + offset, y, 21.5 - 1.5 * t + .34];
  };
  for (const offset of [-.27, .27]) tube("mast-leg-ladder-side", [ladderPoint(mastBase, offset), ladderPoint(34.5, offset)], .03, light);
  for (let y = mastBase + .23; y < 34.5; y += .35) tube("mast-leg-ladder-rung", [ladderPoint(y, -.27), ladderPoint(y, .27)], .023, light);
  for (let y = mastBase + .55; y < 34.4; y += 2.15) {
    const p = ladderPoint(y, 0); tube("mast-ladder-bracket", [[p[0], y, p[2] - .4], p], .04, gray);
  }
  for (const x of [-.26, .26]) tube("upper-mast-ladder-side", [[x, 34.7, 20.65], [x, 38.5, 20.51]], .026, light);
  for (let y = 34.85; y <= 38.5; y += .34) tube("upper-mast-ladder-rung", [[-.26, y, 20.65 - (y - 34.7) * .037], [.26, y, 20.65 - (y - 34.7) * .037]], .02, light);

  cylinder("mast-top-radome-neck", .72, .72, 0, 39.30, 20, gray, .55);
  sphere("mast-top-communications-dome", 1.45, 0, 39.98, 20, light);
  cylinder("mast-top-dome-collar", 1.36, .10, 0, 39.72, 20, gray);
  cylinder("search-radar-bearing", .42, .40, 0, 40.90, 20, gray);
  const scanner = box("rotating-mast-search-radar", 3.05, .22, .48, 0, 41.13, 20, dark);
  cylinder("mast-top-sensor-column", .29, 1.03, 0, 41.73, 20, gray, .23);
  cylinder("mast-top-sensor-lower-collar", .61, .20, 0, 42.22, 20, gray);
  cylinder("mast-top-faceted-sensor", .71, .82, 0, 42.67, 20, light, .46, 8);
  cylinder("mast-top-sensor-cap", .47, .17, 0, 43.16, 20, gray, .29, 8);
  cylinder("mast-lightning-spike", .045, .89, 0, 43.62, 20, light, .012, 6);
  beam("mast-top-small-crossbar", [-.51, 43.11, 20], [.51, 43.11, 20], .06, .08, dark);
  cylinder("mast-top-small-aerial", .034, .53, -.46, 43.38, 20, light, .009, 6);
  return scanner;
}
