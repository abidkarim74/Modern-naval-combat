import { Mesh } from "@babylonjs/core/Meshes/mesh";

/** Babylon can batch only meshes with identical vertex buffer layouts. */
export function mergeStaticMeshes(root: Mesh, casters: Mesh[], animatedParts: ReadonlySet<Mesh>): void {
  const materials = new Map<Mesh["material"], Map<string, Mesh[]>>();
  for (const mesh of casters) {
    if (animatedParts.has(mesh)) continue;
    let batches = materials.get(mesh.material);
    if (!batches) {
      batches = new Map<string, Mesh[]>();
      materials.set(mesh.material, batches);
    }
    const attributes = mesh.getVerticesDataKinds().sort().join("|");
    const parts = batches.get(attributes) ?? [];
    parts.push(mesh);
    batches.set(attributes, parts);
  }

  for (const batches of materials.values()) {
    for (const parts of batches.values()) {
      if (parts.length < 2) continue;
      const merged = Mesh.MergeMeshes(parts, true, true);
      if (!merged) continue;
      merged.parent = root;
      merged.receiveShadows = true;
      merged.isPickable = false;
      const sources = new Set(parts);
      for (let index = casters.length - 1; index >= 0; index--) {
        if (sources.has(casters[index])) casters.splice(index, 1);
      }
      casters.push(merged);
    }
  }
}
