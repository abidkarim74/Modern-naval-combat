import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const source = await readFile(new URL('../src/ships/createSeahawk.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/\b(from|import)\s+(["'])([^"']+)\2/g, (_match, prefix, _quote, specifier) => {
  const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
  assert.ok(!name.startsWith('.'), `unexpected runtime-relative import: ${name}`);
  return `${prefix} ${JSON.stringify(import.meta.resolve(name))}`;
});
const { addParkedSeahawk } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

// These tests inspect real mesh buffers; texture drawing needs only a canvas
// interface under NullEngine, which does not upload pixels to a GPU.
class GeometryCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.context = new Proxy({
      canvas: this,
      measureText: text => ({ width: text.length * 10 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    }, { get: (target, key) => key in target ? target[key] : () => {} });
  }
  getContext() { return this.context; }
}

function fixture(t, slope = .03) {
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = GeometryCanvas;
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  const scene = new Scene(engine);
  const root = new Mesh('test-destroyer', scene);
  const paints = Object.fromEntries(['gray', 'light', 'dark', 'radar', 'glass', 'white', 'orange']
    .map(name => [name, new PBRMaterial(name, scene)]));
  const casters = [];
  const deckHeight = z => 4.5 + slope * (z + 62.7);
  addParkedSeahawk(scene, root, casters, paints, deckHeight);
  root.computeWorldMatrix(true);
  casters.forEach(mesh => mesh.computeWorldMatrix(true));
  t.after(() => {
    scene.dispose();
    engine.dispose();
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  });
  return { scene, root, casters, deckHeight };
}

const named = (meshes, name) => meshes.filter(mesh => mesh.name === name);
function points(mesh) {
  const positions = mesh.getVerticesData('position');
  const world = mesh.computeWorldMatrix(true);
  return Array.from({ length: positions.length / 3 }, (_, i) =>
    Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), world));
}

function triangles(mesh) {
  const vertices = points(mesh), indices = mesh.getIndices(), result = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = Array.from(indices.slice(i, i + 3), index => vertices[index]);
    // Babylon's default left-handed face normal points along (a-b) x (c-b).
    const normal = Vector3.Cross(a.subtract(b), c.subtract(b));
    if (normal.lengthSquared() < 1e-12) continue;
    result.push({ a, b, c, normal: normal.normalize(), center: a.add(b).add(c).scale(1 / 3) });
  }
  return result;
}

function bounds(vertices) {
  return {
    min: new Vector3(...['x', 'y', 'z'].map(axis => Math.min(...vertices.map(v => v[axis])))),
    max: new Vector3(...['x', 'y', 'z'].map(axis => Math.max(...vertices.map(v => v[axis])))),
  };
}

