export interface OceanGeometryOptions {
  /** Subdivisions along one side of the central square; must be divisible by 4. */
  readonly subdivisions: number;
  readonly cellSizeMeters: number;
  readonly minimumHalfSizeMeters?: number;
}

export interface OceanGeometry {
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  /** Largest cell touching each vertex, used to filter unresolved wave bands. */
  readonly cellSizes: Float32Array;
  readonly halfSizeMeters: number;
  readonly ringCount: number;
}

/**
 * A dense central square surrounded by static rings with doubled cell spacing.
 * Ring boundaries share vertices and split their coarse edges at the fine grid's
 * midpoints. This avoids cracks without wasting thin triangles across the ocean.
 * Only the mesh transform moves; buffers are built once per quality selection.
 */
export function createOceanGeometry({
  subdivisions,
  cellSizeMeters,
  minimumHalfSizeMeters = 10_000,
}: OceanGeometryOptions): OceanGeometry {
  if (!Number.isInteger(subdivisions) || subdivisions < 4 || subdivisions % 4 !== 0) {
    throw new RangeError("Ocean subdivisions must be a positive multiple of four.");
  }
  if (!Number.isFinite(cellSizeMeters) || cellSizeMeters <= 0
    || !Number.isFinite(minimumHalfSizeMeters) || minimumHalfSizeMeters <= 0) {
    throw new RangeError("Ocean cell spacing and extent must be finite and positive.");
  }
  const centralHalfSize = subdivisions * cellSizeMeters / 2;
  const ringCount = Math.max(0, Math.ceil(Math.log2(minimumHalfSizeMeters / centralHalfSize)));
  const positions: number[] = [];
  const cellSizes: number[] = [];
  const indices: number[] = [];
  const vertices = new Map<string, number>();

  // Use integer coordinates in central-cell units so adjacent rings match exactly.
  const vertex = (x: number, z: number, spacing: number): number => {
    const key = `${x}:${z}`;
    let index = vertices.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      vertices.set(key, index);
      positions.push(x * cellSizeMeters, 0, z * cellSizeMeters);
      cellSizes.push(spacing * cellSizeMeters);
    } else {
      cellSizes[index] = Math.max(cellSizes[index], spacing * cellSizeMeters);
    }
    return index;
  };

  const triangle = (a: number, b: number, c: number,
    stitchedEdge?: readonly [number, number, number]): void => {
    if (stitchedEdge) {
      const [edgeA, edgeB, midpoint] = stitchedEdge;
      const corners = [a, b, c];
      for (let edge = 0; edge < 3; edge++) {
        const start = corners[edge], end = corners[(edge + 1) % 3];
        if ((start === edgeA && end === edgeB) || (start === edgeB && end === edgeA)) {
          const opposite = corners[(edge + 2) % 3];
          indices.push(start, midpoint, opposite, midpoint, end, opposite);
          return;
        }
      }
    }
    indices.push(a, b, c);
  };

  for (let level = 0; level <= ringCount; level++) {
    const spacing = 2 ** level;
    const halfSize = subdivisions * spacing / 2;
    const holeStart = subdivisions / 4;
    const holeEnd = subdivisions * 3 / 4;
    for (let row = 0; row < subdivisions; row++) {
      for (let column = 0; column < subdivisions; column++) {
        if (level > 0 && row >= holeStart && row < holeEnd
          && column >= holeStart && column < holeEnd) continue;
        const x = -halfSize + column * spacing;
        const z = -halfSize + row * spacing;
        const a = vertex(x, z, spacing);
        const b = vertex(x + spacing, z, spacing);
        const c = vertex(x + spacing, z + spacing, spacing);
        const d = vertex(x, z + spacing, spacing);
        let stitchedEdge: readonly [number, number, number] | undefined;
        if (level > 0) {
          const spansHoleX = column >= holeStart && column < holeEnd;
          const spansHoleZ = row >= holeStart && row < holeEnd;
          if (row === holeStart - 1 && spansHoleX) {
            stitchedEdge = [c, d, vertex(x + spacing / 2, z + spacing, spacing)];
          } else if (row === holeEnd && spansHoleX) {
            stitchedEdge = [a, b, vertex(x + spacing / 2, z, spacing)];
          } else if (column === holeStart - 1 && spansHoleZ) {
            stitchedEdge = [b, c, vertex(x + spacing, z + spacing / 2, spacing)];
          } else if (column === holeEnd && spansHoleZ) {
            stitchedEdge = [d, a, vertex(x, z + spacing / 2, spacing)];
          }
        }
        // Babylon's left-handed front face is upward for this winding.
        triangle(a, b, c, stitchedEdge);
        triangle(a, c, d, stitchedEdge);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: positions.length / 3 <= 65_536 ? new Uint16Array(indices) : new Uint32Array(indices),
    cellSizes: new Float32Array(cellSizes),
    halfSizeMeters: centralHalfSize * 2 ** ringCount,
    ringCount,
  };
}
