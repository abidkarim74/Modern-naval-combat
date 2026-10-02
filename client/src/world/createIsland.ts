import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_SEABED_Y, ISLAND_BASE, ISLAND_HARBOR, ISLAND_DOCK_OBSTACLES, islandHeight, islandShoreRadius } from "@naval/shared";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export { ISLAND_CENTER } from "@naval/shared";

const TERRAIN_ANGULAR_SEGMENTS = 256;
const TERRAIN_RADIAL_SEGMENTS = 104;
const ISLAND_ROAD: readonly [number, number][] = [
  [ISLAND_HARBOR.x, ISLAND_HARBOR.shoreZ + 12], [-306, -80], [-317, -35], [-290, 2],
  [ISLAND_BASE.x, ISLAND_BASE.z], [-205, 83], [-125, 118], [-60, 122], [45, 112],
];

export interface IslandVisual {
  readonly shadowCasters: readonly Mesh[];
}

export function createIsland(scene: Scene): IslandVisual {
  const root = new TransformNode("north-watch-island", scene);
  root.position.set(ISLAND_CENTER.x, 0, ISLAND_CENTER.z);
  const casters: Mesh[] = [];
  const paint = (name: string, color: string, roughness = .82, metallic = .04) => {
    const material = new PBRMaterial(name, scene);
    material.albedoColor = Color3.FromHexString(color).toLinearSpace();
    material.roughness = roughness;
    material.metallic = metallic;
    return material;
  };

  const terrainMaterial = new StandardMaterial("north-watch-terrain-material", scene);
  terrainMaterial.diffuseColor = Color3.White();
  terrainMaterial.specularColor = new Color3(.035, .045, .04);
  const rock = paint("island-weathered-basalt", "#686354", .99, 0);
  rock.environmentIntensity = .3;
  const concrete = paint("outpost-concrete", "#747d7b", .9);
  const darkConcrete = paint("dock-steel", "#46545a", .84, .16);
  const roof = paint("outpost-roof", "#535f58", .9, .05);
  const wall = paint("outpost-walls", "#aaa995", .88);
  const darkWall = paint("utility-shed-walls", "#707c79", .9);
  const glass = paint("outpost-window-glass", "#183944", .28, .3);
  const white = paint("outpost-markings", "#d5d4c5", .9);
  const olive = paint("outpost-vehicle-olive", "#525b48", .88);
  const foliage = paint("island-tropical-canopy", "#345b31", 1);
  const lightFoliage = paint("island-tropical-canopy-light", "#50773c", 1);
  const palmLeaves = paint("island-palm-fronds", "#527c3c", 1);
  palmLeaves.backFaceCulling = false;
  const trunk = paint("island-tropical-bark", "#625340", 1);
  for (const material of [foliage, lightFoliage, palmLeaves, trunk]) {
    material.environmentIntensity = .35;
    material.metallic = 0;
  }
  const radarWhite = paint("radome-white", "#d0d1c4", .66, .05);
  const antennaMetal = paint("outpost-antenna-metal", "#364246", .62, .24);
  const amber = paint("dock-light-amber", "#dfaa5a", .3, .15);

  casters.push(createTerrain(scene, root, terrainMaterial));
  addRoad(scene, root, casters, concrete);
  addDock(scene, root, casters, darkConcrete, concrete, amber, roof, white);
  addOutpost(scene, root, casters, {
    concrete, darkConcrete, roof, wall, darkWall, glass, white, olive,
    radarWhite, antennaMetal,
  });
  addTrees(scene, root, casters, foliage, lightFoliage, palmLeaves, trunk);
  addRockOutcrops(scene, root, casters, rock);
  batchBaseDetails(root, casters);

  return { shadowCasters: casters };
}

