import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

// Load the production source without generated files. Side-effect imports must
// resolve as well: thinInstanceMesh registers the instance methods on Mesh.
const source = await readFile(new URL('../src/ships/destroyerVls.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/\b(from|import)\s+(["'])([^"']+)\2/g, (_match, prefix, _quote, specifier) => {
  const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
  assert.ok(!name.startsWith('.'), `unexpected runtime-relative import: ${name}`);
  return `${prefix} ${JSON.stringify(import.meta.resolve(name))}`;
});
const { createVlsLaunchCell } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const bankLayouts = {
  forward: { rows: 4, width: .73, depth: 1.23, thickness: .065, xSpacing: .91, zSpacing: 1.47, y: 6.235, z: 42 },
  aft: { rows: 8, width: .62, depth: 1, thickness: .1, xSpacing: .86, zSpacing: 1.3, y: 12.4, z: -30 },
};
const unitCorners = [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5].map(z => new Vector3(x, y, z))));
const near = (actual, expected, label, epsilon = 1e-5) => {
  assert.ok(Vector3.Distance(actual, expected) < epsilon,
    `${label}: ${actual.asArray()} differs from ${expected.asArray()}`);
};
const nearNumber = (actual, expected, label, epsilon = 1e-5) => {
  assert.ok(Math.abs(actual - expected) < epsilon, `${label}: ${actual} differs from ${expected}`);
};

function fixture(t) {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  // NullEngine exposes CPU instance buffers without requiring GPU support.
  engine.getCaps().instancedArrays = true;
  const scene = new Scene(engine);
  const ship = new Mesh('test-destroyer', scene);
  const paint = Object.fromEntries(['gray', 'light', 'dark', 'red'].map(name => [name, new PBRMaterial(name, scene)]));
  const casters = [];
  const records = [];
  for (const [bank, layout] of Object.entries(bankLayouts)) {
    for (let row = 0; row < layout.rows; row++) for (let column = 0; column < 8; column++) {
      const index = row * 8 + column;
      const options = {
        bank, index,
        x: (column - 3.5) * layout.xSpacing,
        y: layout.y,
        z: layout.z + (row - (layout.rows - 1) / 2) * layout.zSpacing,
        width: layout.width, depth: layout.depth, thickness: layout.thickness,
      };
      const cell = createVlsLaunchCell(scene, ship, casters, options, paint);
      records.push({ cell, options, instanceIndex: index });
    }
  }
  t.after(() => { scene.dispose(); engine.dispose(); });
  return { scene, ship, paint, casters, records };
}

function instancePoint(record, part, point = Vector3.Zero(), world = false) {
  const host = record.cell.hatchMeshes[part];
  const matrix = host.thinInstanceGetWorldMatrices()[record.instanceIndex];
  return Vector3.TransformCoordinates(point, world ? matrix.multiply(host.getWorldMatrix()) : matrix);
}

function updatePose(ship, casters, records) {
  ship.computeWorldMatrix(true);
  for (const { cell } of records) cell.hatchPivot.computeWorldMatrix(true);
  for (const host of casters) host.computeWorldMatrix(true);
}

test('96 launch cells share six caster hosts and 288 thin-instance matrices', t => {
  const { scene, ship, casters, records } = fixture(t);
  assert.equal(records.length, 96);
  assert.equal(records.filter(record => record.cell.bank === 'forward').length, 32);
  assert.equal(records.filter(record => record.cell.bank === 'aft').length, 64);
  assert.equal(casters.length, 6, 'each bank needs only one host for each of its three materials');
  assert.equal(new Set(casters).size, 6, 'shared hosts must not appear repeatedly in the shadow list');
  assert.equal(scene.meshes.length, 7, 'only the ship root and six geometry hosts should exist');
  assert.equal(scene.transformNodes.length, 96, 'each cell must retain an independent hinge');
  assert.equal(casters.reduce((count, host) => count + host.thinInstanceCount, 0), 288);
  for (const [bank, count] of [['forward', 32], ['aft', 64]]) {
    const bankRecords = records.filter(record => record.cell.bank === bank);
    const hosts = new Set(bankRecords.flatMap(record => record.cell.hatchMeshes));
    assert.equal(hosts.size, 3);
    for (const host of hosts) {
      assert.equal(host.parent, ship);
      assert.equal(host.thinInstanceCount, count);
      assert.equal(host.subMeshes.length, 1, 'each host is one instanced draw');
      assert.equal(host.receiveShadows, true);
      assert.equal(host.isPickable, false);
      assert.ok(casters.includes(host));
    }
  }
});

test('closed covers occupy their specified cells and the launch point lies on the panel top', t => {
  const { ship, casters, records } = fixture(t);
  updatePose(ship, casters, records);
  for (const record of records) {
    const { cell, options } = record;
    const { x, y, z, width, depth, thickness } = options;
    assert.equal(cell.hatchPivot.parent, ship);
    near(instancePoint(record, 0), new Vector3(x, y, z), 'closed panel center');
    near(instancePoint(record, 0, new Vector3(0, .5, 0)), cell.launchPoint, 'launch point on panel top');
    near(cell.launchPoint, new Vector3(x, y + thickness / 2, z), 'root-local launch point');
    near(instancePoint(record, 0, new Vector3(0, 0, -.5)), cell.hatchPivot.position, 'hinge remains at aft panel edge');
    near(instancePoint(record, 0, new Vector3(.5, 0, .5)), new Vector3(x + width / 2, y, z + depth / 2), 'panel dimensions');
    near(instancePoint(record, 1), new Vector3(x, y + thickness / 2 + .006, z), 'seam lies above the cover');
    const fittingCenter = instancePoint(record, 2);
    nearNumber(fittingCenter.x, x, 'fitting is centered across the cover');
    assert.ok(fittingCenter.y > cell.launchPoint.y, 'tab or grip should sit above the panel');
    assert.ok(Math.abs(fittingCenter.z - z) < depth / 2, 'tab or grip should sit on the cover');
    assert.equal(cell.hatchPivot.rotation.x, 0);
  }
});

