import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

type Point = readonly [number, number, number];
type FeatureRange = {
  name: string; vertexStart: number; vertexCount: number; indexStart: number; indexCount: number;
};
type BeregModel = { meshes: Mesh[]; shadowCasters: Mesh[] };
const scenePrototypes = new WeakMap<Scene, BeregModel>();

/** Static A-222 scenery, visually based on public photographs of a MAZ-543M
 * gun vehicle. The wheels and deployed feet rest at local y=0. The cab and
 * fixed, slightly elevated barrel point along +z before the heading rotation.
 * Subsequent vehicles share the first vehicle's merged geometry and materials. */
export function createBereg(
  scene: Scene, root: TransformNode, x: number, y: number, z: number, heading: number, id: string,
): BeregModel {
  const placement = new TransformNode(`bereg-${id}-placement`, scene);
  placement.parent = root;
  placement.position.set(x, y, z);
  placement.rotation.y = heading;
  placement.metadata = { facility: "bereg", beregId: id, heading, visualOnly: true };
  const cached = scenePrototypes.get(scene);
  if (cached && cached.meshes.every(mesh => !mesh.isDisposed())) {
    const meshes = cached.meshes.map(source => {
      const mesh = source.clone(`bereg-${id}-${source.material!.name}-batch`, placement, true)!;
      mesh.metadata = { ...source.metadata, beregId: id, heading };
      mesh.isPickable = false;
      return mesh;
    });
    return { meshes, shadowCasters: meshes.filter(mesh => mesh.receiveShadows) };
  }

  const parts: Mesh[] = [];
  const material = (name: string, roughness: number, metallic: number) => {
    const paint = new PBRMaterial(`bereg-${name}`, scene);
    paint.albedoColor = Color3.White();
    paint.roughness = roughness;
    paint.metallic = metallic;
    paint.environmentIntensity = .55;
    return paint;
  };
  const olive = material("weathered-olive", .89, .03);
  const steel = material("steel-fittings", .73, .22);
  const rubber = material("rubber", .96, 0);
  const glass = material("glazing", .25, .3);
  const lamps = material("lamp-lenses", .35, .03);
  const wire = material("fine-antenna", .82, .1);
  lamps.emissiveColor.set(.012, .011, .007);
  const colors = {
    olive: "#60694a", panel: "#566044", light: "#74805b", edge: "#46513a",
    steel: "#454d45", rubber: "#252923", glass: "#233d45", lamp: "#dfd8b6",
    red: "#8c3c2e", amber: "#b28740", scuff: "#817b59",
  };
  const finish = (mesh: Mesh, paint: PBRMaterial, tint: string) => {
    mesh.material = paint;
    mesh.isPickable = false;
    mesh.receiveShadows = paint !== wire;
    mesh.checkCollisions = paint !== wire;
    const base = Color3.FromHexString(tint).toLinearSpace();
    const positions = mesh.getVerticesData("position")!;
    const vertexColors = new Float32Array(mesh.getTotalVertices() * 4);
    for (let vertex = 0; vertex < mesh.getTotalVertices(); vertex++) {
      const offset = vertex * 3;
      const grain = .98 + .02 * Math.sin(positions[offset] * 7.7
        + positions[offset + 1] * 11.4 + positions[offset + 2] * 5.9);
      vertexColors.set([base.r * grain, base.g * grain, base.b * grain, 1], vertex * 4);
    }
    mesh.setVerticesData("color", vertexColors);
    if (!mesh.isVerticesDataPresent("uv")) mesh.setVerticesData("uv", new Float32Array(mesh.getTotalVertices() * 2));
    mesh.useVertexColors = true;
    parts.push(mesh);
    return mesh;
  };
  const box = (name: string, dimensions: Point, position: Point, paint = olive, tint = colors.olive) => {
    const mesh = CreateBox(`bereg-${name}`, { width: dimensions[0], height: dimensions[1], depth: dimensions[2] }, scene);
    mesh.position.set(...position);
    return finish(mesh, paint, tint);
  };
  const cylinder = (name: string, diameter: number, height: number, position: Point,
    paint = steel, tint = colors.steel, segments = 6, diameterTop = diameter) => {
    const mesh = CreateCylinder(`bereg-${name}`, { diameter, diameterTop, height, tessellation: segments }, scene);
    mesh.position.set(...position);
    return finish(mesh, paint, tint);
  };
  const beam = (name: string, a: Point, b: Point, thickness: number,
    paint = steel, tint = colors.steel, segments = 4) => {
    const direction = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const mesh = CreateCylinder(`bereg-${name}`, { diameter: thickness, height: direction.length(), tessellation: segments }, scene);
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    mesh.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), mesh.rotationQuaternion);
    return finish(mesh, paint, tint);
  };
  const geometry = (name: string, positions: number[], indices: number[], paint = olive, tint = colors.olive) => {
    const mesh = new Mesh(`bereg-${name}`, scene);
    const data = new VertexData();
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(mesh);
    return finish(mesh, paint, tint);
  };
  const addFace = (positions: number[], indices: number[], points: readonly Point[], outward: Point) => {
    // Babylon's default left-handed normal convention reverses the usual
    // right-handed cross product. Keep winding explicit for every broad face.
    const a = Vector3.FromArray(points[0]), b = Vector3.FromArray(points[1]), c = Vector3.FromArray(points[2]);
    const normal = Vector3.Cross(a.subtract(b), c.subtract(b));
    const ordered = Vector3.Dot(normal, Vector3.FromArray(outward)) < 0 ? [...points].reverse() : points;
    const start = positions.length / 3;
    positions.push(...ordered.flatMap(point => [...point]));
    for (let index = 1; index < ordered.length - 1; index++) indices.push(start, start + index, start + index + 1);
  };
  const panel = (name: string, points: readonly Point[], outward: Point, paint: PBRMaterial, tint: string) => {
    const positions: number[] = [], indices: number[] = [];
    addFace(positions, indices, points, outward);
    return geometry(name, positions, indices, paint, tint);
  };
  const extrudeAcross = (name: string, profile: readonly (readonly [number, number])[],
    left: number, right: number, paint = olive, tint = colors.olive) => {
    const positions: number[] = [], indices: number[] = [];
    addFace(positions, indices, profile.map(([height, along]) => [left, height, along] as const), [-1, 0, 0]);
    addFace(positions, indices, profile.map(([height, along]) => [right, height, along] as const), [1, 0, 0]);
    const centerY = profile.reduce((sum, p) => sum + p[0], 0) / profile.length;
    const centerZ = profile.reduce((sum, p) => sum + p[1], 0) / profile.length;
    for (let index = 0; index < profile.length; index++) {
      const [ay, az] = profile[index], [by, bz] = profile[(index + 1) % profile.length];
      addFace(positions, indices, [[left, ay, az], [right, ay, az], [right, by, bz], [left, by, bz]],
        [0, (ay + by) / 2 - centerY, (az + bz) / 2 - centerZ]);
    }
    return geometry(name, positions, indices, paint, tint);
  };

  // MAZ's widely spaced axle pairs, low chassis rails and separate wheel arches.
  for (const side of [-1, 1]) box(`chassis-rail-${side}`, [.17, .29, 11.18], [side * .66, 1.09, -.14], steel);
  for (const along of [-5.12, -3.2, -.55, 2.3, 4.6]) box("chassis-crossmember", [1.62, .15, .14], [0, 1.08, along], steel);
  beam("driveshaft", [0, .87, -4.75], [0, .87, 4.15], .12);
  const axlePositions = [-4.66, -2.49, 2.04, 4.04];
  const wheelY = .82;
  for (let axle = 0; axle < axlePositions.length; axle++) {
    const along = axlePositions[axle];
    beam(`axle-${axle + 1}`, [-1.28, wheelY, along], [1.28, wheelY, along], .19);
    const differential = cylinder("axle-differential", .40, .35, [0, wheelY, along]);
    differential.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const across = side * 1.29;
      for (let leaf = 0; leaf < 2; leaf++) box("suspension-leaf", [.12, .045, 1.2 - leaf * .21],
        [side * .85, .92 + leaf * .052, along], steel);
      beam("suspension-damper", [side * .94, .9, along + .32], [side * .97, 1.35, along + .5], .095);
      const profile: readonly (readonly [number, number])[] = [[-.34, .42], [-.32, .62], [-.19, .79], [.19, .79], [.32, .62], [.34, .42]];
      const positions: number[] = [], indices: number[] = [];
      const segments = 14;
      for (const [offset, radius] of profile) for (let segment = 0; segment < segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        positions.push(across + offset, wheelY + Math.cos(angle) * radius, along + Math.sin(angle) * radius);
      }
      for (let ring = 0; ring < profile.length - 1; ring++) for (let segment = 0; segment < segments; segment++) {
        const a = ring * segments + segment, b = ring * segments + (segment + 1) % segments;
        indices.push(a, a + segments, b, b, a + segments, b + segments);
      }
      geometry(`tire-axle-${axle + 1}-${side}`, positions, indices, rubber, colors.rubber);
      for (let tread = 0; tread < 14; tread++) {
        const angle = tread / 14 * Math.PI * 2;
        const block = box("tire-chevron-tread", [.51, .06, .16],
          [across, wheelY + Math.cos(angle) * .777, along + Math.sin(angle) * .777], rubber, "#30352c");
        block.rotation.x = angle;
        block.rotation.y = tread % 2 === 0 ? .21 : -.21;
      }
      const hubX = across + side * .325;
      const rim = cylinder(`wheel-rim-axle-${axle + 1}-${side}`, .9, .09, [hubX, wheelY, along], olive, colors.edge, 10);
      rim.rotation.z = Math.PI / 2;
      const hub = cylinder("wheel-hub", .46, .12, [hubX + side * .06, wheelY, along], steel, colors.steel, 8);
      hub.rotation.z = Math.PI / 2;
      for (let bolt = 0; bolt < 6; bolt++) {
        const angle = bolt / 6 * Math.PI * 2;
        box("wheel-hub-bolt", [.028, .062, .062],
          [hubX + side * .123, wheelY + Math.cos(angle) * .3, along + Math.sin(angle) * .3], steel, "#818971");
      }
      const archPositions: number[] = [], archIndices: number[] = [];
      for (let step = 0; step <= 8; step++) {
        const angle = step / 8 * Math.PI;
        for (const offset of [-.40, .40]) for (const radius of [.88, .95]) {
          archPositions.push(across + offset, wheelY + Math.sin(angle) * radius, along + Math.cos(angle) * radius);
        }
        if (step < 8) {
          const a = step * 4, b = a + 4;
          archIndices.push(a, a + 2, b, a + 2, b + 2, b,
            a + 1, b + 1, a + 3, a + 3, b + 1, b + 3,
            a, b, a + 1, a + 1, b, b + 1,
            a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
        }
      }
      geometry("separate-wheel-mudguard", archPositions, archIndices, olive, colors.edge);
      box("rubber-mudflap", [.70, .4, .045], [across, .72, along - .86], rubber, colors.rubber);
    }
  }

  // A single long left cab is the MAZ-543M's distinctive asymmetric silhouette.
  // The other half of the nose is the lower ribbed engine/grille housing.
  const cabLeft = -1.52, cabRight = -.08;
  extrudeAcross("asymmetric-left-cab", [[1.34, 2.17], [1.34, 5.47], [2.5, 5.47], [3.26, 5.13], [3.26, 2.17]], cabLeft, cabRight);
  extrudeAcross("right-forward-engine-housing", [[1.36, 3.59], [1.36, 5.42], [2.43, 5.42], [2.63, 5.04], [2.63, 3.59]], -.02, 1.51, olive, colors.panel);
  box("front-bumper", [3.24, .27, .23], [0, 1.18, 5.63], steel, "#313c34");
  box("front-grille-recess", [2.75, .82, .045], [.03, 1.91, 5.503], rubber, colors.rubber);
  for (let slat = 0; slat < 24; slat++) box("front-grille-vertical-rib", [.041, .77, .062],
    [-1.28 + slat * .113, 1.91, 5.54], olive, colors.light);
  for (const side of [-1, 1]) {
    const headlamp = cylinder("front-headlamp", .26, .08, [side * 1.40, 1.89, 5.551], lamps, colors.lamp, 12);
    headlamp.rotation.x = Math.PI / 2;
    box("front-indicator", [.115, .10, .073], [side * 1.40, 2.18, 5.553], lamps, colors.amber);
    box("bumper-towing-eye", [.12, .18, .13], [side * .73, 1.14, 5.79], steel);
  }
  panel("front-windscreen-seal", [[-1.44, 2.48, 5.492], [-1.44, 3.18, 5.179], [-.15, 3.18, 5.179], [-.15, 2.48, 5.492]], [0, .3, 1], rubber, colors.rubber);
  panel("front-windscreen-glazing", [[-1.37, 2.54, 5.484], [-1.37, 3.12, 5.224], [-.22, 3.12, 5.224], [-.22, 2.54, 5.484]], [0, .3, 1], glass, colors.glass);
  beam("windscreen-wiper", [-.81, 2.55, 5.515], [-1.20, 2.92, 5.352], .025);
  // Two doors/windows run down the outward cab side, as in the original photos.
  for (const along of [2.98, 4.33]) {
    box("left-cab-door", [.035, 1.52, 1.20], [cabLeft - .013, 2.05, along], olive, colors.panel);
    box("cab-side-window-seal", [.055, .69, 1.03], [cabLeft - .037, 2.79, along], rubber, colors.rubber);
    box("cab-side-window-glazing", [.018, .57, .91], [cabLeft - .073, 2.79, along], glass, colors.glass);
    box("cab-door-handle", [.048, .08, .19], [cabLeft - .058, 2.04, along - .36], steel, "#9aa187");
    for (const height of [1.49, 2.22]) box("cab-door-hinge", [.055, .10, .045], [cabLeft - .058, height, along + .55], steel);
    for (const height of [.69, 1.04]) box("cab-entry-step", [.39, .07, .7], [-1.59, height, along], steel);
    for (const height of [1.40, 1.54]) box("cab-lower-rivet", [.025, .029, .029], [cabLeft - .040, height, along - .42], steel, colors.light);
  }
  panel("cab-forward-corner-window-seal", [[-1.55, 2.55, 4.89], [-1.55, 3.13, 4.89], [-1.55, 3.13, 5.13], [-1.55, 2.55, 5.37]], [-1, 0, 0], rubber, colors.rubber);
  panel("cab-forward-corner-window-glazing", [[-1.56, 2.60, 4.93], [-1.56, 3.08, 4.93], [-1.56, 3.08, 5.09], [-1.56, 2.60, 5.28]], [-1, 0, 0], glass, colors.glass);
  panel("cab-inner-side-glazing", [[-.066, 2.55, 3.33], [-.066, 3.13, 3.33], [-.066, 3.13, 4.93], [-.066, 2.55, 5.18]], [1, 0, 0], glass, colors.glass);
  beam("cab-mirror-arm", [-1.52, 2.89, 5.04], [-1.90, 2.94, 5.09], .04);
  box("cab-mirror-frame", [.10, .34, .20], [-1.91, 2.95, 5.10], rubber, colors.rubber);
  box("cab-mirror-glass", [.014, .28, .14], [-1.968, 2.95, 5.10], glass, "#617476");
  box("cab-roof-hatch", [.78, .065, .61], [-.78, 3.30, 3.08], olive, colors.light);
  for (const along of [3.71, 4.42, 5.09]) beam("nose-panel-handle", [.48, 2.69, along], [.75, 2.69, along], .039);
  box("engine-roof-intake", [1.28, .16, .53], [.73, 2.64, 3.84], rubber, colors.rubber);
  for (let rib = 0; rib < 7; rib++) box("engine-intake-louver", [1.22, .026, .039], [.73, 2.74, 3.61 + rib * .073], olive, colors.edge);

  // Tall front engine service module, side cooling vents and access ladder.
  extrudeAcross("engine-service-module", [[1.67, .88], [1.67, 2.14], [3.50, 2.14], [3.66, 1.86], [3.66, .88]], -1.48, 1.48, olive, colors.panel);
  for (const side of [-1, 1]) {
    box("engine-service-side-hatch", [.055, 1.45, .88], [side * 1.507, 2.55, 1.50], olive, colors.olive);
    box("engine-service-hatch-latch", [.04, .17, .05], [side * 1.55, 2.57, 1.17], steel);
    box("engine-cooling-recess", [.037, .66, .65], [side * 1.505, 2.68, 1.5], rubber, colors.rubber);
    for (let rib = 0; rib < 5; rib++) box("engine-cooling-louver", [.065, .034, .60],
      [side * 1.53, 2.40 + rib * .128, 1.5], olive, colors.edge);
    box("engine-side-toolbox", [.20, .40, .82], [side * 1.10, 1.12, .59], olive, colors.panel);
  }
  for (const across of [-1.39, -.79]) beam("engine-access-ladder-rail", [across, 1.48, .80], [across, 3.56, .80], .045);
  for (let rung = 0; rung < 7; rung++) beam("engine-access-ladder-rung", [-1.39, 1.54 + rung * .29, .79], [-.79, 1.54 + rung * .29, .79], .043);
  for (let rib = 0; rib < 9; rib++) box("engine-front-stiffening-rib", [.055, .60, .06], [-1.31 + rib * .328, 3.21, 2.18], olive, colors.light);
  const spotlight = cylinder("engine-roof-spotlight", .24, .22, [.66, 3.82, 1.54], steel, colors.edge, 10);
  spotlight.rotation.x = Math.PI / 2;
  const spotlightLens = cylinder("engine-spotlight-lens", .19, .025, [.66, 3.82, 1.66], lamps, colors.lamp, 10);
  spotlightLens.rotation.x = Math.PI / 2;

  // The large gun turret has chamfered shoulders, a sloping rear roof and a
  // raised turntable. Flat independent face vertices keep its armor facets crisp.
  cylinder("turret-turntable", 2.86, .26, [0, 1.77, -2.60], steel, colors.edge, 20);
  box("turret-access-deck", [3.22, .14, 6.04], [0, 1.71, -2.84], steel, colors.steel);
  const front: Point[] = [[-1.52, 1.85, -.18], [1.52, 1.85, -.18], [1.52, 3.41, -.18], [1.12, 4.28, -.18], [-1.12, 4.28, -.18], [-1.52, 3.41, -.18]];
  const rear: Point[] = [[-1.52, 1.85, -5.64], [1.52, 1.85, -5.64], [1.52, 3.28, -5.64], [1.08, 3.91, -5.64], [-1.08, 3.91, -5.64], [-1.52, 3.28, -5.64]];
  const turretPositions: number[] = [], turretIndices: number[] = [];
  addFace(turretPositions, turretIndices, front, [0, 0, 1]);
  addFace(turretPositions, turretIndices, rear, [0, 0, -1]);
  for (let edge = 0; edge < front.length; edge++) {
    const next = (edge + 1) % front.length;
    const meanX = (front[edge][0] + front[next][0]) / 2;
    const meanY = (front[edge][1] + front[next][1]) / 2;
    addFace(turretPositions, turretIndices, [front[edge], front[next], rear[next], rear[edge]], [meanX, meanY - 2.85, 0]);
  }
  geometry("angular-rear-turret", turretPositions, turretIndices);
  for (const side of [-1, 1]) {
    box("turret-side-door", [.043, 1.55, 1.11], [side * 1.55, 2.68, -1.08], olive, colors.panel);
    for (const along of [-1.65, -.50]) box("turret-door-seal", [.021, 1.56, .024], [side * 1.58, 2.68, along], rubber, colors.rubber);
    for (const height of [1.92, 3.44]) box("turret-door-seal", [.021, .023, 1.15], [side * 1.58, height, -1.08], rubber, colors.rubber);
    box("turret-door-handle", [.075, .21, .04], [side * 1.60, 2.67, -.75], steel, "#899178");
    box("turret-side-equipment-hatch", [.047, .73, 1.09], [side * 1.552, 2.88, -3.71], olive, colors.panel);
    for (const along of [-4.19, -3.23]) box("turret-hatch-hinge", [.065, .12, .058], [side * 1.59, 2.68, along], steel);
    box("turret-side-cooling-recess", [.025, .27, 1.90], [side * 1.553, 2.05, -3.31], rubber, colors.rubber);
    for (let slot = 0; slot < 13; slot++) box("turret-side-cooling-fin", [.048, .26, .042],
      [side * 1.58, 2.05, -4.16 + slot * .14], olive, colors.light);
    for (const height of [2.47, 2.83, 3.19]) beam("turret-side-access-rung", [side * 1.61, height, -2.34], [side * 1.61, height, -1.85], .048);
    for (const along of [-.56, -2.53, -4.42]) {
      const roofY = 4.22 - (-along - .18) * .068;
      beam("turret-shoulder-handhold", [side * 1.37, roofY - .38, along - .12], [side * 1.37, roofY - .38, along + .12], .045);
    }
    box("turret-bottom-sill", [.083, .17, 5.48], [side * 1.52, 1.94, -2.88], olive, colors.edge);
    for (let chip = 0; chip < 4; chip++) box("turret-sill-paint-scuff", [.014, .024, .16],
      [side * 1.57, 1.98, -4.94 + chip * 1.12], olive, colors.scuff);
    const fuelTank = cylinder("chassis-fuel-tank", .68, 1.3, [side * 1.12, 1.16, -.93], steel, colors.steel, 10);
    fuelTank.rotation.x = Math.PI / 2;
    for (const along of [-1.36, -.53]) box("fuel-tank-retaining-band", [.66, .08, .062], [side * 1.12, 1.47, along], olive, colors.edge);
  }
  box("turret-rear-service-door", [1.24, 1.60, .047], [0, 2.7, -5.68], olive, colors.panel);
  for (const across of [-.65, .65]) box("turret-rear-door-frame", [.025, 1.63, .024], [across, 2.70, -5.72], steel, colors.edge);
  box("turret-rear-door-handle", [.24, .045, .065], [.31, 2.74, -5.74], steel, "#949b83");
  for (const across of [-.65, -.05, .65]) {
    beam("rear-platform-guardrail-post", [across, 1.86, -5.97], [across, 2.49, -5.97], .045);
  }
  beam("rear-platform-guardrail", [-.65, 2.49, -5.97], [.65, 2.49, -5.97], .048);
  box("rear-crew-platform", [1.56, .09, .6], [0, 1.84, -5.88], steel);
  for (const height of [.53, .90, 1.27]) box("rear-access-step", [.76, .065, .34], [0, height, -5.99], steel);
  box("rear-bumper", [2.9, .21, .20], [0, 1.18, -5.86], steel);
  for (const side of [-1, 1]) {
    box("rear-tail-lamp", [.24, .15, .055], [side * 1.14, 1.31, -5.982], lamps, colors.red);
    box("rear-reflector", [.11, .072, .055], [side * .85, 1.32, -5.982], lamps, colors.amber);
  }
  box("turret-roof-hatch", [.80, .063, .70], [-.62, 4.16, -1.76], olive, colors.light);
  cylinder("turret-roof-vent", .28, .13, [.63, 4.20, -1.0], steel, colors.edge, 10);
  box("turret-optical-sight-housing", [.28, .31, .31], [-.70, 4.4, -.53], olive, colors.edge);
  box("turret-optical-sight-glass", [.20, .17, .025], [-.70, 4.42, -.357], glass, colors.glass);
  cylinder("radio-antenna-base", .12, .17, [.84, 4.08, -3.48], steel);
  beam("radio-whip-antenna", [.84, 4.16, -3.48], [.84, 5.54, -3.48], .016, wire, colors.steel, 4);

  // Compact vertical jacks between the wheels of each axle pair follow the
  // deployed archive photographs; the Bereg has no radar-style wide outriggers.
  for (const along of [-3.58, 3.04]) for (const side of [-1, 1]) {
    box("stabilizer-mounting-bracket", [.31, .26, .32], [side * 1.53, 1.47, along], steel);
    cylinder("stabilizer-hydraulic-jack", .24, .99, [side * 1.67, 1.02, along], olive, colors.edge);
    cylinder("stabilizer-exposed-piston", .10, .58, [side * 1.67, .37, along], steel, "#98a28d");
    const footpad = cylinder("stabilizer-footpad", .55, .08, [side * 1.67, .04, along], steel, "#758064", 12);
    footpad.scaling.z = 1.13;
    beam("stabilizer-brace", [side * 1.40, 1.70, along], [side * 1.67, 1.38, along], .069);
  }

  // Barrel components share a seven-degree elevation, including the recessed
  // muzzle. The enlarged faceted collar has the TWO broad side ports visible
  // in the exhibition photographs, rather than a generic perforated tank brake.
  const elevation = 7 * Math.PI / 180;
  const pivot: Point = [0, 3.75, -.06];
  const gunPoint = (along: number, across = 0, height = 0): Point => [across,
    pivot[1] + along * Math.sin(elevation) + height * Math.cos(elevation),
    pivot[2] + along * Math.cos(elevation) - height * Math.sin(elevation)];
  const gunTube = (name: string, diameter: number, start: number, end: number,
    tint: string, diameterEnd = diameter, paint = olive) => {
    const mesh = cylinder(name, diameter, end - start, gunPoint((start + end) / 2), paint, tint, 16, diameterEnd);
    mesh.rotation.x = Math.PI / 2 - elevation;
    return mesh;
  };
  gunTube("gun-mantlet", .85, -.22, .64, colors.panel, .68);
  gunTube("cannon-recoil-sleeve", .46, .34, 2.31, colors.edge, .37);
  gunTube("cannon-barrel", .285, 2.20, 7.51, colors.olive, .215);
  gunTube("cannon-fume-extractor", .40, 4.37, 5.23, colors.panel, .38);
  for (const along of [2.25, 4.4, 5.18, 7.40]) gunTube("cannon-barrel-collar", along > 7 ? .26 : .34,
    along - .035, along + .035, colors.light);
  for (const side of [-1, 1]) beam("gun-recoil-cylinder", gunPoint(.05, side * .31, .26), gunPoint(1.72, side * .31, .26), .15, olive, colors.panel, 10);

  const muzzleStart = 7.46, muzzleEnd = 8.20;
  const muzzlePositions: number[] = [], muzzleIndices: number[] = [];
  const muzzleSection: readonly (readonly [number, number])[] = [[-.23, -.105], [-.13, -.205], [.13, -.205], [.23, -.105], [.23, .105], [.13, .205], [-.13, .205], [-.23, .105]];
  const localGunFace = (points: readonly Point[], outward: Point) => {
    addFace(muzzlePositions, muzzleIndices, points.map(([across, height, along]) => gunPoint(along, across, height)),
      [outward[0], outward[1] * Math.cos(elevation) + outward[2] * Math.sin(elevation),
        outward[2] * Math.cos(elevation) - outward[1] * Math.sin(elevation)]);
  };
  for (let edge = 0; edge < muzzleSection.length; edge++) {
    const next = (edge + 1) % muzzleSection.length;
    const [ax, ay] = muzzleSection[edge], [bx, by] = muzzleSection[next];
    if (edge === 3 || edge === 7) {
      // Genuine openings on the broad vertical sides, separated by narrow webs.
      for (const [start, end] of [[muzzleStart, muzzleStart + .11], [muzzleStart + .29, muzzleStart + .40], [muzzleStart + .59, muzzleEnd]]) {
        localGunFace([[ax, ay, start], [bx, by, start], [bx, by, end], [ax, ay, end]], [ax, 0, 0]);
      }
    } else localGunFace([[ax, ay, muzzleStart], [bx, by, muzzleStart], [bx, by, muzzleEnd], [ax, ay, muzzleEnd]], [(ax + bx) / 2, (ay + by) / 2, 0]);
    const angleA = Math.atan2(ay, ax), angleB = Math.atan2(by, bx);
    const innerA: Point = [Math.cos(angleA) * .072, Math.sin(angleA) * .072, muzzleEnd];
    const innerB: Point = [Math.cos(angleB) * .072, Math.sin(angleB) * .072, muzzleEnd];
    localGunFace([[ax, ay, muzzleEnd], [bx, by, muzzleEnd], innerB, innerA], [0, 0, 1]);
    localGunFace([[ax * .60, ay * .60, muzzleStart], [bx * .60, by * .60, muzzleStart], [bx, by, muzzleStart + .055], [ax, ay, muzzleStart + .055]], [(ax + bx) / 2, (ay + by) / 2, -.2]);
  }
  geometry("two-port-muzzle-collar", muzzlePositions, muzzleIndices, olive, colors.edge);
  const borePositions: number[] = [], boreIndices: number[] = [];
  const boreSegments = 16;
  for (let segment = 0; segment < boreSegments; segment++) {
    const angleA = segment / boreSegments * Math.PI * 2;
    const angleB = (segment + 1) / boreSegments * Math.PI * 2;
    const a: Point = [Math.cos(angleA) * .0715, Math.sin(angleA) * .0715, muzzleStart + .04];
    const b: Point = [Math.cos(angleB) * .0715, Math.sin(angleB) * .0715, muzzleStart + .04];
    addFace(borePositions, boreIndices, [gunPoint(a[2], a[0], a[1]), gunPoint(b[2], b[0], b[1]),
      gunPoint(muzzleEnd, b[0], b[1]), gunPoint(muzzleEnd, a[0], a[1])],
      [-Math.cos((angleA + angleB) / 2), -Math.sin((angleA + angleB) / 2) * Math.cos(elevation), Math.sin((angleA + angleB) / 2) * Math.sin(elevation)]);
  }
  geometry("cannon-muzzle-bore", borePositions, boreIndices, rubber, "#151b16");
  const darkBoreEnd = cylinder("recessed-muzzle-darkness", .14, .016, gunPoint(muzzleStart + .03), rubber, "#101611", 16);
  darkBoreEnd.rotation.x = Math.PI / 2 - elevation;

  // Material batching keeps the hundreds of close-view parts at six draws.
  // All coordinates above are vehicle-local. Parenting the batch only now
  // applies the placement and island translation exactly once.
  const groups = new Map<PBRMaterial, Mesh[]>();
  for (const part of parts) {
    const paint = part.material as PBRMaterial;
    const group = groups.get(paint) ?? [];
    group.push(part);
    groups.set(paint, group);
  }
  const meshes: Mesh[] = [], shadowCasters: Mesh[] = [];
  for (const [paint, group] of groups) {
    let vertexStart = 0, indexStart = 0;
    const featureRanges: FeatureRange[] = group.map(part => {
      const range = { name: part.name, vertexStart, vertexCount: part.getTotalVertices(), indexStart, indexCount: part.getTotalIndices() };
      vertexStart += range.vertexCount;
      indexStart += range.indexCount;
      return range;
    });
    const sourceNames = group.map(part => part.name);
    const merged = Mesh.MergeMeshes(group, true, true)!;
    if (!merged) throw new Error(`Could not merge Bereg ${paint.name}`);
    merged.name = `bereg-${id}-${paint.name}-batch`;
    merged.parent = placement;
    merged.material = paint;
    merged.useVertexColors = true;
    merged.isPickable = false;
    merged.receiveShadows = paint !== wire;
    merged.checkCollisions = paint !== wire;
    merged.metadata = { facility: "bereg", beregId: id, heading, sourceNames, featureRanges, visualOnly: true };
    meshes.push(merged);
    if (paint !== wire) shadowCasters.push(merged);
  }
  const result = { meshes, shadowCasters };
  scenePrototypes.set(scene, result);
  return result;
}
