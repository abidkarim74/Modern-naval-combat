import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

async function loadSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const { createGullBodyGeometry, createGullWingGeometry } = await loadSource('../src/world/gullGeometry.ts');
const { GullFlockFlight, GULL_CAPACITY, GULL_PASS_PERIOD_SECONDS } = await loadSource('../src/world/gullFlight.ts');

async function compiledModuleUrl(sourceUrl) {
  let compiled = ts.transpileModule(await readFile(sourceUrl, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const imports = [...compiled.matchAll(/\b(from\s+|import\s*)(["'])([^"']+)\2/g)];
  for (const match of imports) {
    const specifier = match[3];
    const url = specifier.startsWith('.')
      ? await compiledModuleUrl(new URL(`${specifier}.ts`, sourceUrl))
      : import.meta.resolve(specifier.endsWith('.js') ? specifier : `${specifier}.js`);
    compiled = compiled.replace(match[0], `${match[1]}${JSON.stringify(url)}`);
  }
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
}

const { AmbientSprites } = await import(await compiledModuleUrl(new URL('../src/world/createAmbientSprites.ts', import.meta.url)));

test('shared gull parts have finite shaded geometry and bounded triangle cost', () => {
  const parts = [createGullBodyGeometry(), createGullWingGeometry(false), createGullWingGeometry(true)];
  let birdTriangles = 0;
  for (const [partIndex, geometry] of parts.entries()) {
    const { positions, normals, colors, indices } = geometry;
    const vertices = positions.length / 3;
    assert.equal(normals.length, positions.length);
    assert.equal(colors.length, vertices * 4);
    assert.ok(indices instanceof Uint16Array);
    assert.ok(positions.every(Number.isFinite));
    assert.ok(normals.every(Number.isFinite));
    assert.ok(colors.every(Number.isFinite));
    for (let vertex = 0; vertex < vertices; vertex++) {
      assert.equal(colors[vertex * 4 + 3], 1, 'opaque plumage avoids sorted transparency');
      assert.ok(Math.abs(Math.hypot(...normals.slice(vertex * 3, vertex * 3 + 3)) - 1) < 1e-5);
    }
    for (let offset = 0; offset < indices.length; offset += 3) {
      const [a, b, c] = Array.from(indices.slice(offset, offset + 3));
      assert.ok(a < vertices && b < vertices && c < vertices);
      const u = [0, 1, 2].map(axis => positions[b * 3 + axis] - positions[a * 3 + axis]);
      const v = [0, 1, 2].map(axis => positions[c * 3 + axis] - positions[a * 3 + axis]);
      const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
      assert.ok(area > 1e-12, 'every triangle contributes an actual surface');
    }
    birdTriangles += indices.length / 3 * (partIndex === 0 ? 1 : 2);
  }
  assert.ok(birdTriangles < 1_700);
  const bodyZ = Array.from(parts[0].positions).filter((_, index) => index % 3 === 2);
  assert.ok(Math.max(...bodyZ) - Math.min(...bodyZ) >= .6);
  assert.ok(Math.max(...bodyZ) - Math.min(...bodyZ) <= .67);
  const outerX = Array.from(parts[2].positions).filter((_, index) => index % 3 === 0);
  const wingspan = 2 * (.065 + .335 + Math.max(...outerX));
  assert.ok(wingspan >= 1.4 && wingspan <= 1.6, 'adult gull dimensions stay in metres');
  assert.ok(parts[2].colors.some((value, index) => index % 4 === 0 && value < .1), 'outer primaries have dark tips');
  assert.ok(parts[2].colors.some((value, index) => index % 4 === 0 && value > .9), 'outer primaries retain white mirrors');
});

test('visible passes and calling sources respect every quality budget', () => {
  for (const count of [12, 10, 6, 0]) {
    const flight = new GullFlockFlight();
    flight.setBirdCount(count);
    let maximum = 0;
    for (let time = 0; time < GULL_PASS_PERIOD_SECONDS * 2; time += .125) {
      flight.update(time, 0, 0, 0, 12);
      const visible = flight.birds.filter(bird => bird.visible);
      maximum = Math.max(maximum, visible.length);
      assert.equal(flight.activeBirdCount, visible.length);
      assert.ok(visible.length <= count);
      assert.ok(flight.birds.every(bird => !bird.callEligible || bird.visible));
      assert.ok(flight.birds.filter(bird => bird.callEligible).length <= 4);
    }
    assert.equal(maximum, count);
  }
});

test('moving or rotating the camera cannot drag a pass already in flight', () => {
  const moving = new GullFlockFlight(), stationary = new GullFlockFlight();
  moving.update(0, 120, -85, .7, 25);
  stationary.update(0, 120, -85, .7, 25);
  moving.update(4, 8_000, -9_000, 2.8, 100);
  stationary.update(4, 120, -85, .7, 25);
  assert.deepEqual(moving.birds, stationary.birds);
  moving.update(13.1, 8_000, -9_000, 2.8, 100);
  stationary.update(13.1, 120, -85, .7, 25);
  assert.notEqual(moving.birds[6].x, stationary.birds[6].x, 'the next pass can anchor to the new viewer position');
});

test('flight reuses source objects, agrees across frame rates, and exposes analytic velocity', () => {
  const flight = new GullFlockFlight(), otherRate = new GullFlockFlight();
  const sources = [...flight.birds];
  flight.update(0, 20, 30, .4, 18);
  otherRate.update(0, 20, 30, .4, 18);
  for (let time = 1 / 30; time <= 2; time += 1 / 30) flight.update(time, 20, 30, .4, 18);
  for (let time = 1 / 144; time <= 2; time += 1 / 144) otherRate.update(time, 20, 30, .4, 18);
  flight.update(2, 20, 30, .4, 18);
  otherRate.update(2, 20, 30, .4, 18);
  assert.deepEqual(flight.birds, otherRate.birds);
  assert.equal(flight.birds.length, GULL_CAPACITY);
  for (let index = 0; index < sources.length; index++) assert.equal(flight.birds[index], sources[index]);
  const before = { ...flight.birds[0] };
  flight.update(2.0001, 20, 30, .4, 18);
  const after = flight.birds[0];
  assert.ok(Math.abs((after.x - before.x) / .0001 - before.velocityX) < .0001);
  assert.ok(Math.abs((after.y - before.y) / .0001 - before.velocityY) < .0001);
  assert.ok(Math.abs((after.z - before.z) / .0001 - before.velocityZ) < .0001);
  assert.ok(Math.hypot(before.velocityX, before.velocityZ) > 11);
  assert.ok(Math.hypot(before.velocityX, before.velocityZ) < 13);
});

test('close passes retain sensible altitude and mix articulated beats with stable glides', () => {
  const flight = new GullFlockFlight();
  let closest = Infinity, widestBeat = 0, quietFrames = 0;
  for (let time = 0; time < 15; time += .01) {
    flight.update(time, 0, 0, 0, 10);
    const bird = flight.birds[0];
    closest = Math.min(closest, Math.hypot(bird.x, bird.y - 10, bird.z));
    widestBeat = Math.max(widestBeat, Math.abs(bird.wingLift));
    if (Math.abs(bird.wingLift - .105) < .025) quietFrames++;
    assert.ok(bird.y > 14);
    assert.ok(Math.abs(bird.bank) < .1);
    assert.ok(Math.abs(bird.pitch) < .04);
    assert.ok(Math.abs(bird.wingTipLift) < .4);
  }
  assert.ok(closest >= 12 && closest <= 30);
  assert.ok(widestBeat > .7, 'active beats visibly articulate the wings');
  assert.ok(quietFrames > 700, 'long glides dominate rather than nonstop frantic flapping');
});

test('production gull instances preserve mirrored articulation and share three reusable mesh buffers', t => {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const birds = new AmbientSprites(scene, { birdCount: 12 });
  birds.update(.37, 150, 230, .6, 18);
  assert.equal(scene.meshes.length, 3);
  assert.equal(scene.materials.length, 1);
  const [body, inner, outer] = scene.meshes;
  assert.equal(body.thinInstanceCount, birds.activeBirdCount);
  assert.equal(inner.thinInstanceCount, birds.activeBirdCount * 2);
  assert.equal(outer.thinInstanceCount, birds.activeBirdCount * 2);
  assert.equal(body.material, inner.material);
  assert.equal(body.material, outer.material);
  assert.equal(body.material.twoSidedLighting, false,
    'closed mirrored surfaces retain outward normals independently of reversed triangle winding');
  assert.equal(body.material.backFaceCulling, false);
  const bodyWorld = body.thinInstanceGetWorldMatrices()[0];
  const bodyInverse = bodyWorld.clone().invert();
  for (const mesh of [inner, outer]) {
    const matrices = mesh.thinInstanceGetWorldMatrices();
    const right = matrices[0].multiply(bodyInverse), left = matrices[1].multiply(bodyInverse);
    const point = new Vector3(.24, 0, -.05);
    const rightPoint = Vector3.TransformCoordinates(point, right), leftPoint = Vector3.TransformCoordinates(point, left);
    // GPU float32 translations lose a few micrometres when inverted at 200 m.
    assert.ok(Math.abs(rightPoint.x + leftPoint.x) < 1e-4);
    assert.ok(Math.abs(rightPoint.y - leftPoint.y) < 1e-4);
    assert.ok(Math.abs(rightPoint.z - leftPoint.z) < 1e-4);
    const rightNormal = Vector3.TransformNormal(Vector3.Up(), right), leftNormal = Vector3.TransformNormal(Vector3.Up(), left);
    assert.ok(Math.abs(rightNormal.x + leftNormal.x) < 1e-5);
    assert.ok(Math.abs(rightNormal.y - leftNormal.y) < 1e-5);
    assert.ok(Math.abs(rightNormal.z - leftNormal.z) < 1e-5);
    assert.ok(right.determinant() > 0 && left.determinant() < 0);
  }
  const buffers = scene.meshes.map(mesh => mesh._thinInstanceDataStorage.matrixData);
  const snapshots = birds.birdAudioSnapshots;
  birds.setQuality({ birdCount: 6 });
  birds.update(1.5, 8000, 9000, 2, 100);
  assert.ok(birds.activeBirdCount <= 6);
  assert.equal(birds.birdAudioSnapshots, snapshots);
  scene.meshes.forEach((mesh, index) => assert.equal(mesh._thinInstanceDataStorage.matrixData, buffers[index]));
  birds.setQuality({ birdCount: 0 });
  birds.update(2, 0, 0, 0);
  assert.ok(scene.meshes.every(mesh => !mesh.isEnabled() && mesh.thinInstanceCount === 0));
});