function rayDistance(origin, direction, triangle) {
  // Two-sided Moller-Trumbore intersection detects opaque skin even when its
  // winding is wrong. Merely checking Babylon's pickable flag would miss it.
  const e1 = triangle.b.subtract(triangle.a), e2 = triangle.c.subtract(triangle.a);
  const p = Vector3.Cross(direction, e2), determinant = Vector3.Dot(e1, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const offset = origin.subtract(triangle.a), u = Vector3.Dot(offset, p) / determinant;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = Vector3.Cross(offset, e1), v = Vector3.Dot(direction, q) / determinant;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const distance = Vector3.Dot(e2, q) / determinant;
  return distance > 1e-5 ? distance : null;
}

test('cabin side faces and both end caps face outward', t => {
  const { casters } = fixture(t);
  const cabins = named(casters, 'Seahawk-shaped-cabin-and-nose');
  assert.equal(cabins.length, 1);
  const cabin = cabins[0], vertices = points(cabin), box = bounds(vertices);
  const sections = [...new Set(vertices.map(v => v.z))].sort((a, b) => a - b).map(z => {
    const ring = bounds(vertices.filter(v => Math.abs(v.z - z) < 1e-6));
    return { z, x: (ring.min.x + ring.max.x) / 2, y: (ring.min.y + ring.max.y) / 2 };
  });
  const sectionCenter = z => {
    const upper = sections.findIndex(section => section.z >= z);
    if (upper <= 0) return new Vector3(sections[0].x, sections[0].y, z);
    const a = sections[upper - 1], b = sections[upper], fraction = (z - a.z) / (b.z - a.z);
    return new Vector3(a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction, z);
  };
  let aftCaps = 0, forwardCaps = 0, sides = 0;
  for (const face of triangles(cabin)) {
    const flatZ = Math.max(face.a.z, face.b.z, face.c.z) - Math.min(face.a.z, face.b.z, face.c.z) < 1e-6;
    if (flatZ && Math.abs(face.center.z - box.min.z) < 1e-6) {
      assert.ok(face.normal.z < -.99, 'aft cap is culled from outside the cabin');
      aftCaps++;
    } else if (flatZ && Math.abs(face.center.z - box.max.z) < 1e-6) {
      assert.ok(face.normal.z > .99, 'forward cap is culled from outside the cabin');
      forwardCaps++;
    } else {
      const radial = face.center.subtract(sectionCenter(face.center.z));
      assert.ok(Vector3.Dot(face.normal, radial) > .02,
        `cabin face points into the fuselage at ${face.center.asArray()}`);
      sides++;
    }
  }
  assert.ok(aftCaps > 0 && forwardCaps > 0 && sides > 0, 'closed cabin must include sides and both end caps');
});

test('spread rotor blades expose upward top faces and downward bottom faces', t => {
  const { casters } = fixture(t);
  const blades = named(casters, 'Seahawk-extended-main-rotor-blade');
  assert.equal(blades.length, 4);
  for (const blade of blades) {
    const vertices = points(blade);
    const isUpper = vertex => vertices.some(other => Math.abs(other.x - vertex.x) < 1e-5
      && Math.abs(other.z - vertex.z) < 1e-5 && other.y < vertex.y - .01);
    const isLower = vertex => vertices.some(other => Math.abs(other.x - vertex.x) < 1e-5
      && Math.abs(other.z - vertex.z) < 1e-5 && other.y > vertex.y + .01);
    let tops = 0, bottoms = 0;
    for (const face of triangles(blade)) {
      if ([face.a, face.b, face.c].every(isUpper)) {
        assert.ok(face.normal.y > .95, 'rotor top disappears when viewed from above');
        tops++;
      } else if ([face.a, face.b, face.c].every(isLower)) {
        assert.ok(face.normal.y < -.95, 'rotor underside disappears when viewed from below');
        bottoms++;
      }
    }
    assert.ok(tops > 0 && bottoms > 0, 'blade must have distinct closed upper and lower surfaces');
  }
});

test('cockpit glazing is visible outside the opaque cabin and nose', t => {
  const { casters } = fixture(t);
  const skinNames = new Set(['Seahawk-shaped-cabin-and-nose', 'Seahawk-rounded-lower-nose',
    'Seahawk-cockpit-side-shell', 'Seahawk-cockpit-roof']);
  const skin = casters.filter(mesh => skinNames.has(mesh.name)).flatMap(triangles);
  const cabin = bounds(points(named(casters, 'Seahawk-shaped-cabin-and-nose')[0]));
  const centerX = (cabin.min.x + cabin.max.x) / 2;
  const panes = casters.filter(mesh => /Seahawk-(forward-windscreen|pilot-(side|quarter)-glazing)/.test(mesh.name));
  assert.equal(panes.length, 6);
  const weights = [[1 / 3, 1 / 3, 1 / 3], [.9, .05, .05], [.05, .9, .05], [.05, .05, .9],
    [.475, .475, .05], [.475, .05, .475], [.05, .475, .475]];
  for (const pane of panes) for (const face of triangles(pane)) {
    const axis = pane.name.includes('forward') ? 'z' : 'x';
    assert.ok(axis === 'z' ? face.normal.z > .2 : Math.sign(face.center.x - centerX) * face.normal.x > .2,
      `${pane.name} does not face the viewer outside the cockpit`);
    for (const [a, b, c] of weights) {
      const sample = face.a.scale(a).add(face.b.scale(b)).add(face.c.scale(c));
      const obstruction = skin.map(triangle => rayDistance(sample, face.normal, triangle))
        .filter(distance => distance !== null && distance < 5);
      assert.equal(obstruction.length, 0, `${pane.name} is buried by fuselage skin at ${sample.asArray()}`);
    }
  }
});

test('paired submarine-hunting stores sit symmetrically clear of the fuselage', t => {
  const { casters, deckHeight } = fixture(t);
  const body = bounds(points(named(casters, 'Seahawk-shaped-cabin-and-nose')[0]));
  const centerX = (body.min.x + body.max.x) / 2;
  const stores = named(casters, 'Seahawk-submarine-hunting-store-body').map(mesh => bounds(points(mesh)))
    .sort((a, b) => a.min.x - b.min.x);
  assert.equal(stores.length, 2);
  const [port, starboard] = stores;
  assert.ok(port.max.x < body.min.x - .05 && starboard.min.x > body.max.x + .05,
    'weapon cylinders overlap the cabin instead of hanging beside it');
  for (const edge of ['min', 'max']) for (const axis of ['y', 'z']) {
    assert.ok(Math.abs(port[edge][axis] - starboard[edge][axis]) < 1e-5,
      `weapons are misaligned along ${axis}`);
  }
  assert.ok(Math.abs(port.min.x + starboard.max.x - centerX * 2) < 1e-5);
  assert.ok(Math.abs(port.max.x + starboard.min.x - centerX * 2) < 1e-5);
  for (const store of stores) assert.ok(store.min.y > deckHeight(store.min.z) + .018 + .15,
    'submarine-hunting store collides with the flight deck');
});

for (const slope of [-.03, .03]) test(`all three wheels contact the sloped flight-deck overlay (${slope})`, t => {
  const { casters, deckHeight } = fixture(t, slope);
  const wheels = casters.filter(mesh => /^Seahawk-(main-wheel|tail-wheel)$/.test(mesh.name));
  assert.equal(wheels.length, 3);
  for (const wheel of wheels) {
    const clearance = Math.min(...points(wheel).map(vertex => vertex.y - deckHeight(vertex.z) - .018));
    assert.ok(clearance >= -.001 && clearance <= .009,
      `${wheel.name} ${clearance < 0 ? 'sinks into' : 'floats above'} the flight deck by ${clearance.toFixed(4)} m`);
  }
});

test('static material batching preserves helicopter components when the ship moves', t => {
  const { root, casters } = fixture(t);
  const groups = [...new Set(casters.map(mesh => mesh.material))].map(material => {
    const parts = casters.filter(mesh => mesh.material === material);
    const samples = parts.flatMap(mesh => {
      const vertices = points(mesh), box = bounds(vertices);
      return [vertices[0], vertices[Math.floor(vertices.length / 2)], vertices.at(-1),
        vertices.reduce((a, b) => a.y < b.y ? a : b),
        vertices.find(v => Math.abs(v.x - box.max.x) < 1e-6)];
    });
    const vertexCount = parts.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
    const merged = parts.length > 1 ? Mesh.MergeMeshes(parts, true, true) : parts[0];
    assert.ok(merged, 'static helicopter material group failed to merge');
    merged.parent = root;
    return { merged, samples, vertexCount };
  });
  root.position.set(12, .7, -19);
  root.rotation.set(.035, .71, -.03);
  const shipMatrix = root.computeWorldMatrix(true);
  for (const { merged, samples, vertexCount } of groups) {
    const actual = points(merged);
    assert.equal(actual.length, vertexCount, 'batching lost geometry vertices');
    for (const sample of samples) {
      const expected = Vector3.TransformCoordinates(sample, shipMatrix);
      const distance = Math.sqrt(Math.min(...actual.map(vertex => Vector3.DistanceSquared(vertex, expected))));
      assert.ok(distance < .0001, `batching moved a component by ${distance.toFixed(6)} m`);
    }
  }
});
