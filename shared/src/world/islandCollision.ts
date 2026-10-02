import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_DOCK_OBSTACLES, islandShoreRadius } from "./islandTerrain.js";

export interface HullPose { x: number; z: number; heading: number }
export interface HullDimensions { length: number; beam: number }
export interface PlanarVelocity { x: number; z: number }
export interface IslandHullMotion {
  pose: HullPose;
  previousPose: HullPose;
  velocity: PlanarVelocity;
  distance: number;
  collided: boolean;
  rotationBlocked: boolean;
  recovered: boolean;
}

interface Point { x: number; z: number }
interface Obstacle {
  points: readonly Point[];
  axes: readonly Point[];
  minX: number; maxX: number; minZ: number; maxZ: number;
}
interface SweepHit { time: number; normal: Point }

// The renderer and authoritative simulation share the same shoreline. The
// star-shaped coast is filled with triangles, so bays remain navigable while
// every square metre of land (including the island's centre) is solid.
const COAST_SEGMENTS = 256;
const HULL_CLEARANCE_METERS = 2;
const CONTACT_GAP_METERS = 0.002;
const EPSILON = 1e-9;
const obstacles: readonly Obstacle[] = createObstacles();
const worldBounds = {
  minX: Math.min(...obstacles.map((obstacle) => obstacle.minX)),
  maxX: Math.max(...obstacles.map((obstacle) => obstacle.maxX)),
  minZ: Math.min(...obstacles.map((obstacle) => obstacle.minZ)),
  maxZ: Math.max(...obstacles.map((obstacle) => obstacle.maxZ)),
};

/** Checks the complete oriented waterline hull, rather than its centre. */
export function islandHullOverlaps(pose: HullPose, hull: HullDimensions, clearance = 0): boolean {
  const basis = hullBasis(pose, hull, clearance);
  const bounds = hullBounds(pose, basis);
  if (!boundsOverlap(bounds, worldBounds)) return false;
  for (const obstacle of obstacles) {
    if (!boundsOverlap(bounds, obstacle)) continue;
    if (axesFor(obstacle, basis).every((axis) => {
      const [minimum, maximum] = projectObstacle(obstacle, axis);
      const centre = dot(pose, axis), radius = hullProjectionRadius(basis, axis);
      return centre + radius > minimum + EPSILON && centre - radius < maximum - EPSILON;
    })) return true;
  }
  return false;
}

/**
 * Resolves a full hull sweep, keeps tangential movement, and cancels only
 * velocity directed into land. Swept SAT covers arbitrarily large translation
 * steps; the safety clearance also covers sub-metre rotational tip sampling.
 */
