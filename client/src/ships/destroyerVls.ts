import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";

export type MissileLaunchBank = "forward" | "aft";

export interface VlsLaunchCell {
  readonly bank: MissileLaunchBank;
  readonly hatchPivot: TransformNode;
  readonly hatchMeshes: readonly Mesh[];
  /** Cell top center in ship-root coordinates, independent of the open lid. */
  readonly launchPoint: Vector3;
}

interface VlsHatchOptions {
  readonly bank: MissileLaunchBank;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
}

type VlsHatchPaint = Record<"gray" | "light" | "dark", PBRMaterial> & { readonly red?: PBRMaterial };

interface HatchSource {
  readonly mesh: Mesh;
  readonly minimum: Vector3;
  readonly maximum: Vector3;
}

interface HatchInstance {
  readonly source: HatchSource;
  readonly index: number;
  readonly localMatrix: Matrix;
  readonly matrix: Matrix;
  readonly sweepRadius: number;
}

// A scene/root pair owns its sources. Weak keys do not retain disposed sessions.
const sourceCache = new WeakMap<Scene, WeakMap<Mesh, Map<string, WeakMap<PBRMaterial, HatchSource>>>>();

function getHatchSource(scene: Scene, root: Mesh, casters: Mesh[], bank: MissileLaunchBank, part: string, material: PBRMaterial): HatchSource {
  let roots = sourceCache.get(scene);
  if (!roots) { roots = new WeakMap(); sourceCache.set(scene, roots); }
  let parts = roots.get(root);
  if (!parts) { parts = new Map(); roots.set(root, parts); }
  const key = `${bank}-${part}`;
  let materials = parts.get(key);
  if (!materials) { materials = new WeakMap(); parts.set(key, materials); }
  const cached = materials.get(material);
  if (cached && !cached.mesh.isDisposed()) return cached;

  const mesh = CreateBox(`Mk41-${key}-instances`, { size: 1 }, scene);
  mesh.parent = root;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  // These conservative bounds cover every lid angle. Babylon's default thin
  // instance synchronization otherwise scans all instances as the ship moves.
  mesh.doNotSyncBoundingInfo = true;
  mesh.onAfterWorldMatrixUpdateObservable.add(() => {
    mesh.getBoundingInfo().update(mesh.worldMatrixFromCache);
  });
  const source = { mesh, minimum: new Vector3(Infinity, Infinity, Infinity), maximum: new Vector3(-Infinity, -Infinity, -Infinity) };
  materials.set(material, source);
  casters.push(mesh);
  return source;
}

function includeHingeSweep(source: HatchSource, position: Vector3, radius: number): void {
  source.minimum.minimizeInPlaceFromFloats(position.x - radius, position.y - radius, position.z - radius);
  source.maximum.maximizeInPlaceFromFloats(position.x + radius, position.y + radius, position.z + radius);
  source.mesh.setBoundingInfo(new BoundingInfo(source.minimum, source.maximum, source.mesh.getWorldMatrix()));
}

/** A closed Mk 41 cover. Negative X rotation raises its forward edge. */
export function createVlsLaunchCell(
  scene: Scene, root: Mesh, casters: Mesh[], options: VlsHatchOptions, paint: VlsHatchPaint,
): VlsLaunchCell {
  const { bank, index, x, y, z, width, depth, thickness } = options;
  const name = `Mk41-${bank}-cell-${index}`;
  const hatchPivot = new TransformNode(`${name}-hatch-pivot`, scene);
  hatchPivot.parent = root;
  hatchPivot.position.set(x, y, z - depth / 2);
  const hatchMeshes: Mesh[] = [];
  const instances: HatchInstance[] = [];
  const hingeMatrix = Matrix.Translation(x, y, z - depth / 2);
  const part = (suffix: string, w: number, h: number, d: number, localY: number, localZ: number, material: PBRMaterial) => {
    const source = getHatchSource(scene, root, casters, bank, suffix, material);
    const localMatrix = Matrix.Compose(new Vector3(w, h, d), Quaternion.Identity(), new Vector3(0, localY, depth / 2 + localZ));
    const matrix = localMatrix.multiply(hingeMatrix);
    // thinInstanceAdd creates an updatable matrix buffer, shared by the bank.
    const instanceIndex = source.mesh.thinInstanceAdd(matrix);
    const sweepRadius = Math.hypot(w / 2, Math.abs(localY) + h / 2, Math.abs(depth / 2 + localZ) + d / 2);
    instances.push({ source, index: instanceIndex, localMatrix, matrix, sweepRadius });
    includeHingeSweep(source, hatchPivot.position, sweepRadius);
    hatchMeshes.push(source.mesh);
  };
  part("hatch-panel", width, thickness, depth, 0, 0, paint.light);
  part("hatch-center-seam", .022, .012, depth - .18, thickness / 2 + .006, 0, paint.gray);
  if (bank === "forward") {
    part("red-warning-tab", .16, .025, .13, thickness / 2 + .0125, depth / 2 - .175, paint.red ?? paint.dark);
  } else {
    part("hatch-lifting-point", .11, .08, .26, thickness / 2 + .04, -.32, paint.dark);
  }
  const previousPosition = hatchPivot.position.clone();
  const previousRotation = hatchPivot.rotation.clone();
  const previousScaling = hatchPivot.scaling.clone();
  let previousQuaternion: Quaternion | null = null;
  const rotationQuaternion = Quaternion.Identity();
  hatchPivot.onAfterWorldMatrixUpdateObservable.add(() => {
    const quaternion = hatchPivot.rotationQuaternion;
    const sameQuaternion = quaternion ? previousQuaternion !== null && quaternion.equals(previousQuaternion) : previousQuaternion === null;
    if (sameQuaternion && hatchPivot.position.equals(previousPosition)
      && hatchPivot.rotation.equals(previousRotation) && hatchPivot.scaling.equals(previousScaling)) return;

    const sweepChanged = !hatchPivot.position.equals(previousPosition) || !hatchPivot.scaling.equals(previousScaling);
    previousPosition.copyFrom(hatchPivot.position);
    previousRotation.copyFrom(hatchPivot.rotation);
    previousScaling.copyFrom(hatchPivot.scaling);
    previousQuaternion = quaternion?.clone() ?? null;
    if (quaternion) rotationQuaternion.copyFrom(quaternion);
    else Quaternion.RotationYawPitchRollToRef(hatchPivot.rotation.y, hatchPivot.rotation.x, hatchPivot.rotation.z, rotationQuaternion);
    Matrix.ComposeToRef(hatchPivot.scaling, rotationQuaternion, hatchPivot.position, hingeMatrix);
    for (const instance of instances) {
      instance.localMatrix.multiplyToRef(hingeMatrix, instance.matrix);
      instance.source.mesh.thinInstanceSetMatrixAt(instance.index, instance.matrix);
      if (sweepChanged) includeHingeSweep(instance.source, hatchPivot.position,
        instance.sweepRadius * Math.max(Math.abs(hatchPivot.scaling.x), Math.abs(hatchPivot.scaling.y), Math.abs(hatchPivot.scaling.z)));
    }
  });
  return {
    bank, hatchPivot, hatchMeshes,
    launchPoint: new Vector3(x, y + thickness / 2, z),
  };
}
