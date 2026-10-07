import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, islandShoreRadius } from "@naval/shared";
import type { GraphicsQuality } from "../game/graphicsQuality";
import { IslandVegetationWind } from "./IslandVegetationWind";
import { islandDetailTexture } from "./islandDetailTextures";

interface Ground { height: number; slope: number }
type SampleGround = (x: number, z: number) => Ground | undefined;
interface Geometry { positions: number[]; indices: number[]; uvs: number[]; colors: number[] }
const random = (seed: number) => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const geometry = (): Geometry => ({ positions: [], indices: [], uvs: [], colors: [] });

function finish(scene: Scene, name: string, data: Geometry): Mesh {
  const vertices = new VertexData();
  vertices.positions = data.positions;
  vertices.indices = data.indices;
  vertices.uvs = data.uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(data.positions, data.indices, normals);
  vertices.normals = normals;
  if (data.colors.length) vertices.colors = data.colors;
  const mesh = new Mesh(name, scene);
  vertices.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

function source(mesh: Mesh, root: TransformNode, material: PBRMaterial, casters?: Mesh[]): Mesh {
  mesh.parent = root;
  mesh.position.y = -1_000;
  mesh.material = material;
  mesh.receiveShadows = true;
  casters?.push(mesh);
  return mesh;
}

function place(mesh: Mesh, root: TransformNode, name: string, x: number, y: number, z: number,
  scale: Vector3, yaw: number, solid = false) {
  const instance = mesh.createInstance(name);
  instance.parent = root;
  instance.position.set(x, y, z);
  instance.scaling.copyFrom(scale);
  instance.rotation.y = yaw;
  instance.isPickable = false;
  instance.checkCollisions = solid;
  instance.receiveShadows = true;
  return instance;
}

/** Tapered, gently curved branches with continuous bark UVs. */
function branch(data: Geometry, start: Vector3, end: Vector3, radius: number, tip: number, rings: number, sides: number) {
  const direction = end.subtract(start).normalize();
  const across = Vector3.Cross(direction, Math.abs(direction.y) > .95 ? Vector3.Right() : Vector3.Up()).normalize();
  const sideways = Vector3.Cross(direction, across).normalize();
  const offset = data.positions.length / 3;
  const length = Vector3.Distance(start, end);
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, r = radius + (tip - radius) * t;
    const center = Vector3.Lerp(start, end, t).add(across.scale(Math.sin(t * Math.PI) * radius * .5));
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const point = center.add(across.scale(Math.cos(angle) * r)).add(sideways.scale(Math.sin(angle) * r));
      data.positions.push(point.x, point.y, point.z);
      data.uvs.push(side / sides * 2, t * length / 3);
      if (ring < rings && side < sides) {
        const a = offset + ring * (sides + 1) + side, b = a + sides + 1;
        data.indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
}

function treeModel(scene: Scene, variant: number, wood: PBRMaterial, leaves: PBRMaterial,
  root: TransformNode, casters: Mesh[]) {
  const stem = geometry(), ends: Vector3[] = [];
  branch(stem, Vector3.Zero(), new Vector3(.4, 12.5, .2), .68, .20, 6, 9);
  for (let limb = 0; limb < 9; limb++) {
    const angle = limb * 2.399 + variant * .7;
    const start = new Vector3(.2, 6.5 + limb * .6, .1);
    const end = new Vector3(Math.cos(angle) * (3.4 + random(limb + variant * 89) * 1.4),
      11 + random(limb + 54) * 4.8, Math.sin(angle) * 4.2);
    branch(stem, start, end, .23 - limb * .013, .045, 3, 6);
    ends.push(end);
    for (let twig = 0; twig < 2; twig++) {
      const twigEnd = end.add(new Vector3(Math.cos(angle + twig * 1.8) * 1.4, 1.3, Math.sin(angle + twig * 1.8) * 1.4));
      branch(stem, Vector3.Lerp(start, end, .65), twigEnd, .075, .015, 2, 4);
      ends.push(twigEnd);
    }
  }
  const trunk = source(finish(scene, `island-branching-trunk-source-${variant}`, stem), root, wood, casters);
  trunk.checkCollisions = true;
  // Trunks retain their silhouette and physical shape; fine twigs disappear at distance.
  const coarseStem = geometry();
  branch(coarseStem, Vector3.Zero(), new Vector3(.4, 12.5, .2), .68, .20, 3, 6);
  for (let i = 0; i < 9; i += 2) branch(coarseStem, new Vector3(.2, 8.5, .1), ends[i * 3], .18, .035, 1, 4);
  const distantTrunk = source(finish(scene, `island-trunk-lod-${variant}`, coarseStem), root, wood);
  trunk.addLODLevel(170, distantTrunk);

  const leafGeometry = (step: number, leafScale: number) => {
    const data = geometry();
    for (let leaf = 0; leaf < 810; leaf += step) {
      const seed = variant * 901 + leaf * 17 + 63;
      const center = ends[leaf % ends.length].add(new Vector3(
        (random(seed) - .5) * 3.8, (random(seed + 1) - .5) * 3.1, (random(seed + 2) - .5) * 3.8));
      const yaw = random(seed + 3) * Math.PI * 2, tilt = .18 + random(seed + 4) * 1.8;
      const width = (.32 + random(seed + 5) * .23) * leafScale;
      const length = (.65 + random(seed + 6) * .5) * leafScale;
      const across = new Vector3(Math.cos(yaw) * width, 0, Math.sin(yaw) * width);
      const along = new Vector3(-Math.sin(yaw) * Math.cos(tilt) * length, Math.sin(tilt) * length, Math.cos(yaw) * Math.cos(tilt) * length);
      const offset = data.positions.length / 3;
      const shade = .67 + random(seed + 7) * .33;
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const point = center.add(across.scale(u - .5)).add(along.scale(v - .5));
        data.positions.push(point.x, point.y, point.z);
        data.uvs.push(u, v);
        data.colors.push(shade * .94, shade, shade * .9, 1);
      }
      data.indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
    }
    return data;
  };
  const canopy = source(finish(scene, `island-leaf-canopy-source-${variant}`, leafGeometry(1, 1)), root, leaves, casters);
  const middle = source(finish(scene, `island-leaf-canopy-lod-${variant}`, leafGeometry(5, 2.25)), root, leaves);
  canopy.addLODLevel(85, middle);
  canopy.addLODLevel(220, source(finish(scene, `island-leaf-canopy-far-${variant}`, leafGeometry(15, 3.8)), root, leaves));
  return { trunk, canopy };
}

function rockModel(scene: Scene, variant: number, root: TransformNode, material: PBRMaterial, casters?: Mesh[], detailed = true) {
  const mesh = CreateSphere(`island-fractured-basalt-${variant}-${detailed ? "source" : "lod"}`, { diameter: 2, segments: detailed ? 8 : 3 }, scene);
  const positions = mesh.getVerticesData("position")!, indices = mesh.getIndices()!;
  const uvs: number[] = [], colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i], y = positions[i + 1], z = positions[i + 2];
    // Continuous deformation keeps UV seams closed; broad facets form broken basalt.
    const deform = 1 + .18 * Math.sin(x * 3.1 + y * 4.4 + z * 2.8 + variant * 9)
      + .08 * Math.cos(x * 7 - y * 3 + z * 5);
    x *= deform; z *= deform;
    y = Math.max(-.58, y * deform);
    positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
    uvs.push((Math.atan2(z, x) / (Math.PI * 2) + .5) * 3, (y + .7) * 2);
    const shade = .7 + .25 * random(variant * 83 + Math.round((x + z + y) * 71));
    const moss = Math.max(0, y) * .13;
    colors.push(shade * (1 - moss), shade, shade * .90, 1);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  mesh.setVerticesData("position", positions);
  mesh.setVerticesData("normal", normals);
  mesh.setVerticesData("uv", uvs);
  mesh.setVerticesData("color", colors);
  mesh.convertToFlatShadedMesh();
  mesh.checkCollisions = true;
  return source(mesh, root, material, casters);
}

