import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { BoatSimulation, CruiseMissileSimulation } from '@naval/shared';

// Only the procedural plume's two-dimensional pixel buffer needs a canvas.
// Babylon's NullEngine supplies the rendering API without a browser or GPU.
globalThis.OffscreenCanvas ??= class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return {
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      putImageData() {},
    };
  }
};

// Exercise the actual controller source without creating a generated client
// build directory. Type-only imports disappear; runtime imports resolve to
// installed Babylon modules and the compiled shared simulation.
async function sourceModuleUrl(url) {
  const source = await readFile(url, 'utf8');
  let transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const imports = [...transpiled.matchAll(/from\s+(["'])([^"']+)\1/g)];
  for (const [statement, , specifier] of imports) {
    const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
    const resolved = name.startsWith('.') ? await sourceModuleUrl(new URL(`${name}.ts`, url)) : import.meta.resolve(name);
    transpiled = transpiled.replace(statement, `from ${JSON.stringify(resolved)}`);
  }
  return `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`;
}
const { MissileVls } = await import(await sourceModuleUrl(new URL('../src/ships/MissileVls.ts', import.meta.url)));

const difference = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const resourceCounts = scene => Object.fromEntries(['meshes', 'transformNodes', 'materials', 'textures', 'particleSystems', 'lights'].map(key => [key, scene[key].length]));

async function fixture(t, forward = 32, aft = 64) {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32, textureSize: 128 });
  engine.getDeltaTime = () => 100;
  const scene = new Scene(engine);
  const camera = new FreeCamera('test-camera', new Vector3(80, 80, -150), scene);
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  const ship = new Mesh('test-destroyer', scene);
  const cells = [];
  for (const [bank, count, y, z] of [['forward', forward, 6, 42], ['aft', aft, 12.45, -30]]) {
    for (let index = 0; index < count; index++) {
      const launchPoint = new Vector3(index % 8 - 3.5, y, z + Math.floor(index / 8));
      const hatchPivot = new TransformNode(`${bank}-hatch-${index}`, scene);
      hatchPivot.parent = ship;
      hatchPivot.position.copyFrom(launchPoint);
      const hatchMesh = new Mesh(`${bank}-hatch-panel-${index}`, scene);
      hatchMesh.parent = hatchPivot;
      cells.push({ bank, launchPoint, hatchPivot, hatchMeshes: [hatchMesh] });
    }
  }
  const baseline = resourceCounts(scene);
  let ignitions = 0;
  const controller = new MissileVls(scene, ship, cells, () => ignitions++);
  // NullEngine deliberately does not upload dynamic canvas textures. Mark
  // their CPU buffers ready so its real particle animation path can run.
  for (const texture of scene.textures) {
    const internal = texture.getInternalTexture();
    if (internal) internal.isReady = true;
  }
  const shipState = new BoatSimulation().state;
  const step = (delta = .1, render = true) => {
    shipState.elapsedTime += delta;
    controller.update(delta, shipState);
    if (render) scene.render();
  };
  const advance = (seconds, render = true) => {
    for (let index = 0; index < Math.round(seconds * 10); index++) step(.1, render);
  };
  // Shader modules load asynchronously even in NullEngine. Prime readiness
  // before a test queues emissions so its first launch particles are retained.
  for (let attempt = 0; attempt < 20; attempt++) {
    scene.render();
    if (scene.particleSystems.every(system => system.isReady())) break;
    await new Promise(setImmediate);
  }
  assert.ok(scene.particleSystems.every(system => system.isReady()), 'NullEngine particle effects must be ready before launch');
  t.after(() => { controller.dispose(); scene.dispose(); engine.dispose(); });
  return { engine, scene, ship, cells, baseline, controller, shipState, step, advance, ignitions: () => ignitions };
}

test('bank selection consumes one cell and opens its hatch before ignition', async t => {
  const f = await fixture(t);
  assert.equal(f.controller.telemetry.forwardRemaining, 32);
  assert.equal(f.controller.telemetry.aftRemaining, 64);
  assert.equal(f.controller.launch('aft'), true);
  assert.equal(f.controller.telemetry.aftRemaining, 63);
  assert.equal(f.controller.telemetry.forwardRemaining, 32);
  assert.equal(f.controller.telemetry.activeMissiles, 0);
  assert.equal(f.ignitions(), 0);
  assert.equal(f.controller.launch('forward'), false, 'a pending launch must reject a second request');
  f.step();
  const chosen = f.cells.find(cell => cell.bank === 'aft');
  assert.ok(chosen.hatchPivot.rotation.x < -.2);
  assert.equal(f.cells[0].hatchPivot.rotation.x, 0);
  assert.equal(f.ignitions(), 0);
  f.advance(.2);
  assert.equal(f.ignitions(), 0, 'ignition must wait for the full hatch-opening interval');
  f.step();
  assert.equal(f.ignitions(), 1);
  assert.equal(f.controller.telemetry.activeMissiles, 1);
  assert.equal(f.controller.telemetry.lastLaunchBank, 'aft');
  assert.ok(chosen.hatchPivot.rotation.x < -1.6);
  assert.equal(f.controller.launch('forward'), false, 'ignition must not bypass the bank-wide cooldown');
  f.advance(3.2, false);
  assert.equal(f.controller.launch('forward'), true);
  assert.equal(f.controller.telemetry.forwardRemaining, 31);
  assert.equal(f.controller.telemetry.aftRemaining, 63);
});

test('empty or spent cells cannot be fired again after cooldown', async t => {
  const f = await fixture(t, 1, 1);
  assert.equal(f.controller.launch('forward'), true);
  f.advance(3.6, false);
  assert.equal(f.controller.telemetry.forwardRemaining, 0);
  assert.equal(f.controller.launch('forward'), false);
  assert.equal(f.controller.launch('aft'), true);
  f.advance(3.6, false);
  assert.equal(f.controller.telemetry.aftRemaining, 0);
  assert.equal(f.controller.launch('aft'), false);
  assert.equal(f.controller.launch('forward'), false);
  assert.equal(f.ignitions(), 2);
  assert.equal(f.controller.telemetry.activeMissiles, 2);
  assert.equal(f.controller.telemetry.cooldownSeconds, 0);
});

test('all 96 launch cells can be consumed once without ammunition or flight accumulation', async t => {
  const f = await fixture(t);
  for (const [bank, count, remainingKey] of [['forward', 32, 'forwardRemaining'], ['aft', 64, 'aftRemaining']]) {
    for (let index = 0; index < count; index++) {
      assert.equal(f.controller.launch(bank), true, `${bank} cell ${index} should still be available`);
      assert.equal(f.controller.telemetry[remainingKey], count - index - 1);
      f.advance(3.6, false);
      assert.ok(f.controller.telemetry.activeMissiles <= 9, 'expired airframes must be removed during repeated launches');
    }
    assert.equal(f.controller.launch(bank), false, `${bank} bank must reject launches after exhaustion`);
  }
  assert.equal(f.ignitions(), 96);
  assert.equal(f.controller.telemetry.forwardRemaining, 0);
  assert.equal(f.controller.telemetry.aftRemaining, 0);
  f.advance(31, false);
  assert.equal(f.controller.telemetry.activeMissiles, 0);
  assert.equal(f.controller.debris.length, 0);
  assert.equal(f.scene.getNodes().filter(node => node.name.startsWith('Tomahawk-')).length, 0);
});

test('ignition transforms the selected deck cell and inherits moving ship momentum', async t => {
  const f = await fixture(t, 1, 1);
  f.ship.position.set(120, 1.2, -80);
  f.ship.rotation.set(.03, .7, -.04);
  f.shipState.heading = .7;
  f.shipState.velocityX = 9;
  f.shipState.velocityZ = 12;
  f.ship.computeWorldMatrix(true);
  const cell = f.cells[1];
  const worldDeck = Vector3.TransformCoordinates(cell.launchPoint, f.ship.getWorldMatrix());
  const axis = Vector3.TransformNormal(Vector3.Up(), f.ship.getWorldMatrix()).normalize();
  const expected = new CruiseMissileSimulation({
    position: worldDeck.subtract(axis.scale(6.5)), direction: axis,
    headingRadians: .7, inheritedVelocity: { x: 9, y: 0, z: 12 },
  });
  expected.update(.04);
  f.controller.launch('aft');
  f.advance(.3, false);
  f.step(.04, false);
  assert.equal(f.ignitions(), 1);
  const missile = f.controller.missiles[0];
  assert.ok(difference(missile.node.position, expected.state.position) < 1e-8);
  assert.ok(difference(missile.flight.state.velocity, expected.state.velocity) < 1e-8);
  assert.ok(difference(missile.flight.state.direction, axis) < 1e-8);
  assert.equal(missile.node.parent, null, 'airframe must be independent of the moving ship');
  const prior = missile.node.position.clone();
  f.ship.position.x += 1_000;
  f.ship.computeWorldMatrix(true);
  f.step(.1, false);
  assert.ok(Vector3.Distance(prior, missile.node.position) < 5, 'moving the ship must not move an airborne missile');
});

test('fins and wings emerge folded, deploy, and release a ballistic booster', async t => {
  const f = await fixture(t, 1, 1);
  f.controller.launch('forward');
  f.advance(.3, false);
  f.step(.04, false);
  const missile = f.controller.missiles[0];
  assert.ok(missile.wings.every(wing => wing.scaling.x === .015));
  assert.ok(missile.fins.every(fin => fin.scaling.x === .015));
  assert.equal(missile.booster.parent, missile.node);
  f.advance(1, false);
  assert.ok(missile.fins.every(fin => fin.scaling.x === 1));
  assert.ok(missile.wings.every(wing => wing.scaling.x === .015));
  f.advance(2.5, false);
  assert.ok(missile.wings.every(wing => wing.scaling.x > .45 && wing.scaling.x < .75));
  f.advance(1, false);
  assert.ok(missile.wings.every(wing => wing.scaling.x === 1));
  assert.equal(missile.booster.parent, null);
  assert.equal(missile.separated, true);
  assert.equal(f.controller.debris.length, 1);
  assert.equal(missile.flame.isVisible, false);
  assert.equal(missile.core.isVisible, false);
  const boosterY = missile.booster.position.y;
  const boosterVelocityY = f.controller.debris[0].velocity.y;
  f.advance(.5, false);
  assert.ok(missile.booster.position.y < boosterY);
  assert.ok(f.controller.debris[0].velocity.y < boosterVelocityY);
  f.advance(16, false);
  assert.equal(f.controller.debris.length, 0);
  assert.equal(missile.booster.isDisposed(), true);
});

test('launch smoke grows, drifts in world space and fades after emission ends', async t => {
  const f = await fixture(t, 1, 1);
  f.controller.launch('forward');
  f.advance(.5);
  const deck = f.scene.getParticleSystemById('Mk41-deck-exhaust-cloud');
  const trail = f.scene.getParticleSystemById('Tomahawk-world-space-smoke-trail');
  assert.ok(deck.getActiveCount() > 0, 'deck cloud must create real Babylon particles');
  assert.ok(trail.getActiveCount() > 0, 'booster plume must create real Babylon particles');
  assert.equal(deck.isLocal, false);
  assert.equal(trail.isLocal, false);
  const billow = deck.particles[0];
  const originalSize = billow.size;
  const originalPosition = billow.position.clone();
  f.ship.position.x += 1_000;
  f.ship.computeWorldMatrix(true);
  f.advance(2);
  assert.ok(deck.particles.includes(billow));
  // Initial diameter and lifetime vary independently. Even the largest,
  // slowest-growing birth billow must expand substantially after two seconds.
  assert.ok(billow.size > originalSize * 1.5, 'cloud must expand after launch');
  assert.ok(Vector3.Distance(originalPosition, billow.position) < 80, 'existing exhaust must not follow ship translation');
  const originalAlpha = billow.color.a;
  f.advance(6);
  if (deck.particles.includes(billow)) assert.ok(billow.color.a < originalAlpha, 'older smoke must fade');
  f.advance(20);
  assert.equal(deck.getActiveCount(), 0);
  assert.equal(trail.getActiveCount(), 0);
});

test('ignition separates white deck exhaust, rising tan pressure billows and a brief deck flash', async t => {
  const f = await fixture(t, 1, 1);
  f.controller.launch('forward');
  f.advance(.4);
  const deck = f.scene.getParticleSystemById('Mk41-deck-exhaust-cloud');
  const pressure = f.scene.getParticleSystemById('Mk41-hot-launch-pressure-billow');
  const flash = f.scene.getParticleSystemById('Mk41-cell-ignition-fire');
  for (const system of [deck, pressure, flash]) {
    assert.ok(system.getActiveCount() > 0, `${system.name} must emit actual particles at ignition`);
    assert.equal(system.isLocal, false, 'a launch plume must remain in world space');
  }
  const white = deck.particles[0], tan = pressure.particles[0];
  assert.ok(white.color.r > .9 && Math.abs(white.color.r - white.color.g) < .05);
  assert.ok(tan.color.r > tan.color.g && tan.color.g > tan.color.b,
    'the pressure cloud must retain a distinct hot tan tint');
  assert.ok(white.color.a > .85 && tan.color.a > .85, 'both launch layers need a dense birth colour');
  assert.ok(Math.min(...pressure.particles.map(particle => particle.position.y)) > Math.max(...deck.particles.map(particle => particle.position.y)),
    'the pressure billow should start above the cloud rolling across the deck');
  assert.ok(Math.min(...pressure.particles.map(particle => particle.direction.y)) > Math.max(...deck.particles.map(particle => particle.direction.y)),
    'the hot pressure billow must rise faster than the lower deck cloud');
  assert.ok(flash.particles.some(particle => particle.color.r > 1 && particle.color.g > 1), 'deck ignition should be incandescent');
  const whitePosition = white.position.clone(), tanPosition = tan.position.clone();
  f.ship.position.x += 1_000;
  f.ship.computeWorldMatrix(true);
  f.advance(1.1);
  assert.ok(deck.particles.includes(white) && pressure.particles.includes(tan));
  assert.ok(Vector3.Distance(whitePosition, white.position) < 40 && Vector3.Distance(tanPosition, tan.position) < 40,
    'the original billows must drift independently of the translated ship');
  assert.equal(flash.getActiveCount(), 0, 'the short ignition flame must end while smoke is still visible');
  assert.ok(pressure.particles.every(particle => particle.age > .2), 'the pressure impulse must stop producing fresh billows');
});

test('boost smoke samples continuous flight segments as speed increases and fire ends at burnout', async t => {
  const f = await fixture(t, 1, 1);
  f.controller.launch('forward');
  f.advance(1.4);
  const missile = f.controller.missiles[0];
  const trail = f.scene.getParticleSystemById('Tomahawk-world-space-smoke-trail');
  const fire = f.scene.getParticleSystemById('Tomahawk-turbulent-booster-fire');
  const cruise = f.scene.getParticleSystemById('Tomahawk-faint-cruise-exhaust');
  const travelled = [];
  for (let frame = 0; frame < 26; frame++) {
    const start = missile.previousNozzle.clone();
    f.step();
    const finish = missile.previousNozzle.clone();
    const segment = finish.subtract(start), length = segment.length();
    travelled.push(length);
    assert.equal(missile.flight.state.boosterBurning, true);
    const fresh = trail.particles.filter(particle => particle.age === 0);
    assert.ok(fresh.length > 2, 'a fast frame needs multiple smoke samples instead of one distant puff');
    const diameter = Math.max(...fresh.map(particle => particle.size));
    // Test spatial coverage using the live smoke footprint rather than the
    // controller's chosen sampling interval. Newborn particles have not drifted.
    for (let offset = 0; offset <= length; offset += diameter * .25) {
      const point = start.add(segment.scale(offset / length));
      assert.ok(fresh.some(particle => Vector3.Distance(point, particle.position) <= diameter),
        'the exhaust segment must not leave visible holes between frames');
    }
    assert.ok(fire.getActiveCount() > 0, 'the booster must keep producing incandescent exhaust while burning');
  }
  assert.ok(Math.max(...travelled) > Math.min(...travelled) * 1.5, 'coverage must be exercised across increasing flight speed');
  assert.ok(missile.flame.isVisible && missile.core.isVisible);
  while (missile.flight.state.boosterBurning) f.step();
  f.advance(.5);
  assert.equal(fire.getActiveCount(), 0, 'all short-lived fire particles must clear after burnout');
  assert.equal(missile.flame.isVisible, false);
  assert.equal(missile.core.isVisible, false);
  assert.ok(missile.flame.getChildMeshes().every(mesh => !mesh.isEnabled()), 'crossed flame lobes must switch off with their root');
  assert.ok(trail.getActiveCount() > 0 && trail.particles.every(particle => particle.age >= .4),
    'the dense boost column should linger without fresh post-burnout emissions');
  assert.ok(cruise.getActiveCount() > 0 && cruise.particles.every(particle => particle.color.a < .2),
    'cruise exhaust should transition to a faint trail');
});

test('particle age and drift follow controller time after a stalled render frame', async t => {
  const f = await fixture(t, 1, 1);
  f.controller.launch('forward');
  f.advance(.5);
  const deck = f.scene.getParticleSystemById('Mk41-deck-exhaust-cloud');
  assert.ok(deck.getActiveCount() > 0);
  const billow = deck.particles[0];
  f.engine.getDeltaTime = () => 1_000;
  for (const delta of [.016, .1, 0]) {
    const previousAge = billow.age;
    const previousPosition = billow.position.clone();
    f.step(delta);
    assert.ok(f.scene.getAnimationRatio() > 1, 'the scene must observe the stalled renderer clock');
    assert.ok(deck.particles.includes(billow));
    assert.ok(Math.abs(billow.age - previousAge - delta) < 1e-10, 'a stalled render must not age effects by the renderer elapsed second');
    const displacement = billow.position.subtract(previousPosition);
    assert.ok(Vector3.Distance(displacement, billow.direction.scale(delta)) < 1e-8, 'world-space smoke drift must use the same controller time as aging');
  }
});

test('expired flights and disposal release meshes, particles, lights and textures', async t => {
  const f = await fixture(t, 1, 1);
  f.controller.launch('forward');
  f.advance(.5);
  const missile = f.controller.missiles[0];
  f.advance(3.1);
  assert.equal(f.controller.launch('aft'), true);
  f.advance(.4);
  assert.equal(f.controller.telemetry.activeMissiles, 2);
  f.advance(35);
  assert.equal(f.controller.telemetry.activeMissiles, 0);
  assert.equal(f.controller.telemetry.phase, 'expired');
  assert.equal(missile.node.isDisposed(), true);
  assert.equal(f.controller.debris.length, 0);
  assert.ok(f.scene.particleSystems.every(system => system.getActiveCount() === 0));
  assert.ok(Math.abs(f.cells[0].hatchPivot.rotation.x) < 1e-12, 'hatch must finish closing');
  f.controller.dispose();
  assert.deepEqual(resourceCounts(f.scene), f.baseline, 'controller resources must all return to the pre-launch baseline');
  f.controller.dispose();
  assert.deepEqual(resourceCounts(f.scene), f.baseline, 'repeated disposal must be harmless');
});
