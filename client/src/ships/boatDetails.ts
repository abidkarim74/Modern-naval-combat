import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";

export function addBoatDetails(
  scene: Scene, root: Mesh, casters: Mesh[], white: PBRMaterial,
  dark: PBRMaterial, orange: PBRMaterial, deck: PBRMaterial,
): { update(state: BoatSimulationState): void } {
  const steel = new PBRMaterial("brushed-stainless-steel", scene);
  steel.albedoColor = new Color3(0.74, 0.8, 0.82);
  steel.metallic = 0.85;
  steel.roughness = 0.24;

  const register = (mesh: Mesh, material: PBRMaterial, parent = root) => {
    mesh.parent = parent;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    casters.push(mesh);
    return mesh;
  };
  const box = (name: string, size: number[], position: number[], material: PBRMaterial, parent = root) => {
    const mesh = register(CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene), material, parent);
    mesh.position.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
    return mesh;
  };
  const tube = (name: string, points: number[][], radius = 0.023, material = steel) => {
    const path = points.map(p => new Vector3(p[0], p[1], p[2]));
    return register(CreateTube(name, { path, radius, tessellation: 6, cap: Mesh.CAP_ALL }, scene), material);
  };

  // A small repeating deck texture adds scale without a downloaded asset.
  const planks = new DynamicTexture("teak-deck-planks", { width: 128, height: 256 }, scene, true);
  const ctx = planks.getContext();
  ctx.fillStyle = "#c4a279";
  ctx.fillRect(0, 0, 128, 256);
  for (let x = 0; x < 128; x += 16) {
    ctx.fillStyle = x % 32 === 0 ? "#baa17e" : "#c9ad87";
    ctx.fillRect(x + 1, 0, 14, 256);
    ctx.fillStyle = "#68523e";
    ctx.fillRect(x, 0, 1, 256);
    for (let y = 0; y < 256; y += 11) {
      ctx.fillStyle = "rgba(102,73,40,0.12)";
      ctx.fillRect(x + 3 + y % 5, y, 1, 8);
    }
  }
  planks.update();
  deck.albedoColor.set(0.8, 0.8, 0.8);
  deck.albedoTexture = planks;

  for (const side of [-1, 1]) {
    const s = (x: number) => x * side;
    tube("bow-safety-rail", [[s(.86), .66, -.85], [s(.82), .66, .6], [s(.49), .59, 2.1], [s(.05), .48, 2.86]]);
    tube("white-gunwale", [[s(.78), .1, -2.8], [s(.91), .1, -.8], [s(.8), .1, .72], [s(.46), .1, 2.14], [0, .1, 2.91]], .045, white);
    for (const [x, z] of [[.84, -.8], [.77, .65], [.47, 2.04]]) {
      tube("rail-stanchion", [[s(x ?? 0), .10, z ?? 0], [s(x ?? 0), .63, z ?? 0]], .018);
    }
    tube("aft-grab-rail", [[s(.77), .12, -2.75], [s(.77), .46, -2.75], [s(.85), .46, -1.65], [s(.85), .12, -1.65]]);
    box("aft-seat-cushion", [.34, .12, 1.1], [s(.58), .36, -1.99], white);
    box("windshield-frame", [.04, .42, .09], [s(.49), .82, .78], white);
    box("roof-orange-stripe", [.07, .015, 1.62], [s(.64), 1.183, -.08], orange);
    tube("cabin-roof-grab", [[s(.5), 1.18, -.65], [s(.5), 1.29, -.58], [s(.5), 1.29, .46], [s(.5), 1.18, .53]], .018);
    const cleat = register(CreateCylinder("mooring-cleat", { height: .1, diameter: .07, tessellation: 8 }, scene), steel);
    cleat.position.set(s(.6), .2, -2.42);
    box("cleat-crossbar", [.22, .045, .045], [s(.6), .26, -2.42], steel);
  }
  box("windscreen-center-mullion", [.045, .43, .055], [0, .82, .79], white);
  box("aft-door", [.41, .63, .035], [0, .48, -.845], dark);
  box("door-handle", [.07, .025, .025], [.12, .49, -.88], steel);
  tube("antenna", [[.39, 1.19, -.6], [.39, 2.15, -.65]], .014, dark);
  tube("signal-mast", [[-.35, 1.2, -.6], [-.35, 1.83, -.6]], .02);
  const flag = register(CreatePlane("orange-signal-pennant", { width: .4, height: .23, sideOrientation: Mesh.DOUBLESIDE }, scene), orange);
  flag.position.set(-.15, 1.67, -.61);

  const lifeRing = register(CreateTorus("orange-life-ring", { diameter: .47, thickness: .1, tessellation: 16 }, scene), orange);
  lifeRing.rotation.x = Math.PI / 2;
  lifeRing.position.set(0, .82, -.93);
  for (const side of [-1, 1]) box("life-ring-white-band", [.08, .1, .03], [side * .195, .82, -.99], white);

  const engines: Mesh[] = [];
  for (const x of [-.37, .37]) {
    const pivot = new Mesh("outboard-steering-pivot", scene);
    pivot.parent = root;
    pivot.position.set(x, .08, -2.99);
    engines.push(pivot);
    box("outboard-cowling", [.42, .55, .52], [0, 0, 0], dark, pivot);
    box("outboard-silver-cap", [.4, .08, .47], [0, .27, 0], steel, pivot);
    box("outboard-orange-badge", [.27, .075, .01], [0, .06, -.267], orange, pivot);
    box("outboard-leg", [.12, .6, .16], [0, -.47, 0], dark, pivot);
    box("outboard-fin", [.31, .025, .28], [0, -.53, 0], dark, pivot);
  }

  const nameTexture = new DynamicTexture("vessel-name", { width: 512, height: 128 }, scene, true);
  nameTexture.hasAlpha = true;
  nameTexture.drawText("PELAGIC  /  07", null, 83, "bold 45px sans-serif", "#eff5ef", "transparent", true);
  const nameMaterial = new PBRMaterial("vessel-lettering", scene);
  nameMaterial.albedoTexture = nameTexture;
  nameMaterial.useAlphaFromAlbedoTexture = true;
  nameMaterial.metallic = 0;
  nameMaterial.roughness = .75;
  const nameplate = register(CreatePlane("transom-name", { width: .62, height: .155 }, scene), nameMaterial);
  nameplate.position.set(0, -.1, -2.965);

  // Batch the static parts by material. Engines and flag retain their own transforms.
  const materials = new Set(casters.filter(m => m.parent === root && m !== flag).map(m => m.material));
  for (const material of materials) {
    const parts = casters.filter(m => m.parent === root && m !== flag && m.material === material);
    if (parts.length < 2) continue;
    const merged = Mesh.MergeMeshes(parts, true, true);
    if (merged) {
      merged.parent = root;
      merged.receiveShadows = true;
      merged.isPickable = false;
      for (const part of parts) { const index = casters.indexOf(part); if (index >= 0) casters.splice(index, 1); }
      casters.push(merged);
    }
  }
  return {
    update(state) {
      for (const engine of engines) engine.rotation.y = -state.steering * .35;
      flag.rotation.y = Math.sin(state.elapsedTime * 5) * .22 + .3;
      flag.rotation.z = Math.sin(state.elapsedTime * 3.6) * .08;
    },
  };
}
