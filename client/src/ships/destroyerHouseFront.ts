import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { DESTROYER_HOUSES, seatSurfaceBox, seatSurfaceCylinder, sideSurface } from "./destroyerMounts";
import type { MountSurface } from "./destroyerMounts";

type FrontPaint = Record<"gray" | "light" | "deck" | "dark" | "radar" | "glass" | "white" | "orange", PBRMaterial>;

/** Equipment, access and working platforms on the bow-facing forward house wall. */
export function addDestroyerHouseFront(scene: Scene, root: Mesh, casters: Mesh[], paint: FrontPaint,
  deckHeight: (z: number) => number): void {
  const { gray, light, deck, dark, radar, glass, white, orange } = paint;
  const house = DESTROYER_HOUSES.forward;
  const register = (mesh: Mesh, material: PBRMaterial) => {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; casters.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: PBRMaterial) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material);
    mesh.position.set(x, y, z); return mesh;
  };
  const tube = (name: string, path: number[][], radius: number, material: PBRMaterial) => register(CreateTube(name, {
    path: path.map(([x, y, z]) => new Vector3(x, y, z)), radius, tessellation: 6, cap: Mesh.CAP_ALL,
  }, scene), material);
  const wallSurface = (x: number, y: number, offset = 0): MountSurface => {
    const inset = house.inset * (y - house.y) / house.height;
    const surface = { point: new Vector3(x, y, house.z + house.depth / 2 - inset),
      normal: new Vector3(0, house.inset / house.height, 1).normalize() };
    return { point: surface.point.add(surface.normal.scale(offset)), normal: surface.normal };
  };
  const wallBox = (name: string, width: number, height: number, thickness: number, x: number, y: number,
    material: PBRMaterial, offset = 0) => {
    const mesh = register(CreateBox(name, { width: thickness, height, depth: width }, scene), material);
    return seatSurfaceBox(mesh, wallSurface(x, y), thickness, offset);
  };
  const wallCylinder = (name: string, diameter: number, thickness: number, x: number, y: number,
    material: PBRMaterial, offset = 0) => {
    const mesh = register(CreateCylinder(name, { diameter, height: thickness, tessellation: 8 }, scene), material);
    return seatSurfaceCylinder(mesh, wallSurface(x, y), thickness, offset);
  };
  const wallRing = (name: string, diameter: number, x: number, y: number,
    material: PBRMaterial, offset = 0) => {
    const mesh = register(CreateTorus(name, { diameter, thickness: .11, tessellation: 16 }, scene), material);
    return seatSurfaceCylinder(mesh, wallSurface(x, y), .11, offset);
  };

  // An octagonal bolted access plate and two distinct equipment bays break up the flat facade.
  wallCylinder("front-house-panel-raised-octagonal-frame", 2.76, .20, -2.05, 9.35, dark, .015);
  wallCylinder("front-house-octagonal-access-panel", 2.53, .12, -2.05, 9.35, gray, .13);
  wallCylinder("front-house-access-panel-center", 1.98, .045, -2.05, 9.35, light, .22);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, x = -2.05 + Math.cos(angle) * 1.19, y = 9.35 + Math.sin(angle) * 1.19;
    wallCylinder("front-house-panel-bolt", .085, .075, x, y, dark, .25);
  }
  wallBox("forward-wall-louver-frame", 1.82, 2.35, .14, 2.15, 9.75, dark, .015);
  wallBox("forward-wall-louver-inset", 1.57, 2.06, .09, 2.15, 9.75, radar, .13);
  for (let i = 0; i < 9; i++) wallBox("forward-wall-louver-blade", 1.42, .085, .075,
    2.15, 8.93 + i * .205, light, .22);

  // A watertight personnel door, recessed frame, dogs, sill, and status plate.
  wallBox("forward-wall-door-coaming", 1.56, 2.48, .18, .05, 7.56, dark, .015);
  wallBox("forward-wall-watertight-door", 1.31, 2.23, .11, .05, 7.57, gray, .15);
  wallBox("forward-wall-door-inner-panel", .93, 1.55, .055, .05, 7.66, light, .235);
  wallBox("forward-wall-door-kick-plate", 1.12, .28, .055, .05, 6.63, radar, .24);
  wallBox("forward-wall-door-sill", 1.68, .12, .34, .05, 6.28, light, .10);
  for (const [x, y] of [[-.49,6.80],[-.49,8.22],[.59,6.80],[.59,8.22]]) {
    wallCylinder("forward-wall-door-dog", .12, .08, x + .05, y, dark, .28);
    tube("forward-wall-door-dog-handle", [wallSurface(x + .05, y, .31).point.asArray(),
      wallSurface(x + .19, y, .31).point.asArray()], .035, light);
  }
  wallBox("forward-wall-door-id-plate", .39, .24, .07, .75, 8.45, radar, .08);
  wallBox("forward-wall-door-id-mark", .18, .11, .035, .75, 8.45, white, .16);

  // Smaller vents, access covers, conduits and lights give the wall working scale.
  for (const x of [-3.25, 3.30]) {
    wallBox("forward-wall-small-access-frame", .78, 1.18, .12, x, 7.54, dark, .02);
    wallBox("forward-wall-small-access-cover", .62, 1.01, .08, x, 7.54, gray, .13);
    for (const y of [7.22, 7.83]) wallCylinder("forward-wall-access-latch", .09, .07, x + .22, y, light, .20);
    wallBox("forward-wall-vent-canopy", .92, .12, .31, x, 8.38, light, .08);
  }
  for (const x of [-1.12, 1.20]) {
    wallBox("forward-wall-sensor-housing", .58, .31, .28, x, 11.60, dark, .08);
    wallBox("forward-wall-sensor-window", .35, .12, .07, x, 11.60, glass, .24);
    wallCylinder("forward-wall-navigation-lamp", .24, .15, x, 6.22, x < 0 ? orange : white, .11);
  }
  for (let y = 10.75; y <= 11.18; y += .21) {
    wallBox("forward-wall-cable-conduit", .11, .07, .10, -.65, y, radar, .12);
    wallBox("forward-wall-cable-conduit", .11, .07, .10, .80, y, radar, .12);
  }
  wallBox("front-house-junction-box", .60, .53, .28, 3.23, 6.92, dark, .04);
  wallBox("front-house-junction-cover", .46, .37, .12, 3.23, 6.92, light, .20);
  for (const y of [6.56, 6.74, 6.92, 7.10]) wallBox("front-house-pipe-clamp", .24, .045, .09,
    2.70, y, gray, .12);

  // External service ladder with stand-offs reaches the higher sensor panel.
  for (const x of [3.02, 3.78]) {
    const a = wallSurface(x, 6.05, .14), b = wallSurface(x - .08, 11.12, .14);
    tube("forward-wall-ladder-rail", [a.point.asArray(), b.point.asArray()], .055, light);
  }
  for (let y = 6.24; y <= 10.95; y += .34) {
    const left = wallSurface(3.02, y, .17).point, right = wallSurface(3.78, y, .17).point;
    tube("forward-wall-ladder-rung", [left.asArray(), right.asArray()], .042, light);
  }
  for (const y of [6.28, 7.55, 8.82, 10.09, 11.0]) for (const x of [3.02, 3.78]) {
    const wall = wallSurface(x, y), outer = wallSurface(x, y, .13);
    tube("forward-wall-ladder-standoff", [wall.point.asArray(), outer.point.asArray()], .04, gray);
  }

  // Hose reels, a life ring and fire-main pipe sit on the wall above the work platform.
  for (const x of [-3.25, 3.28]) {
    wallRing("forward-wall-fire-hose-reel", .78, x, 6.70, orange, .12);
    wallCylinder("forward-wall-fire-hose-reel-hub", .20, .12, x, 6.70, dark, .20);
  }
  wallRing("forward-wall-life-ring", .83, -3.30, 11.12, orange, .12);
  tube("forward-wall-fire-main", [wallSurface(3.58, 6.35, .09).point.asArray(),
    wallSurface(3.58, 10.30, .09).point.asArray()], .052, dark);

  // The narrow landing gives the door a real threshold, brackets and perimeter rails.
  const platformY = deckHeight(36.7) + .16, platformZ = 36.82;
  box("forward-house-entry-platform", 8.5, .18, 2.10, 0, platformY, platformZ, deck);
  box("forward-house-platform-nosing", 8.56, .11, .17, 0, platformY + .11, 37.79, light);
  for (let x = -3.9; x <= 3.91; x += .42) box("forward-platform-grate-bar", .035, .018, 1.9,
    x, platformY + .105, 36.82, radar);
  for (const x of [-3.2, -1.6, 0, 1.6, 3.2]) {
    const p = wallSurface(x, 5.85, .13).point;
    tube("forward-platform-support-bracket", [p.asArray(), [x, platformY - .28, 37.58]], .075, gray);
  }
  for (const side of [-1, 1]) {
    const x = side * 4.10;
    tube("forward-platform-side-rail", [[x, platformY + .13, 35.90], [x, platformY + .13, 37.83]], .04, light);
    for (let z = 35.95; z <= 37.84; z += .62) tube("forward-platform-rail-post",
      [[x, platformY + .13, z], [x, platformY + 1.08, z]], .038, light);
    tube("forward-platform-rail-top", [[x, platformY + 1.08, 35.90], [x, platformY + 1.08, 37.83]], .045, light);
    tube("forward-platform-rail-mid", [[x, platformY + .61, 35.90], [x, platformY + .61, 37.83]], .027, gray);
  }
  tube("forward-platform-bow-rail", [[-4.1, platformY + 1.08, 37.82], [4.1, platformY + 1.08, 37.82]], .045, light);
  for (let x = -4.1; x <= 4.11; x += 1.36) tube("forward-platform-bow-rail-post",
    [[x, platformY + .13, 37.82], [x, platformY + 1.08, 37.82]], .038, light);
  tube("forward-platform-bow-rail-mid", [[-4.1, platformY + .61, 37.82], [4.1, platformY + .61, 37.82]], .027, gray);

  // Portable equipment crowds the wall on either side of the landing, as in the overhead view.
  for (const side of [-1, 1]) {
    const z = 36.16, y = deckHeight(z), drumX = side * 5.58;
    box("forward-wall-fire-drum-cradle", .82, .13, .85, drumX, y + .09, z, dark);
    const drum = register(CreateCylinder("forward-wall-red-equipment-drum",
      { diameter: .59, height: .70, tessellation: 16 }, scene), orange);
    drum.position.set(drumX, y + .48, z);
    const cap = register(CreateCylinder("forward-wall-equipment-drum-lid",
      { diameter: .64, height: .10, tessellation: 16 }, scene), gray);
    cap.position.set(drumX, y + .88, z);
    box("forward-wall-deck-power-cabinet", .91, .76, .61, side * 6.58,
      y + .41, 36.23, radar);
    box("forward-wall-deck-power-cover", .72, .55, .06, side * 6.58,
      y + .44, 36.57, light);
    box("forward-wall-power-cabinet-latch", .13, .14, .09, side * 6.58 + .22,
      y + .45, 36.62, dark);
    const coil = register(CreateTorus("forward-wall-hose-coil",
      { diameter: .70, thickness: .085, tessellation: 16 }, scene), dark);
    coil.position.set(side * 5.80, deckHeight(38.22) + .13, 38.22);
    tube("forward-wall-hose-tail", [[side * 5.80, deckHeight(38.22) + .15, 38.22],
      [side * 6.65, deckHeight(37.55) + .22, 37.55]], .043, dark);
  }

  // The photograph shows a black grating field, a raised sensor stage and a short stair.
  const roofPartsStart = casters.length;
  const roofY = house.y + house.height, roofZ = 34.25;
  box("forward-house-roof-service-pad", 6.65, .14, 1.80, 0, roofY + .09, roofZ, deck);
  for (let col = -4; col <= 4; col++) for (let row = 0; row < 3; row++) {
    box("forward-roof-square-open-grating", .58, .026, .39, col * .68, roofY + .174,
      33.62 + row * .50, (col + row) % 2 === 0 ? dark : radar);
  }
  for (const side of [-1, 1]) {
    const x = side * 3.24;
    for (const z of [33.40, 34.25, 35.10]) tube("forward-roof-edge-stanchion",
      [[x, roofY + .17, z], [x, roofY + 1.10, z]], .037, light);
    for (const h of [.60, 1.10]) tube("forward-roof-edge-rail",
      [[x, roofY + h, 33.40], [x, roofY + h, 35.10]], .035, light);
  }
  for (let x = -3.24; x <= 3.25; x += 1.08) tube("forward-roof-front-stanchion",
    [[x, roofY + .17, 35.10], [x, roofY + 1.10, 35.10]], .037, light);
  for (const h of [.60, 1.10]) tube("forward-roof-front-rail",
    [[-3.24, roofY + h, 35.10], [3.24, roofY + h, 35.10]], .035, light);

  const stageX = -.45, stageY = roofY + .95;
  box("forward-roof-raised-sensor-stage", 3.45, .16, 1.37, stageX, stageY, roofZ, deck);
  for (const x of [-1.80, .90]) for (const z of [33.73, 34.76]) {
    box("forward-roof-stage-support", .14, .73, .14, x, roofY + .52, z, gray);
    tube("forward-roof-stage-diagonal-brace", [[x, roofY + .20, z],
      [x + (x < 0 ? .28 : -.28), stageY - .12, z]], .045, light);
  }
  for (const x of [-2.12, 1.22]) {
    for (const z of x > 0 ? [33.62, 34.88] : [33.62, 34.25, 34.88]) tube("forward-stage-rail-post",
      [[x, stageY + .08, z], [x, stageY + .94, z]], .034, light);
    for (const h of [.49, .94]) {
      const spans = x > 0 ? [[33.62, 33.78], [34.72, 34.88]] : [[33.62, 34.88]];
      for (const [start, end] of spans) tube("forward-stage-side-rail",
        [[x, stageY + h, start], [x, stageY + h, end]], .035, light);
    }
  }
  for (let x = -2.12; x <= 1.23; x += .84) tube("forward-stage-front-post",
    [[x, stageY + .08, 34.88], [x, stageY + .94, 34.88]], .034, light);
  for (const h of [.49, .94]) tube("forward-stage-front-rail",
    [[-2.12, stageY + h, 34.88], [1.22, stageY + h, 34.88]], .035, light);

  // Five exposed treads connect the roof grating to the raised stage.
  for (let step = 0; step < 6; step++) {
    const t = step / 5;
    box("forward-roof-sensor-stair-tread", .31, .06, .82,
      3.05 - t * 1.76, roofY + .23 + t * .79, roofZ, radar);
  }
  for (const z of [roofZ - .47, roofZ + .47]) {
    tube("forward-roof-stair-stringer", [[3.17, roofY + .17, z], [1.18, stageY + .04, z]], .065, gray);
    tube("forward-roof-stair-handrail", [[3.17, roofY + 1.02, z], [1.18, stageY + .92, z]], .040, light);
    for (let step = 0; step <= 5; step++) {
      const t = step / 5;
      tube("forward-roof-stair-post", [[3.05 - t * 1.76, roofY + .24 + t * .79, z],
        [3.05 - t * 1.76, roofY + 1.04 + t * .79, z]], .032, light);
    }
  }

  const sensor = register(CreateCylinder("forward-roof-radome-pedestal",
    { diameterBottom: 1.18, diameterTop: .85, height: .83, tessellation: 16 }, scene), light);
  sensor.position.set(stageX, stageY + .49, roofZ);
  const collar = register(CreateCylinder("forward-roof-radome-collar",
    { diameter: .92, height: .12, tessellation: 16 }, scene), radar);
  collar.position.set(stageX, stageY + .96, roofZ);
  const radome = register(CreateSphere("forward-roof-small-radome", { diameter: 1.20, segments: 16 }, scene), white);
  radome.position.set(stageX, stageY + 1.43, roofZ); radome.scaling.y = .83;
  box("forward-roof-radome-junction-box", .58, .37, .35, stageX - 1.17, stageY + .25, roofZ + .21, radar);
  tube("forward-roof-radome-cable", [[stageX - .56, stageY + .20, roofZ],
    [stageX - 1.17, stageY + .20, roofZ + .21]], .03, dark);
  tube("forward-roof-outboard-platform-brace", [[-3.06, roofY + .12, roofZ - .60],
    [-1.62, roofY - 1.17, roofZ - .67]], .095, gray);
  tube("forward-roof-outboard-platform-brace", [[-3.06, roofY + .12, roofZ + .60],
    [-1.62, roofY - 1.17, roofZ + .67]], .095, gray);
  // The real gallery projects beside the bridge; shifting its whole assembly exposes
  // the checker grate and rails from the ship's normal chase-camera angle.
  for (const part of casters.slice(roofPartsStart)) part.position.x -= 2.0;

  // The pilothouse roof has the larger checker-grille bank and service gear
  // visible behind the smaller platform in the aerial reference.
  const bridgeRoofY = 21.875;
  const domeX = -5.14, domeZ = 30.39;
  box("bridge-roof-sensor-stage", 2.35, .14, 1.48, domeX, bridgeRoofY + .15, domeZ, deck);
  for (const x of [domeX - 1.07, domeX + 1.07]) {
    for (const z of [domeZ - .64, domeZ + .64]) tube("bridge-roof-sensor-stage-post",
      [[x, bridgeRoofY + .24, z], [x, bridgeRoofY + 1.02, z]], .034, light);
    tube("bridge-roof-sensor-stage-rail", [[x, bridgeRoofY + 1.02, domeZ - .64],
      [x, bridgeRoofY + 1.02, domeZ + .64]], .035, light);
  }
  tube("bridge-roof-sensor-stage-front-rail", [[domeX - 1.07, bridgeRoofY + 1.02, domeZ + .64],
    [domeX + 1.07, bridgeRoofY + 1.02, domeZ + .64]], .035, light);
  const bridgePedestal = register(CreateCylinder("bridge-roof-small-radome-pedestal",
    { diameterBottom: .82, diameterTop: .62, height: .74, tessellation: 16 }, scene), light);
  bridgePedestal.position.set(domeX, bridgeRoofY + .55, domeZ);
  const bridgeRadome = register(CreateSphere("bridge-roof-small-radome",
    { diameter: 1.03, segments: 16 }, scene), white);
  bridgeRadome.position.set(domeX, bridgeRoofY + 1.26, domeZ);
  const ladderZs = [30.04, 30.65];
  for (const z of ladderZs) tube("bridge-roof-access-ladder-rail",
    [[-7.47, 18.32, z], [-6.69, bridgeRoofY + .16, z]], .055, light);
  for (let step = 0; step < 11; step++) {
    const t = step / 10, x = -7.47 + t * .78, y = 18.46 + t * (bridgeRoofY - 18.33);
    tube("bridge-roof-access-ladder-rung", [[x, y, ladderZs[0]],
      [x, y, ladderZs[1]]], .043, light);
  }

  // The side wall has separate door bays between the existing intake banks.
  const sideBox = (name: string, width: number, height: number, thickness: number, side: number,
    y: number, z: number, material: PBRMaterial, offset = 0) => {
    const mesh = register(CreateBox(name, { width: thickness, height, depth: width }, scene), material);
    return seatSurfaceBox(mesh, sideSurface(house, side, y, z), thickness, offset);
  };
  const sideCylinder = (name: string, diameter: number, thickness: number, side: number,
    y: number, z: number, material: PBRMaterial, offset = 0) => {
    const mesh = register(CreateCylinder(name, { diameter, height: thickness, tessellation: 12 }, scene), material);
    return seatSurfaceCylinder(mesh, sideSurface(house, side, y, z), thickness, offset);
  };
  for (const side of [-1, 1]) {
    for (const z of [4, 16.5]) {
      sideBox("forward-house-side-door-frame", 1.42, 2.24, .15, side, 8.30, z, dark, .015);
      sideBox("forward-house-side-watertight-door", 1.20, 2.02, .10, side, 8.30, z, gray, .13);
      sideBox("forward-house-side-door-inner-panel", .83, 1.26, .045, side, 8.32, z, light, .205);
      for (const y of [7.57, 9.03]) {
        sideCylinder("forward-house-side-door-dog", .12, .08, side, y, z + .39, dark, .24);
        sideBox("forward-house-side-door-handle", .20, .07, .045, side, y, z + .39, light, .32);
      }
      sideBox("forward-house-side-door-kickplate", .90, .26, .04, side, 7.48, z, radar, .21);
    }
    sideBox("forward-house-side-service-panel-frame", 1.12, 1.28, .15, side, 8.17, 10.0, dark, .015);
    sideBox("forward-house-side-service-panel", .91, 1.06, .09, side, 8.17, 10.0, gray, .14);
    for (let y = 7.80; y <= 8.52; y += .24)
      sideBox("forward-house-side-service-panel-slot", .63, .06, .045, side, y, 10.0, radar, .22);
    sideBox("forward-house-side-large-hatch-frame", 1.62, 1.54, .16, side, 8.45, 23.0, dark, .015);
    sideBox("forward-house-side-large-hatch", 1.39, 1.31, .10, side, 8.45, 23.0, gray, .14);
    for (const dz of [-.58, .58]) for (const y of [7.92, 8.98])
      sideCylinder("forward-house-side-hatch-fastener", .095, .07, side, y, 23.0 + dz, light, .21);

    // Raised junction boxes, hose reels, pipework and equipment on the main walkway level.
    for (const [z, y] of [[3.0,10.45],[11.35,10.35],[23.45,10.35]]) {
      sideBox("forward-house-side-instrument-panel", .86, .72, .13, side, y, z, dark, .02);
      sideBox("forward-house-side-instrument-cover", .67, .52, .08, side, y, z, gray, .15);
      sideBox("forward-house-side-panel-label", .32, .12, .035, side, y + .16, z, white, .22);
      const ring = register(CreateTorus("forward-house-side-fire-hose-reel",
        { diameter: .72, thickness: .105, tessellation: 16 }, scene), orange);
      seatSurfaceCylinder(ring, sideSurface(house, side, 8.0, z + 1.1), .105, .11);
      sideCylinder("forward-house-side-hose-reel-hub", .18, .11, side, 8.0, z + 1.1, dark, .19);
    }
    const lifeRing = register(CreateTorus("forward-house-side-life-ring",
      { diameter: .82, thickness: .115, tessellation: 16 }, scene), orange);
    seatSurfaceCylinder(lifeRing, sideSurface(house, side, 10.65, 5.0), .115, .10);
    sideBox("forward-house-side-life-ring-bracket", .25, .12, .24, side, 10.65, 5.0, dark, .23);

    for (const z of [5.55, 11.9, 18.95, 24.45]) {
      const lowerSurface = sideSurface(house, side, 6.25, z), upperSurface = sideSurface(house, side, 11.45, z);
      const a = lowerSurface.point.add(lowerSurface.normal.scale(.12));
      const b = upperSurface.point.add(upperSurface.normal.scale(.12));
      tube("forward-house-side-fire-main", [a.asArray(), b.asArray()], .045, radar);
      for (const y of [6.65, 8.35, 10.15]) {
        const wall = sideSurface(house, side, y, z), outer = wall.point.add(wall.normal.scale(.13));
        tube("forward-house-side-pipe-standoff", [wall.point.asArray(), outer.asArray()], .035, gray);
      }
    }

    for (const z of [7.9, 20.4, 28.2]) {
      sideBox("forward-house-side-service-locker", .94, .82, .32, side, 6.30, z, radar, .08);
      sideBox("forward-house-side-locker-door", .69, .58, .12, side, 6.31, z, gray, .27);
      sideBox("forward-house-side-locker-handle", .11, .16, .08, side, 6.31, z + .22, dark, .36);
      sideBox("forward-house-side-red-stowage-box", .75, .40, .72, side, 6.73, z + 1.08, orange);
    }
    for (const z of [2.75, 14.95, 27.9]) {
      sideBox("forward-house-side-safety-light-base", .31, .29, .12, side, 9.95, z, dark, .03);
      sideBox("forward-house-side-safety-light-lens", .21, .17, .06, side, 9.95, z, side < 0 ? orange : white, .15);
    }
  }
}
