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
export const MOON_DIRECTION = new Vector3(0.48, 0.62, -0.62).normalize();

export interface MaritimeSky {
  readonly sunDirection: Vector3;
  readonly moonDirection: Vector3;
  readonly skyMaterial: ShaderMaterial;
  readonly nightFactor: number;
  setQuality(settings: GraphicsQualitySettings, shadowCasters: readonly Mesh[]): void;
  setNight(isNight: boolean, instant?: boolean): void;
  update(focus: Vector3, islandView?: boolean, timeSeconds?: number, deltaSeconds?: number): void;
}

export function createMaritimeSky(
  scene: Scene,
  settings: GraphicsQualitySettings,
  shadowCasters: readonly Mesh[],
): MaritimeSky {
  const dayClearColor = new Color3(0.55, 0.75, 0.88);
  const nightClearColor = new Color3(0.005, 0.009, 0.020);
  const dayFogColor = new Color3(0.61, 0.77, 0.85);
  const nightFogColor = new Color3(0.012, 0.022, 0.042);

  scene.clearColor = dayClearColor.toColor4(1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = dayFogColor.clone();
  scene.fogDensity = 0.000095;

  const skyMesh = CreateBox("atmosphere-sky", { size: 2_000 }, scene);
  skyMesh.infiniteDistance = true;
  skyMesh.isPickable = false;
  skyMesh.applyFog = false;
  skyMesh.alwaysSelectAsActiveMesh = true;
  // Shade only visible far-depth sky after sea and terrain have filled depth.
  skyMesh.renderingGroupId = 1;
  scene.setRenderingAutoClearDepthStencil(1, false);

  const skyMaterial = createDaylightMaterial(scene, SUN_DIRECTION, MOON_DIRECTION);
  skyMesh.material = skyMaterial;

  // Capture only the sky once for glass/metal highlights; no recurring reflection pass.
  const environment = new ReflectionProbe("sky-environment", 64, scene);
  environment.renderList = [skyMesh];
  environment.refreshRate = 0;
  scene.environmentTexture = environment.cubeTexture;
  scene.environmentIntensity = 0.65;

  const dayAmbientDiffuse = new Color3(0.67, 0.81, 0.92);
  const nightAmbientDiffuse = new Color3(0.045, 0.075, 0.14);
  const daySeaBounce = new Color3(0.12, 0.18, 0.20);
  const nightSeaBounce = new Color3(0.015, 0.025, 0.04);
  const dayLandBounce = new Color3(0.23, 0.28, 0.22);
  const nightLandBounce = new Color3(0.022, 0.035, 0.030);

  const ambient = new HemisphericLight("maritime-ambient-light", new Vector3(0, 1, 0), scene);
  ambient.diffuse = dayAmbientDiffuse.clone();
  ambient.groundColor = daySeaBounce.clone();
  ambient.intensity = 0.72;

  const daySunDiffuse = new Color3(1, 0.89, 0.72);
  const nightMoonDiffuse = new Color3(0.20, 0.30, 0.48);
  const daySunSpecular = new Color3(1, 0.94, 0.82);
  const nightMoonSpecular = new Color3(0.40, 0.50, 0.70);

  const sunLight = new DirectionalLight("daylight-sun", SUN_DIRECTION.scale(-1), scene);
  sunLight.diffuse = daySunDiffuse.clone();
  sunLight.specular = daySunSpecular.clone();
  sunLight.intensity = 1.8;
  sunLight.position = SUN_DIRECTION.scale(350);
  sunLight.shadowMinZ = 0.5;
  sunLight.shadowMaxZ = 650;

  let shadowGenerator: ShadowGenerator | undefined;
  let shadowResolution = -1;
  let currentCasters: readonly Mesh[] = [];
  let skyDetailLevel = -1;

  let targetNightFactor = 0;
  let currentNightFactor = 0;
  let lastEnvironmentRefreshNight = -1;

  const setQuality = (nextSettings: GraphicsQualitySettings, shadowCasters: readonly Mesh[]) => {
    if (skyDetailLevel !== nextSettings.skyDetailLevel) {
      skyMaterial.setDefine("SKY_DETAIL_LEVEL", String(nextSettings.skyDetailLevel));
      skyDetailLevel = nextSettings.skyDetailLevel;
    }
    currentCasters = shadowCasters;
    if (shadowResolution === nextSettings.shadowMapSize) {
      const shadowMap = shadowGenerator?.getShadowMap();
      if (shadowMap) shadowMap.renderList = [...shadowCasters];
      return;
    }
    shadowGenerator?.dispose();
    shadowGenerator = undefined;
    shadowResolution = nextSettings.shadowMapSize;
    if (shadowResolution === 0) return;

    shadowGenerator = new ShadowGenerator(shadowResolution, sunLight);
    shadowGenerator.usePercentageCloserFiltering = true;
    // The shadow texels cover a 155 m hull; tiny default offsets cause diagonal acne on steel faces.
    const texelScale = 1024 / shadowResolution;
    shadowGenerator.bias = 0.0012 * texelScale;
    shadowGenerator.normalBias = 0.10 * texelScale;
    shadowGenerator.setDarkness(0.20);
    for (const caster of currentCasters) shadowGenerator.addShadowCaster(caster, false);
  };

  setQuality(settings, shadowCasters);

  const setNight = (isNight: boolean, instant = false) => {
    targetNightFactor = isNight ? 1 : 0;
    if (instant) {
      currentNightFactor = targetNightFactor;
    }
  };

  return {
    sunDirection: SUN_DIRECTION,
    moonDirection: MOON_DIRECTION,
    skyMaterial,
    get nightFactor() {
      return currentNightFactor;
    },
    setQuality,
    setNight,
    update(focus, islandView = false, timeSeconds = 0, deltaSeconds = 0.016) {
      skyMaterial.setFloat("time", timeSeconds);

      // Smooth transition between day and night
      if (Math.abs(currentNightFactor - targetNightFactor) > 0.001) {
        const speed = 2.8;
        currentNightFactor += (targetNightFactor - currentNightFactor) * (1 - Math.exp(-deltaSeconds * speed));
      } else {
        currentNightFactor = targetNightFactor;
      }
      skyMaterial.setFloat("nightFactor", currentNightFactor);

      // Update background and fog colors
      Color3.LerpToRef(dayClearColor, nightClearColor, currentNightFactor, scene.clearColor as unknown as Color3);
      Color3.LerpToRef(dayFogColor, nightFogColor, currentNightFactor, scene.fogColor);

      // Interpolate ambient lighting
      Color3.LerpToRef(dayAmbientDiffuse, nightAmbientDiffuse, currentNightFactor, ambient.diffuse);
      const groundTarget = islandView
        ? Color3.Lerp(dayLandBounce, nightLandBounce, currentNightFactor)
        : Color3.Lerp(daySeaBounce, nightSeaBounce, currentNightFactor);
      ambient.groundColor.copyFrom(groundTarget);

      const dayIntensity = islandView ? 1.05 : 0.72;
      const nightIntensity = islandView ? 0.45 : 0.32;
      ambient.intensity = dayIntensity + (nightIntensity - dayIntensity) * currentNightFactor;

      // Interpolate main directional light (Sun -> Moon)
      const currentLightDir = Vector3.Lerp(SUN_DIRECTION, MOON_DIRECTION, currentNightFactor).normalize();
      sunLight.direction.copyFrom(currentLightDir).scaleInPlace(-1);
      Color3.LerpToRef(daySunDiffuse, nightMoonDiffuse, currentNightFactor, sunLight.diffuse);
      Color3.LerpToRef(daySunSpecular, nightMoonSpecular, currentNightFactor, sunLight.specular);

      const daySunIntensity = 1.8;
      const nightMoonIntensity = 0.55;
      sunLight.intensity = daySunIntensity + (nightMoonIntensity - daySunIntensity) * currentNightFactor;

      scene.environmentIntensity = 0.65 - 0.45 * currentNightFactor;

      const distance = islandView ? 850 : 350;
      sunLight.shadowMaxZ = islandView ? 1_800 : 650;
      sunLight.position.copyFrom(focus).addInPlaceFromFloats(
        currentLightDir.x * distance,
        currentLightDir.y * distance,
        currentLightDir.z * distance,
      );

      // Refresh reflection probe if day/night changed significantly
      const discreteNight = currentNightFactor > 0.5 ? 1 : 0;
      if (discreteNight !== lastEnvironmentRefreshNight) {
        lastEnvironmentRefreshNight = discreteNight;
        environment.refreshRate = 1;
        // Schedule reset back to 0 next frame
        setTimeout(() => {
          environment.refreshRate = 0;
        }, 50);
      }
    },
  };
}
