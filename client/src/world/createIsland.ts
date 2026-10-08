import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_SEABED_Y, ISLAND_BASE, ISLAND_HILL_POSTS, ISLAND_HELIPAD, ISLAND_RADAR_SITE, ISLAND_BEREG_SITES, ISLAND_HARBOR, ISLAND_DOCK_OBSTACLES, islandHeight, islandShoreRadius } from "@naval/shared";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Collisions/collisionCoordinator";
import "@babylonjs/core/Culling/Octrees/octreeSceneComponent";
import { createIslandNature, type IslandNature } from "./createIslandNature";
import { islandDetailTexture } from "./islandDetailTextures";
import { createCoastalRadar } from "./createCoastalRadar";
import { createBereg } from "./createBereg";

export { ISLAND_CENTER } from "@naval/shared";

const TERRAIN_ANGULAR_SEGMENTS = 256;
const TERRAIN_RADIAL_SEGMENTS = 104;
const ISLAND_ROAD: readonly [number, number][] = [
  [ISLAND_HARBOR.x, ISLAND_HARBOR.shoreZ + 12], [-306, -80], [-317, -35], [-300, -12],
  [-265, -2], [-265, 32], [-275, 46], [-275, 92], [-275, 114], [-205, 120], [-125, 118], [-60, 122], [45, 112],
];
const HILL_PATHS: readonly (readonly [number, number][])[] = [
  [[45, 112], [87, 100], [117, 158], [151, 108], [158, 158], [190, 114], [204, 147], [248, 104]],
  [[248, 104], [275, 97], [293, 109], [306, 80], [330, 105], [350, 61], [373, 86], [390, 48], [414, 18]],
];

export interface IslandVisual extends IslandNature {
  readonly shadowCasters: readonly Mesh[];
}

export function createIsland(scene: Scene): IslandVisual {
  scene.collisionsEnabled = true;
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
  terrainMaterial.diffuseTexture = islandDetailTexture(scene, "ground");
  terrainMaterial.bumpTexture = islandDetailTexture(scene, "ground", true);
  terrainMaterial.bumpTexture.level = .25;
  const rock = paint("island-weathered-basalt", "#686354", .99, 0);
  rock.environmentIntensity = .3;
  const concrete = paint("outpost-concrete", "#747d7b", .9);
  const darkConcrete = paint("dock-steel", "#46545a", .84, .16);
  const roof = paint("outpost-roof", "#535f58", .9, .05);
  const wall = paint("outpost-walls", "#c4b99b", .92, 0);
  const darkWall = paint("utility-shed-walls", "#707c79", .9);
  const glass = paint("outpost-window-glass", "#183944", .28, .3);
  const white = paint("outpost-markings", "#d5d4c5", .9);
  // Batched matte architecture shares a fine, neutral painted-surface grain.
  white.albedoTexture = islandDetailTexture(scene, "plaster");
  white.bumpTexture = islandDetailTexture(scene, "plaster", true);
  white.bumpTexture.level = .10;
  const olive = paint("outpost-vehicle-olive", "#525b48", .88);
  const palmLeaves = paint("island-palm-fronds", "#527c3c", 1);
  palmLeaves.backFaceCulling = false;
  const trunk = paint("island-tropical-bark", "#625340", 1);
  for (const material of [palmLeaves, trunk]) {
    material.environmentIntensity = .35;
    material.metallic = 0;
  }
  const radarWhite = paint("radome-white", "#d0d1c4", .66, .05);
  const antennaMetal = paint("outpost-antenna-metal", "#364246", .62, .24);
  const amber = paint("dock-light-amber", "#dfaa5a", .3, .15);
  const gravel = paint("outpost-compacted-gravel", "#8b8571", 1, 0);
  const trail = paint("island-gravel-access-trail", "#8b8571", 1, 0);
  trail.zOffset = -1;
  trail.zOffsetUnits = -2;
  const asphalt = paint("aviation-weathered-asphalt", "#424b4b", .98, 0);
  const yellow = paint("aviation-safety-yellow", "#c6ae58", .9, 0);
  const padMarking = paint("aviation-white-paint", "#d5d4c5", .9, 0);
  // Thin painted surfaces need depth bias at the kilometre-wide overview.
  // Millimetre offsets alone become indistinguishable in the depth buffer.
  asphalt.zOffset = -1;
  asphalt.zOffsetUnits = -2;
  padMarking.zOffset = -2;
  padMarking.zOffsetUnits = -4;
  const padYellow = paint("aviation-yellow-paint", "#c6ae58", .9, 0);
  padYellow.zOffset = -2;
  padYellow.zOffsetUnits = -4;
  const greenLight = paint("aviation-edge-light", "#449681", .4, .05);
  greenLight.emissiveColor = new Color3(.025, .13, .09);
  const paints: OutpostPaints = {
    concrete, darkConcrete, roof, wall, darkWall, glass, white, olive,
    radarWhite, antennaMetal, gravel, asphalt, yellow, padMarking, padYellow, amber, greenLight,
  };

  const terrain = createTerrain(scene, root, terrainMaterial);
  const terrainSurface = createTerrainSampler(terrain);
  casters.push(terrain);
  addRoad(scene, root, casters, concrete);
  addDock(scene, root, casters, darkConcrete, concrete, amber, roof, white);
  addOutpost(scene, root, casters, paints);
  addCoastalRadarSite(scene, root, casters, paints, terrainSurface);
  addBeregSites(scene, root, casters, paints, terrainSurface);
  for (const post of ISLAND_HILL_POSTS) addHillPost(scene, root, casters, post, paints);
  addExternalHelipad(scene, root, casters, paints, terrainSurface);
  for (let index = 0; index < HILL_PATHS.length; index++) {
    addTerrainPath(scene, root, casters, `hill-access-path-${index}`, HILL_PATHS[index], 2.1, trail, terrainSurface);
  }
  const nature = createIslandNature(scene, root, casters, terrainSurface.sample, clearVegetationSite, trunk, rock);
  addPalms(scene, root, casters, palmLeaves, trunk, terrainSurface);
  batchBaseDetails(root, casters);
  // The island and all its fittings are static. Freeze transforms after merging,
  // while keeping materials responsive to the existing shadow quality settings.
  root.freezeWorldMatrix();
  for (const node of root.getChildTransformNodes()) node.freezeWorldMatrix();
  for (const mesh of root.getChildMeshes()) {
    // Solid static scenery participates in swept camera collision. Foliage and
    // fine rail/wire details stay visual; they do not need thousands of bodies.
    if (!/island-(leaf|broadleaf-canopy|understory|nearby-grass|grass-tuft|palm-fronds)/.test(mesh.name)
      && !(["coastal-radar", "bereg"].includes(mesh.metadata?.facility) && !mesh.receiveShadows)) {
      mesh.checkCollisions = true;
    }
    mesh.freezeWorldMatrix();
  }
  terrain.checkCollisions = false;
  addTerrainCollision(scene, root, terrain);

  // Fine wire is visible in the main pass, but contributes no useful soft
  // shadow at this scale. Keep it out of the recurring shadow render pass.
  return { ...nature, shadowCasters: casters.filter(mesh => mesh.receiveShadows) };
}

function createTerrain(scene: Scene, root: TransformNode, material: StandardMaterial): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, z: number, height = islandHeight(x, z)) => {
    positions.push(x, height, z);
    uvs.push(x / 6, z / 6);
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
  vertexData.uvs = uvs;
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

/** Keep terrain rendering in one draw. The invisible collision surface uses
 * the identical triangles partitioned into spatial cells, so a close camera
 * checks only a few hundred triangles rather than the whole island. */
function addTerrainCollision(scene: Scene, root: TransformNode, terrain: Mesh): void {
  const positions = terrain.getVerticesData("position")!;
  const original = terrain.getIndices()!;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < original.length; i += 3) {
    const a = original[i] * 3, b = original[i + 1] * 3, c = original[i + 2] * 3;
    const x = (positions[a] + positions[b] + positions[c]) / 3;
    const z = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const key = Math.floor(x / 48) + ":" + Math.floor(z / 48);
    const group = groups.get(key) ?? [];
    group.push(original[i], original[i + 1], original[i + 2]);
    groups.set(key, group);
  }
  const mesh = new Mesh("north-watch-terrain-collision", scene);
  mesh.parent = root;
  const collisionPositions: number[] = [], collisionIndices: number[] = [];
  const ranges: { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number }[] = [];
  for (const group of groups.values()) {
    const vertexStart = collisionPositions.length / 3, indexStart = collisionIndices.length;
    const remap = new Map<number, number>();
    for (const originalVertex of group) {
      let vertex = remap.get(originalVertex);
      if (vertex === undefined) {
        vertex = collisionPositions.length / 3;
        remap.set(originalVertex, vertex);
        collisionPositions.push(positions[originalVertex * 3], positions[originalVertex * 3 + 1], positions[originalVertex * 3 + 2]);
      }
      collisionIndices.push(vertex);
    }
    ranges.push({ vertexStart, vertexCount: remap.size, indexStart, indexCount: group.length });
  }
  const data = new VertexData();
  data.positions = collisionPositions;
  data.indices = collisionIndices;
  data.applyToMesh(mesh);
  mesh.releaseSubMeshes();
  for (const range of ranges) {
    new SubMesh(0, range.vertexStart, range.vertexCount, range.indexStart, range.indexCount, mesh);
  }
  mesh.isVisible = false;
  mesh.isPickable = false;
  mesh.checkCollisions = true;
  mesh.material = terrain.material;
  mesh.freezeWorldMatrix();
  mesh.createOrUpdateSubmeshesOctree(32, 3);
  mesh.useOctreeForCollisions = true;
}

interface TerrainSurface {
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  trianglesInBounds(minX: number, minZ: number, maxX: number, maxZ: number): Set<number>;
  sample(x: number, z: number): { height: number; slope: number } | undefined;
}

/** Index the existing terrain triangles once so paths can be clipped directly
 * onto the rendered slopes, with no height interpolation gaps or frame work. */
function createTerrainSampler(terrain: Mesh): TerrainSurface {
  const positions = terrain.getVerticesData("position")!;
  const indices = terrain.getIndices()!;
  const cells = new Map<string, number[]>();
  const size = 16;
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle] * 3, b = indices[triangle + 1] * 3, c = indices[triangle + 2] * 3;
    if (Math.max(positions[a + 1], positions[b + 1], positions[c + 1]) < 0) continue;
    const minX = Math.floor(Math.min(positions[a], positions[b], positions[c]) / size);
    const maxX = Math.floor(Math.max(positions[a], positions[b], positions[c]) / size);
    const minZ = Math.floor(Math.min(positions[a + 2], positions[b + 2], positions[c + 2]) / size);
    const maxZ = Math.floor(Math.max(positions[a + 2], positions[b + 2], positions[c + 2]) / size);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = x + ":" + z;
      const group = cells.get(key) ?? [];
      group.push(triangle);
      cells.set(key, group);
    }
  }
  return {
    positions, indices,
    sample(x, z) {
      for (const triangle of cells.get(Math.floor(x / size) + ":" + Math.floor(z / size)) ?? []) {
        const a = indices[triangle] * 3, b = indices[triangle + 1] * 3, c = indices[triangle + 2] * 3;
        const bx = positions[b] - positions[a], bz = positions[b + 2] - positions[a + 2];
        const cx = positions[c] - positions[a], cz = positions[c + 2] - positions[a + 2];
        const det = bx * cz - bz * cx;
        if (Math.abs(det) < 1e-9) continue;
        const dx = x - positions[a], dz = z - positions[a + 2];
        const u = (dx * cz - dz * cx) / det, v = (bx * dz - bz * dx) / det;
        if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) continue;
        const by = positions[b + 1] - positions[a + 1], cy = positions[c + 1] - positions[a + 1];
        return { height: positions[a + 1] + u * by + v * cy,
          slope: Math.hypot((by * cz - cy * bz) / det, (bx * cy - cx * by) / det) };
      }
      return undefined;
    },
    trianglesInBounds(minX, minZ, maxX, maxZ) {
      const triangles = new Set<number>();
      for (let x = Math.floor(minX / size); x <= Math.floor(maxX / size); x++) {
        for (let z = Math.floor(minZ / size); z <= Math.floor(maxZ / size); z++) {
          for (const triangle of cells.get(x + ":" + z) ?? []) triangles.add(triangle);
        }
      }
      return triangles;
    },
  };
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
    // A six-metre service lane fits between the compound buildings, while the
    // harbour approach retains its wider two-way carriageway.
    const compoundDistance = Math.max(Math.abs(point[0] - ISLAND_BASE.x) - 70,
      Math.abs(point[1] - ISLAND_BASE.z) - 47);
    const halfWidth = 3 + smoothStep(0, 16, compoundDistance) * 2.2;
    const offsetX = dz / length * halfWidth;
    const offsetZ = -dx / length * halfWidth;
    for (const side of [-1, 1]) {
      const x = point[0] + offsetX * side;
      const z = point[1] + offsetZ * side;
      // Hold the road at yard level through the northern gate, then descend
      // through the terrace opening instead of disappearing inside the slab.
      const northExitBlend = point[1] >= ISLAND_BASE.z + 40
        ? 1 - smoothStep(ISLAND_BASE.z + 52, ISLAND_BASE.z + 74, point[1]) : 0;
      const yardBlend = Math.max(1 - smoothStep(0, 8, compoundDistance), northExitBlend);
      const surfaceY = islandHeight(x, z) + 1.0;
      const yardY = islandHeight(ISLAND_BASE.x, ISLAND_BASE.z) + 3.45;
      positions.push(x, surfaceY + (yardY - surfaceY) * yardBlend, z);
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

  // Fill the exposed sides of the elevated exit so the road has a solid
  // embankment rather than a floating ribbon above the surrounding terrain.
  const sidePositions: number[] = [], sideIndices: number[] = [];
  for (let segment = 1; segment < points.length; segment++) {
    const midpointZ = (points[segment - 1][1] + points[segment][1]) / 2;
    if (midpointZ < ISLAND_BASE.z + 52 || midpointZ > ISLAND_BASE.z + 74) continue;
    for (const side of [0, 1]) {
      const first = sidePositions.length / 3;
      for (const vertex of [(segment - 1) * 2 + side, segment * 2 + side]) {
        const [x, y, z] = positions.slice(vertex * 3, vertex * 3 + 3);
        sidePositions.push(x, y - .025, z, x, islandHeight(x, z) - .1, z);
      }
      if (side === 0) sideIndices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
      else sideIndices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
    }
  }
  const rampSides = createGeometry(scene, "north-watch-service-road-ramp-sides", sidePositions, sideIndices);
  rampSides.parent = root;
  rampSides.material = material;
  rampSides.isPickable = false;
  rampSides.receiveShadows = true;
  casters.push(rampSides);
}

