import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatSimulation, BOAT_SIMULATION_CONFIG } from '../dist/index.js';
const advance = (ship, seconds, throttle = 0, steering = 0) => {
  for (let i = 0; i < seconds * 60; i++) ship.update({ throttle, steering });
};
test('rudder alone cannot rotate or propel a stopped destroyer', () => {
  const ship = new BoatSimulation();
  advance(ship, 30, 0, 1);
  assert.equal(ship.state.heading, 0);
  assert.equal(ship.state.speed, 0);
});
test('acceleration is gradual and settles near the public 30-knot class speed', () => {
  const ship = new BoatSimulation();
  advance(ship, 30, 1);
  assert.ok(ship.state.speed > 4 && ship.state.speed < 8);
  advance(ship, 150, 1);
  assert.ok(ship.state.speed * 1.943844 > 29);
  assert.ok(ship.state.speed <= BOAT_SIMULATION_CONFIG.maximumSpeedMetersPerSecond);
});
test('neutral coasts and astern thrust takes time to stop forward momentum', () => {
  const ship = new BoatSimulation();
  advance(ship, 180, 1);
  const cruise = ship.state.speed;
  advance(ship, 15);
  assert.ok(ship.state.speed < cruise && ship.state.speed > cruise * .7);
  advance(ship, 10, -1);
  assert.ok(ship.state.forwardSpeed > 0);
  advance(ship, 200, -1);
  assert.ok(ship.state.forwardSpeed < -3);
  assert.ok(ship.state.forwardSpeed >= -BOAT_SIMULATION_CONFIG.maximumReverseSpeedMetersPerSecond);
});
test('hard rudder produces a broad turn and carries world-space momentum', () => {
  const ship = new BoatSimulation();
  advance(ship, 180, 1);
  advance(ship, 120, 1, 1);
  const radius = ship.state.speed / ship.state.yawRate;
  assert.ok(radius > 450 && radius < 900);
  assert.ok(Math.abs(ship.state.roll) < .15);
  const yaw = ship.state.yawRate;
  advance(ship, 1, 1, 0);
  assert.ok(ship.state.yawRate > yaw * .8);
});
test('astern steering reverses rudder response', () => {
  const ship = new BoatSimulation();
  advance(ship, 100, -1, 1);
  assert.ok(ship.state.forwardSpeed < 0);
  assert.ok(ship.state.yawRate < 0);
});
test('long mixed maneuvers remain finite with modest fair-weather pitch and roll', () => {
  const ship = new BoatSimulation();
  for(let i=0;i<12;i++) {
    advance(ship, 60, i % 3 === 0 ? -1 : 1, i % 2 === 0 ? -1 : 1);
    assert.ok(Object.values(ship.state).every(Number.isFinite));
    assert.ok(Math.abs(ship.state.pitch) < .08);
    assert.ok(Math.abs(ship.state.roll) < .15);
    assert.ok(Math.abs(ship.state.positionY) < 2);
  }
});

test('travel is integrated in world metres, including coasting after engine neutral', () => {
  const ship = new BoatSimulation();
  advance(ship, 60, 1);
  assert.ok(ship.state.positionZ > 280, 'the hull must actually cover distance');
  assert.ok(Math.abs(ship.state.distanceTraveledMeters - ship.state.positionZ) < 1e-6);
  const previousZ = ship.state.positionZ;
  const previousLog = ship.state.distanceTraveledMeters;
  advance(ship, 10);
  assert.ok(ship.state.positionZ > previousZ + 80);
  assert.ok(ship.state.distanceTraveledMeters > previousLog + 80);
});

test('rudder takes time to slew, and does not rotate world velocity instantaneously', () => {
  const ship = new BoatSimulation();
  advance(ship, 120, 1);
  ship.update({ throttle: 1, steering: 1 });
  assert.ok(ship.state.rudderAngleRadians > 0 && ship.state.rudderAngleRadians < .001);
  assert.ok(Math.abs(ship.state.velocityX) < .001);
  advance(ship, 25, 1, 1);
  const course = Math.atan2(ship.state.velocityX, ship.state.velocityZ);
  const sideslip = ship.state.heading - course;
  assert.ok(sideslip > .02 && sideslip < .25, 'momentum should lag the turning hull');
  assert.equal(ship.state.rudderAngleRadians, BOAT_SIMULATION_CONFIG.maximumRudderAngleRadians);
});

test('hard helm loses speed through rudder and hull drag', () => {
  const straight = new BoatSimulation(), turning = new BoatSimulation();
  advance(straight, 180, 1); advance(turning, 180, 1);
  advance(straight, 90, 1); advance(turning, 90, 1, 1);
  assert.ok(turning.state.speed < straight.state.speed * .94);
  assert.ok(turning.state.speed > straight.state.speed * .65);
});

test('20 Hz and 60 Hz simulation updates cover the same time and trajectory', () => {
  const fast = new BoatSimulation(), slow = new BoatSimulation();
  for (let i = 0; i < 60 * 90; i++) fast.update({ throttle: 1, steering: .6 }, 1 / 60);
  for (let i = 0; i < 20 * 90; i++) slow.update({ throttle: 1, steering: .6 }, 1 / 20);
  assert.ok(Math.abs(fast.state.elapsedTime - slow.state.elapsedTime) < 1e-8);
  assert.ok(Math.hypot(fast.state.positionX - slow.state.positionX, fast.state.positionZ - slow.state.positionZ) < .01);
  assert.ok(Math.abs(fast.state.roll - slow.state.roll) < .001);
});

test('invalid or zero time does not corrupt state and nonfinite inputs settle to neutral', () => {
  const ship = new BoatSimulation(), original = structuredClone(ship.state);
  for (const dt of [0, -1, NaN, Infinity]) ship.update({ throttle: 1, steering: 1 }, dt);
  assert.deepEqual(ship.state, original);
  for (let i = 0; i < 600; i++) ship.update({ throttle: NaN, steering: Infinity });
  assert.ok(Object.values(ship.state).every(Number.isFinite));
  assert.equal(ship.state.speed, 0);
  assert.equal(ship.state.rudderAngleRadians, 0);
});