test('opening raises panel, seam and fittings rigidly while adjacent cells stay closed', t => {
  const { ship, casters, records } = fixture(t);
  updatePose(ship, casters, records);
  for (const bank of ['forward', 'aft']) {
    const selected = records.filter(record => record.cell.bank === bank)[12];
    const neighbor = records.filter(record => record.cell.bank === bank)[13];
    const launchPoint = selected.cell.launchPoint.clone();
    const closedParts = [0, 1, 2].map(part => instancePoint(selected, part));
    const neighborClosed = [0, 1, 2].map(part => instancePoint(neighbor, part));
    const closedHinge = instancePoint(selected, 0, new Vector3(0, 0, -.5));
    for (const angle of [-.45, -1.1, -1.65]) {
      selected.cell.hatchPivot.rotation.x = angle;
      updatePose(ship, casters, records);
      const openParts = [0, 1, 2].map(part => instancePoint(selected, part));
      near(instancePoint(selected, 0, new Vector3(0, 0, -.5)), closedHinge, 'hinge must not drift');
      const raisedEdge = instancePoint(selected, 0, new Vector3(0, 0, .5));
      nearNumber(raisedEdge.y - closedHinge.y, -Math.sin(angle) * selected.options.depth, 'front edge height');
      nearNumber(raisedEdge.z - closedHinge.z, Math.cos(angle) * selected.options.depth, 'front edge sweep');
      for (let part = 0; part < 3; part++) {
        assert.ok(openParts[part].y > closedParts[part].y, 'every attached hatch part must rise');
        nearNumber(Vector3.Distance(openParts[part], closedHinge), Vector3.Distance(closedParts[part], closedHinge), 'part keeps its hinge radius');
        near(instancePoint(neighbor, part), neighborClosed[part], 'opening one instance cannot alter its neighbor');
      }
      for (let part = 1; part < 3; part++) {
        nearNumber(Vector3.Distance(openParts[0], openParts[part]), Vector3.Distance(closedParts[0], closedParts[part]), 'fitting keeps its attachment distance');
      }
      near(selected.cell.launchPoint, launchPoint, 'launch point must not follow the lid');
    }
    selected.cell.hatchPivot.rotation.x = 0;
    updatePose(ship, casters, records);
    for (let part = 0; part < 3; part++) near(instancePoint(selected, part), closedParts[part], 'cover closes to its original placement');
  }
});

test('host bounds cover open covers and follow a moving, pitched and rolled ship', t => {
  const { ship, casters, records } = fixture(t);
  for (const angle of [0, -.6, -1.65]) {
    for (const { cell } of records) cell.hatchPivot.rotation.x = angle;
    for (const moved of [false, true]) {
      ship.position.set(moved ? 420 : 0, moved ? 3.7 : 0, moved ? -230 : 0);
      ship.rotation.set(moved ? .11 : 0, moved ? .8 : 0, moved ? -.07 : 0);
      updatePose(ship, casters, records);
      for (const record of records) for (let part = 0; part < 3; part++) {
        const host = record.cell.hatchMeshes[part];
        const bounds = host.getBoundingInfo().boundingBox;
        for (const corner of unitCorners) {
          const local = instancePoint(record, part, corner);
          const world = instancePoint(record, part, corner, true);
          // The GPU instance matrix stores Float32 values; composing it at a
          // translated ship origin can differ by a few tens of micrometres.
          near(world, Vector3.TransformCoordinates(local, ship.getWorldMatrix()), 'ship transform is applied exactly once', 1e-4);
          for (const axis of ['x', 'y', 'z']) {
            assert.ok(world[axis] >= bounds.minimumWorld[axis] - 1e-4 && world[axis] <= bounds.maximumWorld[axis] + 1e-4,
              `${record.cell.bank} open ${angle} ${part} corner falls outside world bounds on ${axis}`);
          }
        }
      }
    }
  }
});

test('ships in the same scene have isolated instance hosts and shadow lists', t => {
  const { scene, ship, paint, casters, records } = fixture(t);
  const anotherShip = new Mesh('another-destroyer', scene);
  const otherCasters = [];
  const options = { ...records[0].options, index: 0 };
  const otherCell = createVlsLaunchCell(scene, anotherShip, otherCasters, options, paint);
  assert.equal(otherCasters.length, 3);
  assert.equal(new Set(otherCasters).size, 3);
  for (const host of otherCasters) {
    assert.equal(host.parent, anotherShip);
    assert.equal(host.thinInstanceCount, 1);
    assert.ok(!casters.includes(host), 'a second ship must not reuse the first ship GPU buffers');
  }
  const first = records[0];
  const before = first.cell.hatchMeshes[0].thinInstanceGetWorldMatrices()[0].clone();
  otherCell.hatchPivot.rotation.x = -1.65;
  otherCell.hatchPivot.computeWorldMatrix(true);
  assert.ok(first.cell.hatchMeshes[0].thinInstanceGetWorldMatrices()[0].equals(before), 'other ship hatch must not alter this ship');
  assert.equal(casters.length, 6);
  assert.equal(ship.getChildMeshes().length, 6);
});
