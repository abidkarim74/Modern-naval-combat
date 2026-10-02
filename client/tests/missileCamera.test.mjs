import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

// Extract the production method, rather than reproducing the camera algorithm
// in a mock. This leaves browser/GameSession setup out of the NullEngine test.
const source = await readFile(new URL('../src/game/GameSession.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('GameSession.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const sessionClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GameSession');
assert.ok(sessionClass, 'GameSession class must exist');
const cameraMethod = sessionClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'updateMissileCamera');
assert.ok(cameraMethod, 'the production missile tracking method must exist');
const harnessSource = `
  import { Vector3 } from ${JSON.stringify(import.meta.resolve('@babylonjs/core/Maths/math.vector.js'))};
  export class TestSession {
    cameraView = "missile";
    trackedMissileState = null;
    cameraViewChanges = [];
    missiles = { trackingState: null };
    simulation = { state: { heading: 0 } };
    constructor(public missileCamera) {}
    setCameraView(view) { this.cameraView = view; this.cameraViewChanges.push(view); }
    ${cameraMethod.getText(ast)}
  }
`;
const harness = ts.transpileModule(harnessSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { TestSession } = await import(`data:text/javascript;base64,${Buffer.from(harness).toString('base64')}`);

const trackingState = (overrides = {}) => ({
  position: { x: 0, y: -.5, z: 42 },
  direction: { x: 0, y: 1, z: 0 },
  velocity: { x: 0, y: 30, z: 0 },
  ageSeconds: 0,
  phase: 'boost',
  boosterBurning: true,
  boosterAttached: true,
  wingDeployment: 0,
  distanceMeters: 0,
  ...overrides,
});

function fixture(t) {
  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  const scene = new Scene(engine);
  const camera = new FreeCamera('test-missile-camera', Vector3.Zero(), scene);
  scene.activeCamera = camera;
  const session = new TestSession(camera);
  t.after(() => { scene.dispose(); engine.dispose(); });
  return { scene, camera, session };
}

const finitePosition = camera => [camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite);
const missileTarget = state => new Vector3(state.position.x, state.position.y, state.position.z)
  .add(new Vector3(state.direction.x, state.direction.y, state.direction.z).scale(3));
function assertPointsAtMissile(camera, state) {
  const expectedDirection = missileTarget(state).subtract(camera.position).normalize();
  camera.getViewMatrix(true);
  const cameraDirection = camera.getTarget().subtract(camera.position).normalize();
  assert.ok(Vector3.Dot(expectedDirection, cameraDirection) > .999999, 'camera must aim along the missile nose, including during pitch-over');
}

test('first tracking frame stays above water beside a vertical launch and aims at the missile', t => {
  const { camera, session } = fixture(t);
  session.simulation.state.heading = .65;
  const state = trackingState();
  session.missiles.trackingState = state;
  session.updateMissileCamera(.016);
  assert.ok(finitePosition(camera));
  assert.ok(camera.position.y >= 12, 'tracking a missile rising from a below-deck tube must not place the camera underwater');
  assert.ok(Vector3.Distance(camera.position, Vector3.Zero()) > 30, 'the first frame must snap to the launch instead of easing from world origin');
  assert.ok(Math.abs(Math.hypot(camera.position.x - state.position.x, camera.position.z - state.position.z) - 31) < 1e-8);
  const horizontalOffset = new Vector3(camera.position.x - state.position.x, 0, camera.position.z - state.position.z).normalize();
  assert.ok(Vector3.Dot(horizontalOffset, new Vector3(Math.cos(.65), 0, -Math.sin(.65))) > .999999, 'vertical flight uses ship heading for the camera side');
  assertPointsAtMissile(camera, state);
});

test('cruise tracking follows motion smoothly and remains aimed at the changing missile position', t => {
  const { camera, session } = fixture(t);
  const state = trackingState({
    position: { x: 400, y: 120, z: 800 }, direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 235, y: 0, z: 0 }, phase: 'cruise',
  });
  session.missiles.trackingState = state;
  session.updateMissileCamera(0);
  const previous = camera.position.clone();
  state.position.x += 23.5;
  session.updateMissileCamera(.1);
  assert.ok(finitePosition(camera));
  assert.ok(camera.position.x > previous.x && camera.position.x < previous.x + 23.5, 'same-flight tracking must ease toward its next position');
  assert.ok(Math.abs(camera.position.y - previous.y) < 1e-8);
  assert.ok(Math.abs(camera.position.z - previous.z) < 1e-8);
  assertPointsAtMissile(camera, state);
  const intermediate = camera.position.clone();
  session.updateMissileCamera(.1);
  assert.ok(camera.position.x > intermediate.x && camera.position.x < previous.x + 23.5, 'tracking must converge without overshooting a stationary target');
});

test('a new launch immediately replaces distant-flight tracking without sweeping across the world', t => {
  const { camera, session } = fixture(t);
  session.missiles.trackingState = trackingState({
    position: { x: 6_000, y: 120, z: -4_000 }, direction: { x: 0, y: 0, z: -1 },
    velocity: { x: 0, y: 0, z: -235 }, phase: 'cruise',
  });
  session.updateMissileCamera(.1);
  const distantCamera = camera.position.clone();
  const latest = trackingState({ position: { x: 100, y: 6, z: 50 } });
  session.missiles.trackingState = latest;
  session.updateMissileCamera(.001);
  assert.equal(session.trackedMissileState, latest);
  assert.ok(Vector3.Distance(camera.position, distantCamera) > 5_000);
  assert.ok(Vector3.Distance(camera.position, new Vector3(100, 6, 50)) < 40, 'new flight identity must snap to the new launch even with a tiny delta');
  assert.ok(camera.position.y >= 12);
  assertPointsAtMissile(camera, latest);
});

test('tracking returns to chase when there is no live missile', t => {
  const { camera, session } = fixture(t);
  session.missiles.trackingState = trackingState();
  session.updateMissileCamera(.1);
  const previous = camera.position.clone();
  session.missiles.trackingState = null;
  session.updateMissileCamera(.1);
  assert.equal(session.cameraView, 'chase');
  assert.deepEqual(session.cameraViewChanges, ['chase']);
  assert.ok(Vector3.Distance(camera.position, previous) < 1e-8, 'missing flight must not move the tracking camera');
});
