import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { ForedeckGunFire } from "./ForedeckGunFire";

type ForedeckPaint = Record<"gray" | "light" | "dark" | "radar" | "white" | "orange" | "red" | "green", PBRMaterial>;

export interface ForedeckGunControls {
  readonly animatedMeshes: readonly Mesh[];
  readonly cameraMount: TransformNode;
  updateAim(traverseDirection: number, elevationDirection: number, deltaSeconds: number): void;
  fire(worldTime: number): boolean;
  updateFireEffects(deltaSeconds: number, worldTime: number): void;
}

/** Flight IIA forecastle details. Bow is +Z and all dimensions are metres. */
export function addDestroyerForedeck(
  scene: Scene, root: Mesh, casters: Mesh[], paint: ForedeckPaint,
  deckHeight: (z: number) => number, hullBeam: (z: number) => number,
): ForedeckGunControls {
  const { gray, light, dark, radar, white, orange, red, green } = paint;
  const register = (mesh: Mesh, material: PBRMaterial) => {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; casters.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: PBRMaterial) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const cylinder = (name: string, d: number, h: number, x: number, y: number, z: number, material: PBRMaterial, sides = 16) => {
    const mesh = register(CreateCylinder(name, { diameter: d, height: h, tessellation: sides }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const tube = (name: string, path: number[][], radius: number, material: PBRMaterial) => register(CreateTube(name, {
    path: path.map(([x, y, z]) => new Vector3(x, y, z)), radius, tessellation: 6, cap: Mesh.CAP_ALL,
  }, scene), material);
  const surfaceLine = (name: string, xz: number[][], radius: number, material: PBRMaterial, lift = .075) =>
    tube(name, xz.map(([x, z]) => [x, deckHeight(z) + lift, z]), radius, material);

  // The flush Mk 41 bank has 32 separate covers in a low, pale coaming.
  const vlsY = deckHeight(42) + .08;
  box("forward-VLS-dark-recess", 7.66, .16, 6.42, 0, vlsY + .07, 42, dark);
  for (const side of [-1, 1]) {
    box("forward-VLS-side-coaming", .19, .24, 6.54, side * 3.87, vlsY + .19, 42, light);
    box("forward-VLS-side-grating", .3, .065, 6.4, side * 4.13, deckHeight(42) + .065, 42, radar);
  }
  for (const z of [38.76, 45.24]) box("forward-VLS-end-coaming", 7.9, .24, .18, 0, vlsY + .19, z, light);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
    const x = (col - 3.5) * .91, z = 42 + (row - 1.5) * 1.47;
    box("Mk41-cell-hatch-frame", .83, .085, 1.34, x, vlsY + .20, z, radar);
    box("Mk41-cell-hatch-panel", .73, .065, 1.23, x, vlsY + .27, z, light);
    surfaceLine("Mk41-hatch-center-seam", [[x, z - .51], [x, z + .51]], .012, gray, vlsY - deckHeight(z) + .315);
    box("Mk41-hatch-hinge", .21, .07, .09, x - .24, vlsY + .33, z - .48, dark);
    box("Mk41-hatch-hinge", .21, .07, .09, x + .24, vlsY + .33, z - .48, dark);
    box("Mk41-red-warning-tab", .16, .025, .13, x, vlsY + .315, z + .44, red);
  }
  for (const side of [-1, 1]) for (const z of [39.2, 44.8]) {
    box("VLS-maintenance-panel", .65, .045, .86, side * 4.8, deckHeight(z) + .065, z, radar);
    box("VLS-maintenance-latch", .14, .07, .17, side * 4.8, deckHeight(z) + .115, z, dark);
  }

  // Mk 45 Mod 4: low circular race, eight-sided armored skirt and a raked roof.
  const gunY = deckHeight(56);
  const traversePivot = new TransformNode("Mk45-traverse-pivot", scene);
  traversePivot.parent = root;
  traversePivot.position.set(0, gunY + .40, 56);
  const elevationPivot = new TransformNode("Mk45-elevation-pivot", scene);
  elevationPivot.parent = traversePivot;
  elevationPivot.position.set(0, 1.98, 2.75);
  const traverseMeshes: Mesh[] = [];
  const elevationMeshes: Mesh[] = [];
  cylinder("Mk45-training-race", 5.25, .24, 0, gunY + .16, 56, radar, 32);
  cylinder("Mk45-inner-race", 4.88, .17, 0, gunY + .33, 56, dark, 32);
  const lower = [[-1.8,-2.55],[1.8,-2.55],[2.5,-1.65],[2.5,1.55],[1.65,2.62],[-1.65,2.62],[-2.5,1.55],[-2.5,-1.65]];
  const upper = [[-1.55,-2.02],[1.55,-2.02],[2.02,-1.32],[2.02,1.20],[1.36,1.90],[-1.36,1.90],[-2.02,1.20],[-2.02,-1.32]];
  const positions: number[] = [], indices: number[] = [];
  for (const [ring, y] of [[lower, gunY + .40], [lower, gunY + 2.54], [upper, gunY + 3.53]] as const)
    for (const [x, z] of ring) positions.push(x, y, 56 + z);
  for (let level = 0; level < 2; level++) for (let i = 0; i < 8; i++) {
    const a = level * 8 + i, b = level * 8 + (i + 1) % 8;
    indices.push(a, b, a + 8, b, b + 8, a + 8);
  }
  for (let i = 1; i < 7; i++) indices.push(16, 16 + i, 17 + i);
  const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals;
  data.uvs = positions.flatMap((_, i) => i % 3 === 0 ? [positions[i] / 5 + .5, (positions[i + 2] - 53) / 6] : []);
  const enclosure = new Mesh("Mk45-faceted-armored-enclosure", scene); data.applyToMesh(enclosure);
  traverseMeshes.push(register(enclosure, light));
  for (const side of [-1, 1]) {
    traverseMeshes.push(surfaceLine("gun-roof-plate-joint", [[side * 1.38, 54.05], [side * 1.82, 54.70]], .018, gray, gunY + 3.57 - deckHeight(54.4)));
    traverseMeshes.push(box("gun-side-service-cover", .055, .75, 1.14, side * 2.49, gunY + 1.36, 55.6, gray));
    traverseMeshes.push(box("gun-side-service-handle", .09, .09, .23, side * 2.53, gunY + 1.40, 55.6, dark));
    for (const z of [54.75, 55.12, 55.49]) traverseMeshes.push(box("gun-vent-slot", .075, .075, .24, side * 2.54, gunY + 2.05, z, radar));
  }
  const mantlet = cylinder("gun-port-mantlet", 1.10, .56, 0, gunY + 2.37, 58.55, gray, 20);
  mantlet.rotation.x = Math.PI / 2;
  traverseMeshes.push(mantlet);
  elevationMeshes.push(tube("gun-barrel-sleeve", [[0, gunY + 2.38, 58.75], [0, gunY + 2.75, 60.2]], .29, gray));
  elevationMeshes.push(tube("127mm-gun-barrel", [[0, gunY + 2.75, 60.1], [0, gunY + 3.68, 65.15]], .17, dark));
  const muzzle = register(CreateTorus("127mm-muzzle-rim", { diameter: .39, thickness: .065, tessellation: 16 }, scene), dark);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, gunY + 3.68, 65.15);
  elevationMeshes.push(muzzle);
  const firing = new ForedeckGunFire(scene, muzzle, elevationPivot);

  // Rebase each gun part around its pivot so the turret rotates in place.
  for (const mesh of traverseMeshes) {
    mesh.parent = traversePivot;
    mesh.position.y -= gunY + .40;
    mesh.position.z -= 56;
  }
  for (const mesh of elevationMeshes) {
    mesh.parent = elevationPivot;
    mesh.position.y -= gunY + 2.38;
    mesh.position.z -= 58.75;
  }

  // Paint lies on the sloped steel itself; the aft line of the white box is broken.
  const arcRadius = 8.45;
  for (let i = 0; i < 96; i++) {
    if (i % 3 === 2) continue;
    const a = i * Math.PI * 2 / 96, b = (i + .88) * Math.PI * 2 / 96;
    const points = [[Math.sin(a) * arcRadius, 56 + Math.cos(a) * arcRadius], [Math.sin(b) * arcRadius, 56 + Math.cos(b) * arcRadius]];
    if (points.every(([x, z]) => Math.abs(x) < hullBeam(z) - .75 && z < 67.5)) surfaceLine("red-gun-training-limit", points, .045, red);
  }
  for (const side of [-1, 1]) {
    surfaceLine("forecastle-white-operating-box", [[side * 3.20, 60.15], [side * 3.20, 67.35]], .07, white);
    surfaceLine("forecastle-white-operating-box", [[0, 67.35], [side * 3.20, 67.35]], .07, white);
    for (let x = .25; x < 3.2; x += .72) surfaceLine("forecastle-aft-broken-line", [[side * x, 60.15], [side * Math.min(x + .47, 3.2), 60.15]], .05, white);
  }
  surfaceLine("forecastle-centerline", [[0, 60.3], [0, 67.35]], .035, white);
  for (const [x, z] of [[-1.9, 62], [1.9, 62], [-1.9, 65.5], [1.9, 65.5], [-4.8, 49], [4.8, 49]]) {
    const ring = register(CreateTorus("foredeck-flush-tie-down", { diameter: .42, thickness: .035, tessellation: 12 }, scene), radar);
    ring.position.set(x, deckHeight(z) + .06, z);
    cylinder("tie-down-socket", .12, .025, x, deckHeight(z) + .068, z, dark, 10);
  }

  // Closely spaced seams, scuppers, and the low metal toe strip define the deck's scale.
  for (const z of [38, 46.5, 49.5, 52.5, 59.5, 62.5, 66, 69]) {
    const half = hullBeam(z) - .65;
    surfaceLine("foredeck-plate-butt-seam", [[-half, z], [half, z]], .012, radar, .052);
  }
  for (const side of [-1, 1]) {
    const toe: number[][] = [];
    for (let z = 37; z <= 75; z += 1.5) toe.push([side * (hullBeam(z) - .28), z]);
    surfaceLine("foredeck-edge-toe-strip", toe, .055, gray, .11);
    for (let z = 38; z <= 74; z += 2.25) {
      const x = side * (hullBeam(z) - .20), y = deckHeight(z);
      tube("foredeck-lifeline-stanchion", [[x, y + .08, z], [x, y + 1.11, z]], .034, light);
      box("foredeck-scupper-mouth", .26, .055, .32, side * (hullBeam(z) - .52), y + .07, z, dark);
    }
  }

  // The bow has two chain runs, wildcats and capstans, plus chocks and deck lockers.
  for (const side of [-1, 1]) {
    const x = side * .88;
    box("anchor-chain-trough", .73, .075, 5.55, x, deckHeight(71.8) + .08, 71.8, radar);
    for (let i = 0; i < 20; i++) {
      const z = 69.3 + i * .255;
      const link = register(CreateTorus("black-anchor-chain-link", { diameter: .31, thickness: .067, tessellation: 8 }, scene), dark);
      link.position.set(x, deckHeight(z) + .16, z); link.scaling.z = 1.32;
      if (i % 2) link.rotation.z = Math.PI / 2;
    }
    cylinder("anchor-windlass-plinth", 1.30, .20, side * 1.23, deckHeight(69) + .14, 69, gray);
    cylinder("anchor-wildcat-drum", .88, .44, side * 1.23, deckHeight(69) + .48, 69, dark);
    cylinder("anchor-wildcat-top", .78, .10, side * 1.23, deckHeight(69) + .75, 69, light);
    cylinder("anchor-capstan-foot", .83, .13, side * 2.37, deckHeight(68.7) + .12, 68.7, radar);
    cylinder("anchor-capstan-head", .57, .70, side * 2.37, deckHeight(68.7) + .52, 68.7, side > 0 ? green : gray);
    box("bow-mooring-chock", .42, .40, .80, side * (hullBeam(73) - .38), deckHeight(73) + .25, 73, light);
    box("bow-chain-fairlead", .66, .19, .65, side * .88, deckHeight(74.45) + .13, 74.45, dark);
    for (const z of [67.8, 71.7]) {
      const bx = side * (hullBeam(z) - .9), y = deckHeight(z);
      box("forecastle-bitt-footplate", 1.02, .10, .75, bx, y + .09, z, radar);
      for (const dx of [-.27, .27]) cylinder("forecastle-mooring-bitt", .24, .59, bx + dx, y + .41, z, dark, 10);
    }
  }
  box("foredeck-equipment-locker", 1.65, .88, .75, 3.55, deckHeight(67) + .46, 67, light);
  box("foredeck-locker-lid", 1.76, .085, .85, 3.55, deckHeight(67) + .94, 67, gray);
  box("foredeck-emergency-gear", 1.04, .26, .44, 3.55, deckHeight(67) + .20, 65.9, orange);
  cylinder("forecastle-jackstaff", .07, 3.1, 0, deckHeight(76.6) + 1.58, 76.6, light, 10);

  // Small gear is attached to the forward deckhouse face and adjacent walkways.
  for (const side of [-1, 1]) {
    const y = deckHeight(37.4);
    box("forward-house-deck-locker", 1.7, 1.05, .9, side * 5.05, y + .55, 37.4, gray);
    box("forward-house-deck-locker-door", 1.36, .78, .065, side * 5.05, y + .55, 37.91, light);
    box("forward-house-locker-latch", .17, .13, .07, side * 5.05 + .42, y + .55, 37.96, dark);
    const reel = register(CreateTorus("forward-fire-hose-reel", { diameter: .82, thickness: .13, tessellation: 16 }, scene), orange);
    reel.rotation.x = Math.PI / 2; reel.position.set(side * 6.65, y + 1.18, 37.5);
    box("forward-fire-main-stand", .21, 1.12, .21, side * 6.65, y + .60, 37.5, gray);
    cylinder("forward-deck-vent", .43, .77, side * 6.55, y + .42, 39, gray);
    box("forward-deck-vent-cap", .73, .13, .73, side * 6.55, y + .86, 39, radar);
  }

  let traverse = 0;
  let elevation = 0;
  return {
    animatedMeshes: [...traverseMeshes, ...elevationMeshes],
    cameraMount: elevationPivot,
    updateAim(traverseDirection, elevationDirection, deltaSeconds) {
      traverse = Math.max(-Math.PI * .42, Math.min(Math.PI * .42,
        traverse + traverseDirection * deltaSeconds * 1.05));
      elevation = Math.max(0, Math.min(Math.PI * .13,
        elevation + elevationDirection * deltaSeconds * .38));
      traversePivot.rotation.y = traverse;
      elevationPivot.rotation.x = -elevation;
    },
    fire: (worldTime) => firing.fire(worldTime),
    updateFireEffects: (deltaSeconds, worldTime) => firing.update(deltaSeconds, worldTime),
  };
}
