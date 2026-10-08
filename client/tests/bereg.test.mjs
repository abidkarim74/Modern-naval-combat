import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import {
  ISLAND_CENTER, ISLAND_BASE, ISLAND_HELIPAD, ISLAND_RADAR_SITE,
  ISLAND_BEREG_SITES, islandHeight,
} from '@naval/shared';

const sourceModules = new Map();
async function productionModuleUrl(url) {
  if (sourceModules.has(url.href)) return sourceModules.get(url.href);
  const source = await readFile(url, 'utf8');
  let compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const imports = [...compiled.matchAll(/\b(from|import)\s+(["'])([^"']+)\2/g)];
  for (const match of imports.reverse()) {
    const specifier = match[3];
    const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js')
      ? `${specifier}.js` : specifier;
    const resolved = name.startsWith('.')
      ? await productionModuleUrl(new URL(name.replace(/\.js$/, '') + '.ts', url))
      : import.meta.resolve(name);
    compiled = compiled.slice(0, match.index) + `${match[1]} ${JSON.stringify(resolved)}`
      + compiled.slice(match.index + match[0].length);
  }
  const result = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  sourceModules.set(url.href, result);
  return result;
}
const { createBereg } = await import(await productionModuleUrl(new URL('../src/world/createBereg.ts', import.meta.url)));
const { createIsland } = await import(await productionModuleUrl(new URL('../src/world/createIsland.ts', import.meta.url)));

function fixture(t) {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  engine.getCaps().instancedArrays = true;
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  return scene;
}

function features(meshes, expression) {
  return meshes.flatMap(mesh => (mesh.metadata?.featureRanges ?? [])
    .filter(range => expression.test(range.name)).map(range => ({ mesh, range })));
}

function featureBounds({ mesh, range }, world = false) {
  const positions = mesh.getVerticesData('position');
  const minimum = new Vector3(Infinity, Infinity, Infinity);
  const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
  const matrix = world ? mesh.computeWorldMatrix(true) : null;
  for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex++) {
    let point = Vector3.FromArray(positions, vertex * 3);
    if (matrix) point = Vector3.TransformCoordinates(point, matrix);
    minimum.minimizeInPlace(point);
    maximum.maximizeInPlace(point);
  }
  return { minimum, maximum, center: minimum.add(maximum).scale(.5) };
}

function outwardNormalRatio({ mesh, range }) {
  const positions = mesh.getVerticesData('position');
  const normals = mesh.getVerticesData('normal');
  const indices = mesh.getIndices();
  const { center } = featureBounds({ mesh, range });
  let outward = 0, sampled = 0;
  for (let index = range.indexStart; index < range.indexStart + range.indexCount; index += 3) {
    const vertices = [indices[index], indices[index + 1], indices[index + 2]];
    const points = vertices.map(vertex => Vector3.FromArray(positions, vertex * 3));
    const edgeA = points[1].subtract(points[0]), edgeB = points[2].subtract(points[0]);
    if (Vector3.Cross(edgeA, edgeB).lengthSquared() < 1e-12) continue;
    const normal = vertices.reduce((sum, vertex) => sum.addInPlace(Vector3.FromArray(normals, vertex * 3)), Vector3.Zero());
    const triangleCenter = points.reduce((sum, point) => sum.addInPlace(point), Vector3.Zero()).scale(1 / 3);
    sampled++;
    if (Vector3.Dot(normal, triangleCenter.subtract(center)) > 1e-6) outward++;
  }
  assert.ok(sampled >= 8, `${range.name} must have a solid exterior`);
  return outward / sampled;
}

test('four Bereg copies share batched geometry and apply cardinal heading and island translation once', t => {
  const scene = fixture(t);
  const root = new TransformNode('translated-island', scene);
  root.position.set(660, 0, 2_050);
  const placements = [
    { x: -240, y: 30, z: 130, heading: 0 },
    { x: -160, y: 31, z: -40, heading: Math.PI / 2 },
    { x: -320, y: 32, z: -70, heading: Math.PI },
    { x: -405, y: 33, z: 15, heading: -Math.PI / 2 },
  ];
  const copies = placements.map((placement, index) => createBereg(scene, root,
    placement.x, placement.y, placement.z, placement.heading, `test-${index}`));
  const prototype = copies[0].meshes;
  assert.ok(prototype.length >= 3 && prototype.length <= 8,
    'close-up fittings must remain combined into a small number of material batches');
  assert.ok(prototype.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0) <= 9_000,
    'the shared prototype must retain its bounded close-up triangle cost');
  const geometryByMaterial = new Map(prototype.map(mesh => [mesh.material, mesh.geometry]));
  for (let copy = 0; copy < copies.length; copy++) {
    const vehicle = copies[copy], placement = placements[copy];
    assert.equal(vehicle.meshes.length, prototype.length);
    assert.ok(vehicle.shadowCasters.length > 0);
    assert.ok(vehicle.shadowCasters.every(mesh => vehicle.meshes.includes(mesh)),
      'shadows must reference the placed copies rather than the unplaced template');
    for (const mesh of vehicle.meshes) {
      assert.equal(mesh.geometry, geometryByMaterial.get(mesh.material),
        'all four vehicles must share their vertex buffers and materials');
      assert.equal(mesh.metadata?.beregId, `test-${copy}`);
      assert.equal(mesh.metadata?.facility, 'bereg');
      assert.ok(mesh.isEnabled() && mesh.isVisible, 'every installed batch must render');
      const positions = mesh.getVerticesData('position');
      assert.ok(positions.every(Number.isFinite));
      assert.ok(mesh.getVerticesData('normal').every(Number.isFinite));
      const matrix = mesh.computeWorldMatrix(true);
      for (let vertex = 0; vertex < mesh.getTotalVertices(); vertex += Math.max(1, Math.floor(mesh.getTotalVertices() / 20))) {
        const local = Vector3.FromArray(positions, vertex * 3);
        const actual = Vector3.TransformCoordinates(local, matrix);
        const cos = Math.cos(placement.heading), sin = Math.sin(placement.heading);
        const expected = new Vector3(root.position.x + placement.x + local.x * cos + local.z * sin,
          placement.y + local.y, root.position.z + placement.z - local.x * sin + local.z * cos);
        assert.ok(Vector3.Distance(actual, expected) < 1e-3,
          'batching must retain vehicle-local geometry and apply placement and heading exactly once');
      }
    }
  }
  assert.equal(new Set(copies.flatMap(copy => copy.meshes.map(mesh => mesh.geometry))).size, prototype.length,
    'four copies must not quadruple geometry allocation');
});

test('Bereg wheel contact and visible hull surfaces remain valid after merging', t => {
  const scene = fixture(t);
  const vehicle = createBereg(scene, new TransformNode('island', scene), 0, 0, 0, 0, 'geometry');
  const tires = features(vehicle.meshes, /^bereg-tire-axle-/);
  assert.equal(tires.length, 8, 'the four-axle chassis needs eight separate road wheels');
  const axleCenters = [];
  for (const tire of tires) {
    const { minimum, maximum, center } = featureBounds(tire);
    assert.ok(minimum.y >= -.08 && minimum.y < .12, 'tires must meet the ground without sinking or floating');
    assert.ok(maximum.y - minimum.y > 1.3, 'tires must retain their full-size curved sidewalls');
    assert.ok(Math.abs(center.x) > .8, 'wheels must sit on both sides of the chassis');
    const axle = axleCenters.find(candidate => Math.abs(candidate.z - center.z) < .05);
    if (axle) axle.sides.push(Math.sign(center.x));
    else axleCenters.push({ z: center.z, sides: [Math.sign(center.x)] });
  }
  assert.equal(axleCenters.length, 4);
  assert.ok(axleCenters.every(axle => axle.sides.length === 2 && axle.sides[0] !== axle.sides[1]),
    'each axle must retain a left and right wheel');
  const supports = features(vehicle.meshes, /^bereg-stabilizer-footpad/);
  assert.equal(supports.length, 4, 'the deployed truck needs four stabilizing footpads');
  assert.ok(supports.every(support => Math.abs(featureBounds(support).minimum.y) < .02),
    'all stabilizer feet must sit on the same ground plane');
  for (const expression of [/^bereg-asymmetric-left-cab$/, /^bereg-angular-rear-turret$/, /^bereg-cannon-barrel$/]) {
    const exterior = features(vehicle.meshes, expression);
    assert.equal(exterior.length, 1, `the model must retain the principal exterior matching ${expression}`);
    assert.ok(outwardNormalRatio(exterior[0]) > .9,
      `${exterior[0].range.name} must face outward for daylight shading and backface culling`);
  }
});

test('the island installs four grounded outward-facing Bereg vehicles in separate clearings', t => {
  const scene = fixture(t);
  const island = createIsland(scene);
  assert.equal(ISLAND_BEREG_SITES.length, 4);
  const directions = new Set();
  const occupied = [];
  const compound = { x: ISLAND_BASE.x, z: ISLAND_BASE.z, halfX: 77, halfZ: 59.5 };
  for (const site of ISLAND_BEREG_SITES) {
    const meshes = scene.meshes.filter(mesh => mesh.metadata?.facility === 'bereg' && mesh.metadata.beregId === site.id);
    assert.ok(meshes.length > 0 && meshes.length <= 8, `missing or unbatched vehicle at ${site.id}`);
    assert.ok(meshes.every(mesh => mesh.isWorldMatrixFrozen), 'parked vehicles must avoid per-frame matrix work');
    assert.ok(meshes.some(mesh => island.shadowCasters.includes(mesh)), 'placed vehicles must cast shadows');
    const antenna = meshes.find(mesh => !mesh.receiveShadows);
    assert.ok(antenna && !antenna.checkCollisions && !island.shadowCasters.includes(antenna),
      'fine antenna wires must stay visual during close camera inspection');
    const direction = new Vector3(Math.sin(site.heading), 0, Math.cos(site.heading));
    directions.add(`${Math.round(direction.x)},${Math.round(direction.z)}`);
    const fromCompound = new Vector3(site.x - ISLAND_BASE.x, 0, site.z - ISLAND_BASE.z).normalize();
    assert.ok(Vector3.Dot(direction, fromCompound) > .5,
      'each barrel must point outward from the base toward its own sector');
    const bounds = meshes.map(mesh => mesh.getBoundingInfo().boundingBox);
    const minimum = new Vector3(Math.min(...bounds.map(box => box.minimumWorld.x)) - ISLAND_CENTER.x,
      Math.min(...bounds.map(box => box.minimumWorld.y)), Math.min(...bounds.map(box => box.minimumWorld.z)) - ISLAND_CENTER.z);
    const maximum = new Vector3(Math.max(...bounds.map(box => box.maximumWorld.x)) - ISLAND_CENTER.x,
      Math.max(...bounds.map(box => box.maximumWorld.y)), Math.max(...bounds.map(box => box.maximumWorld.z)) - ISLAND_CENTER.z);
    assert.ok(minimum.x >= site.x - site.halfX - .1 && maximum.x <= site.x + site.halfX + .1
      && minimum.z >= site.z - site.halfZ - .1 && maximum.z <= site.z + site.halfZ + .1,
    'the entire deployed vehicle must fit its graded pad');
    const feet = features(meshes, /^bereg-stabilizer-footpad/);
    assert.equal(feet.length, 4);
    for (const foot of feet) {
      const { minimum: footMinimum, center } = featureBounds(foot, true);
      const contactY = footMinimum.y;
      assert.ok(contactY >= islandHeight(site.x, site.z) - .1,
        'deployed supports must remain above the surveyed terrain');
      const contactRay = new Ray(new Vector3(center.x, contactY + 1, center.z), new Vector3(0, -1, 0), 2);
      const padHit = scene.pickWithRay(contactRay, mesh => mesh.metadata?.facility === 'bereg-sites');
      assert.ok(padHit?.hit, 'every stabilizer must have an actual apron surface below it');
      assert.ok(Math.abs(contactY - padHit.pickedPoint.y) < .06,
        `${site.id} stabilizer must touch its apron rather than float above or sink into it`);
    }
    const occupiedBounds = { minimum, maximum };
    for (const existing of [compound, ISLAND_HELIPAD, ISLAND_RADAR_SITE]) {
      const intersects = minimum.x < existing.x + existing.halfX && maximum.x > existing.x - existing.halfX
        && minimum.z < existing.z + existing.halfZ && maximum.z > existing.z - existing.halfZ;
      assert.equal(intersects, false, 'vehicles must clear the compound, helipad and coastal radar');
    }
    for (const existing of occupied) {
      const intersects = minimum.x < existing.maximum.x && maximum.x > existing.minimum.x
        && minimum.z < existing.maximum.z && maximum.z > existing.minimum.z;
      assert.equal(intersects, false, 'the four vehicles must have separate deployment space');
    }
    occupied.push(occupiedBounds);
  }
  assert.deepEqual(directions, new Set(['0,1', '1,0', '0,-1', '-1,0']),
    'the four guns must face all four cardinal sectors');
});
