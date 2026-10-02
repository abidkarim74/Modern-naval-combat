import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, islandHeight } from '@naval/shared';

const source = await readFile(new URL('../src/game/IslandCamera.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/\b(from|import)\s+(["'])([^"']+)\2/g, (_match, prefix, _quote, specifier) => {
  const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
  return `${prefix} ${JSON.stringify(import.meta.resolve(name))}`;
});
const { IslandCamera } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture(t, width = 32, height = 32) {
  const engine = new NullEngine({ renderWidth: width, renderHeight: height });
  const scene = new Scene(engine);
  const controller = new IslandCamera(scene, 6_800);
  scene.activeCamera = controller.camera;
  t.after(() => { scene.dispose(); engine.dispose(); });
  controller.camera.getViewMatrix(true);
  return controller;
}

test('the elongated island overview fits both portrait and wide windows', t => {
  for (const [width, height] of [[406, 532], [1280, 800]]) {
    const controller = fixture(t, width, height);
    const { camera } = controller;
    controller.reset();
    const viewProjection = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    for (let segment = 0; segment < 64; segment++) {
      const angle = segment / 64 * Math.PI * 2;
      const x = Math.cos(angle) * ISLAND_RADIUS_X;
      const z = Math.sin(angle) * ISLAND_RADIUS_Z;
      const projected = Vector3.TransformCoordinates(new Vector3(ISLAND_CENTER.x + x, 0, ISLAND_CENTER.z + z), viewProjection);
      assert.ok(Math.abs(projected.x) < .98 && Math.abs(projected.y) < .98,
        `coast leaves the overview at ${width} by ${height}`);
    }
  }
});

function settle(camera) {
  camera.update();
  camera.getViewMatrix(true);
}

function horizontalDirection(vector) {
  return new Vector3(vector.x, 0, vector.z).normalize();
}

test('island orbit stays upright and scroll zoom stays within inspection limits', t => {
  const { camera } = fixture(t);
  assert.ok(camera.radius > camera.lowerRadiusLimit && camera.radius < camera.upperRadiusLimit);
  assert.ok(camera.lowerRadiusLimit > camera.minZ);
  assert.equal(camera.maxZ, 6_800);
  camera.beta = -.8;
  camera.radius = -100;
  settle(camera);
  assert.equal(camera.beta, camera.lowerBetaLimit);
  assert.equal(camera.radius, camera.lowerRadiusLimit);
  assert.ok(camera.position.y > 0);
  camera.beta = Math.PI * 1.7;
  camera.radius = 100_000;
  settle(camera);
  assert.equal(camera.beta, camera.upperBetaLimit);
  assert.equal(camera.radius, camera.upperRadiusLimit);
  assert.ok(camera.beta < Math.PI / 2, 'orbit must not flip beneath the coast');
  assert.ok([camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite));
});

test('keyboard pan follows the viewing direction and its right axis at different orbit angles', t => {
  const controller = fixture(t);
  const { camera } = controller;
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    controller.reset();
    camera.alpha = angle;
    camera.getViewMatrix(true);
    const forward = horizontalDirection(camera.target.subtract(camera.position));
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const beforeForward = camera.target.clone();
    controller.update({ throttle: 1, steering: 0 }, .1);
    const movedForward = horizontalDirection(camera.target.subtract(beforeForward));
    assert.ok(Vector3.Dot(movedForward, forward) > .9999, 'W pans into the scene at any orbit angle');

    const beforeRight = camera.target.clone();
    controller.update({ throttle: 0, steering: 1 }, .1);
    const movedRight = horizontalDirection(camera.target.subtract(beforeRight));
    assert.ok(Vector3.Dot(movedRight, right) > .9999, 'D pans right relative to the current camera');
  }
});

test('diagonal pan has the same speed as straight pan and cannot leave the island area', t => {
  const controller = fixture(t);
  const { camera } = controller;
  const distanceMoved = input => {
    controller.reset();
    const before = camera.target.clone();
    controller.update(input, .1);
    return Math.hypot(camera.target.x - before.x, camera.target.z - before.z);
  };
  assert.ok(Math.abs(distanceMoved({ throttle: 1, steering: 1 }) - distanceMoved({ throttle: 1, steering: 0 })) < 1e-8);
  for (const sign of [-1, 1]) {
    camera.target.set(ISLAND_CENTER.x + sign * 100_000, -1_000, ISLAND_CENTER.z + sign * 100_000);
    controller.update({ throttle: 0, steering: 0 }, .1);
    assert.ok(Math.abs(camera.target.x - ISLAND_CENTER.x) < ISLAND_RADIUS_X * 1.25);
    assert.ok(Math.abs(camera.target.z - ISLAND_CENTER.z) < ISLAND_RADIUS_Z * 1.6);
    assert.ok(camera.target.y >= 12, 'panning cannot move the focal point underwater');
  }
});