function sampleRoute(route: readonly (readonly [number, number])[], samplesPerSegment: number): [number, number][] {
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
  const last = route[route.length - 1];
  result.push([last[0], last[1]]);
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
  readonly gravel: PBRMaterial;
  readonly asphalt: PBRMaterial;
  readonly yellow: PBRMaterial;
  readonly padMarking: PBRMaterial;
  readonly padYellow: PBRMaterial;
  readonly amber: PBRMaterial;
  readonly greenLight: PBRMaterial;
}

function addOutpost(scene: Scene, root: TransformNode, casters: Mesh[], paint: OutpostPaints): void {
  const centerX = ISLAND_BASE.x, centerZ = ISLAND_BASE.z;
  const ground = islandHeight(centerX, centerZ), platformY = ground + 2.2;
  const baseY = platformY + 1.2;
  const parts: Mesh[] = [];
  const gateZ = centerZ - 52;
  const gateX = compoundRoadCrossing(gateZ);
  const red = new PBRMaterial("outpost-faded-safety-red", scene);
  red.albedoColor = Color3.FromHexString("#974c40").toLinearSpace();
  red.roughness = .96;
  red.metallic = 0;
  const soot = new PBRMaterial("outpost-yard-soot-and-damp", scene);
  soot.albedoColor = Color3.FromHexString("#4a514b").toLinearSpace();
  soot.roughness = .99;
  soot.metallic = 0;

  // Both road entrances have openings in the slab for their sloping ramps.
  addBox(scene, root, parts, "outpost-upper-terrace", 154, 1.8, 104,
    centerX, platformY, centerZ, paint.concrete);
  const portalX = compoundRoadCrossing(centerZ - 58);
  const cutLeft = Math.min(gateX - 9, portalX - 9), cutRight = Math.max(gateX + 9, portalX + 9);
  for (const [left, right] of [[centerX - 77, cutLeft], [cutRight, centerX + 77]]) {
    addBox(scene, root, parts, "outpost-entrance-terrace-wing", right - left, 1.8, 7.5,
      (left + right) / 2, platformY, centerZ - 55.75, paint.concrete);
  }
  const northGateX = compoundRoadCrossing(centerZ + 52);
  for (const [left, right] of [[centerX - 77, northGateX - 9], [northGateX + 9, centerX + 77]]) {
    addBox(scene, root, parts, "outpost-north-entrance-terrace-wing", right - left, 1.8, 7.5,
      (left + right) / 2, platformY, centerZ + 55.75, paint.concrete);
  }
  // The incoming road goes through a real portal in the retaining face. A
  // sloping slab bridges the 2.4 m difference between road and service yard.
  for (const [left, right] of [[centerX - 77, portalX - 9], [portalX + 9, centerX + 77]]) {
    addBox(scene, root, parts, "outpost-retaining-wall-south", right - left, 6, 2.5,
      (left + right) / 2, platformY - 2, centerZ - 58, paint.darkConcrete);
  }
  addBox(scene, root, parts, "outpost-retaining-wall-east", 2.5, 5, 119,
    centerX + 76, platformY - 1.5, centerZ, paint.darkConcrete);
  addWeatheredGround(scene, root, parts, "outpost-parade-ground", 143, 104, centerX, baseY - .035, centerZ, paint.concrete);
  for (const x of [-63, -45, -27, -9, 9, 27, 45, 63]) {
    addBox(scene, root, parts, "outpost-yard-slab-joint", .045, .013, 104,
      centerX + x, baseY - .015, centerZ, paint.darkConcrete);
  }
  for (const z of [-43, -26, -9, 8, 25, 42]) {
    addBox(scene, root, parts, "outpost-yard-slab-joint", 143, .013, .045,
      centerX, baseY - .015, centerZ + z, paint.darkConcrete);
  }
  addCompoundEntryRamp(scene, root, parts, gateX, gateZ, baseY, paint);

  addCompoundBuilding(scene, root, parts, "naval-command-house", centerX - 29, baseY, centerZ + 28,
    37, 8.7, 26, 2, -1, paint.wall, paint, soot);
  addCompoundBuilding(scene, root, parts, "island-barracks", centerX + 24, baseY, centerZ + 27,
    46, 8.3, 22, 2, -1, paint.wall, paint, soot);
  addCompoundBuilding(scene, root, parts, "maintenance-shed", centerX - 28, baseY, centerZ - 26,
    38, 7.1, 25, 1, 1, paint.darkWall, paint, soot);
  addCompoundBuilding(scene, root, parts, "power-and-comms-room", centerX + 33, baseY, centerZ - 29,
    24, 5.5, 20, 1, 1, paint.darkWall, paint, soot);

  // Courtyard circulation and practical service fittings leave the former
  // internal landing area open; aircraft still use the external helipad.
  addBox(scene, root, parts, "outpost-yard-walkway", 126, .1, 2.2,
    centerX, baseY + .02, centerZ + 10, paint.concrete);
  addBox(scene, root, parts, "outpost-yard-walkway", 2.2, .1, 81,
    centerX + 4, baseY + .02, centerZ - 2, paint.concrete);
  for (const z of [-47, 0, 47]) {
    addBox(scene, root, parts, "outpost-yard-drain-channel", 135, .035, .28,
      centerX, baseY + .025, centerZ + z, paint.darkConcrete);
    for (const x of [-61, -37, -13, 11, 35, 59]) {
      addBox(scene, root, parts, "outpost-yard-drain-grate", 1.3, .03, .33,
        centerX + x, baseY + .05, centerZ + z, paint.antennaMetal);
      for (const dx of [-.45, -.15, .15, .45]) addBox(scene, root, parts, "outpost-yard-drain-slot",
        .04, .01, .26, centerX + x + dx, baseY + .07, centerZ + z, soot);
    }
  }
  for (const [x, z, w, d] of [[-3, -6, 3.8, 2.7], [-55, 9, 2.6, 1.2], [54, -39, 3.1, 2.1]]) {
    const patch = addCylinder(scene, root, parts, "outpost-yard-oil-stain", w, .012,
      centerX + x, baseY + .03, centerZ + z, soot, w, 10);
    patch.scaling.z = d / w;
  }
  for (const [x, z] of [[-56, 22], [-56, 27], [53, -43]]) {
    addBox(scene, root, parts, "outpost-yard-storage-crate", 2.8, 2.0, 2.0,
      centerX + x, baseY + 1, centerZ + z, paint.olive);
    for (const offset of [-.9, .9]) addBox(scene, root, parts, "outpost-yard-crate-strap", .09, 2.04, 2.08,
      centerX + x + offset, baseY + 1, centerZ + z, paint.antennaMetal);
    addBox(scene, root, parts, "outpost-yard-crate-stencil", .7, .3, .025,
      centerX + x, baseY + 1.3, centerZ + z - 1.02, paint.white);
  }
  addCompoundGenerator(scene, root, parts, centerX + 55, baseY, centerZ - 25, paint, soot);
  for (const [x, z] of [[-52, -10], [17, -18]]) {
    addBox(scene, root, parts, "outpost-yard-fire-equipment-cabinet", 1.4, 2.1, .7,
      centerX + x, baseY + 1.05, centerZ + z, red);
    addBox(scene, root, parts, "outpost-yard-fire-cabinet-label", .55, .45, .025,
      centerX + x, baseY + 1.45, centerZ + z + .365, paint.white);
    addBox(scene, root, parts, "outpost-yard-fire-cabinet-handle", .065, .32, .09,
      centerX + x + .46, baseY + .95, centerZ + z + .4, paint.antennaMetal);
  }
  addRadarStation(scene, root, parts, centerX + 52, baseY, centerZ + 3, paint);
  addWatchtower(scene, root, parts, centerX - 63, baseY, centerZ - 43, paint);
  addPerimeterFence(scene, root, parts, centerX, baseY, centerZ, paint.antennaMetal, gateX);
  addCompoundCheckpoint(scene, root, parts, gateX, baseY, gateZ, paint, red);
  addCompoundServiceGate(scene, root, parts, centerX - 5, baseY, centerZ + 52, paint);
  addSupplyVehicle(scene, root, parts, centerX - 58, baseY, centerZ + 2, paint.olive, paint.darkConcrete);
  addCylinder(scene, root, parts, "outpost-flagpole", .26, 18,
    centerX - 66, baseY + 9, centerZ + 32, paint.antennaMetal, .15, 8);
  addBox(scene, root, parts, "outpost-naval-ensign", 3.4, 1.9, .035,
    centerX - 64.2, baseY + 16.4, centerZ + 32, paint.white);
  for (const direction of [-1, 1]) addBeam(scene, root, parts, "outpost-naval-ensign-blue-saltire",
    [centerX - 65.9, baseY + 16.4 + direction * .95, centerZ + 32.03],
    [centerX - 62.5, baseY + 16.4 - direction * .95, centerZ + 32.03], .12, paint.glass);
  batchFacility(scene, root, casters, parts, "main-compound");
}

/** The fence opening follows the same sampled centerline as the approach road. */
function compoundRoadCrossing(z: number): number {
  const route = sampleRoute(ISLAND_ROAD, 12);
  for (let index = 1; index < route.length; index++) {
    const a = route[index - 1], b = route[index];
    if (a[1] <= z && b[1] >= z) return a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]);
  }
  return ISLAND_BASE.x - 30;
}

function addCompoundEntryRamp(
  scene: Scene, root: TransformNode, parts: Mesh[], x: number, z: number, y: number, paint: OutpostPaints,
): void {
  const startZ = z - 19, startX = compoundRoadCrossing(startZ);
  const endZ = z, endX = compoundRoadCrossing(endZ);
  const startY = islandHeight(startX, startZ) + 1.025;
  const dx = endX - startX, dz = endZ - startZ, length = Math.hypot(dx, dz);
  const nx = dz / length * 6.25, nz = -dx / length * 6.25;
  const positions = [
    startX - nx, startY, startZ - nz, startX + nx, startY, startZ + nz,
    endX - 7, y + .045, endZ, endX + 7, y + .045, endZ,
  ];
  const ramp = createGeometry(scene, "outpost-main-gate-approach-ramp", positions, [0, 1, 2, 1, 3, 2]);
  ramp.parent = root;
  ramp.material = paint.concrete;
  ramp.isPickable = false;
  ramp.receiveShadows = true;
  parts.push(ramp);
  for (const side of [-1, 1]) {
    addBeam(scene, root, parts, "outpost-main-gate-ramp-curb",
      [startX + side * nx, startY + .12, startZ + side * nz],
      [endX + side * 7, y + .17, endZ], .22, paint.concrete);
  }
  addBox(scene, root, parts, "outpost-main-gate-concrete-threshold", 14, .16, .65, x, y + .04, z, paint.concrete);
}

