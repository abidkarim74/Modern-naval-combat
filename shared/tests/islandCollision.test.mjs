import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatSimulation, BOAT_SIMULATION_CONFIG } from '../dist/index.js';
import { islandHullOverlaps, resolveIslandHullMotion } from '../dist/world/islandCollision.js';
import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_DOCK_OBSTACLES, islandShoreRadius } from '../dist/world/islandTerrain.js';

const hull = { length: BOAT_SIMULATION_CONFIG.hullLengthMeters, beam: BOAT_SIMULATION_CONFIG.hullBeamMeters };
const poseOf = (state) => ({ x: state.positionX, z: state.positionZ, heading: state.heading });
const dockHead = ISLAND_DOCK_OBSTACLES.find((dock) => dock.kind === 'head');
const head = { x: ISLAND_CENTER.x + dockHead.centerX, z: ISLAND_CENTER.z + dockHead.centerZ };
const headSouth = head.z - dockHead.halfZ;

test('land is solid through its centre and the open ocean remains clear', () => {
  assert.equal(islandHullOverlaps({ ...ISLAND_CENTER, heading: 0 }, hull), true);
  assert.equal(islandHullOverlaps({ x: 0, z: 0, heading: 0 }, hull), false);
  assert.equal(islandHullOverlaps({ x: head.x, z: head.z, heading: 0 }, hull), true);
});

test('the sheltered lagoon is navigable and its inner shore remains solid', () => {
  const start = { x: ISLAND_CENTER.x, z: ISLAND_CENTER.z - 440, heading: 0 };
  const insideBay = { ...start, z: ISLAND_CENTER.z - 195 };
  const approach = resolveIslandHullMotion(start, insideBay, { x: 0, z: 12 }, hull);
  assert.equal(approach.collided, false, 'the bay must be real open water, not a painted patch over land');
  assert.equal(islandHullOverlaps(insideBay, hull), false);
  const contact = resolveIslandHullMotion(insideBay, { ...insideBay, z: ISLAND_CENTER.z }, { x: 0, z: 12 }, hull);
  assert.equal(contact.collided, true);
  assert.equal(islandHullOverlaps(contact.pose, hull), false);
});

test('a swept full hull cannot cross any shoreline, even with a kilometre-scale step', () => {
  for (let index = 0; index < 48; index++) {
    const angle = index * Math.PI * 2 / 48, radius = islandShoreRadius(angle);
    const localX = Math.cos(angle) * ISLAND_RADIUS_X * radius;
    const localZ = Math.sin(angle) * ISLAND_RADIUS_Z * radius;
    const distance = Math.hypot(localX, localZ), nx = localX / distance, nz = localZ / distance;
    for (const offset of [0, Math.PI / 2, Math.PI, 0.63]) {
      const heading = Math.atan2(-nx, -nz) + offset;
      const start = { x: ISLAND_CENTER.x + localX + nx * 350, z: ISLAND_CENTER.z + localZ + nz * 350, heading };
      const target = { x: start.x - nx * 2200, z: start.z - nz * 2200, heading };
      const motion = resolveIslandHullMotion(start, target, { x: -nx * 15, z: -nz * 15 }, hull);
      assert.equal(motion.collided, true, `approach ${index}, heading offset ${offset}`);
      assert.equal(motion.recovered, false);
      assert.equal(islandHullOverlaps(motion.pose, hull), false);
      assert.ok(motion.distance < 2200, 'the distance log must not count a rejected crossing');
      assert.ok(Object.values(motion.pose).every(Number.isFinite));
    }
  }
});

test('the bow and stern stop before the pier while the ship centre is still offshore', () => {
  for (const heading of [0, Math.PI]) {
    const start = { x: head.x, z: headSouth - 160, heading };
    const target = { ...start, z: headSouth + 100 };
    const motion = resolveIslandHullMotion(start, target, { x: 0, z: 15 }, hull);
    assert.ok(Math.abs(motion.pose.z - (headSouth - hull.length / 2 - 2)) < 0.01);
    assert.ok(Math.abs(motion.velocity.z) < 1e-8);
    assert.equal(islandHullOverlaps(motion.pose, hull), false);
    assert.equal(motion.collided, true);
  }
});

