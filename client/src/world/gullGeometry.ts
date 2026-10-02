export interface GullGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint16Array;
}

type Color = readonly [number, number, number];
type Point = readonly [number, number, number];
const WHITE: Color = [.96, .965, .94];
const MANTLE: Color = [.64, .69, .72];
const PRIMARY: Color = [.055, .066, .074];
const BILL: Color = [.9, .68, .14];

class GeometryBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number, color: Color): number {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.colors.push(...color, 1);
    return index;
  }

  triangle(a: number, b: number, c: number): void { this.indices.push(a, b, c); }

  ellipsoid(center: Point, radius: Point, color: Color, segments = 10, rings = 6): void {
    const top = this.vertex(center[0], center[1] + radius[1], center[2], color);
    const first = this.positions.length / 3;
    for (let ring = 1; ring < rings; ring++) {
      const polar = ring / rings * Math.PI;
      for (let segment = 0; segment < segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        this.vertex(center[0] + Math.sin(polar) * Math.cos(angle) * radius[0],
          center[1] + Math.cos(polar) * radius[1],
          center[2] + Math.sin(polar) * Math.sin(angle) * radius[2], color);
      }
    }
    const bottom = this.vertex(center[0], center[1] - radius[1], center[2], color);
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      this.triangle(top, first + next, first + segment);
      for (let ring = 0; ring < rings - 2; ring++) {
        const a = first + ring * segments + segment, b = first + ring * segments + next;
        const c = a + segments, d = b + segments;
        this.triangle(a, b, c); this.triangle(b, d, c);
      }
      const last = first + (rings - 2) * segments;
      this.triangle(bottom, last + segment, last + next);
    }
  }

  /** Thin closed feather, including a central ridge and pointed outline. */
  feather(root: Point, tip: Point, width: number, color: Color): void {
    const dx = tip[0] - root[0], dz = tip[2] - root[2], length = Math.hypot(dx, dz);
    const sideX = -dz / length * width, sideZ = dx / length * width;
    const a = this.vertex(root[0] + sideX, root[1], root[2] + sideZ, color);
    const b = this.vertex(root[0] - sideX, root[1], root[2] - sideZ, color);
    const c = this.vertex(tip[0], tip[1], tip[2], color);
    const d = this.vertex(root[0] + dx * .47, root[1] + .004, root[2] + dz * .47, color);
    const e = this.vertex(root[0] + dx * .47, root[1] - .003, root[2] + dz * .47, color);
    this.triangle(a, c, d); this.triangle(c, b, d); this.triangle(b, a, d);
    this.triangle(c, a, e); this.triangle(b, c, e); this.triangle(a, b, e);
  }

  build(): GullGeometry {
    const normals = new Float32Array(this.positions.length);
    for (let offset = 0; offset < this.indices.length; offset += 3) {
      const a = this.indices[offset]! * 3, b = this.indices[offset + 1]! * 3, c = this.indices[offset + 2]! * 3;
      const ux = this.positions[b]! - this.positions[a]!, uy = this.positions[b + 1]! - this.positions[a + 1]!, uz = this.positions[b + 2]! - this.positions[a + 2]!;
      const vx = this.positions[c]! - this.positions[a]!, vy = this.positions[c + 1]! - this.positions[a + 1]!, vz = this.positions[c + 2]! - this.positions[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const index of [a, b, c]) { normals[index] += nx; normals[index + 1] += ny; normals[index + 2] += nz; }
    }
    for (let index = 0; index < normals.length; index += 3) {
      const length = Math.hypot(normals[index]!, normals[index + 1]!, normals[index + 2]!) || 1;
      normals[index] /= length; normals[index + 1] /= length; normals[index + 2] /= length;
    }
    return { positions: new Float32Array(this.positions), normals, colors: new Float32Array(this.colors), indices: new Uint16Array(this.indices) };
  }
}

