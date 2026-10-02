import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatSimulation, sampleOceanHeight } from '../dist/index.js';

const neutral = { throttle: 0, steering: 0 };

test('heave, pitch and roll restore a displaced hull while following the moving sea', () => {
  const reference = new BoatSimulation(), displaced = new BoatSimulation();
  displaced.state.positionY += 4;
  displaced.state.verticalVelocity = 2;
  displaced.state.pitch = .25;
  displaced.state.pitchVelocity = .1;
  displaced.state.roll = -.3;
  displaced.state.rollVelocity = -.2;
  let minHeight = Infinity, maxHeight = -Infinity;
  for (let index = 0; index < 120 * 60; index++) {
    reference.update(neutral);
    displaced.update(neutral);
    assert.ok(Object.values(displaced.state).every(Number.isFinite));
    minHeight = Math.min(minHeight, reference.state.positionY);
    maxHeight = Math.max(maxHeight, reference.state.positionY);
  }
  for (const field of ['positionY', 'verticalVelocity', 'pitch', 'pitchVelocity', 'roll', 'rollVelocity']) {
    assert.ok(Math.abs(displaced.state[field] - reference.state[field]) < 1e-9, `${field} disturbance should decay`);
  }
  assert.ok(maxHeight - minHeight > .4, 'the heavy hull still responds to long swell');
  assert.equal(displaced.state.speed, 0, 'vertical waves do not create artificial engine thrust');
});

test('waterplane sampling averages short waves across a destroyer hull', () => {
  const ship = new BoatSimulation();
  let hullSquared = 0, surfaceSquared = 0, count = 0;
  for (let index = 0; index < 180 * 60; index++) {
    ship.update(neutral);
    if (index < 30 * 60) continue;
    hullSquared += (ship.state.positionY - .6) ** 2;
    surfaceSquared += sampleOceanHeight(ship.state.positionX, ship.state.positionZ, ship.state.elapsedTime) ** 2;
    count++;
  }
  assert.ok(Math.sqrt(hullSquared / count) < Math.sqrt(surfaceSquared / count) * .85,
    'a long hull bridges short chop instead of tracking a single-point wave height');
});

test('buoyancy is identical with fixed 60 Hz, server 20 Hz and capped 4 Hz updates', () => {
  const fixed = new BoatSimulation(), server = new BoatSimulation(), coarse = new BoatSimulation();
  const input = { throttle: 1, steering: .7 };
  for (let index = 0; index < 90 * 60; index++) fixed.update(input, 1 / 60);
  for (let index = 0; index < 90 * 20; index++) server.update(input, 1 / 20);
  for (let index = 0; index < 90 * 4; index++) coarse.update(input, 1 / 4);
  for (const other of [server, coarse]) {
    for (const field of ['elapsedTime', 'positionX', 'positionY', 'positionZ', 'verticalVelocity', 'pitch', 'pitchVelocity', 'roll', 'rollVelocity']) {
      assert.ok(Math.abs(fixed.state[field] - other.state[field]) < 1e-8, `${field} should be independent of update grouping`);
    }
  }
});
