import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { RendererBackend } from "../engine/createRenderer";
import type { GraphicsQualitySettings } from "../game/graphicsQuality";
import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_LAGOON, OCEAN_WAVES } from "@naval/shared";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { createOceanGeometry } from "./oceanGeometry";
import { createOceanDetailTexture } from "./oceanDetailTexture";
import oceanVertexGlsl from "./shaders/ocean.vertex.glsl?raw";
import oceanFragmentGlsl from "./shaders/ocean.fragment.glsl?raw";
import oceanVertexWgsl from "./shaders/ocean.vertex.wgsl?raw";
import oceanFragmentWgsl from "./shaders/ocean.fragment.wgsl?raw";

const UNIFORM_NAMES = [
  "world",
  "worldViewProjection",
  "time",
  "eyePosition",
  "sunDirection",
  "detailStrength",
  "reflectionStrength",
  "boatPosition",
  "boatHeading",
  "boatSpeed",
  "boatYawRate",
  "islandCenter",
  "islandRadii",
  "lagoonShape",
  ...OCEAN_WAVES.flatMap((_, index) => [
    `wave${index}`,
    `waveFrequency${index}`,
    `wavePhase${index}`,
  ]),
];

export class OceanRenderer {
  readonly material: ShaderMaterial;
  private readonly boatPosition = new Vector3();
  private mesh: Mesh;
  private subdivisions: number;
  private cellSizeMeters: number;
  private detailLevel: 0 | 1 | 2;

  constructor(
    private readonly scene: Scene,
    backend: RendererBackend,
    settings: GraphicsQualitySettings,
    private readonly sunDirection: Vector3,
  ) {
    const isWebGpu = backend === "WebGPU";
    this.material = new ShaderMaterial(
      "ocean-material",
      scene,
      {
        vertexSource: isWebGpu ? oceanVertexWgsl : oceanVertexGlsl,
        fragmentSource: isWebGpu ? oceanFragmentWgsl : oceanFragmentGlsl,
      },
      {
        attributes: ["position", "waterCellSize"],
        uniforms: UNIFORM_NAMES,
        samplers: ["skySampler", "detailSampler"],
        defines: [`WATER_DETAIL_LEVEL ${settings.waterDetailLevel}`],
        shaderLanguage: isWebGpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
      },
    );
    this.material.backFaceCulling = true;
    if (scene.environmentTexture) this.material.setTexture("skySampler", scene.environmentTexture);
    this.material.setTexture("detailSampler", createOceanDetailTexture(scene));
    this.material.setVector3("sunDirection", this.sunDirection);
    this.material.setVector3("islandCenter", new Vector3(ISLAND_CENTER.x, 0, ISLAND_CENTER.z));
    this.material.setVector3("islandRadii", new Vector3(ISLAND_RADIUS_X, 0, ISLAND_RADIUS_Z));
    this.material.setVector4("lagoonShape", new Vector4(ISLAND_CENTER.x + ISLAND_LAGOON.x,
      ISLAND_CENTER.z + ISLAND_LAGOON.z, ISLAND_LAGOON.radiusX, ISLAND_LAGOON.radiusZ));
    this.setWaveUniforms();
    this.subdivisions = settings.oceanSubdivisions;
    this.cellSizeMeters = settings.oceanCellSizeMeters;
    this.detailLevel = settings.waterDetailLevel;
    this.mesh = this.createMesh(settings);
    this.setQuality(settings);
  }

  update(timeSeconds: number, centerX: number, centerZ: number, eyePosition: Vector3, heading: number, speed: number, yawRate: number, focus?: Vector3): void {
    // Continuous camera-relative placement removes one-metre geometry jumps.
    // The shader evaluates waves in world space, so their phase remains anchored.
    this.mesh.position.x = focus?.x ?? eyePosition.x;
    this.mesh.position.z = focus?.z ?? eyePosition.z;
    this.material.setFloat("time", timeSeconds);
    this.material.setVector3("eyePosition", eyePosition);
    this.boatPosition.set(centerX, 0, centerZ);
    this.material.setVector3("boatPosition", this.boatPosition);
    this.material.setFloat("boatHeading", heading);
    this.material.setFloat("boatSpeed", speed);
    this.material.setFloat("boatYawRate", yawRate);
  }

  setQuality(settings: GraphicsQualitySettings): void {
    this.material.setFloat("detailStrength", settings.waterDetailStrength);
    this.material.setFloat("reflectionStrength", settings.waterReflectionStrength);
    if (this.detailLevel !== settings.waterDetailLevel) {
      this.material.setDefine("WATER_DETAIL_LEVEL", String(settings.waterDetailLevel));
      this.detailLevel = settings.waterDetailLevel;
    }
    if (this.subdivisions !== settings.oceanSubdivisions || this.cellSizeMeters !== settings.oceanCellSizeMeters) {
      const previousPosition = this.mesh.position.clone();
      this.mesh.dispose(false, false);
      this.subdivisions = settings.oceanSubdivisions;
      this.cellSizeMeters = settings.oceanCellSizeMeters;
      this.mesh = this.createMesh(settings);
      this.mesh.position.copyFrom(previousPosition);
    }
  }

  private setWaveUniforms(): void {
    OCEAN_WAVES.forEach((wave, index) => {
      this.material.setVector4(
        `wave${index}`,
        new Vector4(
          wave.directionX,
          wave.directionZ,
          (Math.PI * 2) / wave.wavelength,
          wave.amplitude,
        ),
      );
      this.material.setFloat(`waveFrequency${index}`, wave.angularFrequency);
      this.material.setFloat(`wavePhase${index}`, wave.phase);
    });
  }

  private createMesh(settings: GraphicsQualitySettings): Mesh {
    const geometry = createOceanGeometry({
      subdivisions: settings.oceanSubdivisions,
      cellSizeMeters: settings.oceanCellSizeMeters,
    });
    const mesh = new Mesh("ocean-surface", this.scene);
    mesh.setVerticesData(VertexBuffer.PositionKind, geometry.positions, false, 3);
    mesh.setVerticesData("waterCellSize", geometry.cellSizes, false, 1);
    mesh.setIndices(geometry.indices);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}
