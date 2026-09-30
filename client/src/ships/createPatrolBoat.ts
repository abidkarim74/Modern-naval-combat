import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";
import { addBoatDetails } from "./boatDetails";

const HULL_STATIONS = [
  { z: -2.95, upper: 0.77, lower: 0.46, bottom: -0.52 },
  { z: -2.25, upper: 0.88, lower: 0.55, bottom: -0.55 },
  { z: -0.9, upper: 0.92, lower: 0.55, bottom: -0.55 },
  { z: 0.75, upper: 0.79, lower: 0.45, bottom: -0.49 },
  { z: 2.15, upper: 0.46, lower: 0.22, bottom: -0.37 },
  { z: 2.92, upper: 0.025, lower: 0.015, bottom: -0.14 },
] as const;

export interface PatrolBoatVisual {
  readonly root: Mesh;
  readonly shadowCasters: readonly Mesh[];
  update(state: BoatSimulationState, interpolation: number): void;
}

export function createPatrolBoat(scene: Scene): PatrolBoatVisual {
  const root = new Mesh("patrol-boat-root", scene);
  root.isVisible = false;
  root.isPickable = false;

  const hullMaterial = createPbrMaterial("hull-material", scene, new Color3(0.065, 0.14, 0.19), 0.36, 0.34);
  const deckMaterial = createPbrMaterial("deck-material", scene, new Color3(0.56, 0.37, 0.19), 0, 0.75);
  const cabinMaterial = createPbrMaterial("cabin-material", scene, new Color3(0.88, 0.91, 0.86), 0.05, 0.3);
  const glassMaterial = createPbrMaterial("glass-material", scene, new Color3(0.025, 0.12, 0.16), 0.52, 0.20);
  const engineMaterial = createPbrMaterial("engine-material", scene, new Color3(0.11, 0.15, 0.17), 0.55, 0.36);
  const accentMaterial = createPbrMaterial("safety-accent-material", scene, new Color3(0.92, 0.36, 0.13), 0.08, 0.52);
  const lightMaterialPort = createPbrMaterial("port-light-material", scene, new Color3(0.82, 0.07, 0.045), 0.02, 0.2);
  const lightMaterialStarboard = createPbrMaterial("starboard-light-material", scene, new Color3(0.08, 0.72, 0.36), 0.02, 0.2);

  const hull = createHull(scene);
  hull.material = hullMaterial;
  hull.parent = root;

  const shadowCasters: Mesh[] = [hull];
  addBox(scene, root, shadowCasters, "deck", 1.72, 0.16, 4.45, 0, 0.06, -0.08, deckMaterial);
  addBox(scene, root, shadowCasters, "bow-deck", 1.15, 0.1, 1.15, 0, 0.06, 1.72, deckMaterial);
  addBox(scene, root, shadowCasters, "cabin", 1.25, 0.91, 1.55, 0, 0.60, -0.05, cabinMaterial);
  addBox(scene, root, shadowCasters, "cabin-roof", 1.45, 0.13, 1.78, 0, 1.11, -0.08, cabinMaterial);
  addBox(scene, root, shadowCasters, "front-windshield", 0.94, 0.37, 0.055, 0, 0.82, 0.755, glassMaterial, 0.18);
  addBox(scene, root, shadowCasters, "rear-window", 0.78, 0.29, 0.045, 0, 0.78, -0.84, glassMaterial, -0.14);
  addBox(scene, root, shadowCasters, "port-window", 0.04, 0.36, 0.79, -0.633, 0.79, -0.08, glassMaterial);
  addBox(scene, root, shadowCasters, "starboard-window", 0.04, 0.36, 0.79, 0.633, 0.79, -0.08, glassMaterial);

  addBox(scene, root, shadowCasters, "port-rub-rail", 0.09, 0.12, 3.95, -0.84, -0.08, -0.10, engineMaterial);
  addBox(scene, root, shadowCasters, "starboard-rub-rail", 0.09, 0.12, 3.95, 0.84, -0.08, -0.10, engineMaterial);
  addBox(scene, root, shadowCasters, "aft-seat", 1.30, 0.22, 0.39, 0, 0.28, -1.37, cabinMaterial);
  addBox(scene, root, shadowCasters, "port-seat", 0.40, 0.20, 0.75, -0.48, 0.28, 0.95, cabinMaterial);
  addBox(scene, root, shadowCasters, "starboard-seat", 0.40, 0.20, 0.75, 0.48, 0.28, 0.95, cabinMaterial);

  addBox(scene, root, shadowCasters, "port-navigation-light", 0.10, 0.10, 0.14, -0.47, 0.20, 1.9, lightMaterialPort);
  addBox(scene, root, shadowCasters, "starboard-navigation-light", 0.10, 0.10, 0.14, 0.47, 0.20, 1.9, lightMaterialStarboard);
  lightMaterialPort.emissiveColor = new Color3(0.4, 0.01, 0);
  lightMaterialStarboard.emissiveColor = new Color3(0, 0.2, 0.06);
  const details = addBoatDetails(scene, root, shadowCasters, cabinMaterial, engineMaterial, accentMaterial, deckMaterial);

  return {
    root,
    shadowCasters,
    update(state, interpolation) {
      const alpha = clamp(interpolation, 0, 1);
      root.position.set(
        lerp(state.previousPositionX, state.positionX, alpha),
        lerp(state.previousPositionY, state.positionY, alpha),
        lerp(state.previousPositionZ, state.positionZ, alpha),
      );
      root.rotation.set(
        -lerp(state.previousPitch, state.pitch, alpha),
        lerp(state.previousHeading, state.heading, alpha),
        lerp(state.previousRoll, state.roll, alpha),
      );
      details.update(state);
    },
  };
}

