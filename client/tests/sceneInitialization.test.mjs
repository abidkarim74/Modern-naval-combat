import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { FollowCamera } from '@babylonjs/core/Cameras/followCamera.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { BoatSimulation, ISLAND_BASE, ISLAND_CENTER, ISLAND_HILL_POSTS, ISLAND_HELIPAD, islandHeight } from '@naval/shared';
import { Ray } from '@babylonjs/core/Culling/ray.js';

async function loadProductionSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replace(/\b(from|import)\s+(["'])([^"']+)\2/g, (_match, prefix, _quote, specifier) => {
    const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
    assert.ok(!name.startsWith('.'), `unexpected runtime-relative import: ${name}`);
    return `${prefix} ${JSON.stringify(import.meta.resolve(name))}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const { mergeStaticMeshes } = await loadProductionSource('../src/ships/mergeStaticMeshes.ts');
const { createIsland } = await loadProductionSource('../src/world/createIsland.ts');
const { IslandCamera } = await loadProductionSource('../src/game/IslandCamera.ts');
const { BoatKeyboardInput } = await loadProductionSource('../src/game/BoatKeyboardInput.ts');
const { GRAPHICS_QUALITY_SETTINGS } = await loadProductionSource('../src/game/graphicsQuality.ts');

// Exercise production mode changes without the browser, audio or ocean renderer.
const sessionSource = await readFile(new URL('../src/game/GameSession.ts', import.meta.url), 'utf8');
const sessionAst = ts.createSourceFile('GameSession.ts', sessionSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const sessionClass = sessionAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GameSession');
const sessionMethods = ['viewIsland', 'setCameraView', 'resetIslandView', 'readShipControls', 'launchMissile']
  .map(name => {
    const method = sessionClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(sessionAst) === name);
    assert.ok(method, `production ${name} method must exist`);
    return method.getText(sessionAst);
  });
const harnessSource = ts.transpileModule(`
  const GRAPHICS_QUALITY_SETTINGS = ${JSON.stringify(GRAPHICS_QUALITY_SETTINGS)};
  export class IslandSessionHarness { ${sessionMethods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { IslandSessionHarness } = await import(`data:text/javascript;base64,${Buffer.from(harnessSource).toString('base64')}`);

function keyboardFixture(t) {
  const previous = new Map();
  for (const [name, value] of Object.entries({
    window: new EventTarget(), document: new EventTarget(),
    HTMLInputElement: class {}, HTMLTextAreaElement: class {},
    HTMLSelectElement: class {}, HTMLElement: class {},
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const input = new BoatKeyboardInput();
  t.after(() => {
    input.dispose();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    input,
    press(key) {
      const event = new Event('keydown', { cancelable: true });
      Object.defineProperty(event, 'key', { value: key });
      window.dispatchEvent(event);
    },
  };
}

function islandSessionFixture(t) {
  const scene = fixture(t);
  const simulation = new BoatSimulation();
  const keyboard = keyboardFixture(t);
  const anchor = new Mesh('camera-anchor', scene);
  const camera = new FollowCamera('ship-camera', new Vector3(100, 100, 100), scene, anchor);
  const islandCamera = new IslandCamera(scene, 6_800);
  const attachmentChanges = [];
  camera.attachControl = () => attachmentChanges.push('attach ship');
  camera.detachControl = () => attachmentChanges.push('detach ship');
  islandCamera.camera.attachControl = () => attachmentChanges.push('attach island');
  islandCamera.camera.detachControl = () => attachmentChanges.push('detach island');
  const telemetryModes = [];
  const shadowUpdates = [];
  const launches = [];
  const session = new IslandSessionHarness();
  Object.assign(session, {
    simulation, camera, islandCamera, scene, input: keyboard.input, audio: { shipControlsEnabled: true },
    cameraView: 'chase', qualityValue: 'High', inputScratch: { throttle: 0, steering: 0 },
    forwardCamera: new FreeCamera('gun-camera', Vector3.Zero(), scene),
    missileCamera: new FreeCamera('missile-camera', Vector3.Zero(), scene),
    boat: { shadowCasters: ['ship casters'] }, island: { shadowCasters: ['island casters'] },
    sky: { setQuality(settings, casters) { shadowUpdates.push(casters); } },
    missiles: { trackingState: null, launch(bank) { launches.push(bank); return true; } },
    publishTelemetry() { telemetryModes.push(this.cameraView); },
  });
  scene.activeCamera = camera;
  return { session, keyboard, camera, islandCamera, scene, simulation,
    attachmentChanges, telemetryModes, shadowUpdates, launches };
}

function fixture(t) {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  engine.getCaps().instancedArrays = true;
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  return scene;
}

test('static batching keeps incompatible vertex layouts separate and preserves animated fittings', t => {
  const scene = fixture(t);
  const root = new Mesh('ship-root', scene);
  const material = new PBRMaterial('shared-paint', scene);
  const boxes = [0, 1].map(index => {
    const mesh = CreateBox(`primitive-${index}`, { size: 1 }, scene);
    mesh.parent = root;
    mesh.material = material;
    mesh.position.x = index * 2;
    return mesh;
  });
  const panels = [0, 1].map(index => {
    const mesh = new Mesh(`panel-without-uvs-${index}`, scene);
    const data = new VertexData();
    data.positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    data.indices = [0, 1, 2];
    data.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    data.applyToMesh(mesh);
    mesh.parent = root;
    mesh.material = material;
    mesh.position.x = 5 + index * 2;
    return mesh;
  });
  const animated = CreateBox('moving-hatch', { size: 1 }, scene);
  animated.parent = root;
  animated.material = material;
  const parts = [...boxes, ...panels];
  const vertexCount = parts.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
  const indexCount = parts.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0);
  const casters = [...parts, animated];

  assert.doesNotThrow(() => mergeStaticMeshes(root, casters, new Set([animated])));
  assert.equal(casters.length, 3);
  assert.ok(casters.includes(animated));
  assert.equal(animated.isDisposed(), false);
  const batches = casters.filter(mesh => mesh !== animated);
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0), vertexCount);
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0), indexCount);
  assert.equal(batches.filter(mesh => mesh.isVerticesDataPresent('uv')).length, 1);
  for (const mesh of batches) {
    assert.equal(mesh.parent, root);
    assert.equal(mesh.material, material);
    assert.equal(mesh.receiveShadows, true);
    assert.equal(mesh.isPickable, false);
  }
  assert.ok(parts.every(mesh => mesh.isDisposed()));
});

test('island construction succeeds with instanced trees and upward terrain and road normals', t => {
  const scene = fixture(t);
  let island;
  assert.doesNotThrow(() => { island = createIsland(scene); });
  assert.ok(island.shadowCasters.length > 0);
  assert.ok(island.shadowCasters.every(mesh => !mesh.isDisposed()));
  assert.ok(scene.meshes.some(mesh => mesh.getClassName() === 'InstancedMesh'));

  for (const name of ['north-watch-island-terrain', 'north-watch-switchback-road']) {
    const mesh = scene.getMeshByName(name);
    assert.ok(mesh, `${name} must exist`);
    const positions = mesh.getVerticesData('position');
    const normals = mesh.getVerticesData('normal');
    assert.ok(positions.every(Number.isFinite));
    assert.equal(normals.length, positions.length);
    const nonzero = Array.from({ length: normals.length / 3 }, (_, i) => normals[i * 3 + 1])
      .filter(y => Math.abs(y) > 1e-6);
    assert.ok(nonzero.filter(y => y > 0).length / nonzero.length > .95,
      `${name} must face the sky for daylight shading`);
  }

  const terrain = scene.getMeshByName('north-watch-island-terrain').getVerticesData('position');
  const shorelineEdges = new Map();
  const terrainIndices = scene.getMeshByName('north-watch-island-terrain').getIndices();
  for (let index = 0; index < terrainIndices.length; index += 3) {
    const triangle = terrainIndices.slice(index, index + 3);
    for (let side = 0; side < 3; side++) {
      const a = triangle[side], b = triangle[(side + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      shorelineEdges.set(key, (shorelineEdges.get(key) ?? 0) + 1);
    }
  }
  assert.ok([...shorelineEdges.values()].every(count => count === 2),
    'the island must form a closed solid, including its submerged rim and bottom');
  const baseHeights = [];
  for (let index = 0; index < terrain.length; index += 3) {
    if (Math.abs(terrain[index] - ISLAND_BASE.x) < 65 && Math.abs(terrain[index + 2] - ISLAND_BASE.z) < 48) {
      baseHeights.push(terrain[index + 1]);
    }
  }
  assert.ok(baseHeights.length > 0);
  assert.ok(Math.max(...baseHeights) - Math.min(...baseHeights) < 1e-4,
    'the outpost must stand on a level terrace');
});

test('summit facilities sit on both hills and the relocated helipad clears the lower compound', t => {
  const scene = fixture(t);
  const island = createIsland(scene);
  for (const post of ISLAND_HILL_POSTS) {
    const meshes = scene.meshes.filter(mesh => mesh.metadata?.facility === `hill-${post.id}`);
    assert.ok(meshes.length > 0 && meshes.length <= 10, 'each detailed post must use a small number of material batches');
    const features = new Set(meshes.flatMap(mesh => mesh.metadata.sourceNames));
    for (const feature of ['operations-walls', 'utility-walls', 'watchtower-stair-tread', 'watchtower-cross-brace', 'watchtower-window-glass', 'fence-wire']) {
      assert.ok(features.has(`hill-${post.id}-${feature}`), `post is missing ${feature}`);
    }
    const bounds = meshes.map(mesh => mesh.getBoundingInfo().boundingBox);
    const minimumX = Math.min(...bounds.map(box => box.minimumWorld.x));
    const maximumX = Math.max(...bounds.map(box => box.maximumWorld.x));
    const minimumY = Math.min(...bounds.map(box => box.minimumWorld.y));
    const maximumY = Math.max(...bounds.map(box => box.maximumWorld.y));
    assert.ok(Math.abs((minimumX + maximumX) / 2 - ISLAND_CENTER.x - post.x) < .1,
      'batching must apply the island world translation exactly once');
    const ground = islandHeight(post.x, post.z);
    assert.ok(minimumY >= ground - 1 && minimumY <= ground + .1, 'foundations meet the summit terrace');
    assert.ok(maximumY > ground + 16 && maximumY < ground + 21, 'the tower stands above the post at a plausible scale');
  }
  const pad = scene.meshes.find(mesh => mesh.metadata?.sourceNames?.includes('outpost-helipad'));
  assert.ok(pad, 'one relocated landing pad exists');
  const padBounds = pad.getBoundingInfo().boundingBox;
  assert.ok(Math.abs(padBounds.centerWorld.x - ISLAND_CENTER.x - ISLAND_HELIPAD.x) < .01);
  assert.ok(padBounds.minimumWorld.x > ISLAND_CENTER.x + ISLAND_BASE.x + 71 + 20,
    'the rotor area is clear of the compound fence');
  assert.ok(pad.material.zOffset < 0, 'the pad surface retains depth separation in the overview');
  const painted = scene.meshes.find(mesh => mesh.metadata?.sourceNames?.includes('helipad-detail-H-crossbar'));
  assert.ok(painted.material.zOffset < pad.material.zOffset, 'paint stays visible above the landing surface');
  assert.ok(island.shadowCasters.length <= 100, 'island shadow submission stays bounded');
  const triangles = scene.meshes.filter(mesh => mesh.getClassName() !== 'InstancedMesh')
    .reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
  assert.ok(triangles < 100_000, `static island geometry grew beyond its budget: ${triangles}`);
  assert.ok(scene.getTransformNodeByName('north-watch-island').isWorldMatrixFrozen);
  assert.ok(scene.meshes.every(mesh => mesh.isWorldMatrixFrozen), 'static island transforms do no recurring matrix work');
});

test('hill access paths clear the actual terrain triangles on steep slopes', t => {
  const scene = fixture(t);
  createIsland(scene);
  const terrain = scene.getMeshByName('north-watch-island-terrain');
  for (const name of ['hill-access-path-0', 'hill-access-path-1']) {
    const path = scene.getMeshByName(name);
    const positions = path.getVerticesData('position');
    const indices = path.getIndices();
    for (let index = 0; index < indices.length; index += Math.ceil(indices.length / 30 / 3) * 3) {
      const triangle = indices.slice(index, index + 3);
      const center = Vector3.Zero();
      for (const vertex of triangle) center.addInPlace(new Vector3(...positions.slice(vertex * 3, vertex * 3 + 3)));
      center.scaleInPlace(1 / 3);
      const ray = new Ray(new Vector3(center.x + ISLAND_CENTER.x, 400, center.z + ISLAND_CENTER.z), new Vector3(0, -1, 0), 500);
      const hit = scene.pickWithRay(ray, mesh => mesh === terrain);
      assert.ok(hit?.hit, 'the service path stays over land');
      assert.ok(center.y > hit.pickedPoint.y, `${name} is buried in the rendered cliff face`);
      assert.ok(center.y - hit.pickedPoint.y < 1, `${name} floats above the ground`);
    }
  }
});

test('viewing the island switches control without moving or resetting any ship state', t => {
  const { session, keyboard, camera, islandCamera, scene, simulation,
    attachmentChanges, telemetryModes, shadowUpdates } = islandSessionFixture(t);
  const state = simulation.state;
  Object.assign(state, { velocityX: 3, velocityZ: 9, speed: 10, throttle: 1, heading: 2, yawRate: .1,
    pitch: .05, roll: .03, distanceTraveledMeters: 500, elapsedTime: 40,
    positionX: -840, positionZ: 127, previousPositionX: -839, previousPositionZ: 126 });
  const before = structuredClone(state);
  const shipCameraPosition = camera.position.clone();
  keyboard.press('w'); keyboard.press('d'); keyboard.press('r'); keyboard.press(' ');
  session.readShipControls();
  assert.deepEqual(session.inputScratch, { throttle: 1, steering: 1 });

  session.viewIsland();
  assert.deepEqual(state, before, 'a view change preserves the complete ship simulation state');
  assert.equal(session.cameraView, 'island');
  assert.equal(session.audio.shipControlsEnabled, false);
  assert.equal(scene.activeCamera, islandCamera.camera);
  assert.notEqual(islandCamera.camera, camera);
  assert.deepEqual(camera.position, shipCameraPosition);
  assert.deepEqual(attachmentChanges, ['detach ship', 'detach island', 'attach island']);
  assert.deepEqual(telemetryModes, ['island']);
  assert.equal(shadowUpdates.at(-1), session.island.shadowCasters);
  const cleared = { throttle: 1, steering: 1 };
  keyboard.input.readInto(cleared);
  assert.deepEqual(cleared, { throttle: 0, steering: 0 });
  assert.equal(keyboard.input.consumeMissileLaunchPress(), null);
  assert.equal(keyboard.input.consumeGunFirePress(), false);

  session.setCameraView('chase');
  assert.equal(scene.activeCamera, camera);
  assert.deepEqual(state, before);
  assert.deepEqual(attachmentChanges.slice(-3), ['detach ship', 'detach island', 'attach ship']);
  assert.deepEqual(telemetryModes, ['island', 'chase']);
  assert.equal(session.audio.shipControlsEnabled, true);
  assert.equal(shadowUpdates.at(-1), session.boat.shadowCasters);
});

test('island keys pan its camera while ship controls and missile launchers remain inactive', t => {
  const { session, keyboard, islandCamera, launches } = islandSessionFixture(t);
  session.viewIsland();
  keyboard.press('w'); keyboard.press('d');
  session.inputScratch.throttle = 1;
  session.inputScratch.steering = 1;
  session.readShipControls();
  assert.deepEqual(session.inputScratch, { throttle: 0, steering: 0 });
  const cameraControls = { throttle: 0, steering: 0 };
  keyboard.input.readInto(cameraControls);
  assert.deepEqual(cameraControls, { throttle: 1, steering: 1 });
  const previousTarget = islandCamera.camera.target.clone();
  islandCamera.update(cameraControls, .1);
  assert.ok(Vector3.Distance(previousTarget, islandCamera.camera.target) > 1);
  assert.equal(session.launchMissile('forward'), false);
  assert.equal(session.launchMissile('aft'), false);
  assert.deepEqual(launches, []);

  session.setCameraView('chase');
  session.readShipControls();
  assert.deepEqual(session.inputScratch, { throttle: 0, steering: 0 }, 'returning clears island keys before restoring ship control');
  keyboard.press('s'); keyboard.press('a');
  session.readShipControls();
  assert.deepEqual(session.inputScratch, { throttle: -1, steering: -1 });
  assert.equal(session.launchMissile('forward'), true);
  assert.deepEqual(launches, ['forward']);
});

test('returning from island to an unavailable missile view falls back to the ship camera', t => {
  const { session, scene, camera, islandCamera } = islandSessionFixture(t);
  session.viewIsland();
  islandCamera.update({ throttle: 1, steering: 0 }, .1);
  session.resetIslandView();
  assert.equal(scene.activeCamera, islandCamera.camera, 'reset keeps island camera ownership');
  session.setCameraView('missile');
  assert.equal(session.cameraView, 'chase');
  assert.equal(scene.activeCamera, camera);
});
