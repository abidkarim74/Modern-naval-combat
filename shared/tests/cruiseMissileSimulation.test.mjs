import test from 'node:test';
import assert from 'node:assert/strict';
import { CruiseMissileSimulation } from '../dist/index.js';

const launch = (overrides = {}) => ({
  position: { x: 0, y: 8, z: 0 },
  direction: { x: 0, y: 1, z: 0 },
  headingRadians: 0,
  inheritedVelocity: { x: 0, y: 0, z: 0 },
  ...overrides,
});
const advance = (missile, seconds, hz = 120) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) missile.update(1 / hz);
};
const length = (v) => Math.hypot(v.x, v.y, v.z);
const difference = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

test('vertical boost rises moderately and clears the ship before the curved pitch-over', () => {
  const missile = new CruiseMissileSimulation(launch());
  advance(missile, 1);
  assert.equal(missile.state.phase, 'boost');
  assert.deepEqual(missile.state.direction, { x: 0, y: 1, z: 0 });
  assert.equal(missile.state.position.z, 0);
  assert.ok(missile.state.position.y > 35 && missile.state.position.y < 45, 'the deck exit should rise steadily without rushing the vertical climb');
  assert.ok(missile.state.velocity.y > 50 && missile.state.velocity.y < 65, 'vertical ascent should be slower than outbound flight without feeling sluggish');
  let previousHeight = missile.state.position.y;
  while (missile.state.phase === 'boost' && missile.state.ageSeconds < 2) {
    previousHeight = missile.state.position.y;
    missile.update(1 / 120);
  }
  assert.equal(missile.state.phase, 'turn');
  assert.ok(previousHeight - 8 >= 55, 'pitch-over cannot begin while the missile is below mast clearance');
  assert.ok(missile.state.ageSeconds >= 1.3 && missile.state.ageSeconds < 1.6);
});

test('launch preserves ship roll/pitch and inherits its world-space momentum', () => {
  const axis = { x: .03, y: 2, z: -.06 };
  const input = launch({ direction: axis, inheritedVelocity: { x: 12, y: 0, z: -4 } });
  const original = structuredClone(input);
  const tilted = new CruiseMissileSimulation(input);
  assert.ok(Math.abs(length(tilted.state.direction) - 1) < 1e-12);
  assert.ok(Math.abs(tilted.state.direction.x - axis.x / length(axis)) < 1e-12);
  assert.ok(Math.abs(tilted.state.velocity.x - (12 + tilted.state.direction.x * 8)) < 1e-12);
  assert.deepEqual(input, original, 'launch vectors must never be mutated or retained by reference');

  const moving = new CruiseMissileSimulation(launch({ inheritedVelocity: { x: 12, y: 0, z: -4 } }));
  const stopped = new CruiseMissileSimulation(launch());
  advance(moving, 1); advance(stopped, 1);
  assert.ok(Math.abs(moving.state.position.x - stopped.state.position.x - 12) < 1e-9);
  assert.ok(Math.abs(moving.state.position.z - stopped.state.position.z + 4) < 1e-9);
});

test('fixed-step accumulation produces the same trajectory at 30, 60 and 144 fps', () => {
  const input = launch({ direction: { x: .015, y: 1, z: -.012 }, headingRadians: .7, inheritedVelocity: { x: 2, y: .1, z: 12 } });
  const reference = new CruiseMissileSimulation(input);
  advance(reference, 12);
  for (const hz of [30, 60, 144]) {
    const candidate = new CruiseMissileSimulation(input);
    advance(candidate, 12, hz);
    assert.ok(difference(candidate.state.position, reference.state.position) < 1e-8, `${hz} fps changed position`);
    assert.ok(difference(candidate.state.velocity, reference.state.velocity) < 1e-8, `${hz} fps changed momentum`);
    assert.ok(difference(candidate.state.direction, reference.state.direction) < 1e-10);
    assert.equal(candidate.state.phase, reference.state.phase);
    assert.ok(Math.abs(candidate.state.distanceMeters - reference.state.distanceMeters) < 1e-8);
  }
  const slowFrame = new CruiseMissileSimulation(input);
  slowFrame.update(12);
  assert.ok(difference(slowFrame.state.position, reference.state.position) < 1e-8, 'a long frame must not lose elapsed simulation time');
});

