import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { createDaylightMaterial } from "./createDaylightMaterial";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { GraphicsQualitySettings } from "../game/graphicsQuality";

export const SUN_DIRECTION = new Vector3(-0.42, 0.68, 0.60).normalize();

export interface MaritimeSky {
  readonly sunDirection: Vector3;
  readonly skyMaterial: ShaderMaterial;
  setQuality(settings: GraphicsQualitySettings, shadowCasters: readonly Mesh[]): void;
  update(boatPosition: Vector3): void;
}

export function createMaritimeSky(
  scene: Scene,
  settings: GraphicsQualitySettings,
  shadowCasters: readonly Mesh[],
): MaritimeSky {
  scene.clearColor = new Color3(0.55, 0.75, 0.88).toColor4(1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.61, 0.77, 0.85);
  scene.fogDensity = 0.000095;

  const skyMesh = CreateBox("atmosphere-sky", { size: 2_000 }, scene);
  skyMesh.infiniteDistance = true;
  skyMesh.isPickable = false;
  skyMesh.applyFog = false;

  const skyMaterial = createDaylightMaterial(scene, SUN_DIRECTION);
  skyMesh.material = skyMaterial;

  // Capture only the sky once for glass/metal highlights; no recurring reflection pass.
  const environment = new ReflectionProbe("sky-environment", 64, scene);
  environment.renderList = [skyMesh];
  environment.refreshRate = 0;
  scene.environmentTexture = environment.cubeTexture;
  scene.environmentIntensity = 0.65;

  const ambient = new HemisphericLight("maritime-ambient-light", new Vector3(0, 1, 0), scene);
  ambient.diffuse = new Color3(0.67, 0.81, 0.92);
  ambient.groundColor = new Color3(0.12, 0.18, 0.20);
  ambient.intensity = 0.72;

  const sunLight = new DirectionalLight("daylight-sun", SUN_DIRECTION.scale(-1), scene);
  sunLight.diffuse = new Color3(1, 0.89, 0.72);
  sunLight.specular = new Color3(1, 0.94, 0.82);
  sunLight.intensity = 1.8;
  sunLight.position = SUN_DIRECTION.scale(350);
  sunLight.shadowMinZ = 0.5;
  sunLight.shadowMaxZ = 650;

  let shadowGenerator: ShadowGenerator | undefined;
  let shadowResolution = -1;
  let currentCasters: readonly Mesh[] = [];

  const setQuality = (nextSettings: GraphicsQualitySettings, shadowCasters: readonly Mesh[]) => {
    currentCasters = shadowCasters;
    if (shadowResolution === nextSettings.shadowMapSize) return;
    shadowGenerator?.dispose();
    shadowGenerator = undefined;
    shadowResolution = nextSettings.shadowMapSize;
    if (shadowResolution === 0) return;

    shadowGenerator = new ShadowGenerator(shadowResolution, sunLight);
    shadowGenerator.usePercentageCloserFiltering = true;
    shadowGenerator.bias = 0.0004;
    shadowGenerator.normalBias = 0.018;
    shadowGenerator.setDarkness(0.20);
    for (const caster of currentCasters) shadowGenerator.addShadowCaster(caster, false);
  };

  setQuality(settings, shadowCasters);

  return {
    sunDirection: SUN_DIRECTION,
    skyMaterial,
    setQuality,
    update(boatPosition) {
      sunLight.position.copyFrom(boatPosition).addInPlaceFromFloats(
        SUN_DIRECTION.x * 350, SUN_DIRECTION.y * 350, SUN_DIRECTION.z * 350,
      );
    },
  };
}