test('glancing contact preserves tangential velocity and allows retreat from the pier', () => {
  const start = { x: head.x - 240, z: head.z, heading: Math.PI / 2 };
  const target = { ...start, x: head.x + 120, z: head.z + 30 };
  const motion = resolveIslandHullMotion(start, target, { x: 20, z: 8 }, hull);
  assert.equal(motion.collided, true);
  assert.ok(Math.abs(motion.velocity.x) < 1e-8);
  assert.equal(motion.velocity.z, 8);
  assert.ok(Math.abs(motion.pose.z - target.z) < 1e-8);
  assert.equal(islandHullOverlaps(motion.pose, hull), false);
  const retreat = resolveIslandHullMotion(motion.pose, { ...motion.pose, x: motion.pose.x - 40 }, { x: -4, z: 0 }, hull);
  assert.equal(retreat.collided, false);
  assert.equal(retreat.velocity.x, -4);
  assert.ok(Math.abs(retreat.pose.x - (motion.pose.x - 40)) < 1e-8);
});

test('rotation stops before a long bow swings into the dock', () => {
  const start = { x: head.x - dockHead.halfX - 35, z: head.z, heading: 0 };
  assert.equal(islandHullOverlaps(start, hull), false);
  const motion = resolveIslandHullMotion(start, { ...start, heading: Math.PI }, { x: 0, z: 0 }, hull);
  assert.equal(motion.rotationBlocked, true, 'rotation must sweep through contact even when the final angle is clear');
  assert.ok(motion.pose.heading > 0 && motion.pose.heading < Math.PI / 2);
  assert.equal(islandHullOverlaps(motion.pose, hull), false);
  assert.equal(motion.distance, 0);
});

test('overlapping starting positions recover to open water without adding travel', () => {
  for (const start of [{ ...ISLAND_CENTER, heading: 0 }, { ...head, heading: 0 }, { ...head, heading: 1.2 }]) {
    const motion = resolveIslandHullMotion(start, start, { x: 0, z: 0 }, hull);
    assert.equal(motion.recovered, true);
    assert.equal(islandHullOverlaps(motion.pose, hull), false);
    assert.deepEqual(motion.previousPose, motion.pose, 'interpolation must not sweep through the recovery teleport');
    assert.equal(motion.distance, 0);
  }
});

test('authoritative boat integration stops at the pier and can reverse away', () => {
  const ship = new BoatSimulation();
  Object.assign(ship.state, { positionX: head.x, positionZ: headSouth - hull.length / 2 - 4,
    velocityZ: 15, speed: 15, forwardSpeed: 15, throttle: 1 });
  const initialZ = ship.state.positionZ;
  for (let index = 0; index < 120; index++) {
    ship.update({ throttle: 1, steering: 0 }, 0.25);
    assert.equal(islandHullOverlaps(poseOf(ship.state), hull), false);
    assert.equal(islandHullOverlaps({ x: ship.state.previousPositionX, z: ship.state.previousPositionZ, heading: ship.state.previousHeading }, hull), false);
  }
  assert.ok(ship.state.positionZ <= headSouth - hull.length / 2 - 1.99);
  assert.ok(ship.state.speed < 1e-8);
  assert.ok(Math.abs(ship.state.forwardSpeed - ship.state.velocityZ) < 1e-8);
  assert.ok(Math.abs(ship.state.distanceTraveledMeters - (ship.state.positionZ - initialZ)) < 1e-6);
  const stoppedZ = ship.state.positionZ;
  for (let index = 0; index < 180; index++) ship.update({ throttle: -1, steering: 0 }, 0.25);
  assert.ok(ship.state.positionZ < stoppedZ - 5);
  assert.ok(ship.state.forwardSpeed < 0);
  assert.equal(islandHullOverlaps(poseOf(ship.state), hull), false);
});

test('boat recovery resets interpolation and does not inflate the odometer', () => {
  const ship = new BoatSimulation();
  Object.assign(ship.state, { positionX: ISLAND_CENTER.x, positionZ: ISLAND_CENTER.z });
  ship.update({ throttle: 0, steering: 0 });
  assert.equal(islandHullOverlaps(poseOf(ship.state), hull), false);
  assert.equal(ship.state.previousPositionX, ship.state.positionX);
  assert.equal(ship.state.previousPositionZ, ship.state.positionZ);
  assert.equal(ship.state.distanceTraveledMeters, 0);
  assert.ok(Object.values(ship.state).every(Number.isFinite));
});