test('orientation and trajectory bend continuously without position or velocity snaps', () => {
  const missile = new CruiseMissileSimulation(launch({ headingRadians: -.8 }));
  let traveled = 0;
  let highestAltitude = 0;
  for (let i = 0; i < 12 * 120; i++) {
    const previous = structuredClone(missile.state);
    missile.update(1 / 120);
    const state = missile.state;
    const positionStep = difference(state.position, previous.position);
    traveled += positionStep;
    highestAltitude = Math.max(highestAltitude, state.position.y);
    assert.ok(Math.abs(positionStep - length(state.velocity) / 120) < 1e-8, 'position must follow integrated momentum');
    assert.ok(difference(state.velocity, previous.velocity) < 2, 'staging and leveling must not snap velocity');
    const turnAngle = Math.acos(Math.min(1, Math.max(-1, dot(state.direction, previous.direction))));
    assert.ok(turnAngle <= 52 * Math.PI / 180 / 120 + 1e-8, 'nose turn exceeded its angular rate limit');
    assert.ok(Math.abs(length(state.direction) - 1) < 1e-10);
    assert.ok(length(state.velocity) < 260);
    assert.ok(state.position.y > 7, 'curve must remain clear of the sea');
  }
  assert.ok(highestAltitude > 150 && highestAltitude < 300, 'the curve should visibly crest before leveling');
  assert.ok(Math.abs(traveled - missile.state.distanceMeters) < 1e-8);
});

test('booster cutoff and folding wings are staged while flight continues', () => {
  const missile = new CruiseMissileSimulation(launch());
  advance(missile, 2.5);
  assert.equal(missile.state.wingDeployment, 0);
  advance(missile, 1);
  assert.ok(missile.state.wingDeployment > .45 && missile.state.wingDeployment < .55);
  assert.equal(missile.state.boosterBurning, true);
  assert.equal(missile.state.boosterAttached, true);
  advance(missile, 1);
  assert.equal(missile.state.wingDeployment, 1);
  assert.equal(missile.state.boosterBurning, false);
  assert.equal(missile.state.boosterAttached, false);
  assert.ok(length(missile.state.velocity) > 160);
  advance(missile, 2);
  assert.equal(missile.state.phase, 'cruise');
});

test('cruise follows launch heading and settles above sea level through damping', () => {
  const missile = new CruiseMissileSimulation(launch({ headingRadians: Math.PI / 2 }));
  advance(missile, 12);
  assert.equal(missile.state.phase, 'cruise');
  assert.ok(missile.state.position.x > 1_800);
  assert.ok(Math.abs(missile.state.position.z) < 1e-8);
  assert.ok(missile.state.position.y > 110 && missile.state.position.y < 130);
  assert.ok(Math.abs(missile.state.velocity.y) < 1);
  assert.ok(length(missile.state.velocity) > 230 && length(missile.state.velocity) < 240);
  assert.ok(missile.state.direction.x > .999);
});

test('expired flights freeze and stop booster effects after their bounded lifetime', () => {
  const missile = new CruiseMissileSimulation(launch());
  missile.update(40);
  assert.equal(missile.state.phase, 'expired');
  assert.ok(Math.abs(missile.state.ageSeconds - 30) < 1e-8);
  assert.ok(missile.state.distanceMeters < 8_000);
  assert.equal(missile.state.boosterBurning, false);
  assert.equal(missile.state.boosterAttached, false);
  const expired = structuredClone(missile.state);
  missile.update(100);
  assert.deepEqual(missile.state, expired);
});

test('fractional, invalid and oversized inputs remain bounded and finite', () => {
  const missile = new CruiseMissileSimulation(launch({
    position: { x: NaN, y: Infinity, z: -Infinity },
    direction: { x: Infinity, y: NaN, z: 0 },
    headingRadians: NaN,
    inheritedVelocity: { x: NaN, y: Infinity, z: -Infinity },
  }));
  const original = structuredClone(missile.state);
  for (const dt of [0, -1, NaN, Infinity]) missile.update(dt);
  assert.deepEqual(missile.state, original);
  missile.update(1 / 240);
  assert.deepEqual(missile.state, original, 'a partial fixed step is accumulated');
  missile.update(1 / 240);
  assert.ok(missile.state.ageSeconds > 0);
  for (let i = 0; i < 31 * 120; i++) {
    missile.update(1 / 120);
    const state = missile.state;
    for (const vector of [state.position, state.velocity, state.direction]) assert.ok(Object.values(vector).every(Number.isFinite));
    assert.ok(Number.isFinite(state.distanceMeters) && Number.isFinite(state.ageSeconds));
  }
  assert.equal(missile.state.phase, 'expired');
  for (const scale of [1e-300, 1e300]) {
    const scaledAxis = new CruiseMissileSimulation(launch({ direction: { x: scale * .01, y: scale, z: 0 } }));
    assert.ok(Math.abs(scaledAxis.state.direction.x - .01 / Math.hypot(.01, 1)) < 1e-12);
    assert.ok(Math.abs(length(scaledAxis.state.direction) - 1) < 1e-12);
  }
});