function createPbrMaterial(
  name: string,
  scene: Scene,
  albedoColor: Color3,
  metallic: number,
  roughness: number,
): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = albedoColor;
  material.metallic = metallic;
  material.roughness = roughness;
  material.useRadianceOverAlpha = true;
  return material;
}

function createHull(scene: Scene): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const pointsPerStation = 5;

  for (const station of HULL_STATIONS) {
    positions.push(
      0, station.bottom, station.z,
      station.lower, station.bottom + 0.13, station.z,
      station.upper, 0.04, station.z,
      -station.upper, 0.04, station.z,
      -station.lower, station.bottom + 0.13, station.z,
    );
  }

  for (let stationIndex = 0; stationIndex < HULL_STATIONS.length - 1; stationIndex += 1) {
    const base = stationIndex * pointsPerStation;
    const nextBase = base + pointsPerStation;
    for (let edgeIndex = 0; edgeIndex < pointsPerStation; edgeIndex += 1) {
      const nextEdge = (edgeIndex + 1) % pointsPerStation;
      const a = base + edgeIndex;
      const b = base + nextEdge;
      const c = nextBase + nextEdge;
      const d = nextBase + edgeIndex;
      indices.push(a, b, d, b, c, d);
    }
  }

  for (const stationIndex of [0, HULL_STATIONS.length - 1]) {
    const base = stationIndex * pointsPerStation;
    for (let edgeIndex = 1; edgeIndex < pointsPerStation - 1; edgeIndex += 1) {
      if (stationIndex === 0) indices.push(base, base + edgeIndex + 1, base + edgeIndex);
      else indices.push(base, base + edgeIndex, base + edgeIndex + 1);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  const hull = new Mesh("patrol-hull", scene);
  vertexData.applyToMesh(hull, false);
  hull.isPickable = false;
  hull.receiveShadows = true;
  return hull;
}

function addBox(
  scene: Scene,
  root: Mesh,
  casters: Mesh[],
  name: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: PBRMaterial,
  rotationX = 0,
): Mesh {
  const mesh = CreateBox(name, { width, height, depth }, scene);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rotationX;
  mesh.parent = root;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  casters.push(mesh);
  return mesh;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