function createTerrain(scene: Scene, root: TransformNode, material: StandardMaterial): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, z: number, height = islandHeight(x, z)) => {
    positions.push(x, height, z);
    const angle = Math.atan2(z / ISLAND_RADIUS_Z, x / ISLAND_RADIUS_X);
    const distance = islandShoreRadius(angle) - Math.hypot(x / ISLAND_RADIUS_X, z / ISLAND_RADIUS_Z);
    const slope = Math.hypot(islandHeight(x + 2, z) - islandHeight(x - 2, z), islandHeight(x, z + 2) - islandHeight(x, z - 2)) / 4;
    const grain = (Math.sin(x * .12 + Math.sin(z * .11)) * Math.cos(z * .13 - x * .08) + 1) * .5;
    const greenery = .5 + .5 * Math.sin(x * .017 + Math.sin(z * .011)) * Math.cos(z * .015);
    const strata = .5 + .5 * Math.sin(height * .14 + Math.sin(x * .039) * 1.6 + Math.sin(z * .051) * 1.1);
    let color: Color3;
    if (height < 1.8) color = Color3.Lerp(new Color3(.31, .32, .24), new Color3(.47, .44, .31), grain * .6);
    else if (distance < .05 && height < 8) color = Color3.Lerp(new Color3(.53, .48, .34), new Color3(.66, .61, .43), grain * .65);
    else {
      const green = Color3.Lerp(new Color3(.22, .30, .16), new Color3(.32, .38, .22), greenery * .7 + grain * .12);
      const basalt = Color3.Lerp(new Color3(.29, .27, .23), new Color3(.42, .39, .32), grain * .40 + strata * .22);
      const crag = smoothStep(.52, 1.30, slope) * smoothStep(7, 28, height)
        + smoothStep(155, 235, height) * .20;
      color = Color3.Lerp(green, basalt, Math.min(1, crag));
    }
    colors.push(color.r, color.g, color.b, 1);
  };

  // Continuous radial rings reach below the waterline and close against a
  // bottom cap: no cut triangles, transparent edges or gaps through the shore.
  vertex(0, 0);
  for (let ring = 1; ring <= TERRAIN_RADIAL_SEGMENTS; ring++) {
    const radiusFraction = ring <= 88 ? ring / 88 * .91 : .91 + (ring - 88) / 16 * .135;
    for (let segment = 0; segment < TERRAIN_ANGULAR_SEGMENTS; segment++) {
      const angle = segment / TERRAIN_ANGULAR_SEGMENTS * Math.PI * 2;
      const radius = islandShoreRadius(angle) * radiusFraction;
      vertex(Math.cos(angle) * radius * ISLAND_RADIUS_X, Math.sin(angle) * radius * ISLAND_RADIUS_Z,
        ring === TERRAIN_RADIAL_SEGMENTS ? ISLAND_SEABED_Y : undefined);
      const current = 1 + (ring - 1) * TERRAIN_ANGULAR_SEGMENTS + segment;
      const next = 1 + (ring - 1) * TERRAIN_ANGULAR_SEGMENTS + (segment + 1) % TERRAIN_ANGULAR_SEGMENTS;
      if (ring === 1) indices.push(0, current, next);
      else {
        const inner = current - TERRAIN_ANGULAR_SEGMENTS;
        const innerNext = next - TERRAIN_ANGULAR_SEGMENTS;
        indices.push(inner, current, innerNext, current, next, innerNext);
      }
    }
  }
  const bottom = positions.length / 3;
  vertex(0, 0, ISLAND_SEABED_Y);
  for (let segment = 0; segment < TERRAIN_ANGULAR_SEGMENTS; segment++) {
    const rim = 1 + (TERRAIN_RADIAL_SEGMENTS - 1) * TERRAIN_ANGULAR_SEGMENTS;
    indices.push(bottom, rim + (segment + 1) % TERRAIN_ANGULAR_SEGMENTS, rim + segment);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh("north-watch-island-terrain", scene);
  mesh.parent = root;
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.useVertexColors = true;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}

function smoothStep(minimum: number, maximum: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return t * t * (3 - 2 * t);
}