function addCompoundBuilding(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  x: number, y: number, z: number, width: number, height: number, depth: number,
  floors: number, front: number, wallPaint: PBRMaterial, paint: OutpostPaints, soot: PBRMaterial,
): void {
  addBox(scene, root, parts, `${name}-foundation`, width + .65, .35, depth + .65,
    x, y + .175, z, paint.concrete);
  const walls = addBox(scene, root, parts, `${name}-walls`, width, height, depth,
    x, y + height / 2 + .3, z, wallPaint);
  const points = walls.getVerticesData("position")!;
  const colors: number[] = [];
  for (let vertex = 0; vertex < points.length / 3; vertex++) {
    const vertical = (points[vertex * 3 + 1] + height / 2) / height;
    const shade = .84 + vertical * .11 + pseudo(Math.floor(vertex / 4) + width) * .045;
    colors.push(shade, shade, shade * .99, 1);
  }
  walls.setVerticesData("color", colors);
  walls.useVertexColors = true;
  addBox(scene, root, parts, `${name}-damp-plinth`, width + .08, .66, depth + .08,
    x, y + .57, z, soot);
  const topY = y + height + .3, halfRoof = width / 2 + .75;
  const rise = Math.min(1.7, width * .043), slope = Math.atan2(rise, halfRoof);
  for (const side of [-1, 1]) {
    const panel = addBox(scene, root, parts, `${name}-sheet-metal-roof-panel`,
      Math.hypot(halfRoof, rise), .17, depth + 1.5, x + side * halfRoof / 2, topY + rise / 2 + .16, z, paint.roof);
    panel.rotation.z = -side * slope;
    for (let rib = .7; rib < halfRoof; rib += 1.25) {
      const seam = addBox(scene, root, parts, `${name}-standing-roof-seam`, .035, .055, depth + 1.5,
        x + side * rib, topY + rise * (1 - rib / halfRoof) + .29, z, paint.antennaMetal);
      seam.rotation.z = -side * slope;
    }
    addBox(scene, root, parts, `${name}-eaves-fascia`, .12, .32, depth + 1.65,
      x + side * halfRoof, topY + .07, z, paint.darkWall);
    addBox(scene, root, parts, `${name}-rain-gutter`, .18, .14, depth + 1.7,
      x + side * (halfRoof + .05), topY + .2, z, paint.antennaMetal);
    for (const end of [-1, 1]) {
      const px = x + side * (width / 2 + .17), pz = z + end * (depth / 2 - .35);
      addCylinder(scene, root, parts, `${name}-rain-downspout`, .14, height - .05,
        px, y + height / 2 + .5, pz, paint.antennaMetal, .14, 6);
      addBeam(scene, root, parts, `${name}-downspout-offset`, [px, topY - .2, pz],
        [x + side * halfRoof, topY + .1, pz], .14, paint.antennaMetal);
      addBox(scene, root, parts, `${name}-downspout-splash-block`, .55, .09, .8,
        px + side * .12, y + .055, pz, paint.concrete);
    }
  }
  addBox(scene, root, parts, `${name}-roof-ridge-flashing`, .32, .14, depth + 1.8,
    x, topY + rise + .27, z, paint.antennaMetal);
  for (const end of [-1, 1]) {
    const gz = z + end * (depth / 2 + .015);
    const gable = createGeometry(scene, `${name}-gable-wall`,
      [x - width / 2, topY, gz, x + width / 2, topY, gz, x, topY + rise, gz],
      end < 0 ? [0, 1, 2] : [0, 2, 1]);
    gable.parent = root;
    gable.material = wallPaint;
    gable.receiveShadows = true;
    gable.isPickable = false;
    parts.push(gable);
    addBeam(scene, root, parts, `${name}-gable-flashing`, [x - halfRoof, topY + .18, gz + end * .75],
      [x, topY + rise + .23, gz + end * .75], .1, paint.antennaMetal);
    addBeam(scene, root, parts, `${name}-gable-flashing`, [x, topY + rise + .23, gz + end * .75],
      [x + halfRoof, topY + .18, gz + end * .75], .1, paint.antennaMetal);
  }
  const columns = Math.max(3, Math.floor(width / 6.5));
  for (const side of [-1, 1]) for (let floor = 0; floor < floors; floor++) {
    for (let column = 0; column < columns; column++) {
      const wx = x + (column - (columns - 1) / 2) * width * .78 / (columns - 1);
      if (floor === 0 && side === front && Math.abs(wx - x) < 3.3) continue;
      if (name === "maintenance-shed" && floor === 0 && side === front && Math.abs(wx - x + 9) < 4.5) continue;
      addCompoundWindow(scene, root, parts, name, wx, y + 2.9 + floor * 3.65,
        z + side * (depth / 2 + .08), 2.5, 1.75, side, false, paint);
    }
  }
  for (const side of [-1, 1]) for (let floor = 0; floor < floors; floor++) {
    for (const dz of [-depth * .24, depth * .24]) addCompoundWindow(scene, root, parts, name,
      x + side * (width / 2 + .08), y + 2.9 + floor * 3.65, z + dz, 2.1, 1.75, side, true, paint);
  }
  const frontZ = z + front * (depth / 2 + .1);
  const doorWidth = floors === 2 ? 2.1 : 1.5;
  addBox(scene, root, parts, `${name}-entry-door-frame`, doorWidth + .22, 3.05, .16,
    x, y + 1.88, frontZ, paint.antennaMetal);
  addBox(scene, root, parts, `${name}-entry-steel-door`, doorWidth, 2.85, .055,
    x, y + 1.81, frontZ + front * .105, paint.darkWall);
  addBox(scene, root, parts, `${name}-door-vision-panel`, doorWidth * .55, .65, .035,
    x, y + 2.62, frontZ + front * .145, paint.glass);
  addBox(scene, root, parts, `${name}-door-handle`, .075, .26, .11,
    x + doorWidth * .36, y + 1.73, frontZ + front * .18, paint.white);
  addBox(scene, root, parts, `${name}-door-bottom-kickplate`, doorWidth - .16, .37, .025,
    x, y + .73, frontZ + front * .145, paint.antennaMetal);
  addBox(scene, root, parts, `${name}-entry-landing`, 4.2, .32, 2,
    x, y + .16, frontZ + front * 1.04, paint.concrete);
  for (let step = 0; step < 2; step++) addBox(scene, root, parts, `${name}-entry-step`, 4.2, .12 * (2 - step), .45,
    x, y + .06 * (2 - step), frontZ + front * (2.28 + step * .43), paint.concrete);
  for (const side of [-1, 1]) {
    addBeam(scene, root, parts, `${name}-entry-handrail`, [x + side * 2, y + 1.22, frontZ + front * .35],
      [x + side * 2, y + 1.22, frontZ + front * 1.85], .07, paint.antennaMetal);
    addBeam(scene, root, parts, `${name}-entry-stair-handrail`, [x + side * 2, y + 1.22, frontZ + front * 1.85],
      [x + side * 2, y + 1.0, frontZ + front * 2.8], .07, paint.antennaMetal);
    for (const distance of [.4, 1.8]) addBox(scene, root, parts, `${name}-entry-rail-post`, .07, .9, .07,
      x + side * 2, y + .77, frontZ + front * distance, paint.antennaMetal);
  }
  addBox(scene, root, parts, `${name}-entry-metal-canopy`, 4.4, .14, 2.3,
    x, y + 3.65, frontZ + front * .95, paint.roof);
  for (const side of [-1, 1]) addBeam(scene, root, parts, `${name}-canopy-bracket`,
    [x + side * 1.8, y + 2.95, frontZ], [x + side * 1.8, y + 3.55, frontZ + front * 1.7], .08, paint.antennaMetal);
  addBox(scene, root, parts, `${name}-entry-security-light`, .55, .19, .18,
    x + 2.2, y + 3.1, frontZ + front * .18, paint.amber);
  addBox(scene, root, parts, `${name}-entry-unit-plaque`, .7, .6, .035,
    x - 2, y + 2.3, frontZ + front * .15, paint.olive);
  for (const dx of [-.2, 0, .2]) addBox(scene, root, parts, `${name}-plaque-lettering`, .065, .22, .025,
    x - 2 + dx, y + 2.3, frontZ + front * .18, paint.white);
  const utilityX = x + width / 2 + .5;
  addBox(scene, root, parts, `${name}-air-conditioning-case`, .8, 1.2, 2.1,
    utilityX, y + 2.1, z + 3, paint.darkWall);
  for (let slat = 0; slat < 6; slat++) addBox(scene, root, parts, `${name}-air-conditioning-louvre`, .035, .075, 1.78,
    utilityX + .42, y + 1.72 + slat * .15, z + 3, paint.antennaMetal);
  addBeam(scene, root, parts, `${name}-AC-coolant-conduit`, [utilityX, y + 2.7, z + 3.7],
    [x + width / 2 + .09, y + 4.25, z + 3.7], .1, paint.antennaMetal);
  addBox(scene, root, parts, `${name}-electrical-junction-box`, .14, .7, .5,
    x + width / 2 + .1, y + 1.4, z - 4, paint.olive);
  addBox(scene, root, parts, `${name}-surface-electrical-conduit`, .065, height - 1.5, .065,
    x + width / 2 + .11, y + (height - 1.5) / 2 + 1.5, z - 4, paint.antennaMetal);
  for (const dx of [-width * .22, width * .22]) {
    const ventY = topY + rise * .55 + .55;
    addCylinder(scene, root, parts, `${name}-roof-extract-vent`, .55, 1.0,
      x + dx, ventY, z - depth * .18, paint.antennaMetal, .55, 8);
    addCylinder(scene, root, parts, `${name}-roof-vent-rain-cap`, .95, .12,
      x + dx, ventY + .55, z - depth * .18, paint.roof, .95, 8);
    addBox(scene, root, parts, `${name}-roof-vent-flashing`, 1.25, .06, 1.25,
      x + dx, ventY - .48, z - depth * .18, paint.antennaMetal);
  }
  if (name === "maintenance-shed") {
    const doorX = x - 9, rollerZ = z + depth / 2 + .15;
    addBox(scene, root, parts, `${name}-vehicle-door-frame`, 6.1, 4.8, .19,
      doorX, y + 2.64, rollerZ, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-vehicle-roller-door`, 5.75, 4.45, .08,
      doorX, y + 2.64, rollerZ + .12, paint.olive);
    for (let slat = 0; slat < 12; slat++) addBox(scene, root, parts, `${name}-roller-door-rib`, 5.7, .035, .045,
      doorX, y + .61 + slat * .35, rollerZ + .17, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-vehicle-door-threshold`, 6.3, .12, 2.4,
      doorX, y + .04, rollerZ + 1.2, paint.concrete);
  }
}

function addCompoundWindow(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  x: number, y: number, z: number, width: number, height: number, facing: number, endWall: boolean, paint: OutpostPaints,
): void {
  const box = (suffix: string, w: number, h: number, d: number, along: number, up: number, out: number, material: PBRMaterial) =>
    addBox(scene, root, parts, `${name}-${suffix}`, endWall ? d : w, h, endWall ? w : d,
      x + (endWall ? facing * out : along), y + up, z + (endWall ? along : facing * out), material);
  for (const side of [-1, 1]) {
    box("individual-window-frame", width + .26, .11, .14, 0, side * (height / 2 + .055), .07, paint.white);
    box("individual-window-frame", .13, height, .14, side * (width / 2 + .065), 0, .07, paint.white);
  }
  box("individual-window-glazing", width, height, .05, 0, 0, .11, paint.glass);
  box("window-central-mullion", .065, height + .04, .04, 0, 0, .15, paint.white);
  box("window-transom", width, .06, .04, 0, height * .18, .15, paint.white);
  box("window-weathered-sill", width + .45, .12, .4, 0, -height / 2 - .16, .045, paint.concrete);
}

function addCompoundGenerator(
  scene: Scene, root: TransformNode, parts: Mesh[], x: number, y: number, z: number, paint: OutpostPaints, soot: PBRMaterial,
): void {
  addBox(scene, root, parts, "outpost-yard-generator-foundation", 4.4, .18, 6.4, x, y + .09, z, paint.concrete);
  addBox(scene, root, parts, "outpost-yard-generator-skid", 3.2, .24, 4.8, x, y + .32, z, paint.antennaMetal);
  addBox(scene, root, parts, "outpost-yard-diesel-generator-enclosure", 2.9, 2.3, 4.3, x, y + 1.55, z, paint.olive);
  for (let slat = 0; slat < 9; slat++) addBox(scene, root, parts, "outpost-yard-generator-cooling-louvre", .04, .085, 1.8,
    x + 1.48, y + .7 + slat * .2, z - .55, paint.antennaMetal);
  addBox(scene, root, parts, "outpost-yard-generator-access-panel", .04, 1.7, 1.4,
    x - 1.48, y + 1.5, z + .45, paint.darkWall);
  addBox(scene, root, parts, "outpost-yard-generator-panel-latch", .1, .28, .055,
    x - 1.55, y + 1.4, z + .9, paint.white);
  addCylinder(scene, root, parts, "outpost-yard-generator-exhaust-stack", .25, 2.5,
    x - .8, y + 3.1, z - 1.25, soot, .25, 8);
  addCylinder(scene, root, parts, "outpost-yard-generator-exhaust-rain-cap", .42, .09,
    x - .8, y + 4.4, z - 1.25, paint.antennaMetal, .42, 8);
  addBox(scene, root, parts, "outpost-yard-generator-cable-tray", 8, .13, .24,
    x - 4.3, y + .13, z, paint.antennaMetal);
}

