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

globalThis.OffscreenCanvas ??= class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return {
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      putImageData() {},
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {},
    };
  }
};

async function sourceModuleUrl(url) {
  const source = await readFile(url, 'utf8');
  let transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  for (const [statement, , specifier] of [...transpiled.matchAll(/from\s+(["'])([^"']+)\1/g)]) {
    const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
    const resolved = name.startsWith('.') ? await sourceModuleUrl(new URL(`${name}.ts`, url)) : import.meta.resolve(name);
    transpiled = transpiled.replace(statement, `from ${JSON.stringify(resolved)}`);
  }
  return `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`;
}
const { ForedeckGunFire } = await import(await sourceModuleUrl(new URL('../src/ships/ForedeckGunFire.ts', import.meta.url)));
const resourceCounts = scene => Object.fromEntries(['meshes', 'transformNodes', 'materials', 'textures', 'particleSystems', 'lights'].map(key => [key, scene[key].length]));

async function fixture(t) {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32, textureSize: 128 });
  engine.getDeltaTime = () => 50;
  const scene = new Scene(engine);
  const camera = new FreeCamera('test-camera', new Vector3(80, 80, -150), scene);
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  const ship = new Mesh('test-destroyer', scene);
  const traverse = new TransformNode('gun-traverse', scene);
  traverse.parent = ship;
  const pivot = new TransformNode('gun-elevation', scene);
  pivot.parent = traverse;
  pivot.position.set(0, 6, 45);
  const muzzle = new Mesh('gun-muzzle', scene);
  muzzle.parent = pivot;
  muzzle.position.set(0, .93, 5.05);
  const baseline = resourceCounts(scene);
  const controller = new ForedeckGunFire(scene, muzzle, pivot);
  for (const texture of scene.textures) {
    const internal = texture.getInternalTexture();
    if (internal) internal.isReady = true;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    scene.render();
    if (scene.particleSystems.every(system => system.isReady())) break;
    await new Promise(setImmediate);
  }
  assert.ok(scene.particleSystems.every(system => system.isReady()));
  let time = 0;
  const step = (delta = .05, render = true) => {
    time += Math.max(0, Math.min(.1, delta));
    controller.update(delta, time);
    if (render) scene.render();
  };
  const advance = (seconds, render = true) => {
    for (let index = 0; index < Math.ceil(seconds / .05); index++) step(.05, render);
  };
  t.after(() => { controller.dispose(); scene.dispose(); engine.dispose(); });
  return { engine, scene, ship, traverse, pivot, muzzle, controller, baseline, step, advance };
}

test('gun fires a brief layered flash, recoils along its elevated bore and preserves cooldown', async t => {
  const f = await fixture(t);
  f.pivot.rotation.x = -.2;
  const base = f.pivot.position.clone();
  assert.equal(f.controller.fire(0), true);
  assert.equal(f.controller.fire(0), false);
  const light = f.scene.getLightByName('Mk45-muzzle-light');
  assert.ok(light.intensity > 0);
  f.step(.016);
  const core = f.scene.getParticleSystemById('Mk45-white-hot-muzzle-core');
  const fire = f.scene.getParticleSystemById('Mk45-directional-muzzle-fire');
  assert.ok(core.getActiveCount() > 0 && fire.getActiveCount() > 0, 'both layers must emit real Babylon particles');
  assert.ok(f.pivot.position.y < base.y && f.pivot.position.z < base.z);
  f.advance(.1);
  assert.equal(light.intensity, 0, 'muzzle illumination must end with the flash');
  assert.equal(core.getActiveCount(), 0);
  assert.equal(fire.getActiveCount(), 0, 'flame must vanish while smoke remains');
  assert.ok(f.scene.getParticleSystemById('Mk45-propellant-plume').getActiveCount() > 0);
  assert.equal(f.controller.fire(.116), false);
  f.advance(.7);
  assert.ok(Vector3.Distance(f.pivot.position, base) < 1e-10, 'gun must return to its original mount');
  f.advance(2.4);
  assert.equal(f.controller.fire(3.216), true);
});

test('muzzle gases follow the trained bore and become detached drifting smoke', async t => {
  const f = await fixture(t);
  f.ship.position.set(120, 0, -80);
  f.ship.rotation.y = .7;
  f.traverse.rotation.y = -.3;
  f.pivot.rotation.x = -.2;
  f.pivot.computeWorldMatrix(true);
  f.muzzle.computeWorldMatrix(true);
  const origin = f.muzzle.getAbsolutePosition().clone();
  const bore = Vector3.TransformNormal(new Vector3(0, .93, 5.05).normalize(), f.pivot.getWorldMatrix()).normalize();
  f.controller.fire(0);
  f.step(.016);
  const smoke = f.scene.getParticleSystemById('Mk45-propellant-plume');
  const particle = smoke.particles[0];
  assert.ok(Vector3.Distance(particle.position, origin) < 1);
  assert.ok(Vector3.Dot(particle.direction.clone().normalize(), bore) > .9, 'initial propellant must leave the transformed bore');
  assert.equal(smoke.isLocal, false);
  const position = particle.position.clone();
  const size = particle.size;
  f.ship.position.x += 1_000;
  f.ship.computeWorldMatrix(true);
  f.advance(1);
  assert.ok(smoke.particles.includes(particle));
  assert.ok(particle.size > size * 2, 'smoke should billow outward after the gas jet');
  assert.ok(Vector3.Distance(position, particle.position) < 30, 'existing smoke must not follow the moving ship');
  f.advance(1);
  assert.ok(Math.abs(particle.direction.x - 2.4) < 1 && Math.abs(particle.direction.z - .7) < 1, 'drag must carry old smoke with the wind');
  f.advance(.5);
  assert.ok(smoke.particles.every(puff => puff.color.a < .21), 'older drifting smoke must become translucent instead of obscuring the whole foredeck');
  f.advance(7);
  assert.equal(smoke.getActiveCount(), 0, 'lingering smoke must eventually fade away');
});

test('smoke ages and drifts on bounded controller time after a stalled render frame', async t => {
  const f = await fixture(t);
  f.controller.fire(0);
  f.step(.016);
  const smoke = f.scene.getParticleSystemById('Mk45-propellant-plume');
  const particle = smoke.particles[0];
  f.engine.getDeltaTime = () => 1_000;
  for (const delta of [.016, .1, 1, 0]) {
    const age = particle.age;
    const position = particle.position.clone();
    f.step(delta);
    const boundedDelta = Math.max(0, Math.min(.1, delta));
    assert.ok(Math.abs(particle.age - age - boundedDelta) < 1e-10);
    assert.ok(Vector3.Distance(particle.position.subtract(position), particle.direction.scale(boundedDelta)) < 1e-8);
  }
});

test('ballistic shells stay unlit and create water impacts that release their spray', async t => {
  const f = await fixture(t);
  f.controller.fire(0);
  const shell = f.controller.shells[0];
  assert.equal(shell.mesh.material.disableLighting, false);
  assert.equal(shell.mesh.material.emissiveColor.r, 0);
  const initialYVelocity = shell.velocity.y;
  f.step(.1, false);
  assert.ok(shell.velocity.y < initialYVelocity);
  const persistentResources = resourceCounts(f.scene);
  let impacted = false;
  for (let index = 0; index < 300; index++) {
    f.step(.1, false);
    if (f.controller.splashes.length) { impacted = true; break; }
  }
  assert.ok(impacted, 'the existing shell flight must produce a water splash');
  assert.equal(shell.mesh.isDisposed(), true);
  assert.ok(f.scene.getParticleSystemById('Mk45-water-impact-spray'));
  f.advance(2, false);
  assert.equal(f.controller.splashes.length, 0);
  assert.equal(f.scene.getParticleSystemById('Mk45-water-impact-spray'), null);
  assert.equal(f.scene.textures.length, persistentResources.textures, 'water impacts must reuse their cached sprite');
});

test('repeated shots without rendering keep emissions bounded and disposal releases all resources', async t => {
  const f = await fixture(t);
  for (let shot = 0; shot < 20; shot++) {
    assert.equal(f.controller.fire(shot * 3.3), true);
    f.advance(3.3, false);
    assert.ok(f.controller.smokeEmissions.length <= 112, 'unrendered smoke must not accumulate indefinitely');
    assert.ok(f.controller.flameEmissions.length <= 68);
    assert.ok(f.controller.shells.length <= 3);
  }
  assert.equal(f.scene.textures.length, f.baseline.textures + 3);
  f.controller.dispose();
  assert.deepEqual(resourceCounts(f.scene), f.baseline);
  f.controller.dispose();
  assert.deepEqual(resourceCounts(f.scene), f.baseline);
  assert.equal(f.controller.fire(70), false);
});
