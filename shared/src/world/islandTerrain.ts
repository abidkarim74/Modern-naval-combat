/** North Watch's compact volcanic island. Coordinates here are local to its center. */
export const ISLAND_CENTER = Object.freeze({ x: 660, z: 2_050 });
export const ISLAND_RADIUS_X = 580;
export const ISLAND_RADIUS_Z = 275;
export const ISLAND_SEABED_Y = -28;
export const ISLAND_BASE = Object.freeze({ x: -270, z: 40 });
export const ISLAND_LAGOON = Object.freeze({ x: -15, z: -180, radiusX: 315, radiusZ: 155 });
/** Small summit terraces, inset from the exposed cliff rims. */
export const ISLAND_HILL_POSTS = Object.freeze([
  Object.freeze({ id: "ridge", x: 250, z: 128, halfX: 30, halfZ: 25 }),
  Object.freeze({ id: "cape", x: 416, z: 42, halfX: 30, halfZ: 25 }),
]);
/** Separate aviation clearing east of the lower compound's fence. */
export const ISLAND_HELIPAD = Object.freeze({ x: -133, z: 40, halfX: 31, halfZ: 31 });

/** Angle uses atan2(z / radiusZ, x / radiusX); the result is an elliptical radius. */
export function islandShoreRadius(angle: number): number {
  const bay = angleDifference(angle, -Math.PI / 2);
  const headland = angleDifference(angle, -2.62);
  return .94 + .055 * Math.sin(angle * 3 + .4)
    + .032 * Math.sin(angle * 7 - .8)
    + .020 * Math.sin(angle * 15 + 1.8)
    + .009 * Math.sin(angle * 27 + 1.2)
    - .67 * Math.exp(-((bay / .72) ** 2))
    + .07 * Math.exp(-((headland / .30) ** 2));
}

/** A small pier on the lagoon's western bank, away from its open approach. */
export const ISLAND_HARBOR = Object.freeze({ x: -300, shoreZ: southernShoreAt(-300) + 6 });
export const ISLAND_DOCK_OBSTACLES = Object.freeze([
  Object.freeze({ kind: "pier", centerX: ISLAND_HARBOR.x, centerZ: ISLAND_HARBOR.shoreZ - 44, halfX: 5.5, halfZ: 44 }),
  Object.freeze({ kind: "head", centerX: ISLAND_HARBOR.x, centerZ: ISLAND_HARBOR.shoreZ - 83, halfX: 30, halfZ: 10 }),
]);

/** The same solid surface is used by rendering, camera clearance and collision. */
export function islandHeight(x: number, z: number): number {
  const natural = naturalIslandHeight(x, z);
  // A small cut-and-fill terrace, eased back into the hillside outside its walls.
  const terraceEdge = Math.max(Math.abs(x - ISLAND_BASE.x) - 78, Math.abs(z - ISLAND_BASE.z) - 60);
  const terraceBlend = 1 - smoothStep(0, 42, terraceEdge);
  let height = natural + (naturalIslandHeight(ISLAND_BASE.x, ISLAND_BASE.z) - natural) * terraceBlend;
  for (const terrace of ISLAND_HILL_POSTS) {
    const edge = Math.max(Math.abs(x - terrace.x) - terrace.halfX, Math.abs(z - terrace.z) - terrace.halfZ);
    if (edge < 14) height += (naturalIslandHeight(terrace.x, terrace.z) - height) * (1 - smoothStep(0, 14, edge));
  }
  const padEdge = Math.max(Math.abs(x - ISLAND_HELIPAD.x) - ISLAND_HELIPAD.halfX,
    Math.abs(z - ISLAND_HELIPAD.z) - ISLAND_HELIPAD.halfZ);
  if (padEdge < 12) height += (naturalIslandHeight(ISLAND_HELIPAD.x, ISLAND_HELIPAD.z) - height) * (1 - smoothStep(0, 12, padEdge));
  return height;
}