function addCompoundCheckpoint(
  scene: Scene, root: TransformNode, parts: Mesh[], x: number, y: number, z: number,
  paint: OutpostPaints, red: PBRMaterial,
): void {
  // Fourteen metres clear for the angled approach, with two seven-metre
  // leaves hinged inward. The west wicket has its own separate opening.
  for (const side of [-1, 1]) {
    const hingeX = x + side * 7;
    addBox(scene, root, parts, "outpost-main-gate-concrete-pier", .65, .5, .65,
      hingeX, y + .25, z, paint.concrete);
    addBox(scene, root, parts, "outpost-main-gate-hinge-post", .22, 3.45, .22,
      hingeX, y + 1.725, z, paint.antennaMetal);
    for (const height of [.58, 2.5]) addCylinder(scene, root, parts, "outpost-main-gate-hinge", .34, .21,
      hingeX, y + height, z, paint.antennaMetal, .34, 8);
    const leafWidth = 6.8;
    const angle = side * 1.24;
    const leaf = new TransformNode(`outpost-main-gate-open-leaf-${side}`, scene);
    leaf.parent = root;
    leaf.position.set(hingeX, y, z);
    leaf.rotation.y = angle;
    const gateParts: Mesh[] = [];
    for (const height of [.32, 1.5, 2.83]) addBox(scene, leaf, gateParts, "outpost-main-gate-leaf-horizontal-frame",
      leafWidth, .12, .11, -side * leafWidth / 2, height, 0, paint.antennaMetal);
    for (const dx of [0, -side * leafWidth]) addBox(scene, leaf, gateParts, "outpost-main-gate-leaf-end-frame",
      .13, 2.65, .11, dx, 1.54, 0, paint.antennaMetal);
    for (let slat = .2; slat < leafWidth; slat += .28) addBox(scene, leaf, gateParts, "outpost-main-gate-vertical-steel-slat",
      .10, 2.43, .07, -side * slat, 1.58, 0, paint.olive);
    addBeam(scene, leaf, gateParts, "outpost-main-gate-leaf-diagonal-brace", [0, .4, -.08],
      [-side * leafWidth, 2.72, -.08], .08, paint.antennaMetal);
    addBox(scene, leaf, gateParts, "outpost-main-gate-leaf-latch", .25, .18, .22,
      -side * (leafWidth - .18), 1.4, .05, paint.antennaMetal);
    for (const mesh of gateParts) {
      mesh.computeWorldMatrix(true);
      const local = mesh.getWorldMatrix().multiply(root.getWorldMatrix().clone().invert());
      mesh.bakeTransformIntoVertices(local);
      mesh.parent = root;
      mesh.position.setAll(0);
      mesh.rotation.setAll(0);
      mesh.rotationQuaternion = null;
      parts.push(mesh);
    }
    leaf.dispose();
    addBox(scene, root, parts, "outpost-main-gate-pier-lamp", .34, .19, .34,
      hingeX, y + 3.51, z, paint.amber);
  }
  const wicketX = x - 11.5;
  for (const offset of [-.95, .95]) addBox(scene, root, parts, "outpost-personnel-gate-post", .16, 3.1, .16,
    wicketX + offset, y + 1.55, z, paint.antennaMetal);
  for (const height of [.35, 2.7]) addBox(scene, root, parts, "outpost-personnel-gate-frame", 1.7, .085, .075,
    wicketX, y + height, z, paint.antennaMetal);
  for (const offset of [-.8, .8]) addBox(scene, root, parts, "outpost-personnel-gate-frame", .085, 2.35, .075,
    wicketX + offset, y + 1.52, z, paint.antennaMetal);
  for (let slat = -.65; slat <= .65; slat += .26) addBox(scene, root, parts, "outpost-personnel-gate-steel-slat", .075, 2.28, .045,
    wicketX + slat, y + 1.53, z, paint.olive);
  addBox(scene, root, parts, "outpost-personnel-gate-handle", .08, .28, .13,
    wicketX + .57, y + 1.4, z - .08, paint.white);
  addBox(scene, root, parts, "outpost-personnel-gate-threshold", 2.1, .12, 1.1,
    wicketX, y + .015, z, paint.concrete);
  const guardX = x - 11.9, guardZ = z + 5.1;
  addBox(scene, root, parts, "outpost-checkpoint-foundation", 5.1, .3, 5.5,
    guardX, y + .15, guardZ, paint.concrete);
  addBox(scene, root, parts, "outpost-checkpoint-guardhouse-walls", 4.6, 3.4, 4.8,
    guardX, y + 2, guardZ, paint.wall);
  addBox(scene, root, parts, "outpost-checkpoint-damp-plinth", 4.65, .4, 4.85,
    guardX, y + .5, guardZ, paint.darkWall);
  const guardRoof = addBox(scene, root, parts, "outpost-checkpoint-sloping-metal-roof", 5.3, .2, 5.5,
    guardX, y + 3.88, guardZ, paint.roof);
  guardRoof.rotation.z = -.045;
  for (const dx of [-1.6, -.8, 0, .8, 1.6]) addBox(scene, root, parts, "outpost-checkpoint-roof-seam", .035, .04, 5.5,
    guardX + dx, y + 4.0 - dx * .045, guardZ, paint.antennaMetal);
  addCompoundWindow(scene, root, parts, "outpost-checkpoint-guard", guardX + 2.37, y + 2.2, guardZ - .6,
    2.8, 1.25, 1, true, paint);
  addCompoundWindow(scene, root, parts, "outpost-checkpoint-guard", guardX, y + 2.2, guardZ - 2.47,
    2.6, 1.25, -1, false, paint);
  addBox(scene, root, parts, "outpost-checkpoint-steel-door", 1.2, 2.45, .075,
    guardX, y + 1.52, guardZ + 2.47, paint.olive);
  addBox(scene, root, parts, "outpost-checkpoint-door-handle", .07, .25, .1,
    guardX + .4, y + 1.45, guardZ + 2.55, paint.white);
  addBox(scene, root, parts, "outpost-checkpoint-entry-step", 1.8, .2, .8,
    guardX, y + .1, guardZ + 2.8, paint.concrete);
  addBox(scene, root, parts, "outpost-checkpoint-sign-board", 2.6, .56, .055,
    guardX, y + 3.22, guardZ - 2.48, paint.olive);
  for (const dx of [-.8, -.4, 0, .4, .8]) addBox(scene, root, parts, "outpost-checkpoint-sign-stencil", .1, .2, .025,
    guardX + dx, y + 3.22, guardZ - 2.53, paint.white);
  addBox(scene, root, parts, "outpost-checkpoint-security-light", .48, .17, .25,
    guardX + 2.6, y + 3.2, guardZ - 1.7, paint.amber);
  // Raised striped arm preserves vehicle clearance and keeps the gate legible
  // from the island overview. All striping is opaque geometry in one batch.
  const barrierX = x + 6.5, barrierZ = z + 2;
  addBox(scene, root, parts, "outpost-main-gate-barrier-pedestal", .65, 1.1, .55,
    barrierX, y + .55, barrierZ, red);
  addCylinder(scene, root, parts, "outpost-main-gate-barrier-pivot", .36, .75,
    barrierX, y + 1.12, barrierZ, paint.antennaMetal, .36, 8).rotation.x = Math.PI / 2;
  const armLength = 12.2, lift = 1.04;
  const endX = barrierX - Math.cos(lift) * armLength, endY = y + 1.12 + Math.sin(lift) * armLength;
  addBeam(scene, root, parts, "outpost-main-gate-lifted-white-barrier", [barrierX, y + 1.12, barrierZ],
    [endX, endY, barrierZ], .20, paint.white);
  for (let stripe = .45; stripe < armLength; stripe += 1.15) {
    const low = stripe / armLength, high = (stripe + .48) / armLength;
    addBeam(scene, root, parts, "outpost-main-gate-barrier-red-stripe",
      [barrierX + (endX - barrierX) * low, y + 1.12 + (endY - y - 1.12) * low, barrierZ],
      [barrierX + (endX - barrierX) * high, y + 1.12 + (endY - y - 1.12) * high, barrierZ], .216, red);
  }
  for (const dx of [-8.2, 8.2]) for (const dz of [-2.8, 5.3]) {
    addCylinder(scene, root, parts, "outpost-checkpoint-protective-bollard", .25, 1.0,
      x + dx, y + .5, z + dz, paint.yellow, .25, 8);
    addCylinder(scene, root, parts, "outpost-checkpoint-bollard-black-band", .26, .22,
      x + dx, y + .64, z + dz, paint.antennaMetal, .26, 8);
  }
  for (const dx of [-9.5, 9.5]) {
    addCylinder(scene, root, parts, "outpost-checkpoint-lamp-post", .12, 5,
      x + dx, y + 2.5, z + 1.5, paint.antennaMetal, .09, 8);
    addBox(scene, root, parts, "outpost-checkpoint-lamp-housing", .65, .2, .4,
      x + dx, y + 5.05, z + 1.5, paint.antennaMetal);
    addBox(scene, root, parts, "outpost-checkpoint-lamp-lens", .5, .05, .3,
      x + dx, y + 4.94, z + 1.5, paint.amber);
  }
}

function addCompoundServiceGate(
  scene: Scene, root: TransformNode, parts: Mesh[], x: number, y: number, z: number, paint: OutpostPaints,
): void {
  for (const side of [-1, 1]) {
    const hingeX = x + side * 3.5;
    addBox(scene, root, parts, "outpost-north-service-gate-post", .19, 3.3, .19,
      hingeX, y + 1.65, z, paint.antennaMetal);
    addBox(scene, root, parts, "outpost-north-service-gate-plinth", .5, .25, .5,
      hingeX, y + .125, z, paint.concrete);
    for (const height of [.6, 2.5]) addCylinder(scene, root, parts, "outpost-north-service-gate-hinge", .25, .16,
      hingeX, y + height, z, paint.antennaMetal, .25, 8);
    for (const height of [.32, 1.5, 2.83]) addBox(scene, root, parts, "outpost-north-service-gate-open-leaf-frame", .11, .11, 3.3,
      hingeX, y + height, z - 1.65, paint.antennaMetal);
    for (const dz of [0, -3.3]) addBox(scene, root, parts, "outpost-north-service-gate-open-leaf-end-frame", .11, 2.6, .11,
      hingeX, y + 1.57, z + dz, paint.antennaMetal);
    for (let dz = .2; dz < 3.3; dz += .3) addBox(scene, root, parts, "outpost-north-service-gate-slat", .07, 2.43, .075,
      hingeX, y + 1.58, z - dz, paint.olive);
    addBeam(scene, root, parts, "outpost-north-service-gate-diagonal-brace", [hingeX, y + .4, z],
      [hingeX, y + 2.72, z - 3.3], .07, paint.antennaMetal);
  }
  addBox(scene, root, parts, "outpost-north-service-gate-threshold", 7.3, .11, 1.1, x, y + .015, z, paint.concrete);
}

