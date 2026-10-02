import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";

type AviationPaint = Record<"gray" | "light" | "dark" | "radar" | "glass" | "white" | "orange", PBRMaterial>;
type CabinStation = [z: number, width: number, bottom: number, shoulder: number, roof: number];

/** Parked maritime Seahawk, with the Indian Navy references guiding its silhouette.
 * Coordinates are metres; the nose points toward +Z. All parts remain static
 * children of the ship so its existing material batching can merge the aircraft.
 */
export function addParkedSeahawk(scene: Scene, root: Mesh, casters: Mesh[], paints: AviationPaint,
  deckHeight: (z: number) => number): void {
  const { gray, dark, white, orange } = paints;
  const hx = .25, hz = -62.7, hy = deckHeight(hz) + .02;
  const makePaint = (source: PBRMaterial, name: string, color: string, roughness = .78, metallic = .08) => {
    const material = source.clone(name)!;
    material.albedoTexture = null; material.bumpTexture = null;
    material.albedoColor = Color3.FromHexString(color);
    material.roughness = roughness; material.metallic = metallic;
    return material;
  };
  const airframe = makePaint(gray, "Seahawk-airframe-paint", "#a1aeb5");
  const trim = makePaint(gray, "Seahawk-light-metal-and-intake-lips", "#b7c2c8", .71, .16);
  const panel = makePaint(gray, "Seahawk-panel-and-sensor-paint", "#7e909c", .82);
  const glazing = makePaint(paints.glass, "Seahawk-smoked-cockpit-glass", "#294553", .15, .28);
  const tire = makePaint(dark, "Seahawk-rubber-and-open-intakes", "#182025", .93, .01);
  const bladePaint = makePaint(dark, "Seahawk-rotor-blade-paint", "#3d4b53", .82, .12);
  const deckY = (z: number) => deckHeight(hz + z) - hy + .022;
  const register = (mesh: Mesh, material = airframe) => {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = true; casters.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = airframe) => {
    const mesh = register(CreateBox(name, { width: w, height: h, depth: d }, scene), material);
    mesh.position.set(hx + x, hy + y, hz + z); return mesh;
  };
  const cylinder = (name: string, diameter: number, height: number, x: number, y: number, z: number,
    material = airframe, top = diameter, sides = 16) => {
    const mesh = register(CreateCylinder(name, { diameterBottom: diameter, diameterTop: top, height, tessellation: sides }, scene), material);
    mesh.position.set(hx + x, hy + y, hz + z); return mesh;
  };
  const sphere = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, material = airframe) => {
    const mesh = register(CreateSphere(name, { diameter: 1, segments: 12 }, scene), material);
    mesh.position.set(hx + x, hy + y, hz + z); mesh.scaling.set(sx, sy, sz); return mesh;
  };
  const tube = (name: string, path: number[][], radius: number, material = panel, cap = Mesh.CAP_ALL, sides = 6) => register(CreateTube(name, {
    path: path.map(([x, y, z]) => new Vector3(hx + x, hy + y, hz + z)), radius, tessellation: sides, cap,
  }, scene), material);
  const torus = (name: string, diameter: number, thickness: number, x: number, y: number, z: number, material = trim) => {
    const mesh = register(CreateTorus(name, { diameter, thickness, tessellation: 24 }, scene), material);
    mesh.position.set(hx + x, hy + y, hz + z); return mesh;
  };
  const surface = (name: string, positions: number[], outwardTriangles: number[], material = airframe, uvs?: number[]) => {
    // Inputs use conventional outward winding. Babylon's left-handed normal
    // calculation needs the reverse; never mutate the caller's topology.
    const indices = outwardTriangles.flatMap((v, i) => i % 3 === 0 ? [v, outwardTriangles[i + 2], outwardTriangles[i + 1]] : []);
    const data = new VertexData(); const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.positions = positions; data.indices = indices; data.normals = normals;
    data.uvs = uvs ?? positions.flatMap((_, i) => i % 3 === 0 ? [positions[i] / 3 + .5, positions[i + 2] / 16 + .5] : []);
    const mesh = register(new Mesh(name, scene), material); data.applyToMesh(mesh);
    mesh.position.set(hx, hy, hz); return mesh;
  };
  const loft = (name: string, stations: CabinStation[], material = airframe) => {
    const positions: number[] = [], indices: number[] = [];
    for (const [z, width, bottom, shoulder, roof] of stations) {
      // Flat cabin sides, a rounded lower sill and a narrower roof give the
      // H-60's characteristic cabin without hiding its glass in an ellipsoid.
      const upperSide = shoulder + (roof - shoulder) * .62, lowerSide = bottom + (shoulder - bottom) * .25;
      for (const [x, y] of [[width, shoulder], [width, upperSide], [width * .68, roof], [0, roof + .015],
        [-width * .68, roof], [-width, upperSide], [-width, shoulder], [-width * .88, lowerSide],
        [-width * .47, bottom], [0, bottom - .015], [width * .47, bottom], [width * .88, lowerSide]]) {
        positions.push(x, y, z);
      }
    }
    for (let r = 0; r < stations.length - 1; r++) for (let i = 0; i < 12; i++) {
      const a = r * 12 + i, b = r * 12 + (i + 1) % 12;
      indices.push(a, b, a + 12, b, b + 12, a + 12);
    }
    for (let i = 1; i < 11; i++) {
      indices.push(0, i + 1, i);
      const a = (stations.length - 1) * 12; indices.push(a, a + i, a + i + 1);
    }
    return surface(name, positions, indices, material);
  };

  const cabinStations: CabinStation[] = [[-3.55, .38, 1.20, 1.89, 2.43], [-2.85, .97, .99, 1.87, 2.76],
    [-1.80, 1.23, .90, 1.90, 2.89], [.90, 1.25, .94, 1.90, 2.88], [1.30, 1.24, .99, 1.89, 2.84]];
  loft("Seahawk-shaped-cabin-and-nose", cabinStations);
  // This shell stops below the cockpit sill. The proud faceted glass enclosure
  // prevents the old opaque fuselage from poking through the cockpit panes.
  loft("Seahawk-rounded-lower-nose", [[1.26, 1.23, 1.00, 1.54, 1.98], [2.55, 1.12, 1.01, 1.55, 2.01],
    [3.57, .94, 1.10, 1.55, 1.92], [4.18, .65, 1.23, 1.56, 1.79], [4.42, .25, 1.36, 1.56, 1.68]]);
  surface("Seahawk-cockpit-roof", [-1.045, 2.91, 1.08, 1.045, 2.91, 1.08, .87, 2.84, 2.65, -.87, 2.84, 2.65], [0, 2, 1, 0, 3, 2]);
  sphere("Seahawk-belly-radar", 0, 1.00, 2.86, 1.12, .58, 1.36, panel);
  sphere("Seahawk-nose-radome", .02, 1.70, 4.19, .97, .63, .91, panel);
  sphere("Seahawk-nose-sensor-turret", -.52, 1.11, 3.69, .52, .55, .56, trim);
  sphere("Seahawk-sensor-lens", -.53, 1.13, 3.959, .22, .23, .055, glazing);
  box("Seahawk-chin-equipment-housing", .48, .36, .35, .57, 1.32, 4.08, airframe);
  box("Seahawk-chin-equipment-face", .30, .25, .028, .57, 1.32, 4.268, panel);
  tube("Seahawk-nose-antenna", [[0, 1.75, 4.51], [0, 2.08, 4.57]], .018, panel);

  for (const side of [-1, 1]) {
    const outward = side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    surface("Seahawk-cockpit-side-shell", [side * 1.272, 1.91, 1.25, side * 1.023, 1.95, 3.51,
      side * .875, 2.835, 2.645, side * 1.043, 2.905, 1.105], outward);
    surface("Seahawk-pilot-side-glazing", [side * 1.281, 2.035, 1.345, side * 1.122, 2.055, 2.755,
      side * .957, 2.773, 2.433, side * 1.076, 2.801, 1.295], outward, glazing);
    surface("Seahawk-pilot-quarter-glazing", [side * 1.120, 2.054, 2.88, side * 1.045, 2.058, 3.34,
      side * .930, 2.724, 2.699, side * .953, 2.771, 2.550], outward, glazing);
    surface("Seahawk-forward-windscreen", [side * .058, 2.056, 3.588, side * 1.015, 2.043, 3.547,
      side * .864, 2.815, 2.705, side * .058, 2.861, 2.758],
      side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2], glazing);
    tube("Seahawk-cockpit-frame", [[side * .059, 2.057, 3.604], [side * 1.032, 2.044, 3.566],
      [side * .881, 2.838, 2.699], [side * .059, 2.884, 2.757], [side * .059, 2.057, 3.604]], .036, trim);
    tube("Seahawk-pilot-window-frame", [[side * 1.287, 2.035, 1.325], [side * 1.130, 2.055, 2.779],
      [side * .960, 2.800, 2.453], [side * 1.080, 2.828, 1.287], [side * 1.287, 2.035, 1.325]], .031, trim);
    tube("Seahawk-pilot-quarter-frame", [[side * 1.130, 2.053, 2.830], [side * .935, 2.798, 2.546]], .036, trim);
    tube("Seahawk-windscreen-wiper", [[side * .27, 2.097, 3.562], [side * .67, 2.571, 3.055]], .018, tire);
    tube("Seahawk-pilot-door-seam", [[side * 1.276, 1.225, 1.253], [side * 1.277, 1.910, 1.253]], .013, panel);
    box("Seahawk-pilot-door-handle", .070, .065, .21, side * 1.29, 1.72, 1.50, panel);

    // Thin door skin and an inset window preserve a unified cabin surface.
    box("Seahawk-sliding-door-seal", .024, 1.49, 2.36, side * 1.263, 1.826, -.46, panel);
    box("Seahawk-sliding-cabin-door", .028, 1.43, 2.30, side * 1.281, 1.826, -.46, airframe);
    box("Seahawk-cabin-door-window-frame", .028, .77, .91, side * 1.304, 2.185, -.58, panel);
    box("Seahawk-cabin-door-window", .031, .68, .81, side * 1.324, 2.19, -.58, glazing);
    tube("Seahawk-door-track", [[side * 1.270, 2.586, -1.79], [side * 1.270, 2.586, .80]], .018, trim);
    box("Seahawk-door-handle", .058, .07, .23, side * 1.312, 1.69, .25, panel);
    tube("Seahawk-boarding-step", [[side * 1.09, 1.02, -.72], [side * 1.46, .88, -.72],
      [side * 1.46, .88, -.05], [side * 1.09, 1.02, -.05]], .038, panel);
    sphere("Seahawk-cabin-side-fairing", side * 1.24, 2.15, -1.87, .35, .49, .78, airframe);
    box("Seahawk-aft-side-vent-frame", .030, .38, .39, side * 1.182, 1.93, -2.30, trim);
    box("Seahawk-aft-side-vent", .032, .27, .27, side * 1.204, 1.93, -2.30, tire);
    for (let i = 0; i < 4; i++) box("Seahawk-side-vent-slat", .035, .016, .29, side * 1.223, 1.83 + i * .067, -2.30, panel);

    // Open engine cowls and torus lips leave real dark intake mouths visible.
    const enginePositions: number[] = [], engineIndices: number[] = [];
    const engineRings = [[-2.13, .37, .36], [-1.75, .46, .43], [-.25, .44, .44], [.96, .42, .40], [1.35, .385, .355]];
    for (const [z, width, height] of engineRings) for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      enginePositions.push(side * .72 + Math.cos(a) * width, 3.19 + Math.sin(a) * height, z);
    }
    for (let r = 0; r < engineRings.length - 1; r++) for (let i = 0; i < 16; i++) {
      const a = r * 16 + i, b = r * 16 + (i + 1) % 16;
      engineIndices.push(a, b, a + 16, b, b + 16, a + 16);
    }
    surface("Seahawk-turboshaft-nacelle", enginePositions, engineIndices);
    tube("Seahawk-engine-inlet", [[side * .72, 3.19, 1.355], [side * .72, 3.19, .87]], .326, tire, Mesh.NO_CAP, 16);
    const inletBack = cylinder("Seahawk-engine-inlet-shadow", .65, .022, side * .72, 3.19, .87, tire); inletBack.rotation.x = Math.PI / 2;
    const intakeLip = torus("Seahawk-engine-intake-rim", .71, .105, side * .72, 3.19, 1.37); intakeLip.rotation.x = Math.PI / 2;
    sphere("Seahawk-intake-center", side * .72, 3.19, .99, .18, .18, .27, panel);
    tube("Seahawk-exhaust-outlet", [[side * .72, 3.19, -1.93], [side * .72, 3.19, -2.27]], .313, tire, Mesh.NO_CAP, 16);
    const exhaustLip = torus("Seahawk-exhaust-metal-lip", .665, .060, side * .72, 3.19, -2.21, panel); exhaustLip.rotation.x = Math.PI / 2;
    const exhaustBack = cylinder("Seahawk-exhaust-shadow", .62, .02, side * .72, 3.19, -1.96, tire); exhaustBack.rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) box("Seahawk-engine-cooling-louver", .018, .064, .16, side * 1.16, 3.27, -.32 + i * .18, tire);

    const wheelZ = 1.02, wheelY = deckY(wheelZ) + .36;
    tube("Seahawk-main-gear-strut", [[side * .97, 1.30, .94], [side * 1.49, wheelY + .08, wheelZ]], .082, trim);
    tube("Seahawk-main-gear-brace", [[side * 1.04, 1.24, .50], [side * 1.49, wheelY + .08, wheelZ]], .050, panel);
    sphere("Seahawk-main-gear-fairing", side * 1.06, 1.15, .98, .52, .32, .68, airframe);
    const wheel = cylinder("Seahawk-main-wheel", .72, .25, side * 1.50, wheelY, wheelZ, tire, .72, 20); wheel.rotation.z = Math.PI / 2;
    const hub = cylinder("Seahawk-wheel-hub", .30, .27, side * 1.50, wheelY, wheelZ, trim); hub.rotation.z = Math.PI / 2;
    const cap = cylinder("Seahawk-wheel-hub-center", .15, .281, side * 1.50, wheelY, wheelZ, panel); cap.rotation.z = Math.PI / 2;
    for (const offset of [-.44, .44]) box("Seahawk-wheel-chock", .44, .13, .16, side * 1.50, deckY(wheelZ + offset) + .065, wheelZ + offset, orange);
    for (const [gearX, gearY, gearZ, anchorX, anchorZ] of [[side * 1.39, wheelY + .16, 1.02, side * 4.5 - hx, -61 - hz],
      [side * .65, 1.06, -2.43, side * 2.25 - hx, -66.4 - hz]]) {
      tube("Seahawk-securing-chain", [[gearX, gearY, gearZ], [anchorX, deckY(anchorZ), anchorZ]], .012, tire);
    }

    // Matched submarine-hunting stores on two short side pylons. These are
    // visual scenery only; no weapon behavior is attached to the aircraft.
    box("Seahawk-store-pylon", .86, .12, .70, side * 1.48, 1.68, -.52, airframe);
    box("Seahawk-store-suspension", .15, .32, .42, side * 1.88, 1.50, -.52, panel);
    const store = cylinder("Seahawk-submarine-hunting-store-body", .34, 2.60, side * 1.88, 1.26, -.45, trim); store.rotation.x = Math.PI / 2;
    sphere("Seahawk-submarine-hunting-store-nose", side * 1.88, 1.26, .87, .34, .34, .45, panel);
    const tail = cylinder("Seahawk-submarine-hunting-store-tail", .29, .30, side * 1.88, 1.26, -1.90, panel, .22); tail.rotation.x = Math.PI / 2;
    box("Seahawk-store-horizontal-tail-fins", .61, .026, .47, side * 1.88, 1.26, -1.77, panel);
    box("Seahawk-store-vertical-tail-fins", .026, .61, .47, side * 1.88, 1.26, -1.77, panel);
    for (const z of [-1.18, .43]) {
      const band = cylinder("Seahawk-store-identification-band", .346, .045, side * 1.88, 1.26, z, airframe); band.rotation.x = Math.PI / 2;
    }
  }

  loft("Seahawk-tapered-tail-boom", [[-10.29, .13, 2.57, 2.79, 3.03], [-8.45, .20, 2.15, 2.39, 2.74],
    [-5.85, .34, 1.76, 2.10, 2.56], [-3.22, .54, 1.28, 1.92, 2.61]]);
  const finOutline = [[2.46, -9.55], [2.65, -10.68], [4.28, -11.25], [4.44, -10.78]];
  const finPositions: number[] = [], finIndices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6];
  for (const x of [.105, -.105]) for (const [y, z] of finOutline) finPositions.push(x, y, z);
  for (let i = 0; i < 4; i++) { const k = (i + 1) % 4; finIndices.push(i, k, i + 4, k, k + 4, i + 4); }
  surface("Seahawk-swept-tail-fin", finPositions, finIndices);
  tube("Seahawk-tail-fin-leading-edge", [[0, 2.48, -9.54], [0, 4.44, -10.78]], .032, trim);
  const stab = [-1.62, 2.24, -8.39, 1.62, 2.24, -8.39, 1.48, 2.24, -9.31, -1.48, 2.24, -9.31,
    -1.62, 2.32, -8.39, 1.62, 2.32, -8.39, 1.48, 2.32, -9.31, -1.48, 2.32, -9.31];
  surface("Seahawk-horizontal-stabilator", stab, [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6, 3, 0, 7, 0, 4, 7]);

  const tailWheelZ = -4.20, tailWheelY = deckY(tailWheelZ) + .24;
  tube("Seahawk-tail-wheel-strut", [[0, 1.53, -3.60], [0, tailWheelY + .075, tailWheelZ]], .065, trim);
  tube("Seahawk-tail-wheel-brace", [[0, 1.26, -3.09], [0, tailWheelY + .12, tailWheelZ]], .038, panel);
  const tailWheel = cylinder("Seahawk-tail-wheel", .48, .19, 0, tailWheelY, tailWheelZ, tire, .48, 20); tailWheel.rotation.z = Math.PI / 2;
  const tailWheelHub = cylinder("Seahawk-tail-wheel-hub", .20, .205, 0, tailWheelY, tailWheelZ, trim); tailWheelHub.rotation.z = Math.PI / 2;

  const tailCenter = new Vector3(.22, 3.86, -10.78), tailAxis = new Vector3(1, .27, 0).normalize();
  const tailUp = new Vector3(-tailAxis.y, tailAxis.x, 0), tailForward = Vector3.Forward();
  const tailHub = cylinder("Seahawk-tail-rotor-hub", .29, .46, tailCenter.x, tailCenter.y, tailCenter.z, panel);
  tailHub.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), tailAxis, new Quaternion());
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + .34;
    const direction = tailUp.scale(Math.cos(a)).add(tailForward.scale(Math.sin(a)));
    const tangent = Vector3.Cross(tailAxis, direction), center = tailCenter.add(tailAxis.scale(.31)).add(direction.scale(.94));
    const orientation = Quaternion.RotationQuaternionFromAxis(tailAxis, direction, tangent);
    const blade = box("Seahawk-tail-rotor-blade", .050, 1.37, .19, center.x, center.y, center.z, bladePaint); blade.rotationQuaternion = orientation;
    const tipCenter = tailCenter.add(tailAxis.scale(.31)).add(direction.scale(1.52));
    const tip = box("Seahawk-tail-blade-tip", .054, .18, .20, tipCenter.x, tipCenter.y, tipCenter.z, trim); tip.rotationQuaternion = orientation;
    tube("Seahawk-tail-rotor-spider", [[tailCenter.x, tailCenter.y, tailCenter.z],
      [tailCenter.x + tailAxis.x * .31 + direction.x * .36, tailCenter.y + tailAxis.y * .31 + direction.y * .36, tailCenter.z + direction.z * .36]], .035, trim);
  }

  sphere("Seahawk-rotor-transmission-fairing", 0, 3.42, -.23, 1.25, .58, 1.60, airframe);
  cylinder("Seahawk-rotor-transmission", .70, .58, 0, 3.73, -.10, panel);
  cylinder("Seahawk-main-rotor-mast", .23, 1.00, 0, 4.06, -.10, trim);
  cylinder("Seahawk-main-rotor-swashplate", .73, .10, 0, 4.08, -.10, panel);
  torus("Seahawk-main-rotor-bearing", .56, .060, 0, 4.30, -.10, trim);
  cylinder("Seahawk-four-blade-rotor-hub", .82, .18, 0, 4.56, -.10, panel);
  cylinder("Seahawk-main-rotor-hub-cap", .35, .10, 0, 4.71, -.10, trim);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + .38, radial = new Vector3(Math.sin(a), 0, Math.cos(a));
    const tangent = new Vector3(radial.z, 0, -radial.x), bladePositions: number[] = [];
    for (const y of [0, .045]) for (const [r, c] of [[.76, -.19], [.76, .19], [7.78, .16], [8.20, -.035], [8.20, -.28]]) {
      bladePositions.push(radial.x * r + tangent.x * c, 4.635 + y - r * .012, radial.z * r + tangent.z * c - .10);
    }
    // Both faces and the rim point outward; the old top was wound inward.
    const bladeIndices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 5, 7, 6, 5, 8, 7, 5, 9, 8];
    for (let j = 0; j < 5; j++) { const k = (j + 1) % 5; bladeIndices.push(j, j + 5, k, k, j + 5, k + 5); }
    surface("Seahawk-extended-main-rotor-blade", bladePositions, bladeIndices, bladePaint);
    tube("Seahawk-rotor-blade-grip", [[radial.x * .26, 4.56, radial.z * .26 - .10],
      [radial.x * .66, 4.62, radial.z * .66 - .10], [radial.x * 1.05, 4.62, radial.z * 1.05 - .10]], .060, trim);
    tube("Seahawk-rotor-pitch-link", [[radial.x * .29 + tangent.x * .15, 4.08, radial.z * .29 + tangent.z * .15 - .10],
      [radial.x * .66 + tangent.x * .15, 4.59, radial.z * .66 + tangent.z * .15 - .10]], .030, trim);
    tube("Seahawk-rotor-damper", [[radial.x * .25 - tangent.x * .22, 4.56, radial.z * .25 - tangent.z * .22 - .10],
      [radial.x * .88 - tangent.x * .18, 4.615, radial.z * .88 - tangent.z * .18 - .10]], .045, panel);
    const tip = box("Seahawk-main-blade-tip-stripe", .33, .010, .18, radial.x * 7.91, 4.686 - 7.91 * .012, radial.z * 7.91 - .10, trim); tip.rotation.y = a;
  }

  tube("Seahawk-rescue-hoist-arm", [[1.06, 2.96, 1.14], [1.67, 3.13, 1.12], [1.79, 3.02, .79]], .064, trim);
  const hoist = cylinder("Seahawk-hoist-drum", .25, .31, 1.73, 2.96, .82, panel); hoist.rotation.z = Math.PI / 2;
  for (const [x, z, y] of [[-.41, -2.68, 2.60], [.35, -6.75, 2.40]]) tube("Seahawk-aerial", [[x, y, z], [x, y + .50, z - .07]], .015, tire);
  sphere("Seahawk-tail-navigation-light", 0, 4.445, -10.80, .10, .10, .13, orange);

  const markings = new DynamicTexture("Seahawk-Indian-Navy-roundel-and-serial", { width: 256, height: 384 }, scene, true);
  markings.hasAlpha = true;
  const ctx = markings.getContext() as CanvasRenderingContext2D; ctx.clearRect(0, 0, 256, 384);
  for (const [radius, color] of [[98, "#e97236"], [68, "#edf1e9"], [38, "#248b72"]] as const) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(128, 124, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#6e818b"; ctx.font = "48px sans-serif"; ctx.textAlign = "center"; ctx.fillText("IN751", 128, 308); markings.update();
  const stencil = makePaint(white, "Seahawk-Indian-Navy-markings", "#ffffff", .89, .01);
  stencil.albedoTexture = markings; stencil.useAlphaFromAlbedoTexture = true;
  stencil.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; stencil.alphaCutOff = .3;
  const cabinSide = (z: number) => {
    for (let i = 0; i < cabinStations.length - 1; i++) {
      const a = cabinStations[i], b = cabinStations[i + 1];
      if (z >= a[0] && z <= b[0]) return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]) + .035;
    }
    return 1.26;
  };
  for (const side of [-1, 1]) {
    const back = -2.71, front = -2.11, bottom = 1.27, top = 2.17;
    const positions = [side * cabinSide(back), bottom, back, side * cabinSide(front), bottom, front,
      side * cabinSide(front), top, front, side * cabinSide(back), top, back];
    surface("Seahawk-Indian-Navy-roundel", positions, side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3], stencil,
      side > 0 ? [1, 0, 0, 0, 0, 1, 1, 1] : [0, 0, 1, 0, 1, 1, 0, 1]);
  }
}