export function resolveIslandHullMotion(
  originalStart: HullPose, target: HullPose, originalVelocity: PlanarVelocity, hull: HullDimensions,
): IslandHullMotion {
  const start = { ...originalStart }, pose = { ...originalStart }, velocity = { ...originalVelocity };
  let collided = false, recovered = false, distance = 0;
  if (islandHullOverlaps(start, hull, HULL_CLEARANCE_METERS)) {
    const recovery = recoverHull(start, hull);
    start.x = pose.x = recovery.x;
    start.z = pose.z = recovery.z;
    removeInward(velocity, recovery.normal);
    collided = recovered = true;
  }

  let remaining = { x: target.x - originalStart.x, z: target.z - originalStart.z };
  // Several contacts can occur on a concave coast or where the pier joins it.
  // Unresolved residual motion is discarded; a hull can never jump a corner.
  for (let contact = 0; contact < 6 && Math.hypot(remaining.x, remaining.z) > EPSILON; contact++) {
    const hit = sweepHull(pose, remaining, hull);
    if (!hit) {
      pose.x += remaining.x; pose.z += remaining.z;
      distance += Math.hypot(remaining.x, remaining.z);
      break;
    }
    collided = true;
    const travel = Math.hypot(remaining.x, remaining.z);
    const fraction = Math.max(0, hit.time - CONTACT_GAP_METERS / travel);
    pose.x += remaining.x * fraction; pose.z += remaining.z * fraction;
    distance += travel * fraction;
    remaining = { x: remaining.x * (1 - fraction), z: remaining.z * (1 - fraction) };
    removeInward(remaining, hit.normal);
    removeInward(velocity, hit.normal);
  }

  let rotationBlocked = false;
  const headingChange = target.heading - originalStart.heading;
  const tipRadius = Math.hypot(hull.length / 2 + HULL_CLEARANCE_METERS, hull.beam / 2 + HULL_CLEARANCE_METERS);
  const rotationSteps = Math.max(1, Math.ceil(Math.abs(headingChange) * tipRadius / 0.4));
  for (let index = 1; index <= rotationSteps; index++) {
    const nextHeading = originalStart.heading + headingChange * index / rotationSteps;
    if (!islandHullOverlaps({ ...pose, heading: nextHeading }, hull, HULL_CLEARANCE_METERS)) {
      pose.heading = nextHeading;
      continue;
    }
    // Preserve the last safe angle and locate first contact within this arc.
    let safe = pose.heading, blocked = nextHeading;
    for (let iteration = 0; iteration < 18; iteration++) {
      const middle = (safe + blocked) / 2;
      if (islandHullOverlaps({ ...pose, heading: middle }, hull, HULL_CLEARANCE_METERS)) blocked = middle;
      else safe = middle;
    }
    pose.heading = safe;
    collided = rotationBlocked = true;
    break;
  }
  return { pose, previousPose: start, velocity, distance, collided, rotationBlocked, recovered };
}

function createObstacles(): Obstacle[] {
  const shore: Point[] = [];
  for (let index = 0; index < COAST_SEGMENTS; index++) {
    const angle = index * Math.PI * 2 / COAST_SEGMENTS, radius = islandShoreRadius(angle);
    shore.push({ x: ISLAND_CENTER.x + Math.cos(angle) * ISLAND_RADIUS_X * radius,
      z: ISLAND_CENTER.z + Math.sin(angle) * ISLAND_RADIUS_Z * radius });
  }
  const result = shore.map((point, index) => makeObstacle([ISLAND_CENTER, point, shore[(index + 1) % shore.length]]));
  for (const dock of ISLAND_DOCK_OBSTACLES) {
    const x = ISLAND_CENTER.x + dock.centerX, z = ISLAND_CENTER.z + dock.centerZ;
    result.push(makeObstacle([
      { x: x - dock.halfX, z: z - dock.halfZ }, { x: x + dock.halfX, z: z - dock.halfZ },
      { x: x + dock.halfX, z: z + dock.halfZ }, { x: x - dock.halfX, z: z + dock.halfZ },
    ]));
  }
  return result;
}

function makeObstacle(points: readonly Point[]): Obstacle {
  const axes = points.map((point, index) => {
    const next = points[(index + 1) % points.length], x = next.z - point.z, z = point.x - next.x;
    const length = Math.hypot(x, z);
    return { x: x / length, z: z / length };
  });
  return { points, axes,
    minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)), maxZ: Math.max(...points.map((point) => point.z)) };
}

function hullBasis(pose: HullPose, hull: HullDimensions, clearance: number) {
  const sine = Math.sin(pose.heading), cosine = Math.cos(pose.heading);
  return { forward: { x: sine, z: cosine }, right: { x: cosine, z: -sine },
    halfLength: hull.length / 2 + clearance, halfBeam: hull.beam / 2 + clearance };
}
type HullBasis = ReturnType<typeof hullBasis>;
function hullProjectionRadius(basis: HullBasis, axis: Point): number {
  return Math.abs(dot(basis.forward, axis)) * basis.halfLength + Math.abs(dot(basis.right, axis)) * basis.halfBeam;
}
function hullBounds(pose: HullPose, basis: HullBasis) {
  const x = hullProjectionRadius(basis, { x: 1, z: 0 }), z = hullProjectionRadius(basis, { x: 0, z: 1 });
  return { minX: pose.x - x, maxX: pose.x + x, minZ: pose.z - z, maxZ: pose.z + z };
}
function boundsOverlap(a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ;
}
function axesFor(obstacle: Obstacle, basis: HullBasis): readonly Point[] {
  return [...obstacle.axes, basis.right, basis.forward];
}
function projectObstacle(obstacle: Obstacle, axis: Point): [number, number] {
  let minimum = Infinity, maximum = -Infinity;
  for (const point of obstacle.points) {
    const projection = dot(point, axis);
    minimum = Math.min(minimum, projection); maximum = Math.max(maximum, projection);
  }
  return [minimum, maximum];
}