function grassGeometry(scene: Scene): Mesh {
  const data = geometry();
  for (let blade = 0; blade < 12; blade++) {
    const yaw = blade * 2.399, h = .36 + random(blade + 73) * .42;
    const x = Math.cos(yaw) * .30, z = Math.sin(yaw) * .30;
    const width = .028 + random(blade + 91) * .024;
    const offset = data.positions.length / 3;
    for (const [side, t] of [[-1, 0], [1, 0], [-.65, .55], [.65, .55], [0, 1]]) {
      data.positions.push(x + Math.cos(yaw) * side * width + Math.sin(yaw) * t * t * .14,
        h * t, z + Math.sin(yaw) * side * width - Math.cos(yaw) * t * t * .14);
      data.uvs.push((side + 1) * .5, t);
      const brightness = .60 + t * .4;
      data.colors.push(brightness * .84, brightness, brightness * .57, 1);
    }
    data.indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3,
      offset + 2, offset + 4, offset + 3);
  }
  return finish(scene, "island-grass-tuft-source", data);
}

export interface IslandNature {
  update(eye: Vector3, time: number): void;
  setQuality(quality: GraphicsQuality): void;
}

/** Static instanced trees and rocks, plus a bounded pool of nearby grass patches. */
export function createIslandNature(scene: Scene, root: TransformNode, casters: Mesh[],
  sample: SampleGround, clearSite: (x: number, z: number) => boolean, wood: PBRMaterial, rock: PBRMaterial): IslandNature {
  wood.albedoTexture = islandDetailTexture(scene, "bark");
  wood.bumpTexture = islandDetailTexture(scene, "bark", true);
  wood.bumpTexture.level = .28;
  rock.albedoTexture = islandDetailTexture(scene, "rock");
  rock.bumpTexture = islandDetailTexture(scene, "rock", true);
  rock.bumpTexture.level = .35;
  const leaves = new PBRMaterial("island-individual-leaves", scene);
  leaves.albedoColor = Color3.FromHexString("#68834d").toLinearSpace();
  leaves.albedoTexture = islandDetailTexture(scene, "leaf");
  leaves.useAlphaFromAlbedoTexture = true;
  leaves.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  leaves.alphaCutOff = .45;
  leaves.backFaceCulling = false;
  leaves.roughness = 1;
  leaves.metallic = 0;
  leaves.environmentIntensity = .5;
  const leafWind = new IslandVegetationWind(leaves, .18, 16);
  const trees = Array.from({ length: 3 }, (_, i) => treeModel(scene, i, wood, leaves, root, casters));
  const clusters = [[-435, -48, 52], [-425, 91, 38], [-160, 70, 45], [-62, 110, 42],
    [102, 93, 45], [210, -12, 35], [355, -78, 30]];
  let treeIndex = 0;
  for (let cluster = 0; cluster < clusters.length; cluster++) {
    const [cx, cz, spread] = clusters[cluster];
    for (let candidate = 0; candidate < 32; candidate++) {
      const seed = cluster * 503 + candidate * 37 + 31;
      const angle = random(seed) * Math.PI * 2, radius = Math.sqrt(random(seed + 1)) * spread;
      const x = cx + Math.cos(angle) * radius, z = cz + Math.sin(angle) * radius;
      const ground = sample(x, z);
      if (!ground || !clearSite(x, z) || ground.height < 8 || ground.height > 140 || ground.slope > .85) continue;
      const scale = .68 + random(seed + 2) * .62, yaw = random(seed + 3) * Math.PI * 2;
      const model = trees[candidate % 3], dimensions = new Vector3(scale, scale, scale);
      const trunk = place(model.trunk, root, `island-broadleaf-trunk-${treeIndex}`, x, ground.height - .25, z, dimensions, yaw, true);
      trunk.metadata = { nature: "tree", groundHeight: ground.height };
      place(model.canopy, root, `island-broadleaf-canopy-${treeIndex++}`, x, ground.height - .25, z, dimensions, yaw);
    }
  }
  // Low shrubs use the same leaves and retain the same distance reductions.
  for (let i = 0; i < 100; i++) {
    const seed = 9041 + i * 43, angle = random(seed) * Math.PI * 2, radius = .4 + random(seed + 1) * .51;
    const x = Math.cos(angle) * radius * ISLAND_RADIUS_X, z = Math.sin(angle) * radius * ISLAND_RADIUS_Z;
    const ground = sample(x, z);
    if (!ground || ground.height < 8 || ground.slope > .8 || !clearSite(x, z)) continue;
    const scale = .12 + random(seed + 2) * .14;
    place(trees[i % 3].canopy, root, `island-understory-shrub-${i}`, x, ground.height - 10 * scale, z,
      new Vector3(scale, scale * .65, scale), random(seed + 3) * 6);
  }
  const rocks = Array.from({ length: 3 }, (_, i) => {
    const model = rockModel(scene, i, root, rock, casters);
    model.addLODLevel(130, rockModel(scene, i, root, rock, undefined, false));
    return model;
  });
  for (let i = 0; i < 105; i++) {
    const seed = i * 67 + 313, angle = random(seed) * Math.PI * 2, coastal = i < 60;
    const radius = coastal ? islandShoreRadius(angle) - .012 - random(seed + 1) * .05 : .25 + random(seed + 1) * .60;
    const x = Math.cos(angle) * radius * ISLAND_RADIUS_X, z = Math.sin(angle) * radius * ISLAND_RADIUS_Z;
    const ground = sample(x, z);
    if (!ground || ground.height < 1 || ground.slope > 1.5 || !clearSite(x, z)) continue;
    const size = coastal ? .9 + random(seed + 2) * 3.3 : 1.4 + random(seed + 2) * 4.3;
    const dimensions = new Vector3(size, size * (.48 + random(seed + 3) * .4), size * .83);
    const mesh = place(rocks[i % 3], root, `island-coastal-boulder-${i}`, x, ground.height + dimensions.y * .12, z,
      dimensions, random(seed + 4) * 6, true);
    mesh.metadata = { nature: "rock", groundHeight: ground.height };
  }

  const grassMaterial = new PBRMaterial("island-living-grass", scene);
  grassMaterial.albedoColor = Color3.FromHexString("#647a3c").toLinearSpace();
  grassMaterial.roughness = 1;
  grassMaterial.metallic = 0;
  grassMaterial.environmentIntensity = .55;
  grassMaterial.backFaceCulling = false;
  const grassWind = new IslandVegetationWind(grassMaterial, .14, .78);
  const grassSource = source(grassGeometry(scene), root, grassMaterial);
  grassSource.receiveShadows = false;
  const CELL = 24, CAPACITY = 64;
  const patches: { mesh: Mesh; key: string }[] = [];
  for (let i = 0; i < CAPACITY; i++) {
    const mesh = grassSource.clone(`island-nearby-grass-${i}`, root, true)!;
    // Thin instance attributes belong to the geometry. Each patch needs its
    // own tiny tuft geometry, otherwise clones overwrite each other's matrices.
    mesh.makeGeometryUnique();
    mesh.setEnabled(false);
    mesh.receiveShadows = false;
    mesh.checkCollisions = false;
    mesh.metadata = { nature: "grass", transient: true };
    patches.push({ mesh, key: "" });
  }
  let range = 60, spacing = 1.4;
  const buildPatch = (patch: typeof patches[number], cx: number, cz: number) => {
    const matrices: number[] = [];
    const count = Math.floor(CELL / spacing);
    const offsetX = cx * CELL, offsetZ = cz * CELL;
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
      const seed = cx * 9143 + cz * 7919 + row * 379 + col * 127;
      const x = offsetX + (col + .18 + random(seed) * .64) * CELL / count;
      const z = offsetZ + (row + .18 + random(seed + 1) * .64) * CELL / count;
      if (!clearSite(x, z) || random(seed + 5) < .10) continue;
      const ground = sample(x, z);
      if (!ground || ground.height < 6 || ground.slope > .78) continue;
      const scale = .7 + random(seed + 2) * .65;
      Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationYawPitchRoll(random(seed + 3) * 6.28, 0, 0),
        new Vector3(x - offsetX, ground.height - .035, z - offsetZ)).copyToArray(matrices, matrices.length);
    }
    patch.mesh.unfreezeWorldMatrix();
    patch.mesh.position.set(offsetX, 0, offsetZ);
    patch.mesh.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
    patch.mesh.thinInstanceRefreshBoundingInfo();
    patch.mesh.freezeWorldMatrix();
    patch.mesh.setEnabled(matrices.length > 0);
    patch.key = cx + ":" + cz;
  };
  return {
    setQuality(quality) {
      range = quality === "High" ? 84 : quality === "Low" ? 30 : 60;
      spacing = quality === "High" ? 1.05 : quality === "Low" ? 2.5 : 1.4;
      for (const patch of patches) { patch.key = ""; patch.mesh.setEnabled(false); }
    },
    update(eye, time) {
      leafWind.time = grassWind.time = time;
      leafWind.eye.copyFrom(eye); grassWind.eye.copyFrom(eye);
      grassWind.range = range;
      const x = eye.x - ISLAND_CENTER.x, z = eye.z - ISLAND_CENTER.z;
      const ground = sample(x, z);
      if (!ground || eye.y - ground.height > range * .8 || eye.y < ground.height - 2) {
        for (const patch of patches) patch.mesh.setEnabled(false);
        return;
      }
      const wanted: { key: string; x: number; z: number; distance: number }[] = [];
      const reach = Math.ceil(range / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let a = cx - reach; a <= cx + reach; a++) for (let b = cz - reach; b <= cz + reach; b++) {
        const distance = Math.hypot((a + .5) * CELL - x, (b + .5) * CELL - z);
        if (distance <= range + CELL * .7) wanted.push({ key: a + ":" + b, x: a, z: b, distance });
      }
      wanted.sort((a, b) => a.distance - b.distance);
      wanted.length = Math.min(wanted.length, CAPACITY);
      const keys = new Set(wanted.map(cell => cell.key));
      const existing = new Map(patches.map(patch => [patch.key, patch]));
      const unused = patches.filter(patch => !keys.has(patch.key));
      for (const patch of unused) patch.mesh.setEnabled(false);
      let builds = 0;
      for (const cell of wanted) {
        const patch = existing.get(cell.key);
        if (patch) { patch.mesh.setEnabled(patch.mesh.thinInstanceCount > 0); continue; }
        if (builds >= 2) break; // Bound uploads and terrain sampling during camera motion.
        const free = unused.pop();
        if (!free) break;
        buildPatch(free, cell.x, cell.z);
        builds++;
      }
    },
  };
}
