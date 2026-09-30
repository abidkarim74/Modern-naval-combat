/** Player intent a client can send to an authoritative simulation. */
export interface ShipControlIntent {
  /** Monotonically increasing input sequence for the sending client. */
  readonly sequence: number;
  /** Normalized desired throttle in the range [-1, 1]. */
  readonly throttle: number;
  /** Normalized desired rudder input in the range [-1, 1]. */
  readonly rudder: number;
}

export { OCEAN_WAVES, sampleOceanHeight } from "./oceanWaves.js";
export type { OceanWave } from "./oceanWaves.js";
export { BoatSimulation, BOAT_SIMULATION_CONFIG, FIXED_SIMULATION_STEP } from "./simulation/boatSimulation.js";
export type { BoatSimulationState, ControlInput } from "./simulation/boatSimulation.js";