function addRoad(scene: Scene, root: TransformNode, casters: Mesh[], material: PBRMaterial): void {
  const points = sampleRoute(ISLAND_ROAD, 12);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after[0] - before[0];
    const dz = after[1] - before[1];
    const length = Math.hypot(dx, dz) || 1;
    const offsetX = dz / length * 5.2;
    const offsetZ = -dx / length * 5.2;
    for (const side of [-1, 1]) {
      const x = point[0] + offsetX * side;
      const z = point[1] + offsetZ * side;
      positions.push(x, islandHeight(x, z) + 1.0, z);
    }
    if (index > 0) {
      const previous = (index - 1) * 2;
      const current = index * 2;
      indices.push(previous, previous + 1, current, previous + 1, current + 1, current);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh("north-watch-switchback-road", scene);
  mesh.parent = root;
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  casters.push(mesh);
}

function sampleRoute(route: readonly [number, number][], samplesPerSegment: number): [number, number][] {
  const result: [number, number][] = [];
  for (let index = 0; index < route.length - 1; index++) {
    const p0 = route[Math.max(0, index - 1)];
    const p1 = route[index];
    const p2 = route[index + 1];
    const p3 = route[Math.min(route.length - 1, index + 2)];
    for (let sample = 0; sample < samplesPerSegment; sample++) {
      const t = sample / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push([
        .5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        .5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  result.push(route[route.length - 1]);
  return result;
}

function addDock(
  scene: Scene,
  root: TransformNode,
  casters: Mesh[],
  steel: PBRMaterial,
  concrete: PBRMaterial,
  lamp: PBRMaterial,
  roof: PBRMaterial,
  white: PBRMaterial,
): void {
  const { x, shoreZ } = ISLAND_HARBOR;
  const deckY = Math.max(4.5, islandHeight(x, shoreZ) + .6);
  for (const footprint of ISLAND_DOCK_OBSTACLES) {
    addBox(scene, root, casters, `north-watch-pier${footprint.kind === "head" ? "-head" : ""}`,
      footprint.halfX * 2, 1.2, footprint.halfZ * 2, footprint.centerX, deckY, footprint.centerZ, concrete);
  }
  for (const offset of [8, 31, 56, 82]) {
    for (const side of [-1, 1]) addCylinder(scene, root, casters, "pier-pile", 1.8, deckY + 10,
      x + side * 4, (deckY - 10) / 2, shoreZ - offset, steel, 1.8, 8);
  }
  for (const side of [-1, 1]) {
    const endX = x + side * 27, endZ = shoreZ - 83;
    addBox(scene, root, casters, "dock-edge-fender", 2, 2, 12, endX, deckY + .8, endZ, steel);
    addCylinder(scene, root, casters, "pier-head-pile", 2, deckY + 10, endX, (deckY - 10) / 2, endZ, steel, 2, 8);
    addCylinder(scene, root, casters, "dock-bollard", .8, 1.4, endX - side * 3, deckY + 1.2, endZ, steel, .8, 8);
    addCylinder(scene, root, casters, "dock-lamp-post", .45, 5, endX - side * 6, deckY + 3, endZ, steel, .4, 8);
    addSphere(scene, root, casters, "dock-lamp", .85, endX - side * 6, deckY + 5.6, endZ, lamp);
  }
  const storeZ = shoreZ + 17, storeY = islandHeight(x, storeZ);
  addBuilding(scene, root, casters, "harbor-store", 15, 6, 12, x, storeY + 3, storeZ, steel, roof, white);
}

interface OutpostPaints {
  readonly concrete: PBRMaterial;
  readonly darkConcrete: PBRMaterial;
  readonly roof: PBRMaterial;
  readonly wall: PBRMaterial;
  readonly darkWall: PBRMaterial;
  readonly glass: PBRMaterial;
  readonly white: PBRMaterial;
  readonly olive: PBRMaterial;
  readonly radarWhite: PBRMaterial;
  readonly antennaMetal: PBRMaterial;
}

function addOutpost(scene: Scene, root: TransformNode, casters: Mesh[], paint: OutpostPaints): void {
  const centerX = ISLAND_BASE.x;
  const centerZ = ISLAND_BASE.z;
  const ground = islandHeight(centerX, centerZ);
  const platformY = ground + 2.2;
  addBox(scene, root, casters, "outpost-upper-terrace", 154, 1.8, 119, centerX, platformY, centerZ, paint.concrete);
  addBox(scene, root, casters, "outpost-retaining-wall-south", 154, 6, 2.5, centerX, platformY - 2, centerZ - 58, paint.darkConcrete);
  addBox(scene, root, casters, "outpost-retaining-wall-east", 2.5, 5, 119, centerX + 76, platformY - 1.5, centerZ, paint.darkConcrete);
  addBox(scene, root, casters, "outpost-parade-ground", 133, .18, 98, centerX, platformY + 1.05, centerZ, paint.roof);

  const baseY = platformY + 1.2;
  addBuilding(scene, root, casters, "naval-command-house", 37, 12, 26, centerX - 29, baseY + 6, centerZ + 28, paint.wall, paint.roof, paint.glass);
  addBuilding(scene, root, casters, "island-barracks", 46, 11, 22, centerX + 24, baseY + 5.5, centerZ + 27, paint.wall, paint.roof, paint.glass);
  addBuilding(scene, root, casters, "maintenance-shed", 38, 10, 25, centerX - 28, baseY + 5, centerZ - 26, paint.darkWall, paint.roof, paint.white);
  addBuilding(scene, root, casters, "power-and-comms-room", 24, 8, 20, centerX + 33, baseY + 4, centerZ - 29, paint.darkWall, paint.roof, paint.white);

  addBox(scene, root, casters, "command-house-front-window", 18, 2.4, .35, centerX - 29, baseY + 8.6, centerZ + 14.7, paint.glass);
  addBox(scene, root, casters, "command-house-entry", 3.8, 7.2, .4, centerX - 29, baseY + 3.6, centerZ + 14.6, paint.darkConcrete);
  for (const [x, z, width, depth] of [
    [centerX - 29, centerZ + 28, 37, 26], [centerX + 24, centerZ + 27, 46, 22],
    [centerX - 28, centerZ - 26, 38, 25], [centerX + 33, centerZ - 29, 24, 20],
  ] as const) {
    addBox(scene, root, casters, "roof-vent-box", width * .26, 1.8, depth * .22, x - width * .27, baseY + 12.6, z, paint.darkConcrete);
    addCylinder(scene, root, casters, "roof-vent-cap", 2.5, 1.2, x + width * .23, baseY + 12.9, z - 1, paint.antennaMetal, 2.5, 10);
  }

  addHelipad(scene, root, casters, centerX - 1, platformY + 1.35, centerZ - 2, paint.darkConcrete, paint.white);
  addRadarStation(scene, root, casters, centerX + 52, platformY + 1.2, centerZ + 3, paint);
  addWatchtower(scene, root, casters, centerX - 63, platformY + 1.2, centerZ - 43, paint);
  addPerimeterFence(scene, root, casters, centerX, platformY + 1.2, centerZ, paint.antennaMetal);
  addSupplyVehicle(scene, root, casters, centerX - 5, platformY + .95, centerZ - 42, paint.olive, paint.darkConcrete);

  const flagBase = baseY + 1;
  addCylinder(scene, root, casters, "outpost-flagpole", .52, 24, centerX - 68, flagBase + 12, centerZ + 31, paint.antennaMetal, .34, 8);
  addBox(scene, root, casters, "outpost-naval-ensign", 7.5, 3.5, .12, centerX - 64, flagBase + 21, centerZ + 31, paint.white);
}

function addHelipad(scene: Scene, root: TransformNode, casters: Mesh[], x: number, y: number, z: number, pad: PBRMaterial, marking: PBRMaterial): void {
  addCylinder(scene, root, casters, "outpost-helipad", 47, .55, x, y, z, pad, 47, 32);
  addBox(scene, root, casters, "helipad-mark-left", 3.1, .12, 12.5, x - 4.6, y + .36, z, marking);
  addBox(scene, root, casters, "helipad-mark-right", 3.1, .12, 12.5, x + 4.6, y + .36, z, marking);
  addBox(scene, root, casters, "helipad-mark-cross", 12.2, .12, 3, x, y + .36, z, marking);
  addBox(scene, root, casters, "helipad-mark-stem", 3.1, .12, 9.5, x, y + .36, z - 10, marking);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      addBox(scene, root, casters, "helipad-perimeter-bar", 1.1, .1, 5.5, x + side * 16, y + .35, z + end * 13, marking);
    }
  }
}

function addRadarStation(scene: Scene, root: TransformNode, casters: Mesh[], x: number, y: number, z: number, paint: OutpostPaints): void {
  addCylinder(scene, root, casters, "radar-station-base", 16, 5, x, y + 2.5, z, paint.darkConcrete, 13, 12);
  const radome = addSphere(scene, root, casters, "coastal-radar-radome", 16, x, y + 11, z, paint.radarWhite);
  radome.scaling.y = .78;
  addCylinder(scene, root, casters, "radar-platform", 23, .8, x, y + 5.4, z, paint.antennaMetal, 23, 16);
  addCylinder(scene, root, casters, "communications-mast", 1, 32, x + 18, y + 16, z + 3, paint.antennaMetal, .55, 8);
  addCylinder(scene, root, casters, "mast-top-cap", 2, 2, x + 18, y + 33, z + 3, paint.radarWhite, 1.2, 8);
  for (const height of [8, 15, 23]) {
    addBox(scene, root, casters, "mast-crossarm", 12, .55, .7, x + 18, y + height, z + 3, paint.antennaMetal).rotation.z = -.1;
  }
  for (const side of [-1, 1]) {
    addBox(scene, root, casters, "mast-brace", .48, 18, .48, x + 18 + side * 4.2, y + 9, z + 3, paint.antennaMetal).rotation.z = side * -.24;
  }
  const dish = addSphere(scene, root, casters, "directional-radio-dish", 7, x + 12, y + 14, z - 12, paint.radarWhite);
  dish.scaling.set(.18, .18, 1);
  dish.rotation.y = -.42;
}

function addWatchtower(scene: Scene, root: TransformNode, casters: Mesh[], x: number, y: number, z: number, paint: OutpostPaints): void {
  for (const dx of [-4.5, 4.5]) for (const dz of [-4.5, 4.5]) {
    addCylinder(scene, root, casters, "watchtower-leg", .9, 17, x + dx, y + 8.5, z + dz, paint.antennaMetal, .72, 6);
  }
  addBox(scene, root, casters, "watchtower-cabin", 14, 8, 14, x, y + 18, z, paint.wall);
  addBox(scene, root, casters, "watchtower-glazing-front", 10, 3, .3, x, y + 19, z + 7.2, paint.glass);
  addBox(scene, root, casters, "watchtower-glazing-side", .3, 3, 10, x + 7.2, y + 19, z, paint.glass);
  addBox(scene, root, casters, "watchtower-roof", 17, 1.1, 17, x, y + 22.5, z, paint.roof);
  addCylinder(scene, root, casters, "watchtower-antenna", .45, 7, x + 2, y + 26, z - 2, paint.antennaMetal, .25, 6);
}

function addPerimeterFence(scene: Scene, root: TransformNode, casters: Mesh[], centerX: number, y: number, centerZ: number, material: PBRMaterial): void {
  const bounds = { halfX: 71, halfZ: 52 };
  const sides: readonly [number, number, number, number, number][] = [
    [centerX - bounds.halfX, centerZ - bounds.halfZ, centerX + bounds.halfX, centerZ - bounds.halfZ, 18],
    [centerX - bounds.halfX, centerZ + bounds.halfZ, centerX + bounds.halfX, centerZ + bounds.halfZ, 18],
    [centerX - bounds.halfX, centerZ - bounds.halfZ, centerX - bounds.halfX, centerZ + bounds.halfZ, 14],
    [centerX + bounds.halfX, centerZ - bounds.halfZ, centerX + bounds.halfX, centerZ + bounds.halfZ, 14],
  ];
  let post = 0;
  for (const [x1, z1, x2, z2, count] of sides) {
    for (let index = 0; index < count; index++) {
      if ((z1 === z2 && z1 < centerZ - 40 && index > 7 && index < 11)) continue;
      const t = index / (count - 1);
      const x = x1 + (x2 - x1) * t;
      const z = z1 + (z2 - z1) * t;
      const height = islandHeight(x, z) + y - islandHeight(centerX, centerZ);
      addCylinder(scene, root, casters, `outpost-fence-post-${post++}`, .65, 5.4, x, height + 2.7, z, material, .5, 6);
    }
    const midpointX = (x1 + x2) * .5;
    const midpointZ = (z1 + z2) * .5;
    const fenceHeight = islandHeight(midpointX, midpointZ) + y - islandHeight(centerX, centerZ) + 2.5;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const rail = addBox(scene, root, casters, "outpost-fence-top", length, .42, .36, midpointX, fenceHeight, midpointZ, material);
    rail.rotation.y = Math.atan2(z1 - z2, x2 - x1);
    const lower = addBox(scene, root, casters, "outpost-fence-mid", length, .32, .3, midpointX, fenceHeight - 2.4, midpointZ, material);
    lower.rotation.y = rail.rotation.y;
  }
}

function addSupplyVehicle(scene: Scene, root: TransformNode, casters: Mesh[], x: number, y: number, z: number, body: PBRMaterial, detail: PBRMaterial): void {
  addBox(scene, root, casters, "outpost-supply-truck-chassis", 3.4, 1.4, 10.5, x, y + 1.4, z, detail);
  addBox(scene, root, casters, "outpost-supply-truck-cab", 3.5, 3.4, 3.2, x, y + 3.4, z + 3.1, body);
  addBox(scene, root, casters, "outpost-supply-truck-bed", 3.1, 3.8, 5.2, x, y + 4, z - 1.9, body);
  addBox(scene, root, casters, "outpost-truck-windshield", 2.7, 1.25, .2, x, y + 4, z + 4.8, detail);
  for (const dx of [-2, 2]) for (const dz of [-3.3, 3.1]) {
    const wheel = addCylinder(scene, root, casters, "outpost-truck-wheel", 2.1, .72, x + dx, y + 1.05, z + dz, detail, 2.1, 10);
    wheel.rotation.z = Math.PI / 2;
  }
}

function addTrees(
  scene: Scene, root: TransformNode, casters: Mesh[], leaves: PBRMaterial,
  lightLeaves: PBRMaterial, palmLeaves: PBRMaterial, wood: PBRMaterial,
): void {
  const trunkParts = [CreateCylinder("tropical-trunk-part", { diameterBottom: 1.7, diameterTop: .68, height: 13, tessellation: 8 }, scene)];
  trunkParts[0].position.y = 6.5;
  for (const side of [-1, 1]) {
    const branch = CreateCylinder("tropical-branch-part", { diameterBottom: .65, diameterTop: .18, height: 7.8, tessellation: 6 }, scene);
    branch.position.set(side * 1.8, 10.2, .5);
    branch.rotation.z = side * -.48;
    trunkParts.push(branch);
  }
  const treeTrunk = Mesh.MergeMeshes(trunkParts, true, true)!;
  prepareSource(treeTrunk, "island-broadleaf-trunk-source", root, wood, casters);
  const crowns = [leaves, lightLeaves].map((material, index) => {
    const source = CreateSphere(`island-broadleaf-crown-source-${index}`, { diameter: 12, segments: 8 }, scene);
    roughenRock(source, index + 43, .16);
    prepareSource(source, source.name, root, material, casters);
    return source;
  });
  const palmTrunk = createPalmTrunk(scene);
  prepareSource(palmTrunk, "island-palm-trunk-source", root, wood, casters);
  const palmCrown = createPalmCrown(scene);
  prepareSource(palmCrown, "island-palm-fronds-source", root, palmLeaves, casters);

  let treeIndex = 0;
  // Jittered clusters around the foothills leave the beach, ridgelines and
  // compound open. A moderate number of trees keeps the terrain readable.
  const clusters: readonly [number, number, number][] = [
    [-435, -48, 52], [-425, 91, 38], [-160, 70, 45], [-62, 110, 42],
    [102, 93, 45], [210, -12, 35], [355, -78, 30],
  ];
  for (let cluster = 0; cluster < clusters.length; cluster++) {
    const [centerX, centerZ, spread] = clusters[cluster];
    for (let candidate = 0; candidate < 23; candidate++) {
      const seed = cluster * 503 + candidate * 37 + 31;
      const angle = pseudo(seed) * Math.PI * 2;
      const radius = Math.sqrt(pseudo(seed + 1)) * spread;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      const y = islandHeight(x, z);
      if (!clearVegetationSite(x, z) || y < 8 || y > 140 || terrainSlope(x, z) > 1.05) continue;
      const scale = .7 + pseudo(seed + 2) * .64;
      const yaw = pseudo(seed + 3) * Math.PI * 2;
      addInstance(treeTrunk, root, `island-broadleaf-trunk-${treeIndex}`, x, y - .3, z, scale, scale, scale, yaw);
      for (let lobe = 0; lobe < 3; lobe++) {
        const direction = yaw + lobe / 3 * Math.PI * 2;
        const crown = crowns[(candidate + lobe) % crowns.length];
        addInstance(crown, root, `island-broadleaf-canopy-${treeIndex}-${lobe}`,
          x + Math.cos(direction) * 2.5 * scale, y + (11.6 + lobe * .65) * scale,
          z + Math.sin(direction) * 2.5 * scale, scale * .78, scale * (.5 + lobe * .06), scale * .75, yaw + lobe);
      }
      treeIndex++;
    }
  }

  let palmIndex = 0;
  for (let candidate = 0; candidate < 85; candidate++) {
    const seed = candidate * 101 + 29;
    const angle = candidate / 85 * Math.PI * 2 + (pseudo(seed) - .5) * .15;
    const radius = islandShoreRadius(angle) - .065 - pseudo(seed + 1) * .055;
    const x = Math.cos(angle) * radius * ISLAND_RADIUS_X;
    const z = Math.sin(angle) * radius * ISLAND_RADIUS_Z;
    const y = islandHeight(x, z);
    if (pseudo(seed + 6) < .43 || y < 4 || y > 36 || terrainSlope(x, z) > .6 || !clearVegetationSite(x, z)) continue;
    const scale = .8 + pseudo(seed + 2) * .42;
    const yaw = pseudo(seed + 3) * Math.PI * 2;
    addInstance(palmTrunk, root, `island-palm-trunk-${palmIndex}`, x, y - .2, z, scale, scale, scale, yaw);
    addInstance(palmCrown, root, `island-palm-fronds-${palmIndex}`,
      x + Math.cos(yaw) * 1.4 * scale, y + 17 * scale, z - Math.sin(yaw) * 1.4 * scale, scale, scale, scale, yaw);
    palmIndex++;
  }

  for (let candidate = 0; candidate < 160; candidate++) {
    const seed = 9_041 + candidate * 43;
    const angle = pseudo(seed) * Math.PI * 2;
    const radius = .5 + pseudo(seed + 1) * .43;
    const x = Math.cos(angle) * radius * ISLAND_RADIUS_X;
    const z = Math.sin(angle) * radius * ISLAND_RADIUS_Z;
    const y = islandHeight(x, z);
    if (y < 5 || y > 160 || !clearVegetationSite(x, z) || terrainSlope(x, z) > .9) continue;
    const scale = .17 + pseudo(seed + 2) * .22;
    addInstance(crowns[candidate % 2], root, `island-understory-shrub-${candidate}`, x, y + scale * 2, z,
      scale, scale * .65, scale * .85, pseudo(seed + 3) * 6);
  }
}

function prepareSource(mesh: Mesh, name: string, root: TransformNode, material: PBRMaterial, casters: Mesh[]): void {
  mesh.name = name;
  mesh.parent = root;
  mesh.position.set(0, -1_000, 0);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  casters.push(mesh);
}

function addInstance(
  source: Mesh, root: TransformNode, name: string, x: number, y: number, z: number,
  scaleX: number, scaleY: number, scaleZ: number, yaw: number,
): void {
  const instance = source.createInstance(name);
  instance.parent = root;
  instance.position.set(x, y, z);
  instance.scaling.set(scaleX, scaleY, scaleZ);
  instance.rotation.y = yaw;
  instance.isPickable = false;
  instance.receiveShadows = true;
}

function createPalmTrunk(scene: Scene): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= 18; row++) {
    const t = row / 18;
    const radius = .75 - t * .36 + (row % 2 === 0 ? .05 : 0);
    for (let segment = 0; segment < 8; segment++) {
      const angle = segment / 8 * Math.PI * 2;
      positions.push(Math.cos(angle) * radius + t * t * 1.4, t * 17, Math.sin(angle) * radius);
      if (row === 18) continue;
      const a = row * 8 + segment;
      const b = row * 8 + (segment + 1) % 8;
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
  }
  return createGeometry(scene, "island-palm-trunk-source", positions, indices);
}

function createPalmCrown(scene: Scene): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const point = (angle: number, distance: number, across: number, y: number) => {
    positions.push(Math.cos(angle) * distance - Math.sin(angle) * across, y,
      Math.sin(angle) * distance + Math.cos(angle) * across);
    return positions.length / 3 - 1;
  };
  const height = (t: number) => Math.sin(t * Math.PI) * 2.2 - t * t * 3.8;
  for (let frond = 0; frond < 9; frond++) {
    const angle = frond / 9 * Math.PI * 2;
    const length = 8.4 + pseudo(frond + 47) * 1.9;
    for (let segment = 0; segment < 8; segment++) {
      const t = segment / 8;
      const next = (segment + 1) / 8;
      const a = point(angle, t * length, -.1, height(t));
      const b = point(angle, t * length, .1, height(t));
      const c = point(angle, next * length, -.08, height(next));
      const d = point(angle, next * length, .08, height(next));
      indices.push(a, c, b, b, c, d);
      if (segment === 0) continue;
      for (const side of [-1, 1]) {
        const spread = Math.sin(t * Math.PI) * 1.9 + .2;
        const base = point(angle, t * length, 0, height(t));
        const near = point(angle, t * length + .38, side * spread * .48, height(t) - .08);
        const tip = point(angle, t * length + .68, side * spread, height(t) - .4);
        const far = point(angle, t * length - .12, side * spread * .52, height(t) - .14);
        indices.push(base, near, tip, base, tip, far);
      }
    }
  }
  return createGeometry(scene, "island-palm-fronds-source", positions, indices);
}

function createGeometry(scene: Scene, name: string, positions: number[], indices: number[]): Mesh {
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

function terrainSlope(x: number, z: number): number {
  return Math.hypot(islandHeight(x + 3, z) - islandHeight(x - 3, z), islandHeight(x, z + 3) - islandHeight(x, z - 3)) / 6;
}

function clearVegetationSite(x: number, z: number): boolean {
  if (Math.abs(x - ISLAND_BASE.x) < 103 && Math.abs(z - ISLAND_BASE.z) < 83) return false;
  if (Math.abs(x - ISLAND_HARBOR.x) < 24 && z < ISLAND_HARBOR.shoreZ + 32) return false;
  return !nearRoad(x, z);
}

function nearRoad(x: number, z: number): boolean {
  for (let index = 0; index < ISLAND_ROAD.length - 1; index++) {
    const [x1, z1] = ISLAND_ROAD[index];
    const [x2, z2] = ISLAND_ROAD[index + 1];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - x1 - dx * t, z - z1 - dz * t) < 13) return true;
  }
  return false;
}