function naturalIslandHeight(x: number, z: number): number {
  const radius = Math.hypot(x / ISLAND_RADIUS_X, z / ISLAND_RADIUS_Z);
  const angle = Math.atan2(z / ISLAND_RADIUS_Z, x / ISLAND_RADIUS_X);
  const inlandDistance = islandShoreRadius(angle) - radius;
  if (inlandDistance < 0) {
    return Math.max(ISLAND_SEABED_Y, 1.25 + inlandDistance / .045 * 29.25);
  }

  const westernPlateau = 49 * Math.exp(-(((x + 365) / 180) ** 2 + ((z + 5) / 132) ** 2) * .5);
  const saddle = 27 * Math.exp(-(((x - 5) / 255) ** 2 + ((z - 135) / 94) ** 2) * .5);
  const easternFoothills = 39 * Math.exp(-(((x - 360) / 175) ** 2 + ((z - 75) / 125) ** 2) * .5);
  const summits = Math.max(
    mesa(x, z, 245, 137, 185, 132, 126),
    mesa(x, z, 438, 34, 158, 148, 145),
  );
  const erosion = 2.4 * noise(x / 31, z / 27) + 1.1 * noise(x / 12, z / 14);
  const upland = 13 + westernPlateau + saddle + easternFoothills + summits + erosion;
  const sheltered = Math.exp(-((angleDifference(angle, -Math.PI / 2) / .86) ** 2));
  // The lagoon has a fine sand fringe. The exposed cape has a low basalt
  // escarpment and only a very thin strand at its foot.
  const coastCliff = (19 + noise(x / 19, z / 21) * 5) * (1 - sheltered * .96);
  const beach = 1.25 + 1.9 * smoothStep(0, .025, inlandDistance);
  return beach + coastCliff * smoothStep(.008, .044, inlandDistance) * (1 - smoothStep(.08, .24, inlandDistance))
    + upland * smoothStep(.035, .19, inlandDistance);
}

function mesa(x: number, z: number, centerX: number, centerZ: number, width: number, depth: number, height: number): number {
  const along = (x - centerX) / width;
  const across = (z - centerZ) / depth + along * .23;
  const bearing = Math.atan2(across, along);
  const rim = 1 + .085 * Math.sin(bearing * 5 + .4) + .045 * Math.sin(bearing * 9);
  const distance = Math.hypot(along, across) / rim;
  const erosion = (noise(x / 29, z / 25) * .09 + noise(x / 9, z / 13) * .025)
    * smoothStep(.32, .60, distance) * (1 - smoothStep(.90, 1.25, distance));
  const face = Math.max(0, Math.min(1, 1 - smoothStep(.34, 1.18, distance) + erosion));
  const crown = 1 + noise(x / 18, z / 22) * .028;
  return height * face * crown;
}

function angleDifference(angle: number, reference: number): number {
  return Math.atan2(Math.sin(angle - reference), Math.cos(angle - reference));
}

function southernShoreAt(x: number): number {
  let water = -ISLAND_RADIUS_Z * 1.2, land = 0;
  for (let step = 0; step < 40; step++) {
    const z = (water + land) / 2;
    const radius = Math.hypot(x / ISLAND_RADIUS_X, z / ISLAND_RADIUS_Z);
    if (radius > islandShoreRadius(Math.atan2(z / ISLAND_RADIUS_Z, x / ISLAND_RADIUS_X))) water = z;
    else land = z;
  }
  return land;
}

/** Smooth deterministic rock-scale noise without a texture or random state. */
function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = smoothStep(0, 1, x - ix);
  const tz = smoothStep(0, 1, z - iz);
  const hash = (a: number, b: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43_758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  };
  const south = hash(ix, iz) * (1 - tx) + hash(ix + 1, iz) * tx;
  const north = hash(ix, iz + 1) * (1 - tx) + hash(ix + 1, iz + 1) * tx;
  return south * (1 - tz) + north * tz;
}

function smoothStep(minimum: number, maximum: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return t * t * (3 - 2 * t);
}
