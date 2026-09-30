import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export function createDevelopmentScene(engine: AbstractEngine, canvas: HTMLCanvasElement): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.025, 0.055, 0.09, 1);

  const camera = new ArcRotateCamera(
    "development-camera",
    -Math.PI / 2.5,
    Math.PI / 2.8,
    5,
    Vector3.Zero(),
    scene,
  );
  camera.attachControl(canvas, true);

  const light = new HemisphericLight("development-light", new Vector3(0, 1, 0), scene);
  light.intensity = 0.9;

  const marker = CreateBox("development-marker", { size: 1 }, scene);
  const material = new StandardMaterial("development-marker-material", scene);
  material.diffuseColor = new Color3(0.16, 0.63, 0.78);
  material.emissiveColor = new Color3(0.025, 0.12, 0.16);
  marker.material = material;

  return scene;
}