test('close and low island inspection keeps the viewpoint clear of sampled hills and water', t => {
  const controller = fixture(t);
  const { camera } = controller;
  for (const [x, z] of [[-115, 78], [-207, 55], [-9, 112], [70, -79], [267, 90], [350, -210], [-380, 150]]) {
    for (const radius of [55, 90, 300, 700]) {
      for (const alpha of [0, Math.PI / 2, Math.PI, -Math.PI / 2, -.65]) {
        camera.target.set(ISLAND_CENTER.x + x, 0, ISLAND_CENTER.z + z);
        camera.alpha = alpha;
        camera.beta = camera.upperBetaLimit;
        camera.radius = radius;
        settle(camera);
        const floor = Math.max(8, islandHeight(camera.position.x - ISLAND_CENTER.x, camera.position.z - ISLAND_CENTER.z) + 10);
        assert.ok(camera.position.y >= floor - 1e-5,
          `viewpoint intersects terrain at target (${x}, ${z}), radius ${radius}, alpha ${alpha}`);
        const ground = islandHeight(camera.target.x - ISLAND_CENTER.x, camera.target.z - ISLAND_CENTER.z);
        assert.ok(camera.target.y >= ground + 14 - 1e-5, 'focal point remains above the hillside');
      }
    }
  }
});

test('orbit and zoom across cliff faces retain a clear camera endpoint over the whole island', t => {
  const { camera } = fixture(t);
  const targets = [];
  for (let x = -420; x <= 420; x += 84) {
    for (let z = -300; z <= 300; z += 75) targets.push([x, z]);
  }
  // Include the outpost-to-ridge transition that exposed the previous
  // clearance correction stopping inside a newly sampled cliff face.
  targets.push([267, 90]);
  for (const [x, z] of targets) {
    for (const radius of [55, 90, 180, 300, 700, 1_250]) {
      for (let direction = 0; direction < 12; direction++) {
        camera.target.set(ISLAND_CENTER.x + x, 0, ISLAND_CENTER.z + z);
        camera.alpha = direction * Math.PI / 6;
        camera.beta = camera.upperBetaLimit;
        camera.radius = radius;
        settle(camera);
        const floor = Math.max(8, islandHeight(camera.position.x - ISLAND_CENTER.x, camera.position.z - ISLAND_CENTER.z) + 10);
        assert.ok(camera.position.y >= floor - 1e-5,
          `camera endpoint enters a cliff at (${x}, ${z}), radius ${radius}, direction ${direction}`);
        assert.ok(camera.beta >= camera.lowerBetaLimit && camera.beta <= camera.upperBetaLimit);
      }
    }
  }
});

test('reset restores the island overview and cancels every pending orbit, zoom and pan movement', t => {
  const controller = fixture(t);
  const { camera } = controller;
  const overview = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone(), position: camera.position.clone() };
  camera.alpha += 1;
  camera.beta = .3;
  camera.radius = 70;
  controller.update({ throttle: 1, steering: -1 }, 1);
  camera.inertialAlphaOffset = .5;
  camera.inertialBetaOffset = .5;
  camera.inertialRadiusOffset = 10;
  camera.inertialPanningX = 5;
  camera.inertialPanningY = 5;
  controller.reset();
  assert.equal(camera.alpha, overview.alpha);
  assert.equal(camera.beta, overview.beta);
  assert.equal(camera.radius, overview.radius);
  assert.deepEqual(camera.target, overview.target);
  assert.ok(Vector3.Distance(camera.position, overview.position) < 1e-8);
  assert.deepEqual([camera.inertialAlphaOffset, camera.inertialBetaOffset, camera.inertialRadiusOffset,
    camera.inertialPanningX, camera.inertialPanningY], [0, 0, 0, 0, 0]);
});