function addCoastalRadarSite(
  scene: Scene, root: TransformNode, casters: Mesh[], paint: OutpostPaints, terrain: TerrainSurface,
): void {
  const { x, z, halfX, halfZ } = ISLAND_RADAR_SITE;
  const heights: number[] = [];
  for (const dx of [-halfX, 0, halfX]) for (const dz of [-halfZ, 0, halfZ]) {
    heights.push(terrain.sample(x + dx, z + dz)?.height ?? islandHeight(x + dx, z + dz));
  }
  const padY = Math.max(...heights) + .35, bottom = Math.min(...heights) - .10;
  const parts: Mesh[] = [];
  addBox(scene, root, parts, "coastal-radar-pad-foundation", halfX * 2, padY - bottom, halfZ * 2,
    x, (padY + bottom) / 2, z, paint.concrete);
  addWeatheredGround(scene, root, parts, "coastal-radar-pad-concrete", halfX * 2, halfZ * 2,
    x, padY + .012, z, paint.concrete);
  for (const dx of [-3, 3]) addBox(scene, root, parts, "coastal-radar-pad-joint", .035, .012, halfZ * 2,
    x + dx, padY + .026, z, paint.darkConcrete);
  for (const dz of [-6, 0, 6]) addBox(scene, root, parts, "coastal-radar-pad-joint", halfX * 2, .012, .035,
    x, padY + .026, z + dz, paint.darkConcrete);
  for (const side of [-1, 1]) {
    addBox(scene, root, parts, "coastal-radar-pad-edge-curb", .28, .18, halfZ * 2,
      x + side * (halfX - .14), padY + .09, z, paint.concrete);
    addBox(scene, root, parts, "coastal-radar-pad-entrance-curb", 6.3, .18, .28,
      x + side * 5.85, padY + .09, z - halfZ + .14, paint.concrete);
    for (const dz of [-9.5, 9.5]) {
      addCylinder(scene, root, parts, "coastal-radar-pad-bollard", .16, .85,
        x + side * 7.8, padY + .425, z + dz, paint.yellow, .16, 8);
      addCylinder(scene, root, parts, "coastal-radar-pad-bollard-stripe", .17, .18,
        x + side * 7.8, padY + .60, z + dz, paint.darkConcrete, .17, 8);
    }
    addBox(scene, root, parts, "coastal-radar-pad-wheel-stop", .75, .20, .32,
      x + side * 1.25, padY + .1, z + 7.3, paint.yellow);
  }
  addBox(scene, root, parts, "coastal-radar-pad-drain", .32, .025, 16,
    x + 7, padY + .025, z, paint.darkConcrete);
  for (let index = -16; index <= 16; index++) addBox(scene, root, parts, "coastal-radar-pad-drain-grate", .30, .025, .045,
    x + 7, padY + .041, z + index * .45, paint.antennaMetal);
  addBox(scene, root, parts, "coastal-radar-pad-power-plinth", 1.55, .20, 1.25,
    x - 7, padY + .1, z + 5, paint.concrete);
  addBox(scene, root, parts, "coastal-radar-pad-power-cabinet", 1.1, 1.65, .8,
    x - 7, padY + 1.025, z + 5, paint.olive);
  addBox(scene, root, parts, "coastal-radar-pad-cabinet-door", .86, 1.4, .04,
    x - 7, padY + 1.025, z + 4.58, paint.darkWall);
  addBox(scene, root, parts, "coastal-radar-pad-cabinet-handle", .045, .16, .07,
    x - 6.69, padY + 1.05, z + 4.53, paint.antennaMetal);
  for (const [start, end] of [
    [[x - 6.6, padY + .065, z + 4.65], [x - 4, padY + .065, z + 2]],
    [[x - 4, padY + .065, z + 2], [x - 2, padY + .065, z - 1.4]],
  ] as const) addBeam(scene, root, parts, "coastal-radar-pad-cable", start, end, .06, paint.darkConcrete);
  addTerrainPath(scene, root, parts, "coastal-radar-pad-service-spur",
    [[-317, -35], [-340, -35], [x, -16], [x, z - halfZ - 2]], 4.4, paint.gravel, terrain);
  const south = z - halfZ - 2, north = z - halfZ + 2;
  const ramp = createGeometry(scene, "coastal-radar-pad-access-ramp", [
    x - 2.4, (terrain.sample(x - 2.4, south)?.height ?? islandHeight(x - 2.4, south)) + .17, south,
    x + 2.4, (terrain.sample(x + 2.4, south)?.height ?? islandHeight(x + 2.4, south)) + .17, south,
    x - 2.4, padY + .045, north, x + 2.4, padY + .045, north,
  ], [0, 1, 2, 1, 3, 2]);
  ramp.parent = root;
  ramp.material = paint.concrete;
  ramp.isPickable = false;
  ramp.receiveShadows = true;
  parts.push(ramp);
  batchFacility(scene, root, casters, parts, "coastal-radar-site");
  const radar = createCoastalRadar(scene, root, x, padY + .045, z);
  casters.push(...radar.shadowCasters);
}

