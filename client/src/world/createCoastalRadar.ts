import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

type Point = readonly [number, number, number];

/** Static scenery inspired by the Monolit-B vehicle in the supplied references.
 * Dimensions are visual approximations; this contains no sensing simulation.
 * Coordinates are relative to the island root, with the cab facing +z. */
export function createCoastalRadar(
  scene: Scene, root: TransformNode, x: number, y: number, z: number,
): { meshes: Mesh[]; shadowCasters: Mesh[] } {
  const parts: Mesh[] = [];
  const material = (name: string, roughness: number, metallic: number) => {
    const paint = new PBRMaterial(`coastal-radar-${name}`, scene);
    paint.albedoColor = Color3.White();
    paint.roughness = roughness;
    paint.metallic = metallic;
    paint.environmentIntensity = .55;
    return paint;
  };
  const olive = material("weathered-olive", .9, .03);
  const steel = material("steel-fittings", .7, .28);
  const rubber = material("rubber", .96, 0);
  const glass = material("glazing", .24, .3);
  const lamps = material("lamp-lenses", .34, .05);
  lamps.emissiveColor = new Color3(.015, .013, .009);
  const wire = material("fine-antenna-wire", .77, .16);
  const colors = {
    olive: "#606b4a", panel: "#586345", light: "#74805b", edge: "#49543c",
    metal: "#444e48", rubber: "#252923", glass: "#223e47", rust: "#71684b",
    white: "#c3c5b1", lamp: "#e6ddbe", amber: "#b9893b", red: "#8b3c30",
  };
  const finish = (mesh: Mesh, paint: PBRMaterial, tint: string, castsShadow = true) => {
    mesh.position.addInPlaceFromFloats(x, y, z);
    mesh.material = paint;
    mesh.isPickable = false;
    mesh.receiveShadows = castsShadow;
    mesh.checkCollisions = castsShadow;
    const base = Color3.FromHexString(tint).toLinearSpace();
    const positions = mesh.getVerticesData("position")!;
    const vertexColors = new Float32Array(mesh.getTotalVertices() * 4);
    for (let vertex = 0; vertex < mesh.getTotalVertices(); vertex++) {
      // Very small deterministic paint variation reads as worn panels without
      // competing with lighting or requiring another texture draw.
      const offset = vertex * 3;
      const grain = .975 + .025 * Math.sin(positions[offset] * 7.2
        + positions[offset + 1] * 9.7 + positions[offset + 2] * 4.3);
      vertexColors.set([base.r * grain, base.g * grain, base.b * grain, 1], vertex * 4);
    }
    mesh.setVerticesData("color", vertexColors);
    if (!mesh.isVerticesDataPresent("uv")) mesh.setVerticesData("uv", new Float32Array(mesh.getTotalVertices() * 2));
    mesh.useVertexColors = true;
    parts.push(mesh);
    return mesh;
  };
  const box = (name: string, dimensions: Point, position: Point, paint = olive, tint = colors.olive) => {
    const mesh = CreateBox(`coastal-radar-${name}`, { width: dimensions[0], height: dimensions[1], depth: dimensions[2] }, scene);
    mesh.position.set(...position);
    return finish(mesh, paint, tint);
  };
  const cylinder = (name: string, diameter: number, height: number, position: Point,
    paint = steel, tint = colors.metal, segments = 10, diameterTop = diameter) => {
    const mesh = CreateCylinder(`coastal-radar-${name}`, { diameter, diameterTop, height, tessellation: segments }, scene);
    mesh.position.set(...position);
    return finish(mesh, paint, tint);
  };
  const beam = (name: string, a: Point, b: Point, thickness: number,
    paint = steel, tint = colors.metal, castsShadow = true) => {
    const direction = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const mesh = CreateCylinder(`coastal-radar-${name}`, {
      diameter: thickness, height: direction.length(), tessellation: castsShadow ? 6 : 4,
    }, scene);
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    mesh.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), mesh.rotationQuaternion);
    return finish(mesh, paint, tint, castsShadow);
  };
  const geometry = (name: string, positions: number[], indices: number[], paint = olive, tint = colors.olive) => {
    const mesh = new Mesh(`coastal-radar-${name}`, scene);
    const data = new VertexData();
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(mesh);
    return finish(mesh, paint, tint);
  };
  const panel = (name: string, points: readonly Point[], paint: PBRMaterial, tint: string) => {
    const indices: number[] = [];
    for (let index = 1; index < points.length - 1; index++) indices.push(0, index, index + 1);
    return geometry(name, points.flatMap(point => [...point]), indices, paint, tint);
  };
  const roundedBox = (name: string, width: number, height: number, depth: number, radius: number,
    bevel: number, position: Point, tint: string) => {
    const positions: number[] = [], indices: number[] = [];
    const segments = 4;
    const count = 4 * (segments + 1);
    const rings = [-depth / 2, -depth / 2 + bevel, depth / 2 - bevel, depth / 2];
    for (let ring = 0; ring < rings.length; ring++) {
      const inset = ring === 0 || ring === rings.length - 1 ? bevel : 0;
      const halfWidth = width / 2 - inset, halfHeight = height / 2 - inset;
      const cornerRadius = Math.max(radius - inset, .025);
      for (let corner = 0; corner < 4; corner++) {
        const centerX = (corner === 0 || corner === 3 ? 1 : -1) * (halfWidth - cornerRadius);
        const centerY = (corner < 2 ? 1 : -1) * (halfHeight - cornerRadius);
        for (let step = 0; step <= segments; step++) {
          const angle = corner * Math.PI / 2 + step / segments * Math.PI / 2;
          positions.push(centerX + Math.cos(angle) * cornerRadius,
            centerY + Math.sin(angle) * cornerRadius, rings[ring]);
        }
      }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let point = 0; point < count; point++) {
        const a = ring * count + point, b = ring * count + (point + 1) % count;
        const c = a + count, d = b + count;
        indices.push(a, c, b, b, c, d);
      }
    }
    // Separate cap vertices retain the broad planar face of the radome.
    for (const ring of [0, rings.length - 1]) {
      const center = positions.length / 3;
      positions.push(0, 0, rings[ring]);
      const edge = positions.length / 3;
      positions.push(...positions.slice(ring * count * 3, (ring + 1) * count * 3));
      for (let point = 0; point < count; point++) {
        const a = edge + point, b = edge + (point + 1) % count;
        indices.push(...(ring === 0 ? [center, a, b] : [center, b, a]));
      }
    }
    const mesh = geometry(name, positions, indices, olive, tint);
    mesh.position.addInPlaceFromFloats(...position);
    return mesh;
  };

  // Twin rails, suspended axles and leaf packs remain visible between wheels.
  for (const side of [-1, 1]) {
    box(`chassis-rail-${side}`, [.17, .3, 10.75], [side * .68, 1.15, .08], steel);
    box(`shelter-sill-${side}`, [.14, .21, 6.08], [side * 1.38, 1.69, -1.94], steel);
  }
  for (const crossZ of [-4.8, -2.9, -.2, 2.6, 4.8]) box("chassis-crossmember", [1.7, .16, .13], [0, 1.12, crossZ], steel);
  beam("driveshaft", [0, .91, -4.2], [0, .91, 4.25], .13);

  const axles = [-3.95, -2.04, 2.07, 4.12], wheelY = .805;
  for (let axle = 0; axle < axles.length; axle++) {
    const wheelZ = axles[axle];
    beam(`axle-${axle + 1}`, [-1.28, wheelY, wheelZ], [1.28, wheelY, wheelZ], .21);
    const differential = cylinder(`differential-${axle + 1}`, .42, .4, [0, wheelY, wheelZ]);
    differential.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      for (let leaf = 0; leaf < 3; leaf++) box("suspension-leaf", [.12, .035, 1.10 - leaf * .13], [side * .86, .91 + leaf * .046, wheelZ], steel);
      const wheelX = side * 1.25;
      const profile: readonly (readonly [number, number])[] = [
        [-.37, .42], [-.35, .60], [-.2, .77], [.2, .77], [.35, .60], [.37, .42],
      ];
      const positions: number[] = [], indices: number[] = [];
      const segments = 20;
      for (const [across, radius] of profile) {
        for (let segment = 0; segment < segments; segment++) {
          const angle = segment / segments * Math.PI * 2;
          positions.push(wheelX + across, wheelY + Math.cos(angle) * radius, wheelZ + Math.sin(angle) * radius);
        }
      }
      for (let ring = 0; ring < profile.length - 1; ring++) {
        for (let segment = 0; segment < segments; segment++) {
          const a = ring * segments + segment, b = ring * segments + (segment + 1) % segments;
          indices.push(a, a + segments, b, b, a + segments, b + segments);
        }
      }
      geometry(`tire-axle-${axle + 1}-${side}`, positions, indices, rubber, colors.rubber);
      // The individual angled tread blocks give tires a convincing close view.
      for (let tread = 0; tread < 18; tread++) {
        const angle = tread / 18 * Math.PI * 2;
        const block = box("tire-tread", [.58, .052, .15],
          [wheelX, wheelY + Math.cos(angle) * .774, wheelZ + Math.sin(angle) * .774], rubber, "#30362b");
        block.rotation.x = angle;
        block.rotation.y = tread % 2 === 0 ? .19 : -.19;
      }
      const hubX = wheelX + side * .355;
      const rim = cylinder(`wheel-rim-axle-${axle + 1}-${side}`, .87, .1, [hubX, wheelY, wheelZ], olive, colors.edge, 16);
      rim.rotation.z = Math.PI / 2;
      const hub = cylinder("wheel-hub", .44, .14, [hubX + side * .07, wheelY, wheelZ], steel, colors.metal, 12);
      hub.rotation.z = Math.PI / 2;
      for (let bolt = 0; bolt < 8; bolt++) {
        const angle = bolt / 8 * Math.PI * 2;
        const fastener = cylinder("wheel-hub-bolt", .065, .035,
          [hubX + side * .128, wheelY + Math.cos(angle) * .29, wheelZ + Math.sin(angle) * .29], steel, "#879080", 6);
        fastener.rotation.z = Math.PI / 2;
      }
      // A shallow arch protects each tire without obscuring the sidewalls.
      const archPositions: number[] = [], archIndices: number[] = [];
      for (let step = 0; step <= 10; step++) {
        const angle = step / 10 * Math.PI;
        for (const across of [-.44, .44]) for (const radius of [.87, .93]) {
          archPositions.push(wheelX + across, wheelY + Math.sin(angle) * radius, wheelZ + Math.cos(angle) * radius);
        }
        if (step < 10) {
          const a = step * 4, b = a + 4;
          archIndices.push(a, a + 2, b, a + 2, b + 2, b,
            a + 1, b + 1, a + 3, a + 3, b + 1, b + 3,
            a, b, a + 1, a + 1, b, b + 1,
            a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
        }
      }
      geometry("wheel-mudguard", archPositions, archIndices, olive, colors.edge);
      box("rubber-mudflap", [.73, .39, .055], [wheelX, .75, wheelZ - .88], rubber, colors.rubber);
    }
  }

  // Cab-over profile: the sloped windscreen is geometry, not a decal on a cube.
  const cabProfile: readonly (readonly [number, number])[] = [
    [1.50, 3.02], [1.50, 5.49], [2.50, 5.49], [3.43, 5.11], [3.43, 3.02],
  ];
  const cabPositions: number[] = [], cabIndices: number[] = [];
  const face = (points: readonly Point[]) => {
    const start = cabPositions.length / 3;
    cabPositions.push(...points.flatMap(point => [...point]));
    for (let index = 1; index < points.length - 1; index++) cabIndices.push(start, start + index + 1, start + index);
  };
  face(cabProfile.map(([height, along]) => [-1.36, height, along] as const));
  face([...cabProfile].reverse().map(([height, along]) => [1.36, height, along] as const));
  for (let index = 0; index < cabProfile.length; index++) {
    const [ay, az] = cabProfile[index], [by, bz] = cabProfile[(index + 1) % cabProfile.length];
    face([[-1.36, ay, az], [1.36, ay, az], [1.36, by, bz], [-1.36, by, bz]]);
  }
  geometry("shaped-cab", cabPositions, cabIndices, olive, colors.olive);
  box("front-bumper", [3.03, .22, .24], [0, 1.26, 5.60], steel);
  box("front-grille-recess", [1.72, .5, .035], [0, 1.98, 5.514], rubber, colors.rubber);
  for (let slat = 0; slat < 6; slat++) box("front-grille-slat", [1.66, .024, .046], [0, 1.78 + slat * .075, 5.54], steel, "#69755a");
  for (const side of [-1, 1]) {
    const low = side < 0 ? -1.23 : .055, high = side < 0 ? -.055 : 1.23;
    panel("windscreen-seal", [[low, 2.54, 5.487], [low, 3.26, 5.193], [high, 3.26, 5.193], [high, 2.54, 5.487]], rubber, colors.rubber);
    panel(`windscreen-pane-${side}`, [[low + .06, 2.60, 5.472], [low + .06, 3.20, 5.226], [high - .06, 3.20, 5.226], [high - .06, 2.60, 5.472]], glass, colors.glass);
    beam("windscreen-wiper", [side * .51, 2.59, 5.495], [side * .9, 2.88, 5.374], .027, steel);
    const sideX = side * 1.373;
    const sidePane: Point[] = [[sideX, 2.55, 3.43], [sideX, 3.23, 3.43], [sideX, 3.23, 4.91], [sideX, 2.55, 5.19]];
    panel("cab-side-window-seal", side < 0 ? sidePane : [...sidePane].reverse(), rubber, colors.rubber);
    const glassX = side * 1.382;
    const glazing: Point[] = [[glassX, 2.61, 3.49], [glassX, 3.17, 3.49], [glassX, 3.17, 4.88], [glassX, 2.61, 5.09]];
    panel("cab-side-glazing", side < 0 ? glazing : [...glazing].reverse(), glass, colors.glass);
    box("cab-door-front-seam", [.023, .95, .022], [side * 1.385, 2.06, 5.04], steel, colors.edge);
    box("cab-door-rear-seam", [.023, 1.66, .022], [side * 1.385, 2.40, 3.35], steel, colors.edge);
    box("cab-door-lower-seam", [.023, .025, 1.71], [side * 1.385, 1.59, 4.19], steel, colors.edge);
    box("cab-door-handle", [.065, .043, .22], [side * 1.41, 2.31, 3.71], steel, "#9ca38b");
    for (const stepY of [.65, 1.02]) {
      box("cab-entry-step", [.39, .085, .77], [side * 1.51, stepY, 3.5], steel);
      for (const along of [3.24, 3.49, 3.74]) box("cab-step-grip", [.35, .013, .04], [side * 1.52, stepY + .049, along], steel, "#8e967e");
    }
    beam("cab-mirror-arm", [side * 1.36, 2.79, 5.02], [side * 1.78, 2.88, 5.04], .04);
    box("cab-mirror-frame", [.12, .43, .22], [side * 1.78, 2.93, 5.08], rubber, colors.rubber);
    box("cab-mirror-glass", [.017, .35, .15], [side * 1.851, 2.93, 5.09], glass, "#5e7375");
    const headlight = cylinder("headlamp", .26, .085, [side * 1.09, 1.97, 5.554], lamps, colors.lamp, 14);
    headlight.rotation.x = Math.PI / 2;
    box("front-turn-indicator", [.20, .11, .08], [side * 1.14, 2.24, 5.54], lamps, colors.amber);
    box("front-bumper-towing-eye", [.1, .16, .15], [side * .54, 1.19, 5.78], steel);
    box("roof-clearance-lamp", [.085, .065, .13], [side * 1.05, 3.48, 5.02], lamps, colors.amber);
  }
  box("cab-roof-hatch", [.83, .10, .67], [0, 3.46, 3.74], olive, colors.light);
  for (const side of [-1, 1]) beam("roof-hatch-handle", [side * .24, 3.55, 3.60], [side * .24, 3.55, 3.86], .036);
  // Pale identification strips are deliberately fictional scenery markings.
  for (const side of [-1, 1]) box("cab-identification-stripe", [.016, .046, .56], [side * 1.389, 2.17, 4.45], olive, colors.white);

  // Separate generator/engine bay and access deck behind the cab.
  roundedBox("generator-housing", 2.67, 1.41, 1.32, .09, .035, [0, 2.18, 2.10], colors.panel);
  box("generator-access-deck", [2.77, .13, 1.77], [0, 1.55, 1.86], steel);
  for (const side of [-1, 1]) {
    box("generator-intake-recess", [.035, .82, .87], [side * 1.348, 2.25, 2.06], rubber, colors.rubber);
    for (let slat = 0; slat < 8; slat++) box("generator-intake-louver", [.063, .027, .81], [side * 1.363, 1.91 + slat * .095, 2.06], steel, colors.edge);
    box("generator-service-panel", [.036, .62, .34], [side * 1.349, 2.20, 2.61], olive, colors.light);
    box("generator-panel-latch", [.045, .08, .045], [side * 1.377, 2.18, 2.73], steel);
  }
  for (const along of [1.78, 2.06, 2.34]) box("generator-roof-duct", [.96, .1, .16], [0, 2.94, along], olive, colors.edge);
  cylinder("generator-exhaust", .16, 1.52, [-1.04, 2.6, 1.21], steel, "#454943");
  cylinder("generator-exhaust-cap", .23, .06, [-1.04, 3.38, 1.21], steel);
  box("generator-cable-tray", [.14, .14, .72], [.97, 1.82, 1.15], rubber, colors.rubber);

  // Long communications shelter, with corrugated lower trim and service doors.
  roundedBox("equipment-shelter", 2.90, 2.02, 5.90, .085, .035, [0, 2.68, -1.97], colors.olive);
  for (const side of [-1, 1]) {
    box("shelter-roof-gutter", [.085, .10, 5.88], [side * 1.44, 3.68, -1.97], olive, colors.light);
    box("shelter-bottom-trim", [.055, .16, 5.87], [side * 1.472, 1.77, -1.97], olive, colors.edge);
    for (const along of [-4.76, -2.72, -.33, .80]) {
      box("shelter-panel-seam", [.024, 1.79, .025], [side * 1.473, 2.69, along], steel, colors.edge);
      box("shelter-upper-fastener", [.035, .045, .05], [side * 1.493, 3.52, along], steel, "#7f886a");
    }
    box("shelter-access-door", [.05, 1.57, 1.14], [side * 1.485, 2.53, -1.24], olive, colors.panel);
    for (const along of [-1.82, -.66]) box("shelter-door-seal", [.017, 1.58, .018], [side * 1.518, 2.54, along], rubber, colors.rubber);
    for (const height of [1.75, 3.32]) box("shelter-door-seal", [.017, .024, 1.16], [side * 1.518, height, -1.24], rubber, colors.rubber);
    box("shelter-door-handle", [.066, .22, .044], [side * 1.536, 2.50, -.84], steel, "#959b82");
    for (const height of [1.96, 3.10]) box("shelter-door-hinge", [.08, .13, .06], [side * 1.54, height, -1.75], steel);
    box("shelter-service-hatch", [.045, .55, .61], [side * 1.486, 2.2, -3.16], olive, colors.light);
    box("shelter-vent-recess", [.028, .51, .78], [side * 1.484, 2.83, -.01], rubber, colors.rubber);
    for (let slat = 0; slat < 6; slat++) box("shelter-vent-louver", [.052, .025, .72], [side * 1.507, 2.62 + slat * .078, -.01], olive, colors.edge);
    box("shelter-lower-tool-locker", [.15, .42, .83], [side * 1.21, 1.28, -.63], olive, colors.panel);
    box("shelter-step-bracket", [.28, .09, .72], [side * 1.53, 1.24, -1.24], steel);
    // Short irregular paint chips along the sill remain subtle at close range.
    for (let chip = 0; chip < 5; chip++) box("sill-weathering", [.012, .024, .11 + (chip % 2) * .07],
      [side * 1.507, 1.77 + (chip % 2) * .027, -4.10 + chip * .77], olive, colors.rust);
  }
  box("shelter-roof-service-hatch", [.94, .075, .74], [-.55, 3.72, -2.06], olive, colors.light);
  cylinder("shelter-roof-vent", .21, .16, [.76, 3.76, -2.75], steel, colors.edge);
  // Tall radome is a rounded rectangular housing, as in both supplied photos.
  box("radome-mounting-platform", [2.25, .15, 1.64], [0, 3.84, -3.87], steel);
  cylinder("radome-rotary-pedestal", .79, .43, [0, 4.07, -3.87], steel, colors.edge, 20);
  for (const side of [-1, 1]) beam("radome-pedestal-brace", [side * .65, 3.92, -3.88], [side * .25, 4.35, -3.88], .105);
  roundedBox("rounded-rectangular-radome", 1.95, 2.64, 1.29, .26, .11, [0, 5.65, -3.87], colors.light);
  box("radome-lower-flange", [1.84, .12, 1.20], [0, 4.36, -3.87], olive, colors.edge);
  for (const side of [-1, 1]) for (const along of [-4.35, -3.39]) {
    box("radome-flange-bolt", [.05, .07, .06], [side * .84, 4.29, along], steel, "#919781");
  }

  // A fixed ladder and unfolded rear platform make deployment legible.
  for (const along of [-4.58, -4.05]) beam("shelter-access-ladder-rail", [-1.56, .96, along], [-1.56, 3.93, along], .053);
  for (let rung = 0; rung < 10; rung++) beam("shelter-access-ladder-rung", [-1.58, 1.04 + rung * .29, -4.58], [-1.58, 1.04 + rung * .29, -4.05], .049, steel, "#737e62");
  for (const side of [-1, 1]) {
    box("rear-folding-platform-rail", [.095, .08, 1.23], [side * 1.00, 3.79, -5.18], steel);
    beam("rear-platform-brace", [side * 1.00, 3.76, -5.71], [side * 1.00, 2.99, -4.88], .066);
  }
  for (const along of [-4.95, -5.36, -5.73]) box("rear-platform-crossbar", [2.08, .065, .08], [0, 3.79, along], steel);
  box("rear-bumper", [2.68, .19, .19], [0, 1.18, -5.12], steel);
  for (const side of [-1, 1]) {
    box("rear-tail-light", [.23, .16, .068], [side * 1.09, 1.36, -5.245], lamps, colors.red);
    box("rear-reflector", [.16, .075, .06], [side * .80, 1.36, -5.244], lamps, colors.amber);
  }
  box("rear-registration-panel", [.51, .21, .036], [0, 1.32, -5.234], olive, colors.white);
  cylinder("rear-tow-pin", .13, .25, [0, .92, -5.30], steel);

  // Four lowered hydraulic outriggers sit on broad foot pads at pad elevation.
  for (const along of [-4.54, .59]) for (const side of [-1, 1]) {
    box("deployed-outrigger-beam", [1.04, .16, .19], [side * 1.77, 1.56, along], olive, colors.panel);
    box("outrigger-locking-sleeve", [.28, .23, .28], [side * 1.43, 1.56, along], steel);
    cylinder("stabilizer-jack-barrel", .20, .81, [side * 2.28, 1.19, along], olive, colors.edge);
    cylinder("stabilizer-jack-piston", .09, .72, [side * 2.28, .45, along], steel, "#9ca693");
    box("stabilizer-footpad", [.52, .085, .49], [side * 2.28, .045, along], steel, "#737b60");
    beam("stabilizer-diagonal-brace", [side * 1.38, 1.84, along], [side * 2.28, 1.47, along], .062);
  }

  // Telescopic mast, clamps and small paddle dish follow the reference outline.
  const mastX = .32, mastZ = -.19;
  cylinder("antenna-mast-base", .23, 1.12, [mastX, 4.21, mastZ], olive, colors.edge);
  cylinder("antenna-mast-lower", .135, 2.45, [mastX, 5.67, mastZ], steel, colors.light, 10, .11);
  cylinder("antenna-mast-middle", .095, 2.34, [mastX, 7.93, mastZ], steel, colors.light, 10, .065);
  cylinder("antenna-mast-upper", .060, 1.44, [mastX, 9.71, mastZ], steel, colors.light, 8, .034);
  for (const height of [4.75, 6.83, 9.02]) cylinder("antenna-mast-clamp", .17, .09, [mastX, height, mastZ], steel, colors.edge);
  beam("mast-deployment-brace-left", [-.83, 3.76, -.68], [mastX, 5.11, mastZ], .066);
  beam("mast-deployment-brace-right", [1.15, 3.76, .40], [mastX, 5.11, mastZ], .066);
  beam("mast-dish-arm", [mastX, 9.45, mastZ], [mastX + .50, 9.45, mastZ], .052);
  const dishPositions: number[] = [], dishIndices: number[] = [];
  const dishCenter: Point = [mastX + .56, 9.45, mastZ];
  const dishSegments = 16;
  dishPositions.push(dishCenter[0], dishCenter[1], dishCenter[2] - .10);
  for (const radius of [.17, .31, .45]) {
    for (let segment = 0; segment < dishSegments; segment++) {
      const angle = segment / dishSegments * Math.PI * 2;
      dishPositions.push(dishCenter[0] + Math.cos(angle) * radius,
        dishCenter[1] + Math.sin(angle) * radius, dishCenter[2] - .10 + radius * radius * .64);
    }
  }
  for (let segment = 0; segment < dishSegments; segment++) {
    dishIndices.push(0, 1 + (segment + 1) % dishSegments, 1 + segment);
    for (let ring = 0; ring < 2; ring++) {
      const a = 1 + ring * dishSegments + segment, b = 1 + ring * dishSegments + (segment + 1) % dishSegments;
      dishIndices.push(a, b + dishSegments, a + dishSegments, a, b, b + dishSegments);
    }
  }
  // Include the painted reverse face so the dish reads correctly from either side.
  const frontIndices = [...dishIndices];
  for (let index = 0; index < frontIndices.length; index += 3) dishIndices.push(frontIndices[index], frontIndices[index + 2], frontIndices[index + 1]);
  const dish = geometry("mast-paddle-dish", dishPositions, dishIndices, olive, colors.light);
  // Explicit normals avoid opposing front/back triangle normals cancelling.
  dish.setVerticesData("normal", dishPositions.map((_value, index) => index % 3 === 2 ? -1 : 0));
  beam("dish-feed-arm", [dishCenter[0] - .35, dishCenter[1], mastZ + .08], [dishCenter[0], dishCenter[1], mastZ + .33], .027);
  cylinder("mast-top-cap", .07, .12, [mastX, 10.47, mastZ], steel);
  for (const [antennaX, antennaZ, height] of [[-.94, -.05, 6.07], [1.03, -.54, 6.36], [-.75, -2.61, 5.06]]) {
    cylinder("whip-antenna-base", .095, .21, [antennaX, 3.79, antennaZ], steel);
    beam("whip-antenna", [antennaX, 3.90, antennaZ], [antennaX, height, antennaZ], .022, wire, colors.metal, false);
  }
  beam("mast-guy-wire-left", [mastX, 8.48, mastZ], [-1.35, 3.80, -2.48], .013, wire, colors.metal, false);
  beam("mast-guy-wire-right", [mastX, 8.48, mastZ], [1.35, 3.80, -2.48], .013, wire, colors.metal, false);
  beam("mast-guy-wire-front", [mastX, 8.48, mastZ], [.19, 3.64, .87], .013, wire, colors.metal, false);

  // Parts start without a parent. Merging bakes only their island-local pose;
  // applying root afterwards preserves its world translation exactly once.
  const groups = new Map<PBRMaterial, Mesh[]>();
  for (const part of parts) {
    const paint = part.material as PBRMaterial;
    const group = groups.get(paint) ?? [];
    group.push(part);
    groups.set(paint, group);
  }
  const meshes: Mesh[] = [], shadowCasters: Mesh[] = [];
  for (const [paint, group] of groups) {
    const sourceNames = group.map(part => part.name);
    const merged = Mesh.MergeMeshes(group, true, true);
    if (!merged) throw new Error(`Could not merge coastal radar ${paint.name}`);
    merged.name = `${paint.name}-batch`;
    merged.parent = root;
    merged.material = paint;
    merged.useVertexColors = true;
    merged.isPickable = false;
    merged.receiveShadows = paint !== wire;
    merged.checkCollisions = paint !== wire;
    merged.metadata = { facility: "coastal-radar", sourceNames, visualOnly: true };
    meshes.push(merged);
    if (paint !== wire) shadowCasters.push(merged);
  }
  return { meshes, shadowCasters };
}