function sweepHull(pose: HullPose, movement: Point, hull: HullDimensions): SweepHit | undefined {
  const basis = hullBasis(pose, hull, HULL_CLEARANCE_METERS);
  const initialBounds = hullBounds(pose, basis);
  const bounds = { minX: Math.min(initialBounds.minX, initialBounds.minX + movement.x),
    maxX: Math.max(initialBounds.maxX, initialBounds.maxX + movement.x),
    minZ: Math.min(initialBounds.minZ, initialBounds.minZ + movement.z),
    maxZ: Math.max(initialBounds.maxZ, initialBounds.maxZ + movement.z) };
  if (!boundsOverlap(bounds, worldBounds)) return undefined;
  let first: SweepHit | undefined;
  for (const obstacle of obstacles) {
    if (!boundsOverlap(bounds, obstacle)) continue;
    let entry = -Infinity, exit = Infinity, normal: Point | undefined, separated = false;
    for (const axis of axesFor(obstacle, basis)) {
      const [minimum, maximum] = projectObstacle(obstacle, axis);
      const centre = dot(pose, axis), radius = hullProjectionRadius(basis, axis), speed = dot(movement, axis);
      if (Math.abs(speed) < EPSILON) {
        if (centre + radius <= minimum + EPSILON || centre - radius >= maximum - EPSILON) { separated = true; break; }
        continue;
      }
      const firstTime = (minimum - centre - radius) / speed;
      const lastTime = (maximum - centre + radius) / speed;
      const axisEntry = Math.min(firstTime, lastTime), axisExit = Math.max(firstTime, lastTime);
      if (axisEntry > entry) {
        entry = axisEntry;
        normal = { x: -Math.sign(speed) * axis.x, z: -Math.sign(speed) * axis.z };
      }
      exit = Math.min(exit, axisExit);
      if (entry > exit) { separated = true; break; }
    }
    if (separated || !normal || exit <= EPSILON || entry > 1 || entry < -EPSILON) continue;
    const time = Math.max(0, entry);
    if (!first || time < first.time) first = { time, normal };
  }
  return first;
}

function recoverHull(pose: HullPose, hull: HullDimensions): Point & { normal: Point } {
  let x = pose.x - ISLAND_CENTER.x, z = pose.z - ISLAND_CENTER.z;
  const radius = Math.hypot(x, z);
  if (radius < EPSILON) { x = 1; z = 0; }
  else { x /= radius; z /= radius; }
  const normal = { x, z };
  let low = 0, high = Math.max(ISLAND_RADIUS_X, ISLAND_RADIUS_Z) * 3 + hull.length;
  // Moving radially away from this star-shaped island also clears its south
  // pier. The search never changes orientation or adds teleport distance.
  for (let iteration = 0; iteration < 32; iteration++) {
    const middle = (low + high) / 2;
    if (islandHullOverlaps({ ...pose, x: pose.x + x * middle, z: pose.z + z * middle }, hull, HULL_CLEARANCE_METERS)) low = middle;
    else high = middle;
  }
  return { x: pose.x + x * (high + CONTACT_GAP_METERS), z: pose.z + z * (high + CONTACT_GAP_METERS), normal };
}
function removeInward(vector: Point, normal: Point): void {
  const inward = dot(vector, normal);
  if (inward < 0) { vector.x -= inward * normal.x; vector.z -= inward * normal.z; }
}
function dot(a: Point, b: Point): number { return a.x * b.x + a.z * b.z; }