/** Adult gull plumage and metre scale: white body, grey mantle and black primaries. */
export function createGullBodyGeometry(): GullGeometry {
  const b = new GeometryBuilder();
  b.ellipsoid([0, 0, 0], [.086, .092, .19], WHITE, 12, 8);
  b.ellipsoid([0, .047, -.006], [.081, .059, .16], MANTLE, 12, 6);
  b.ellipsoid([0, .055, .145], [.053, .065, .073], WHITE);
  b.ellipsoid([0, .101, .213], [.051, .055, .061], WHITE);
  b.ellipsoid([0, .089, .286], [.024, .02, .049], BILL, 8, 4);
  b.ellipsoid([0, .075, .309], [.018, .006, .013], [.66, .12, .065], 6, 4);
  for (const side of [-1, 1]) {
    b.ellipsoid([side * .048, .117, .231], [.005, .008, .008], [.82, .66, .26], 8, 4);
    b.ellipsoid([side * .052, .117, .233], [.002, .0045, .0045], [.035, .03, .023], 8, 4);
    b.ellipsoid([side * .031, -.078, -.115], [.008, .008, .035], [.7, .44, .4], 6, 4);
  }
  for (let feather = -3; feather <= 3; feather++) {
    b.feather([feather * .012, -.007, -.14], [feather * .024, -.018, -.305 + Math.abs(feather) * .006], .013, WHITE);
  }
  return b.build();
}

/** Right wing relative to its shoulder/elbow; left wings share mirrored instances. */
export function createGullWingGeometry(outer: boolean): GullGeometry {
  const b = new GeometryBuilder();
  const stations = outer
    ? [[0, .025, -.10], [.1, .047, -.142], [.20, .004, -.16], [.285, -.052, -.115]]
    : [[0, .09, -.09], [.11, .12, -.147], [.24, .085, -.132], [.335, .025, -.10]];
  const chordSteps = 4;
  const surfaceVertices = stations.length * (chordSteps + 1);
  for (let surface = 0; surface < 2; surface++) {
    for (const [x, front, rear] of stations) {
      for (let chord = 0; chord <= chordSteps; chord++) {
        const t = chord / chordSteps;
        const darkTip = outer && x! > .15;
        const color = darkTip ? PRIMARY : surface === 1 || t > .74 ? WHITE : MANTLE;
        const camber = Math.sin(t * Math.PI) * .013;
        b.vertex(x!, (surface === 0 ? .003 : -.003) + camber, front! + (rear! - front!) * t, color);
      }
    }
    for (let station = 0; station < stations.length - 1; station++) {
      for (let chord = 0; chord < chordSteps; chord++) {
        const a = surface * surfaceVertices + station * (chordSteps + 1) + chord;
        const next = a + chordSteps + 1;
        if (surface === 0) { b.triangle(a, next, a + 1); b.triangle(a + 1, next, next + 1); }
        else { b.triangle(a, a + 1, next); b.triangle(a + 1, next + 1, next); }
      }
    }
  }
  const closeEdge = (a: number, c: number): void => {
    b.triangle(a, a + surfaceVertices, c); b.triangle(c, a + surfaceVertices, c + surfaceVertices);
  };
  for (let station = 0; station < stations.length - 1; station++) {
    closeEdge(station * 5, (station + 1) * 5);
    closeEdge((station + 1) * 5 + 4, station * 5 + 4);
  }
  for (let chord = 0; chord < chordSteps; chord++) {
    closeEdge(chord + 1, chord);
    const end = (stations.length - 1) * 5;
    closeEdge(end + chord, end + chord + 1);
  }
  if (outer) {
    for (let primary = 0; primary < 5; primary++) {
      b.feather([.17 - primary * .008, .004, -.037 - primary * .025],
        [.34 - primary * .014, .002 - primary * .001, -.077 - primary * .025], .015, PRIMARY);
    }
    // White mirrors on the longest dark primary feathers, on both wing surfaces.
    for (const surface of [-1, 1]) {
      b.ellipsoid([.26, .007 * surface, -.057], [.022, .0018, .009], WHITE, 8, 4);
      b.ellipsoid([.284, .007 * surface, -.096], [.012, .0018, .007], WHITE, 8, 4);
    }
  } else {
    for (let secondary = 0; secondary < 6; secondary++) {
      const x = .07 + secondary * .043;
      b.feather([x, .008, -.077], [x + .012, .004, -.158 + secondary * .005], .019, WHITE);
    }
  }
  return b.build();
}
