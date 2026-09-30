import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type RendererBackend = "WebGPU" | "WebGL 2";

export interface Renderer {
  readonly engine: AbstractEngine;
  readonly backend: RendererBackend;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  try {
    if (await WebGPUEngine.IsSupportedAsync) {
      const webGpuEngine = new WebGPUEngine(canvas, { adaptToDeviceRatio: true });

      try {
        await webGpuEngine.initAsync();
        return { engine: webGpuEngine, backend: "WebGPU" };
      } catch (error) {
        webGpuEngine.dispose();
        throw error;
      }
    }
  } catch (error) {
    console.warn("WebGPU initialization failed; falling back to WebGL 2.", error);
  }

  return {
    engine: new Engine(canvas, true, { adaptToDeviceRatio: true }),
    backend: "WebGL 2",
  };
}
