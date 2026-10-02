import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem.js';

globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return this.context ??= {
      pixels: undefined,
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      putImageData(image) { this.pixels = image; },
    };
  }
};

const source = await readFile(new URL('../src/ships/weaponParticles.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/\bfrom\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => {
  const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
  return `from ${JSON.stringify(import.meta.resolve(name))}`;
});
const { createWeaponSmokeTexture, createWeaponFireTexture, configureWeaponParticles } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture(t) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  return scene;
}

function pixel(image, x, y) { return image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4); }

test('billowing smoke has deterministic density, shaded folds and a transparent irregular outline', t => {
  const scene = fixture(t);
  const first = createWeaponSmokeTexture(scene, 'first-smoke');
  const second = createWeaponSmokeTexture(scene, 'second-smoke');
  const image = first.getContext().pixels;
  assert.deepEqual(image.data, second.getContext().pixels.data);
  assert.equal(image.width, 256);
  assert.ok(image.data.byteLength < 300_000, 'shared smoke bytes should stay small');
  assert.ok(pixel(image, 128, 128)[3] > 190, 'exhaust must have a dense interior');
  let minShade = 255, maxShade = 0, solidPixels = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const [red, green, blue, alpha] = pixel(image, x, y);
    assert.equal(red, green); assert.equal(green, blue);
    if (x === 0 || y === 0 || x === 255 || y === 255) assert.equal(alpha, 0, 'no square texture rim');
    if (alpha > 170) { solidPixels++; minShade = Math.min(minShade, red); maxShade = Math.max(maxShade, red); }
  }
  assert.ok(solidPixels > 8_000, 'dense cloud volume must be large enough to overlap naturally');
  assert.ok(maxShade - minShade > 45, 'smoke billows need visible shading');
  assert.notDeepEqual(pixel(image, 128, 25), pixel(image, 25, 128), 'edges must not be radially symmetric');
  first.dispose();
  assert.ok(second.getInternalTexture(), 'controllers must own independent GPU textures');
});

test('fire texture retains a white-hot centre, amber fringe and smoothly transparent border', t => {
  const scene = fixture(t);
  const texture = createWeaponFireTexture(scene, 'test-flame');
  const image = texture.getContext().pixels;
  assert.equal(image.width, 128);
  const centre = pixel(image, 64, 64);
  assert.ok(centre[1] > 250 && centre[2] > 250 && centre[3] > 225);
  const fringe = pixel(image, 93, 64);
  assert.ok(fringe[0] > fringe[1] && fringe[1] > fringe[2], 'temperature should fall towards the edge');
  assert.ok(fringe[3] > 0 && fringe[3] < centre[3]);
  assert.equal(pixel(image, 0, 64)[3], 0);
  assert.equal(pixel(image, 127, 64)[3], 0);
  assert.equal(texture.hasAlpha, true);
});

test('camera fade restores simulation alpha across frames and particle recycling, including additive fire', t => {
  const scene = fixture(t);
  const camera = new FreeCamera('camera', Vector3.Zero(), scene);
  camera.minZ = .1;
  scene.activeCamera = camera;
  const system = new ParticleSystem('fade-test', 8, scene);
  system.updateFunction = particles => {
    for (const particle of particles) { particle.age += .1; particle.color.a -= .05; }
  };
  configureWeaponParticles(system, scene, ParticleSystem.BLENDMODE_ADD);
  assert.equal(system.blendMode, ParticleSystem.BLENDMODE_ADD);
  assert.equal(system.forceDepthWrite, false);
  assert.equal(system.renderingGroupId, 2, 'weapon sprites must draw after the group-1 maritime sky');
  assert.equal(scene.getAutoClearDepthStencilSetup(2).autoClear, false,
    'the later weapon group must retain ship depth so smoke cannot show through the hull');
  const particle = { age: 0, color: { a: .8 }, position: new Vector3(0, 0, 1.875), size: 1, scale: { x: 1, y: 1 } };
  system.updateFunction([particle]);
  assert.ok(Math.abs(particle.color.a - .375) < 1e-10);
  particle.position.z = 30;
  system.updateFunction([particle]);
  assert.ok(Math.abs(particle.color.a - .7) < 1e-10, 'camera fade must not compound over subsequent frames');
  particle.age = 0; particle.color.a = .9;
  system.updateFunction([particle]);
  assert.ok(Math.abs(particle.color.a - .85) < 1e-10, 'a recycled particle must keep its new birth colour');
  particle.position.z = .2;
  system.updateFunction([particle]);
  assert.equal(particle.color.a, 0, 'a nearby oversized particle should not cover the view');
});
