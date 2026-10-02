import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const { createOceanGeometry } = await loadSource('../src/world/oceanGeometry.ts');
const { GRAPHICS_QUALITY_SETTINGS } = await loadSource('../src/game/graphicsQuality.ts');

const expectedTriangles = { High: 116_544, Medium: 52_096, Low: 29_472 };
const previousTriangles = { High: 180_000, Medium: 96_800, Low: 51_200 };

for (const [quality, settings] of Object.entries(GRAPHICS_QUALITY_SETTINGS)) {
  test(`${quality} water has a dense centre and a horizon with fewer triangles`, () => {
    const geometry = createOceanGeometry({
      subdivisions: settings.oceanSubdivisions,
      cellSizeMeters: settings.oceanCellSizeMeters,
    });
    const { positions, indices, cellSizes, halfSizeMeters } = geometry;
    assert.equal(indices.length / 3, expectedTriangles[quality]);
    assert.ok(indices.length / 3 < previousTriangles[quality]);
    assert.equal(halfSizeMeters, 12_288);
    assert.ok(halfSizeMeters > settings.viewDistanceMeters + 3_000);
    assert.equal(cellSizes.length * 3, positions.length);
    assert.ok(indices instanceof Uint16Array, 'all quality levels fit compact 16-bit indices');
    assert.ok(positions.every(Number.isFinite));
    const centralXs = [];
    for (let index = 0; index < positions.length; index += 3) {
      assert.equal(positions[index + 1], 0);
      assert.ok(Math.abs(positions[index]) <= halfSizeMeters);
      assert.ok(Math.abs(positions[index + 2]) <= halfSizeMeters);
      if (positions[index + 2] === 0 && Math.abs(positions[index]) <= 96) centralXs.push(positions[index]);
    }
    centralXs.sort((a, b) => a - b);
    assert.equal(centralXs.length, settings.oceanSubdivisions + 1);
    for (let index = 1; index < centralXs.length; index++) {
      assert.equal(centralXs[index] - centralXs[index - 1], settings.oceanCellSizeMeters);
    }
  });

  test(`${quality} rings share a closed, upward-facing surface without skinny triangles`, () => {
    const { positions, indices, cellSizes, halfSizeMeters } = createOceanGeometry({
      subdivisions: settings.oceanSubdivisions,
      cellSizeMeters: settings.oceanCellSizeMeters,
    });
    const vertexCount = positions.length / 3;
    const edges = new Map();
    let totalArea = 0;
    for (let offset = 0; offset < indices.length; offset += 3) {
      const triangle = Array.from(indices.slice(offset, offset + 3));
      const points = triangle.map(index => [positions[index * 3], positions[index * 3 + 2]]);
      const [a, b, c] = points;
      const twiceArea = (a[1] - b[1]) * (c[0] - b[0]) - (a[0] - b[0]) * (c[1] - b[1]);
      assert.ok(twiceArea > 0, 'triangles must face upward and have positive area');
      totalArea += twiceArea / 2;
      const lengths = [];
      for (let side = 0; side < 3; side++) {
        const from = triangle[side], to = triangle[(side + 1) % 3];
        const p = points[side], q = points[(side + 1) % 3];
        lengths.push(Math.hypot(p[0] - q[0], p[1] - q[1]));
        // Band filtering must account for every adjacent cell on stitched boundaries.
        for (const vertex of [from, to]) {
          assert.ok(Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) <= cellSizes[vertex]);
        }
        const key = Math.min(from, to) * vertexCount + Math.max(from, to);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      assert.ok(Math.max(...lengths) / Math.min(...lengths) <= Math.sqrt(8) + 1e-9,
        'long thin horizon triangles waste detail and alias waves');
    }
    assert.equal(totalArea, (halfSizeMeters * 2) ** 2, 'rings must cover the complete square exactly');
    let outerEdges = 0;
    for (const [key, count] of edges) {
      const from = Math.floor(key / vertexCount), to = key % vertexCount;
      if (count === 1) {
        const ax = positions[from * 3], az = positions[from * 3 + 2];
        const bx = positions[to * 3], bz = positions[to * 3 + 2];
        assert.ok((ax === bx && Math.abs(ax) === halfSizeMeters)
          || (az === bz && Math.abs(az) === halfSizeMeters), 'an interior edge exposes a ring seam or hole');
        outerEdges++;
      } else assert.equal(count, 2, 'an edge is shared by exactly two triangles');
    }
    assert.equal(outerEdges, settings.oceanSubdivisions * 4);
  });
}

test('invalid ocean dimensions are rejected before geometry allocation', () => {
  for (const subdivisions of [0, 6, 12.5, NaN]) {
    assert.throws(() => createOceanGeometry({ subdivisions, cellSizeMeters: 2 }), RangeError);
  }
  for (const cellSizeMeters of [0, -1, Infinity, NaN]) {
    assert.throws(() => createOceanGeometry({ subdivisions: 16, cellSizeMeters }), RangeError);
  }
});
