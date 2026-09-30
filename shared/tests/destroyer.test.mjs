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
