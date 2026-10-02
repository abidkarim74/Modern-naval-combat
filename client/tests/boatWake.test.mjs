import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { BoatSimulation } from '@naval/shared';

const sourceUrl = new URL('../src/world/BoatWake.ts', import.meta.url);
const compiled = ts.transpileModule(await readFile(sourceUrl, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const imports = [...compiled.matchAll(/\bfrom\s+(["'])([^"']+)\1/g)];
let rewritten = compiled;
for (const match of imports) {
  const specifier = match[2];
  let url;
  if (specifier.endsWith('?raw')) {
    const shader = await readFile(new URL(specifier.slice(0, -4), sourceUrl), 'utf8');
    url = `data:text/javascript;base64,${Buffer.from(`export default ${JSON.stringify(shader)};`).toString('base64')}`;
  } else {
    const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
    url = import.meta.resolve(name);
  }
  rewritten = rewritten.replace(match[0], `from ${JSON.stringify(url)}`);
}
const { BoatWake } = await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`);

function fixture(t, backend) {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  // Texture generation is exercised; a real canvas/GPU is unnecessary for
  // checking the wake history, buffer cadence and shader state handoff.
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    beginPath() {}, arc() {}, fill() {}, stroke() {},
  }) });
  const scene = new Scene(engine);
  const wake = new BoatWake(scene, backend);
  t.after(() => { scene.dispose(); engine.dispose(); });
  return { wake, scene, state: new BoatSimulation().state };
}

for (const backend of ['WebGL 2', 'WebGPU']) {
  test(`${backend} bow foam and shader disturbances follow the interpolated hull and active ocean grid`, t => {
    const { wake, scene, state } = fixture(t, backend);
    state.speed = state.forwardSpeed = 10;
    state.positionX = 100;
    state.positionZ = 200;
    const camera = new Vector3(-500, 30, 850);
    const renderPosition = new Vector3(95, .6, 197);
    wake.setQuality({ oceanSubdivisions: 96, oceanCellSizeMeters: 2 });
    wake.update(state, 0, camera, renderPosition, Math.PI / 2);
    const bow = scene.getMeshByName('breaking-bow-and-shoulder-waves');
    const positions = bow.getVerticesData('position');
    const colors = bow.getVerticesData('color');
    const middleRow = 24 * 9;
    const centerAlpha = colors[(middleRow + 4) * 4 + 3];
    assert.ok(centerAlpha > .2, 'the middle of the breaking sheet remains visible');
    assert.ok(colors[(middleRow + 1) * 4 + 3] < centerAlpha * .2,
      'bow froth dissolves across a broad feather before the geometric edge');
    for (const column of [0, 8]) assert.ok(colors[(middleRow + column) * 4 + 3] < 1e-10);
    assert.ok(Math.abs(positions[0] - (renderPosition.x + 77)) < 1e-5,
      'bow foam uses interpolated heading and location instead of the next simulation pose');
    assert.equal(bow.material._floats.boatHeading, Math.PI / 2);
    assert.deepEqual(bow.material._vectors3.boatPosition.asArray(), renderPosition.asArray());
    assert.deepEqual(bow.material._vectors4.waterGrid.asArray(), [-500, 850, 96, 2]);
    wake.setQuality({ oceanSubdivisions: 48, oceanCellSizeMeters: 4 });
    assert.deepEqual(bow.material._vectors4.waterGrid.asArray(), [-500, 850, 96, 4],
      'quality changes update the wave band filtering grid immediately');
  });

  test(`${backend} foam keeps world-space history and only uploads geometry at its scheduled cadence`, t => {
    const { wake, scene, state } = fixture(t, backend);
    state.speed = state.forwardSpeed = 10;
    for (let index = 0; index < 3; index++) {
      state.positionZ = index * 2;
      state.distanceTraveledMeters = index * 2;
      wake.update(state, index * .2);
    }
    const trail = scene.getMeshByName('world-space-ship-wake');
    const bow = scene.getMeshByName('breaking-bow-and-shoulder-waves');
    assert.equal(trail.isVisible, true);
    assert.equal(bow.isVisible, true);
    const positions = [...trail.getVerticesData('position')];
    for (let index = 1; index < positions.length; index += 3) {
      assert.ok(Math.abs(positions[index] - .22) < 1e-7, 'CPU vertices contain an offset above the GPU surface');
    }
    state.positionZ = 4.1;
    wake.update(state, .411);
    assert.deepEqual([...trail.getVerticesData('position')], positions, 'history geometry holds between 30 Hz uploads');
    assert.equal(trail.material._floats.time, .411, 'surface animation advances every frame through the shader');

    state.positionX = 1000;
    state.positionZ = 1000;
    state.heading = Math.PI / 2;
    wake.update(state, .6);
    const afterTurn = trail.getVerticesData('position');
    assert.ok(Math.abs(afterTurn[0]) < 15, 'old emission stays near its world-space location after a turn');
    assert.equal(afterTurn[2], -75, 'old emission does not translate with the current hull');
    wake.reset();
    assert.equal(trail.isVisible, false);
    assert.equal(bow.isVisible, false);
  });
}