function addRockOutcrops(scene: Scene, root: TransformNode, casters: Mesh[], material: PBRMaterial): void {
  const sources = Array.from({ length: 3 }, (_, index) => {
    const mesh = CreateSphere(`island-basalt-outcrop-source-${index}`, { diameter: 2, segments: 4 }, scene);
    roughenRock(mesh, 113 + index * 17, .32);
    prepareSource(mesh, mesh.name, root, material, casters);
    return mesh;
  });
  // Half-buried broken ledges blend into the ridges without freestanding pillars.
  const crags: readonly [number, number, number, number, number][] = [
    [228, 145, 8, 3.8, 5], [261, 158, 6, 3.2, 4], [429, 43, 7, 4.2, 5],
    [457, 31, 6, 3.5, 4], [-465, -53, 7, 3.2, 5], [-395, -102, 6, 3.6, 4],
  ];
  crags.forEach(([x, z, width, height, depth], index) => {
    addInstance(sources[index % 3], root, `island-volcanic-crag-${index}`, x, islandHeight(x, z) + height * .15, z,
      width, height, depth, index * .83);
  });
  for (let index = 0; index < 75; index++) {
    const seed = index * 67 + 313;
    const angle = pseudo(seed) * Math.PI * 2;
    const coastal = index < 45;
    const radius = coastal ? islandShoreRadius(angle) - .005 - pseudo(seed + 1) * .043 : .35 + pseudo(seed + 1) * .49;
    const x = Math.cos(angle) * radius * ISLAND_RADIUS_X;
    const z = Math.sin(angle) * radius * ISLAND_RADIUS_Z;
    const y = islandHeight(x, z);
    if (nearRoad(x, z) || Math.abs(x - ISLAND_BASE.x) < 95 && Math.abs(z - ISLAND_BASE.z) < 78 || y < 0) continue;
    const scale = coastal ? 1.3 + pseudo(seed + 2) * 3.1 : 2.3 + pseudo(seed + 2) * 4.5;
    addInstance(sources[index % 3], root, `island-coastal-boulder-${index}`, x, y + scale * .18, z,
      scale, scale * (.48 + pseudo(seed + 3) * .45), scale * .83, pseudo(seed + 4) * 6);
  }
}

