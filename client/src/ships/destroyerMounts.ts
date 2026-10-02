import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

export interface DeckhouseLayout {
  readonly width: number; readonly depth: number; readonly height: number;
  readonly chamfer: number; readonly inset: number; readonly y: number; readonly z: number;
}
export interface MountSurface { readonly point: Vector3; readonly normal: Vector3; }

// The structure and its fittings use the same dimensions and sloping surfaces.
export const DESTROYER_HOUSES = {
  forward: {width:15.4,depth:39,height:7.6,chamfer:3.5,inset:.65,y:5,z:16},
  aegis: {width:13.9,depth:17,height:7.1,chamfer:4.1,inset:.9,y:12.6,z:25},
  hangar: {width:14.8,depth:23,height:6.9,chamfer:1.4,inset:.4,y:4.7,z:-35},
  aft: {width:12.8,depth:15,height:5.9,chamfer:2.3,inset:.6,y:4.7,z:-17.5},
  pilothouse: {width:13.7,depth:6,height:3.4,chamfer:0,inset:.55,y:18.2,z:29},
} satisfies Record<string, DeckhouseLayout>;
export const MAST_FOOT_Y = DESTROYER_HOUSES.aegis.y + DESTROYER_HOUSES.aegis.height;
export const HANGAR_ROOF_Y = 11.85;
export const BOAT_DECK_Y = 5.31;

export function roofHeight(house: DeckhouseLayout): number { return house.y + house.height; }

/** Point on a side/chamfer, including the inward rake at this height. */
export function sideSurface(house: DeckhouseLayout, side: number, y: number, z: number): MountSurface {
  const inset = house.inset * (y - house.y) / house.height;
  const dz = z - house.z, w = house.width / 2 - inset, d = house.depth / 2 - inset;
  const corner = Math.abs(dz) > d - house.chamfer;
  return {point: new Vector3(side * (corner ? w + d - house.chamfer - Math.abs(dz) : w), y, z),
    normal: new Vector3(side, house.inset / house.height * (corner ? 2 : 1), corner ? Math.sign(dz) : 0).normalize()};
}

/** Fit a box's thin local X axis to a surface; its back slightly overlaps it. */
export function seatSurfaceBox(mesh: Mesh, surface: MountSurface, thickness: number, offset = 0): Mesh {
  const up = Vector3.Up().subtract(surface.normal.scale(surface.normal.y)).normalize();
  const along = Vector3.Cross(surface.normal, up).normalize();
  mesh.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(surface.normal, up, along);
  mesh.position.copyFrom(surface.point.add(surface.normal.scale(thickness / 2 - .015 + offset)));
  return mesh;
}

/** Cylinder axis is local Y, so both the array frame and face share this normal. */
export function seatSurfaceCylinder(mesh: Mesh, surface: MountSurface, thickness: number, offset = 0): Mesh {
  const tangent = new Vector3(surface.normal.z, 0, -surface.normal.x).normalize();
  mesh.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(tangent, surface.normal, Vector3.Cross(tangent, surface.normal).normalize());
  mesh.position.copyFrom(surface.point.add(surface.normal.scale(thickness / 2 - .015 + offset)));
  return mesh;
}