function addBeregSites(
  scene: Scene, root: TransformNode, casters: Mesh[], paint: OutpostPaints, terrain: TerrainSurface,
): void {
  const parts: Mesh[] = [];
  for (const site of ISLAND_BEREG_SITES) {
    const { id, x, z, halfX, halfZ, heading } = site;
    const name = `bereg-${id}-pad`;
    const heights: number[] = [];
    for (const dx of [-halfX, 0, halfX]) for (const dz of [-halfZ, 0, halfZ]) {
      heights.push(terrain.sample(x + dx, z + dz)?.height ?? islandHeight(x + dx, z + dz));
    }
    const topY = Math.max(...heights) + .35;
    const bottomY = Math.min(...heights) - .1;
    addBox(scene, root, parts, `${name}-foundation`, halfX * 2, topY - bottomY, halfZ * 2,
      x, (topY + bottomY) / 2, z, paint.concrete);
    addWeatheredGround(scene, root, parts, `${name}-compacted-surface`, halfX * 2 - .4, halfZ * 2 - .4,
      x, topY + .025, z, paint.gravel);

    // An open apron edge connects the access track to a short tapered ramp.
    const entry = site.access[site.access.length - 1];
    const entryOnX = Math.abs(entry[0] - x) > halfX;
    const entrySide = Math.sign(entry[entryOnX ? 0 : 1] - (entryOnX ? x : z));
    for (const side of [-1, 1]) {
      if (entryOnX && side === entrySide) {
        for (const dz of [-1, 1]) addBox(scene, root, parts, `${name}-curb`, .22, .18, halfZ - 2.8,
          x + side * (halfX - .12), topY + .09, z + dz * (halfZ / 2 + 1.4), paint.concrete);
      } else addBox(scene, root, parts, `${name}-curb`, .22, .18, halfZ * 2,
        x + side * (halfX - .12), topY + .09, z, paint.concrete);
      if (!entryOnX && side === entrySide) {
        for (const dx of [-1, 1]) addBox(scene, root, parts, `${name}-curb`, halfX - 2.8, .18, .22,
          x + dx * (halfX / 2 + 1.4), topY + .09, z + side * (halfZ - .12), paint.concrete);
      } else addBox(scene, root, parts, `${name}-curb`, halfX * 2, .18, .22,
        x, topY + .09, z + side * (halfZ - .12), paint.concrete);
    }
    // Wheel strips and scuffs sit below the parked vehicle; the remaining
    // apron is compacted gravel with slab seams, drains and service fittings.
    const place = (suffix: string, w: number, h: number, d: number, lx: number, ly: number, lz: number,
      material: PBRMaterial) => {
      const mesh = addBox(scene, root, parts, `${name}-${suffix}`, w, h, d,
        x + Math.cos(heading) * lx + Math.sin(heading) * lz, topY + ly,
        z - Math.sin(heading) * lx + Math.cos(heading) * lz, material);
      mesh.rotation.y = heading;
      return mesh;
    };
    for (const side of [-1, 1]) {
      place("wheel-strip", .85, .018, 11, side * 1.25, .034, -.2, paint.darkWall);
      place("wheel-scuff", .53, .012, 10.6, side * 1.25, .049, -.2, paint.darkConcrete);
      for (const lz of [-3.58, 3.04]) place("jack-footing", 1, .026, 1,
        side * 1.67, .032, lz, paint.concrete);
    }
    addBox(scene, root, parts, `${name}-drain-channel`, .34, .018, halfZ * 1.45,
      x + halfX - 1.2, topY + .04, z, paint.darkConcrete);
    for (let index = -12; index <= 12; index++) addBox(scene, root, parts, `${name}-drain-grate`, .32, .022, .045,
      x + halfX - 1.2, topY + .058, z + index * .55, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-service-cabinet-plinth`, 1.5, .16, 1.2,
      x - halfX + 1.5, topY + .08, z + halfZ - 1.5, paint.concrete);
    addBox(scene, root, parts, `${name}-service-cabinet`, 1.05, 1.35, .7,
      x - halfX + 1.5, topY + .835, z + halfZ - 1.5, paint.olive);
    addBox(scene, root, parts, `${name}-service-cabinet-door`, .89, 1.12, .035,
      x - halfX + 1.5, topY + .835, z + halfZ - 1.87, paint.darkWall);
    addBox(scene, root, parts, `${name}-service-cabinet-latch`, .055, .18, .07,
      x - halfX + 1.82, topY + .85, z + halfZ - 1.91, paint.antennaMetal);
    for (const side of [-1, 1]) {
      const bx = entryOnX ? x + entrySide * (halfX - .4) : x + side * 3.1;
      const bz = entryOnX ? z + side * 3.1 : z + entrySide * (halfZ - .4);
      addCylinder(scene, root, parts, `${name}-entry-bollard`, .14, .82,
        bx, topY + .41, bz, paint.antennaMetal, .14, 8);
      addCylinder(scene, root, parts, `${name}-bollard-yellow-band`, .16, .2,
        bx, topY + .65, bz, paint.yellow, .16, 8);
    }

    addTerrainPath(scene, root, parts, `${name}-access`, site.access, 4.8, paint.gravel, terrain,
      id === "west" ? 0 : .85);
    const direction = new Vector3(x - entry[0], 0, z - entry[1]).normalize();
    const endX = entry[0] + direction.x * 4.5, endZ = entry[1] + direction.z * 4.5;
    const nx = direction.z * 2.6, nz = -direction.x * 2.6;
    const rampPositions: number[] = [];
    for (const side of [-1, 1]) {
      const sx = entry[0] + nx * side, sz = entry[1] + nz * side;
      rampPositions.push(sx, (terrain.sample(sx, sz)?.height ?? islandHeight(sx, sz)) + .17, sz);
    }
    for (const side of [-1, 1]) rampPositions.push(endX + nx * side, topY + .045, endZ + nz * side);
    const ramp = createGeometry(scene, `${name}-access-ramp`, rampPositions, [0, 1, 2, 1, 3, 2]);
    ramp.parent = root;
    ramp.material = paint.concrete;
    ramp.isPickable = false;
    ramp.receiveShadows = true;
    parts.push(ramp);
    const vehicle = createBereg(scene, root, x, topY + .045, z, heading, id);
    casters.push(...vehicle.shadowCasters);
  }
  // Four aprons share the same material batches as a single facility.
  batchFacility(scene, root, casters, parts, "bereg-sites");
}

function addExternalHelipad(
  scene: Scene, root: TransformNode, casters: Mesh[], paint: OutpostPaints,
  terrainSurface: TerrainSurface,
): void {
  const { x, z } = ISLAND_HELIPAD;
  const ground = islandHeight(x, z), y = ground + .66;
  const parts: Mesh[] = [];
  addBox(scene, root, parts, "helipad-detail-apron-foundation", 58, .6, 58, x, ground + .3, z, paint.concrete);
  addWeatheredGround(scene, root, parts, "helipad-detail-concrete-apron", 58, 58, x, ground + .61, z, paint.concrete);
  addCylinder(scene, root, parts, "outpost-helipad", 46, .12, x, y, z, paint.asphalt, 46, 64);
  addFlatRing(scene, root, parts, "helipad-detail-landing-circle", x, y + .1, z, 16.3, .38, paint.padMarking);
  for (const side of [-1, 1]) {
    addBox(scene, root, parts, "helipad-detail-H-upright", 2, .025, 12, x + side * 4, y + .1, z, paint.padMarking);
  }
  addBox(scene, root, parts, "helipad-detail-H-crossbar", 10, .025, 2, x, y + .1, z, paint.padMarking);
  for (let index = 0; index < 32; index++) {
    const angle = index / 32 * Math.PI * 2;
    const stripe = addBox(scene, root, parts, "helipad-detail-safety-dash", 2.5, .025, .34,
      x + Math.cos(angle) * 21.8, y + .1, z + Math.sin(angle) * 21.8, paint.padYellow);
    stripe.rotation.y = -angle - Math.PI / 2;
  }
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    const lx = x + Math.cos(angle) * 23.8, lz = z + Math.sin(angle) * 23.8;
    addCylinder(scene, root, parts, "helipad-detail-flush-light-housing", .5, .1, lx, ground + .67, lz, paint.darkConcrete, .5, 8);
    addCylinder(scene, root, parts, "helipad-detail-flush-light-lens", .32, .06, lx, ground + .75, lz, paint.greenLight, .32, 8);
  }
  for (const offset of [-27, -18, -9, 0, 9, 18, 27]) {
    addBox(scene, root, parts, "helipad-detail-apron-seam", .035, .012, 58, x + offset, ground + .62, z, paint.darkConcrete);
    addBox(scene, root, parts, "helipad-detail-apron-seam", 58, .012, .035, x, ground + .62, z + offset, paint.darkConcrete);
  }
  for (const side of [-1, 1]) {
    addBox(scene, root, parts, "helipad-detail-drain-channel", 56, .035, .28, x, ground + .63, z + side * 28, paint.darkConcrete);
    for (let index = -3; index <= 3; index++) {
      addBox(scene, root, parts, "helipad-detail-drain-grate", .035, .025, .28, x + index * 7.5, ground + .66, z + side * 28, paint.concrete);
    }
  }
  // Equipment stays outside the rotor clearance area; the lights are emissive
  // surfaces, so the pad adds no point lights or extra shadow maps.
  addBox(scene, root, parts, "helipad-detail-fire-cabinet", 1.4, 1.8, .7, x - 31.5, ground + .9, z - 20, paint.wall);
  addBox(scene, root, parts, "helipad-detail-fire-cabinet-door", 1.15, 1.45, .08, x - 31.5, ground + 1, z - 20.4, paint.yellow);
  addCylinder(scene, root, parts, "helipad-detail-windsock-pole", .12, 5.5, x + 33, ground + 2.75, z + 25, paint.antennaMetal, .1, 8);
  const sock = addCylinder(scene, root, parts, "helipad-detail-windsock", .65, 2.2, x + 33.95, ground + 5.15, z + 25, paint.white, .22, 10);
  sock.rotation.z = -Math.PI / 2 + .18;
  for (const offset of [.35, 1.1]) {
    const band = addCylinder(scene, root, parts, "helipad-detail-windsock-band", .53 - offset * .14, .35,
      x + 33 + offset, ground + 5.32 - offset * .18, z + 25, paint.yellow, .49 - offset * .14, 10);
    band.rotation.z = -Math.PI / 2 + .18;
  }
  addTerrainPath(scene, root, parts, "helipad-detail-access-path",
    [[ISLAND_BASE.x + 72, z], [-180, z], [x - 30.8, z]], 4.4, paint.concrete, terrainSurface);
  for (let step = 0; step < 3; step++) {
    addBox(scene, root, parts, "helipad-detail-entry-step", .55, .2 * (step + 1), 4.4,
      x - 30.5 + step * .5, ground + .1 * (step + 1), z, paint.concrete);
  }
  batchFacility(scene, root, casters, parts, "aviation");
}

function addHillPost(
  scene: Scene, root: TransformNode, casters: Mesh[],
  post: typeof ISLAND_HILL_POSTS[number], paint: OutpostPaints,
): void {
  const { x, z, id } = post;
  const ground = islandHeight(x, z), y = ground + .65;
  const parts: Mesh[] = [];
  addBox(scene, root, parts, `hill-${id}-terrace-foundation`, 56, .6, 44, x, ground + .3, z, paint.concrete);
  addWeatheredGround(scene, root, parts, `hill-${id}-gravel-yard`, 54, 42, x, y, z, paint.gravel);
  for (const side of [-1, 1]) {
    addBox(scene, root, parts, `hill-${id}-retaining-edge`, 56, 1.4, .6, x, ground - .1, z + side * 22, paint.concrete);
    addBox(scene, root, parts, `hill-${id}-retaining-edge`, .6, 1.4, 44, x + side * 28, ground - .1, z, paint.concrete);
    for (const offset of [-18, -9, 0, 9, 18]) {
      addBox(scene, root, parts, `hill-${id}-retaining-joint`, .05, 1.1, .025, x + offset, ground, z + side * 22.32, paint.darkConcrete);
    }
  }
  addHillBuilding(scene, root, parts, `hill-${id}-operations`, x - 13, y, z + 9, 18, 4.5, 12, paint);
  addHillBuilding(scene, root, parts, `hill-${id}-utility`, x - 15, y, z - 9, 14, 3.6, 10, paint);
  addWatchtower(scene, root, parts, x + 12, y, z + 5, paint, `hill-${id}-watchtower`);
  addPostFence(scene, root, parts, `hill-${id}-fence`, x, y, z, paint);
  // Paved walkways and a short entry stair make the summit installation readable
  // as a working observation post, rather than isolated buildings on a peak.
  addBox(scene, root, parts, `hill-${id}-walkway`, 3.2, .1, 33, x - 2, y + .05, z - 2, paint.concrete);
  addBox(scene, root, parts, `hill-${id}-walkway`, 27, .1, 2.4, x - 3, y + .05, z + 3, paint.concrete);
  for (let step = 0; step < 3; step++) {
    addBox(scene, root, parts, `hill-${id}-entry-step`, 3, .18 * (3 - step), .55,
      x - 2, ground + .09 * (3 - step), z - 22.3 - step * .5, paint.concrete);
  }
  addBox(scene, root, parts, `hill-${id}-generator-enclosure`, 3.6, 1.9, 2, x - 20, y + .95, z - 16, paint.olive);
  for (let index = 0; index < 7; index++) {
    addBox(scene, root, parts, `hill-${id}-generator-louvre`, 2.4, .075, .045,
      x - 20, y + .45 + index * .16, z - 17.03, paint.antennaMetal);
  }
  addCylinder(scene, root, parts, `hill-${id}-generator-exhaust`, .13, 2.6, x - 21.4, y + 1.3, z - 15.7, paint.antennaMetal, .13, 8);
  addCylinder(scene, root, parts, `hill-${id}-water-tank`, 2.6, 2.8, x - 9, y + 1.4, z - 16, paint.darkWall, 2.6, 12);
  for (const height of [.3, 1.4, 2.5]) {
    addCylinder(scene, root, parts, `hill-${id}-tank-band`, 2.68, .08, x - 9, y + height, z - 16, paint.antennaMetal, 2.68, 12);
  }
  addCylinder(scene, root, parts, `hill-${id}-radio-mast`, .13, 8, x - 22, y + 4, z + 16, paint.antennaMetal, .08, 8);
  for (const height of [5.2, 6.4, 7.5]) {
    addBox(scene, root, parts, `hill-${id}-radio-crossarm`, 1.7, .065, .07, x - 22, y + height, z + 16, paint.antennaMetal);
  }
  for (const offset of [-2.3, 2.3]) {
    addBeam(scene, root, parts, `hill-${id}-radio-stay`, [x - 22, y + 5.8, z + 16],
      [x - 22 + offset, y + .1, z + 14], .025, paint.antennaMetal);
  }
  addBox(scene, root, parts, `hill-${id}-entry-sign`, 2.1, .7, .07, x + .8, y + 1.65, z - 19.1, paint.darkWall);
  // Simple identification bars stay legible without additional text textures.
  for (let stripe = 0; stripe < (id === "ridge" ? 1 : 2); stripe++) {
    addBox(scene, root, parts, `hill-${id}-sign-marking`, .16, .38, .02,
      x + .6 + stripe * .4, y + 1.65, z - 19.15, paint.white);
  }
  batchFacility(scene, root, casters, parts, `hill-${id}`);
}

function addHillBuilding(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  x: number, y: number, z: number, width: number, height: number, depth: number, paint: OutpostPaints,
): void {
  addBox(scene, root, parts, `${name}-plinth`, width + .6, .3, depth + .6, x, y + .15, z, paint.concrete);
  addBox(scene, root, parts, `${name}-walls`, width, height, depth, x, y + height / 2 + .3, z, paint.wall);
  addBox(scene, root, parts, `${name}-damp-course`, width + .06, .2, depth + .06, x, y + .45, z, paint.darkWall);
  const roofY = y + height + .58;
  for (const side of [-1, 1]) {
    const panel = addBox(scene, root, parts, `${name}-roof-panel`, width / 2 + .7, .18, depth + 1.3,
      x + side * width / 4, roofY, z, paint.roof);
    panel.rotation.z = -side * .085;
    for (let rib = 0; rib < Math.ceil(width / 2); rib++) {
      const rx = side * (rib + .3);
      addBox(scene, root, parts, `${name}-roof-seam`, .045, .04, depth + 1.25,
        x + rx, roofY + width * .021 - Math.abs(rx) * .085 + .11, z, paint.antennaMetal);
    }
    addBox(scene, root, parts, `${name}-gutter`, .15, .15, depth + 1.5, x + side * (width / 2 + .5), roofY - width * .022, z, paint.antennaMetal);
    addCylinder(scene, root, parts, `${name}-downpipe`, .12, height + .2, x + side * (width / 2 + .12), y + height / 2 + .2,
      z - depth / 2 + .4, paint.antennaMetal, .12, 8);
  }
  addBox(scene, root, parts, `${name}-roof-ridge`, .22, .12, depth + 1.5, x, roofY + width * .022 + .12, z, paint.antennaMetal);
  for (const offset of [-width * .3, width * .3]) {
    addBox(scene, root, parts, `${name}-window-frame`, 3.3, 1.65, .12, x + offset, y + 2.7, z + depth / 2 + .08, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-window-glazing`, 3, 1.35, .025, x + offset, y + 2.7, z + depth / 2 + .15, paint.glass);
    addBox(scene, root, parts, `${name}-window-mullion`, .065, 1.4, .04, x + offset, y + 2.7, z + depth / 2 + .18, paint.white);
    addBox(scene, root, parts, `${name}-window-sill`, 3.5, .1, .35, x + offset, y + 1.86, z + depth / 2 + .16, paint.concrete);
  }
  addBox(scene, root, parts, `${name}-door-frame`, 1.55, 2.7, .12, x, y + 1.65, z + depth / 2 + .08, paint.antennaMetal);
  addBox(scene, root, parts, `${name}-door`, 1.35, 2.45, .05, x, y + 1.57, z + depth / 2 + .16, paint.darkWall);
  addBox(scene, root, parts, `${name}-door-handle`, .08, .28, .1, x + .48, y + 1.5, z + depth / 2 + .23, paint.white);
  addBox(scene, root, parts, `${name}-entry-canopy`, 3.6, .12, 1.5, x, y + 3.3, z + depth / 2 + .7, paint.roof);
  addBox(scene, root, parts, `${name}-entry-step`, 2.6, .18, 1.1, x, y + .09, z + depth / 2 + .55, paint.concrete);
  addBox(scene, root, parts, `${name}-AC-housing`, 1.8, 1.1, .75, x + width / 2 + .45, y + 1.7, z, paint.darkWall);
  for (let slat = 0; slat < 5; slat++) {
    addBox(scene, root, parts, `${name}-AC-louvre`, .04, .065, .55, x + width / 2 + 1.37, y + 1.38 + slat * .15, z, paint.antennaMetal);
  }
  addCylinder(scene, root, parts, `${name}-roof-vent`, .45, .8, x + 2, roofY + .55, z - 2, paint.antennaMetal, .45, 8);
  addCylinder(scene, root, parts, `${name}-vent-cap`, .7, .12, x + 2, roofY + 1, z - 2, paint.roof, .7, 8);
  for (let joint = 1; joint < Math.ceil(width / 3); joint++) {
    addBox(scene, root, parts, `${name}-wall-panel-joint`, .035, height - .45, .015,
      x - width / 2 + joint * 3, y + height / 2 + .4, z - depth / 2 - .02, paint.darkWall);
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

function addWatchtower(
  scene: Scene, root: TransformNode, casters: Mesh[], x: number, y: number, z: number,
  paint: OutpostPaints, name = "outpost-watchtower",
): void {
  const parts: Mesh[] = [];
  const deckY = y + 11.8;
  for (const dx of [-3.5, 3.5]) for (const dz of [-3.5, 3.5]) {
    addBox(scene, root, parts, `${name}-footing`, 1.3, .35, 1.3, x + dx, y + .175, z + dz, paint.concrete);
    addBox(scene, root, parts, `${name}-baseplate`, .65, .07, .65, x + dx, y + .385, z + dz, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-column`, .32, 11.4, .32, x + dx, y + 6.05, z + dz, paint.antennaMetal);
    for (const bx of [-.23, .23]) for (const bz of [-.23, .23]) {
      addCylinder(scene, root, parts, `${name}-anchor-bolt`, .075, .075, x + dx + bx, y + .45, z + dz + bz, paint.antennaMetal, .075, 6);
    }
  }
  for (const level of [.6, 4.25, 7.9]) {
    for (const side of [-1, 1]) {
      for (const direction of [-1, 1]) {
        addBeam(scene, root, parts, `${name}-cross-brace`,
          [x - direction * 3.5, y + level, z + side * 3.5],
          [x + direction * 3.5, y + level + 3.55, z + side * 3.5], .12, paint.antennaMetal);
        addBeam(scene, root, parts, `${name}-cross-brace`,
          [x + side * 3.5, y + level, z - direction * 3.5],
          [x + side * 3.5, y + level + 3.55, z + direction * 3.5], .12, paint.antennaMetal);
      }
      addBox(scene, root, parts, `${name}-horizontal-tie`, 7.1, .15, .15, x, y + level, z + side * 3.5, paint.antennaMetal);
      addBox(scene, root, parts, `${name}-horizontal-tie`, .15, .15, 7.1, x + side * 3.5, y + level, z, paint.antennaMetal);
    }
  }
  addBox(scene, root, parts, `${name}-observation-deck`, 9.6, .25, 9.6, x, deckY, z, paint.darkConcrete);
  for (const side of [-1, 1]) {
    addBox(scene, root, parts, `${name}-deck-edge`, 9.7, .32, .15, x, deckY - .08, z + side * 4.8, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-deck-edge`, .15, .32, 9.7, x + side * 4.8, deckY - .08, z, paint.antennaMetal);
  }
  addBox(scene, root, parts, `${name}-cabin`, 6.4, 3, 6.4, x, deckY + 1.65, z, paint.wall);
  addBox(scene, root, parts, `${name}-cabin-base-trim`, 6.5, .18, 6.5, x, deckY + .3, z, paint.darkWall);
  for (const side of [-1, 1]) {
    addBox(scene, root, parts, `${name}-window-frame`, 5.95, 1.8, .09, x, deckY + 2.05, z + side * 3.24, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-window-glass`, 5.7, 1.55, .025, x, deckY + 2.05, z + side * 3.3, paint.glass);
    addBox(scene, root, parts, `${name}-window-frame`, .09, 1.8, 5.95, x + side * 3.24, deckY + 2.05, z, paint.antennaMetal);
    addBox(scene, root, parts, `${name}-window-glass`, .025, 1.55, 5.7, x + side * 3.3, deckY + 2.05, z, paint.glass);
    for (const offset of [-1.9, 0, 1.9]) {
      addBox(scene, root, parts, `${name}-window-mullion`, .075, 1.7, .04, x + offset, deckY + 2.05, z + side * 3.33, paint.white);
      addBox(scene, root, parts, `${name}-window-mullion`, .04, 1.7, .075, x + side * 3.33, deckY + 2.05, z + offset, paint.white);
    }
    const roof = addBox(scene, root, parts, `${name}-roof-panel`, 4.3, .18, 8.6, x + side * 2.05, deckY + 3.4, z, paint.roof);
    roof.rotation.z = -side * .08;
    for (const height of [.7, 1.25]) {
      addBox(scene, root, parts, `${name}-balcony-rail`, 9.3, .075, .075, x, deckY + height, z + side * 4.65, paint.antennaMetal);
      // The east rail has an opening onto the stair landing.
      addBox(scene, root, parts, `${name}-balcony-rail`, .075, .075, side < 0 ? 9.3 : 6.7,
        x + side * 4.65, deckY + height, z + (side > 0 ? 1.3 : 0), paint.antennaMetal);
    }
    for (const offset of [-4.65, -2.3, 0, 2.3, 4.65]) {
      addBox(scene, root, parts, `${name}-balcony-post`, .085, 1.25, .085, x + offset, deckY + .625, z + side * 4.65, paint.antennaMetal);
      if (side < 0 || offset > -3) {
        addBox(scene, root, parts, `${name}-balcony-post`, .085, 1.25, .085, x + side * 4.65, deckY + .625, z + offset, paint.antennaMetal);
      }
    }
    addBox(scene, root, parts, `${name}-balcony-toeboard`, 9.3, .12, .06, x, deckY + .19, z + side * 4.65, paint.yellow);
  }
  addBox(scene, root, parts, `${name}-roof-ridge`, .2, .12, 8.7, x, deckY + 3.62, z, paint.antennaMetal);
  addBox(scene, root, parts, `${name}-access-door`, .075, 2.3, 1, x + 3.34, deckY + 1.3, z - 2.1, paint.darkWall);
  addBox(scene, root, parts, `${name}-door-handle`, .12, .22, .07, x + 3.43, deckY + 1.25, z - 2.45, paint.white);
  addCylinder(scene, root, parts, `${name}-antenna`, .09, 3.3, x - 1.7, deckY + 5.1, z + 1.4, paint.antennaMetal, .055, 6);
  addBox(scene, root, parts, `${name}-radio-panel`, .32, 1.1, .16, x - 1.7, deckY + 5.3, z + 1.4, paint.radarWhite);
  addBox(scene, root, parts, `${name}-searchlight-bracket`, .18, .7, .18, x - 4.1, deckY + 1.55, z - 4.1, paint.antennaMetal);
  const light = addCylinder(scene, root, parts, `${name}-searchlight-housing`, .65, .65, x - 4.1, deckY + 1.94, z - 4.25, paint.darkConcrete, .65, 10);
  light.rotation.x = Math.PI / 2;
  const lens = addCylinder(scene, root, parts, `${name}-searchlight-lens`, .52, .03, x - 4.1, deckY + 1.94, z - 4.59, paint.radarWhite, .52, 10);
  lens.rotation.x = Math.PI / 2;
  addTowerStairs(scene, root, parts, name, x, y, z, paint);
  // Keep a named tower landmark while merging its fittings by material/layout.
  batchFacility(scene, root, casters, parts, name);
}

function addTowerStairs(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  x: number, y: number, z: number, paint: OutpostPaints,
): void {
  for (let flight = 0; flight < 2; flight++) {
    const sx = x + 5.45 + flight * 1.7;
    const direction = flight === 0 ? 1 : -1;
    const z1 = z - direction * 3.6, z2 = z + direction * 3.6;
    const lowY = y + flight * 5.9, highY = lowY + 5.9;
    for (let step = 1; step <= 32; step++) {
      const t = step / 32, sz = z1 + (z2 - z1) * t;
      addBox(scene, root, parts, `${name}-stair-tread`, 1.25, .085, .26, sx, lowY + t * 5.9, sz, paint.darkConcrete);
      addBox(scene, root, parts, `${name}-stair-nosing`, 1.25, .03, .045,
        sx, lowY + t * 5.9 + .05, sz - direction * .11, paint.yellow);
      if (step % 4 === 0) for (const side of [-1, 1]) {
        addBox(scene, root, parts, `${name}-stair-guard-post`, .07, 1.05, .07,
          sx + side * .65, lowY + t * 5.9 + .52, sz, paint.antennaMetal);
      }
    }
    for (const side of [-1, 1]) {
      addBeam(scene, root, parts, `${name}-stair-stringer`, [sx + side * .54, lowY - .1, z1],
        [sx + side * .54, highY - .1, z2], .16, paint.antennaMetal);
      for (const height of [.6, 1.1]) addBeam(scene, root, parts, `${name}-stair-handrail`,
        [sx + side * .65, lowY + height, z1], [sx + side * .65, highY + height, z2], .065, paint.antennaMetal);
    }
  }
  addBox(scene, root, parts, `${name}-mid-landing`, 3.4, .16, 1.5, x + 6.3, y + 5.9, z + 4.15, paint.darkConcrete);
  addBox(scene, root, parts, `${name}-upper-landing`, 3.5, .16, 1.5, x + 6.1, y + 11.8, z - 4.15, paint.darkConcrete);
  for (const [height, sz] of [[5.9, 4.9], [11.8, -4.9]]) {
    addBox(scene, root, parts, `${name}-landing-rail`, 3.5, .075, .075, x + 6.3, y + height + 1.1, z + sz, paint.antennaMetal);
    for (const offset of [-1.5, 0, 1.5]) {
      addBox(scene, root, parts, `${name}-landing-post`, .075, 1.1, .075, x + 6.3 + offset, y + height + .55, z + sz, paint.antennaMetal);
    }
  }
  for (const height of [5.9, 11.8]) {
    addBox(scene, root, parts, `${name}-stair-support`, .16, height, .16, x + 7.75, y + height / 2, z + (height < 6 ? 4.15 : -4.15), paint.antennaMetal);
  }
}

function addPerimeterFence(
  scene: Scene, root: TransformNode, casters: Mesh[], centerX: number, y: number,
  centerZ: number, material: PBRMaterial, gateX: number,
): void {
  const southZ = centerZ - 52;
  const sides: readonly [number, number, number, number][] = [
    [centerX - 71, southZ, gateX - 12.45, southZ],
    [gateX - 10.55, southZ, gateX - 7, southZ],
    [gateX + 7, southZ, centerX + 71, southZ],
    [centerX - 71, centerZ + 52, centerX - 8.5, centerZ + 52],
    [centerX - 1.5, centerZ + 52, centerX + 71, centerZ + 52],
    [centerX - 71, southZ, centerX - 71, centerZ + 52],
    [centerX + 71, southZ, centerX + 71, centerZ - 3],
    [centerX + 71, centerZ + 3, centerX + 71, centerZ + 52],
  ];
  for (const [x1, z1, x2, z2] of sides) addFenceLine(scene, root, casters, "outpost-fence", x1, z1, x2, z2, y, 3, material);
  // Three simple strands on inward steel outriggers read as a secured working
  // station without the heavy translucent surfaces of the former fence.
  for (const [x1, z1, x2, z2] of sides) {
    const length = Math.hypot(x2 - x1, z2 - z1), sections = Math.ceil(length / 9);
    for (let index = 0; index <= sections; index++) {
      const t = index / Math.max(1, sections), x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      addBeam(scene, root, casters, "outpost-fence-security-outrigger", [x, y + 2.98, z],
        [x, y + 3.4, z + (z1 === z2 ? -.22 : 0)], .035, material);
    }
    for (const height of [3.08, 3.23, 3.39]) {
      const wire = addBeam(scene, root, casters, "outpost-fence-security-wire", [x1, y + height, z1],
        [x2, y + height, z2], .014, material);
      wire.receiveShadows = false;
    }
  }
}

function addPostFence(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  x: number, y: number, z: number, paint: OutpostPaints,
): void {
  const lines: readonly [number, number, number, number][] = [
    [x - 25, z - 19, x - 3.8, z - 19], [x - .2, z - 19, x + 25, z - 19],
    [x - 25, z + 19, x + 25, z + 19],
    [x - 25, z - 19, x - 25, z + 19], [x + 25, z - 19, x + 25, z + 19],
  ];
  for (const [x1, z1, x2, z2] of lines) addFenceLine(scene, root, parts, name, x1, z1, x2, z2, y, 2.4, paint.antennaMetal);
  addFenceLine(scene, root, parts, `${name}-open-gate`, x - 3.8, z - 19, x - 3.8, z - 15.6, y, 2.4, paint.antennaMetal);
  for (const offset of [-3.8, -.2]) {
    addBox(scene, root, parts, `${name}-gate-pier`, .55, .35, .55, x + offset, y + .175, z - 19, paint.concrete);
    for (const height of [.55, 1.9]) {
      addCylinder(scene, root, parts, `${name}-gate-hinge`, .2, .18, x + offset, y + height, z - 19, paint.darkConcrete, .2, 8);
    }
  }
  for (const dx of [-25, 25]) for (const dz of [-19, 19]) {
    addBox(scene, root, parts, `${name}-corner-plinth`, .45, .15, .45, x + dx, y + .075, z + dz, paint.concrete);
    addBox(scene, root, parts, `${name}-corner-lamp`, .3, .16, .3, x + dx, y + 2.52, z + dz, paint.amber);
  }
}

function addFenceLine(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  x1: number, z1: number, x2: number, z2: number, y: number, height: number, material: PBRMaterial,
): void {
  const length = Math.hypot(x2 - x1, z2 - z1);
  const sections = Math.max(1, Math.ceil(length / 4.5));
  for (let index = 0; index <= sections; index++) {
    const t = index / sections;
    addBox(scene, root, parts, `${name}-post`, .11, height, .11,
      x1 + (x2 - x1) * t, y + height / 2, z1 + (z2 - z1) * t, material);
  }
  for (const offset of [.28, height - .18]) {
    addBeam(scene, root, parts, `${name}-rail`, [x1, y + offset, z1], [x2, y + offset, z2], .07, material);
  }
  const positions: number[] = [], indices: number[] = [];
  const ux = (x2 - x1) / length, uz = (z2 - z1) / length;
  const wireHeight = height - .55;
  // Crossed thin ribbons give the fence actual openings with opaque materials.
  for (const direction of [-1, 1]) for (let start = -wireHeight; start < length; start += .7) {
    const low = Math.max(0, -start), high = Math.min(wireHeight, length - start);
    if (high <= low) continue;
    const a = start + low, b = start + high;
    const ay = y + .3 + (direction > 0 ? low : wireHeight - low);
    const by = y + .3 + (direction > 0 ? high : wireHeight - high);
    const vertex = positions.length / 3;
    const nx = ux * .012, ny = -direction * .012, nz = uz * .012;
    positions.push(
      x1 + ux * a - nx, ay - ny, z1 + uz * a - nz,
      x1 + ux * a + nx, ay + ny, z1 + uz * a + nz,
      x1 + ux * b + nx, by + ny, z1 + uz * b + nz,
      x1 + ux * b - nx, by - ny, z1 + uz * b - nz,
    );
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3,
      vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
  }
  const mesh = createGeometry(scene, `${name}-wire`, positions, indices);
  // Explicit normals avoid cancellation on the two-sided wire ribbons.
  mesh.setVerticesData("normal", positions.map((_v, index) => index % 3 === 0 ? -uz : index % 3 === 2 ? ux : 0));
  mesh.parent = root;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  parts.push(mesh);
}

function addBeam(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  start: readonly [number, number, number], end: readonly [number, number, number], thickness: number, material: PBRMaterial,
): Mesh {
  const direction = new Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const length = direction.length();
  const beam = addBox(scene, root, parts, name, thickness, length, thickness,
    (start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2, material);
  beam.rotationQuaternion = Quaternion.Identity();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.scale(1 / length), beam.rotationQuaternion);
  return beam;
}

function addFlatRing(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  x: number, y: number, z: number, radius: number, width: number, material: PBRMaterial,
): void {
  const positions: number[] = [], indices: number[] = [];
  for (let index = 0; index <= 64; index++) {
    const angle = index / 64 * Math.PI * 2;
    for (const r of [radius - width / 2, radius + width / 2]) positions.push(x + Math.cos(angle) * r, y, z + Math.sin(angle) * r);
    if (index < 64) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const mesh = createGeometry(scene, name, positions, indices);
  mesh.setVerticesData("uv", new Float32Array(positions.length / 3 * 2));
  mesh.parent = root;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  parts.push(mesh);
}

function addWeatheredGround(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  width: number, depth: number, x: number, y: number, z: number, material: PBRMaterial,
): void {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [], uvs: number[] = [];
  const cells = 12;
  for (let row = 0; row <= cells; row++) for (let col = 0; col <= cells; col++) {
    positions.push(x - width / 2 + col / cells * width, y, z - depth / 2 + row / cells * depth);
    const shade = .93 + .018 * Math.sin(col * .73 + row * .31)
      + .012 * Math.cos(row * .63 - col * .27) + .005 * pseudo(row * 59 + col * 131);
    colors.push(shade, shade, shade * .97, 1);
    uvs.push(col / cells * width / 4, row / cells * depth / 4);
    if (row < cells && col < cells) {
      const a = row * (cells + 1) + col;
      indices.push(a, a + 1, a + cells + 1, a + 1, a + cells + 2, a + cells + 1);
    }
  }
  const mesh = createGeometry(scene, name, positions, indices);
  mesh.setVerticesData("color", colors);
  mesh.setVerticesData("uv", uvs);
  mesh.useVertexColors = true;
  mesh.parent = root;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  parts.push(mesh);
}

function addTerrainPath(
  scene: Scene, root: TransformNode, parts: Mesh[], name: string,
  route: readonly (readonly [number, number])[], width: number, material: PBRMaterial,
  terrain: TerrainSurface, roadJoinLift = 0,
): void {
  const points = sampleRoute(route, 24);
  const edges = points.map(([x, z], index) => {
    const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
    const dx = after[0] - before[0], dz = after[1] - before[1], length = Math.hypot(dx, dz) || 1;
    return [
      [x - dz / length * width / 2, z + dx / length * width / 2],
      [x + dz / length * width / 2, z - dx / length * width / 2],
    ];
  });
  const positions: number[] = [], indices: number[] = [];
  for (let segment = 1; segment < edges.length; segment++) {
    const boundary = [edges[segment - 1][0], edges[segment - 1][1], edges[segment][1], edges[segment][0]];
    const area = boundary.reduce((sum, p, i) => {
      const q = boundary[(i + 1) % boundary.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
    if (Math.abs(area) < 1e-8) continue;
    const winding = Math.sign(area);
    const candidates = terrain.trianglesInBounds(
      Math.min(...boundary.map(p => p[0])), Math.min(...boundary.map(p => p[1])),
      Math.max(...boundary.map(p => p[0])), Math.max(...boundary.map(p => p[1])),
    );
    for (const triangle of candidates) {
      let polygon: number[][] = [0, 1, 2].map(offset => {
        const index = terrain.indices[triangle + offset] * 3;
        return [terrain.positions[index], terrain.positions[index + 1], terrain.positions[index + 2]];
      });
      // Clip the terrain's exact 3D triangle against each vertical side of the
      // path footprint. The resulting vertices lie on the original terrain.
      for (let edge = 0; edge < boundary.length && polygon.length; edge++) {
        const a = boundary[edge], b = boundary[(edge + 1) % boundary.length];
        const distance = (p: number[]) => winding * ((b[0] - a[0]) * (p[2] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
        const clipped: number[][] = [];
        let previous = polygon[polygon.length - 1], previousDistance = distance(previous);
        for (const current of polygon) {
          const currentDistance = distance(current);
          if ((previousDistance >= 0) !== (currentDistance >= 0)) {
            const t = previousDistance / (previousDistance - currentDistance);
            clipped.push(previous.map((value, axis) => value + (current[axis] - value) * t));
          }
          if (currentDistance >= 0) clipped.push(current);
          previous = current;
          previousDistance = currentDistance;
        }
        polygon = clipped;
      }
      if (polygon.length < 3) continue;
      const first = positions.length / 3;
      for (const [x, y, z] of polygon) {
        const entryLift = name.includes("helipad") ? 3.3 * Math.max(0, 1 - (x - route[0][0]) / 22)
          : name === "coastal-radar-pad-service-spur"
            ? .85 * (1 - smoothStep(0, 12, Math.max(0, route[0][0] - x))) : 0;
        const joinLift = roadJoinLift * (1 - smoothStep(0, 14, Math.hypot(x - route[0][0], z - route[0][1])));
        positions.push(x, y + .15 + entryLift + joinLift, z);
      }
      for (let vertex = 1; vertex < polygon.length - 1; vertex++) {
        indices.push(first, first + vertex, first + vertex + 1);
      }
    }
  }
  const mesh = createGeometry(scene, name, positions, indices);
  mesh.parent = root;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  parts.push(mesh);
}

function batchFacility(
  scene: Scene, root: TransformNode, casters: Mesh[], parts: Mesh[], name: string,
): void {
  const surfacePaint = scene.getMaterialByName("outpost-markings") as PBRMaterial;
  const groups = new Map<string, Mesh[]>();
  for (const mesh of parts) {
    const material = mesh.material;
    // Bake matte paint into vertex colors. Concrete, wall panels, gravel, roof
    // seams and safety strips can then share one physical material and draw.
    if (material instanceof PBRMaterial && (material.roughness ?? 0) >= .86 && (material.metallic ?? 1) <= .05
      && material.zOffset === 0 && material.zOffsetUnits === 0) {
      const count = mesh.getTotalVertices();
      const previous = mesh.getVerticesData("color");
      const colors = new Float32Array(count * 4);
      const tint = material.albedoColor, base = surfacePaint.albedoColor;
      for (let vertex = 0; vertex < count; vertex++) {
        const index = vertex * 4;
        colors[index] = tint.r / base.r * (previous?.[index] ?? 1);
        colors[index + 1] = tint.g / base.g * (previous?.[index + 1] ?? 1);
        colors[index + 2] = tint.b / base.b * (previous?.[index + 2] ?? 1);
        colors[index + 3] = 1;
      }
      mesh.setVerticesData("color", colors);
      if (!mesh.isVerticesDataPresent("uv")) mesh.setVerticesData("uv", new Float32Array(count * 2));
      mesh.useVertexColors = true;
      mesh.material = surfacePaint;
    }
    const key = mesh.material?.uniqueId + ':' + mesh.getVerticesDataKinds().sort().join('|');
    const group = groups.get(key) ?? [];
    group.push(mesh);
    groups.set(key, group);
  }
  let index = 0;
  for (const group of groups.values()) {
    const material = group[0].material;
    const sourceNames: string[] = group.flatMap(mesh => mesh.metadata?.sourceNames ?? [mesh.name]);
    const receivesShadows = group.some(mesh => mesh.receiveShadows);
    // Reapply the island's translation once after merging local coordinates.
    for (const mesh of group) mesh.parent = null;
    const merged = group.length > 1 ? Mesh.MergeMeshes(group, true, true) : group[0];
    if (!merged) throw new Error(`Could not merge island facility ${name}`);
    merged.name = `north-watch-${name}-batch-${index++}`;
    merged.parent = root;
    merged.material = material;
    merged.useVertexColors = merged.isVerticesDataPresent("color");
    merged.metadata = { facility: name, sourceNames };
    merged.isPickable = false;
    merged.receiveShadows = receivesShadows;
    casters.push(merged);
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

function addPalms(scene: Scene, root: TransformNode, casters: Mesh[], palmLeaves: PBRMaterial,
  wood: PBRMaterial, terrain: TerrainSurface): void {
  const palmTrunk = createPalmTrunk(scene);
  prepareSource(palmTrunk, "island-palm-trunk-source", root, wood, casters);
  const palmCrown = createPalmCrown(scene);
  prepareSource(palmCrown, "island-palm-fronds-source", root, palmLeaves, casters);
  let palmIndex = 0;
  for (let candidate = 0; candidate < 85; candidate++) {
    const seed = candidate * 101 + 29;
    const angle = candidate / 85 * Math.PI * 2 + (pseudo(seed) - .5) * .15;
    const radius = islandShoreRadius(angle) - .065 - pseudo(seed + 1) * .055;
    const x = Math.cos(angle) * radius * ISLAND_RADIUS_X;
    const z = Math.sin(angle) * radius * ISLAND_RADIUS_Z;
    const y = terrain.sample(x, z)?.height ?? islandHeight(x, z);
    if (pseudo(seed + 6) < .43 || y < 4 || y > 36 || terrainSlope(x, z) > .6 || !clearVegetationSite(x, z)) continue;
    const scale = .8 + pseudo(seed + 2) * .42;
    const yaw = pseudo(seed + 3) * Math.PI * 2;
    addInstance(palmTrunk, root, `island-palm-trunk-${palmIndex}`, x, y - .2, z, scale, scale, scale, yaw);
    addInstance(palmCrown, root, `island-palm-fronds-${palmIndex}`,
      x + Math.cos(yaw) * 1.4 * scale, y + 17 * scale, z - Math.sin(yaw) * 1.4 * scale, scale, scale, scale, yaw);
    palmIndex++;
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
  const uvs: number[] = [];
  for (let row = 0; row <= 18; row++) {
    const t = row / 18;
    const radius = .75 - t * .36 + (row % 2 === 0 ? .05 : 0);
    for (let segment = 0; segment < 8; segment++) {
      const angle = segment / 8 * Math.PI * 2;
      positions.push(Math.cos(angle) * radius + t * t * 1.4, t * 17, Math.sin(angle) * radius);
      uvs.push(segment / 8 * 2, t * 5);
      if (row === 18) continue;
      const a = row * 8 + segment;
      const b = row * 8 + (segment + 1) % 8;
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
  }
  const mesh = createGeometry(scene, "island-palm-trunk-source", positions, indices);
  mesh.setVerticesData("uv", uvs);
  return mesh;
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
  for (const site of ISLAND_BEREG_SITES) {
    if (Math.abs(x - site.x) < site.halfX + 4 && Math.abs(z - site.z) < site.halfZ + 4) return false;
    if (nearRoute(x, z, site.access, 4.4)) return false;
  }
  if (Math.abs(x - ISLAND_RADAR_SITE.x) < ISLAND_RADAR_SITE.halfX + 4
    && Math.abs(z - ISLAND_RADAR_SITE.z) < ISLAND_RADAR_SITE.halfZ + 4) return false;
  if (nearRoute(x, z, [[-317, -35], [-340, -35], [ISLAND_RADAR_SITE.x, -16],
    [ISLAND_RADAR_SITE.x, ISLAND_RADAR_SITE.z - ISLAND_RADAR_SITE.halfZ]], 4)) return false;
  if (Math.abs(x - ISLAND_BASE.x) < 103 && Math.abs(z - ISLAND_BASE.z) < 83) return false;
  if (Math.abs(x - ISLAND_HARBOR.x) < 24 && z < ISLAND_HARBOR.shoreZ + 32) return false;
  if (Math.abs(x - ISLAND_HELIPAD.x) < 37 && Math.abs(z - ISLAND_HELIPAD.z) < 37) return false;
  for (const post of ISLAND_HILL_POSTS) {
    if (Math.abs(x - post.x) < post.halfX + 4 && Math.abs(z - post.z) < post.halfZ + 4) return false;
  }
  return !nearRoad(x, z);
}

function nearRoad(x: number, z: number): boolean {
  return nearRoute(x, z, ISLAND_ROAD, 13) || HILL_PATHS.some(route => nearRoute(x, z, route, 4));
}

function nearRoute(x: number, z: number, route: readonly (readonly [number, number])[], clearance: number): boolean {
  for (let index = 0; index < route.length - 1; index++) {
    const [x1, z1] = route[index];
    const [x2, z2] = route[index + 1];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - x1 - dx * t, z - z1 - dz * t) < clearance) return true;
  }
  return false;
}

function batchBaseDetails(root: TransformNode, casters: Mesh[]): void {
  // Small static fittings are batched by material; named terrain, road, pier
  // and primary structures remain available as separate scene landmarks.
  const groups = new Map<string, Mesh[]>();
  const detailPattern = /^(outpost-fence-|outpost-yard-|mast-|roof-vent-|pier-pile|pier-head-pile|dock-bollard|outpost-truck-|communications-mast|outpost-flagpole)/;
  for (const mesh of casters) {
    if (!detailPattern.test(mesh.name) || !(mesh.material instanceof PBRMaterial)) continue;
    const key = mesh.material.uniqueId + ':' + mesh.getVerticesDataKinds().sort().join('|');
    const group = groups.get(key) ?? [];
    group.push(mesh);
    groups.set(key, group);
  }
  let index = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const material = group[0].material;
    const receivesShadows = group.some(mesh => mesh.receiveShadows);
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
    merged.receiveShadows = receivesShadows;
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
