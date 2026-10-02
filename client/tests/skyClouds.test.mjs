import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

async function sourceUrl(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replace(/\bfrom\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => {
    if (specifier.startsWith('.')) {
      assert.ok(dependencies[specifier], `unexpected runtime-relative import ${specifier}`);
      return `from ${JSON.stringify(dependencies[specifier])}`;
    }
    const name = specifier.startsWith('@babylonjs/core/') && !specifier.endsWith('.js') ? `${specifier}.js` : specifier;
    return `from ${JSON.stringify(import.meta.resolve(name))}`;
  });
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
}
const textureUrl = await sourceUrl('../src/world/skyCloudTexture.ts');
const { generateSkyCloudData, SKY_CLOUD_TEXTURE_SIZE: size, SKY_SUN_ANGULAR_RADIUS } = await import(textureUrl);
const { createDaylightMaterial } = await import(await sourceUrl('../src/world/createDaylightMaterial.ts', {
  './skyCloudTexture': textureUrl,
}));

test('cumulus texture leaves most of the sky clear and carries rounded-puff lighting', () => {
  const data = generateSkyCloudData();
  assert.equal(generateSkyCloudData(), data, 'cloud fields are generated once across scene restarts');
  assert.equal(data.length, size * size * 4);
  assert.ok(data.byteLength * 4 / 3 < 1.5 * 1024 * 1024, 'cloud tile and mips stay small');
  let cloudPixels = 0, litPixels = 0, shadowPixels = 0, clearPixels = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset] > 100) {
      cloudPixels++;
      if (data[offset + 1] > 190) litPixels++;
      if (data[offset + 1] < 90) shadowPixels++;
      assert.ok(data[offset + 3] > 70, 'dense clouds retain physical puff thickness');
    } else if (data[offset] < 30) clearPixels++;
  }
  const count = size * size;
  assert.ok(cloudPixels / count > 0.06 && cloudPixels / count < 0.32, 'fair weather has sparse clouds');
  assert.ok(clearPixels / count > 0.60, 'blue sky remains dominant');
  assert.ok(litPixels > cloudPixels * 0.10 && shadowPixels > cloudPixels * 0.05,
    'cloud puffs have both sunlit faces and shaded faces');
});

test('periodic cloud density has no texture-border discontinuity', () => {
  const data = generateSkyCloudData();
  for (const axis of ['x', 'z']) for (const channel of [0, 2, 3]) {
    let seamDifference = 0, interiorDifference = 0;
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
      const nextRow = axis === 'z' ? (row + 1) % size : row;
      const nextColumn = axis === 'x' ? (column + 1) % size : column;
      const current = data[(row * size + column) * 4 + channel];
      const next = data[(nextRow * size + nextColumn) * 4 + channel];
      const squaredDifference = (next - current) ** 2;
      if ((axis === 'x' ? column : row) === size - 1) seamDifference += squaredDifference;
      else interiorDifference += squaredDifference;
    }
    assert.ok(seamDifference / size < interiorDifference / (size * (size - 1)) * 3.0,
      `${axis} wrap in cloud field ${channel} must remain an ordinary neighbour transition`);
  }
});

test('solar disc uses the Earth-observed half-degree angular size', () => {
  const diameterDegrees = SKY_SUN_ANGULAR_RADIUS * 2 * 180 / Math.PI;
  assert.ok(diameterDegrees > 0.52 && diameterDegrees < 0.54);
});

test('sky binds the current global camera or reflection-probe eye on the same draw', t => {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const parent = new Mesh('gun-mount', scene);
  parent.position.set(240, 12, -190);
  const camera = new FreeCamera('parented-gun-camera', new Vector3(1, 4, 2), scene);
  camera.parent = parent;
  scene.activeCamera = camera;
  camera.getViewMatrix(true);
  const material = createDaylightMaterial(scene, new Vector3(-.42, .68, .60).normalize());
  const captured = [];
  material.getEffect = () => ({ setVector3(name, value) { captured.push({ name, value: value.clone() }); } });
  material.onBindObservable.notifyObservers(parent);
  assert.equal(captured.at(-1).name, 'eyePosition');
  assert.ok(Vector3.Distance(captured.at(-1).value, camera.globalPosition) < 1e-8);
  assert.ok(Vector3.Distance(captured.at(-1).value, camera.position) > 100,
    'a parented camera must use its world-space eye');
  scene._forcedViewPosition = new Vector3(-7, 3, 11);
  material.onBindObservable.notifyObservers(parent);
  assert.deepEqual(captured.at(-1).value.asArray(), [-7, 3, 11],
    'all cubemap faces bind their probe origin instead of the gameplay camera');
});
