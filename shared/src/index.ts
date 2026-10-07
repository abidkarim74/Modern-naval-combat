/** Player intent a client can send to an authoritative simulation. */
export interface ShipControlIntent {
  /** Monotonically increasing input sequence for the sending client. */
  readonly sequence: number;
  /** Normalized desired throttle in the range [-1, 1]. */
  readonly throttle: number;
  /** Normalized desired rudder input in the range [-1, 1]. */
  readonly rudder: number;
}

export { OCEAN_WAVES, sampleOceanHeight, sampleOceanSurface } from "./oceanWaves.js";
export type { OceanWave, OceanSurfaceSample } from "./oceanWaves.js";
export { BoatSimulation, BOAT_SIMULATION_CONFIG, FIXED_SIMULATION_STEP } from "./simulation/boatSimulation.js";
export type { BoatSimulationState, ControlInput } from "./simulation/boatSimulation.js";
export { CruiseMissileSimulation } from "./simulation/cruiseMissileSimulation.js";
export type { CruiseMissileLaunch, CruiseMissileState, MissileVector, MissileFlightPhase } from "./simulation/cruiseMissileSimulation.js";
export { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_SEABED_Y, ISLAND_BASE, ISLAND_HILL_POSTS, ISLAND_HELIPAD, ISLAND_HARBOR, ISLAND_LAGOON, ISLAND_DOCK_OBSTACLES, islandShoreRadius, islandHeight } from "./world/islandTerrain.js";