function roughenRock(mesh: Mesh, seed: number, amount: number): void {
  const positions = mesh.getVerticesData("position");
  const indices = mesh.getIndices();
  if (!positions || !indices) return;
  for (let index = 0; index < positions.length; index += 3) {
    const factor = 1 + amount * Math.sin(positions[index] * 2.3 + positions[index + 1] * 1.7 + positions[index + 2] * 3.1 + seed);
    positions[index] *= factor;
    positions[index + 1] *= factor;
    positions[index + 2] *= factor;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  mesh.setVerticesData("position", positions);
  mesh.setVerticesData("normal", normals);
}

function batchBaseDetails(root: TransformNode, casters: Mesh[]): void {
  // Small static fittings are batched by material; named terrain, road, pier
  // and primary structures remain available as separate scene landmarks.
  const groups = new Map<PBRMaterial, Mesh[]>();
  const detailPattern = /^(outpost-fence-|mast-|roof-vent-|pier-pile|pier-head-pile|dock-bollard|helipad-mark-|helipad-perimeter-|outpost-truck-|watchtower-leg|communications-mast|outpost-flagpole)/;
  for (const mesh of casters) {
    if (!detailPattern.test(mesh.name) || !(mesh.material instanceof PBRMaterial)) continue;
    const group = groups.get(mesh.material) ?? [];
    group.push(mesh);
    groups.set(mesh.material, group);
  }
  let index = 0;
  for (const [material, group] of groups) {
    if (group.length < 2) continue;
    // Merge in local coordinates so the island root's world translation is
    // applied once. All original fittings share the same parent and material.
    for (const mesh of group) mesh.parent = null;
    const merged = Mesh.MergeMeshes(group, true, true);
    if (!merged) {
      for (const mesh of group) mesh.parent = root;
      continue;
    }
    merged.name = `north-watch-base-detail-batch-${index++}`;
    merged.parent = root;
    merged.material = material;
    merged.isPickable = false;
    merged.receiveShadows = true;
    for (const mesh of group) {
      const casterIndex = casters.indexOf(mesh);
      if (casterIndex >= 0) casters.splice(casterIndex, 1);
    }
    casters.push(merged);
  }
}

function addBuilding(
  scene: Scene,
  root: TransformNode,
  casters: Mesh[],
  name: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  centerY: number,
  z: number,
  wall: PBRMaterial,
  roof: PBRMaterial,
  detail: PBRMaterial,
): void {
  addBox(scene, root, casters, `${name}-walls`, width, height, depth, x, centerY, z, wall);
  addBox(scene, root, casters, `${name}-flat-roof`, width + 1.4, 1.1, depth + 1.4, x, centerY + height * .5 + .55, z, roof);
  const windowY = centerY + height * .06;
  const frontZ = z + depth * .5 + .18;
  const count = Math.max(2, Math.floor(width / 10));
  for (let index = 0; index < count; index++) {
    const windowX = x + (index - (count - 1) / 2) * (width * .76 / Math.max(1, count - 1));
    addBox(scene, root, casters, `${name}-front-window`, width / count * .42, Math.min(2.7, height * .25), .22, windowX, windowY, frontZ, detail);
  }
  const endZ = z - depth * .5 - .18;
  addBox(scene, root, casters, `${name}-service-door`, 3.1, Math.min(5.5, height * .64), .22, x, centerY - height * .17, endZ, detail);
}

function addBox(
  scene: Scene,
  root: TransformNode,
  casters: Mesh[],
  name: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: PBRMaterial,
): Mesh {
  const mesh = CreateBox(name, { width, height, depth }, scene);
  mesh.parent = root;
  mesh.position.set(x, y, z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  casters.push(mesh);
  return mesh;
}

function addCylinder(
  scene: Scene,
  root: TransformNode,
  casters: Mesh[],
  name: string,
  diameter: number,
  height: number,
  x: number,
  y: number,
  z: number,
  material: PBRMaterial,
  diameterTop = diameter,
  tessellation = 12,
): Mesh {
  const mesh = CreateCylinder(name, { diameterBottom: diameter, diameterTop, height, tessellation }, scene);
  mesh.parent = root;
  mesh.position.set(x, y, z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  casters.push(mesh);
  return mesh;
}

function addSphere(
  scene: Scene,
  root: TransformNode,
  casters: Mesh[],
  name: string,
  diameter: number,
  x: number,
  y: number,
  z: number,
  material: PBRMaterial,
): Mesh {
  const mesh = CreateSphere(name, { diameter, segments: 12 }, scene);
  mesh.parent = root;
  mesh.position.set(x, y, z);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  casters.push(mesh);
  return mesh;
}

function pseudo(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43_758.5453;
  return value - Math.floor(value);
}
