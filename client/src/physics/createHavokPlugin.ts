import HavokPhysics from "@babylonjs/havok";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";

/** Initialize Havok when a scene actually needs general physics or collision support. */
export async function createHavokPlugin(): Promise<HavokPlugin> {
  const havokInterface = await HavokPhysics();
  return new HavokPlugin(true, havokInterface);
}
