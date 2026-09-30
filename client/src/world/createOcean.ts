import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { GroundMesh } from "@babylonjs/core/Meshes/groundMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { RendererBackend } from "../engine/createRenderer";
import type { GraphicsQualitySettings } from "../game/graphicsQuality";
import { OCEAN_WAVES } from "@naval/shared";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import oceanVertexGlsl from "./shaders/ocean.vertex.glsl?raw";
import oceanFragmentGlsl from "./shaders/ocean.fragment.glsl?raw";
import oceanVertexWgsl from "./shaders/ocean.vertex.wgsl?raw";
import oceanFragmentWgsl from "./shaders/ocean.fragment.wgsl?raw";

const OCEAN_SIZE_METERS = 7_600;
const OCEAN_ORIGIN_SNAP_METERS = 1;
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
  ...OCEAN_WAVES.flatMap((_, index) => [
    `wave${index}`,
    `waveFrequency${index}`,
    `wavePhase${index}`,
  ]),
];

export class OceanRenderer {
  readonly material: ShaderMaterial;
  private readonly boatPosition = new Vector3();
  private mesh!: GroundMesh;

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
        attributes: ["position"],
        uniforms: UNIFORM_NAMES,
        shaderLanguage: isWebGpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
      },
    );
    this.material.backFaceCulling = true;
    this.material.setVector3("sunDirection", this.sunDirection);
    this.setWaveUniforms();
    this.mesh = this.createMesh(settings.oceanSubdivisions);
    this.setQuality(settings);
  }

  update(timeSeconds: number, centerX: number, centerZ: number, eyePosition: Vector3, heading: number, speed: number, yawRate: number): void {
    this.mesh.position.x = Math.round(centerX / OCEAN_ORIGIN_SNAP_METERS) * OCEAN_ORIGIN_SNAP_METERS;
    this.mesh.position.z = Math.round(centerZ / OCEAN_ORIGIN_SNAP_METERS) * OCEAN_ORIGIN_SNAP_METERS;
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
    if (this.mesh && this.mesh.subdivisions !== settings.oceanSubdivisions) {
      this.mesh.dispose(false, false);
      this.mesh = this.createMesh(settings.oceanSubdivisions);
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

  private createMesh(subdivisions: number): GroundMesh {
    const mesh = CreateGround(
      "ocean-surface",
      { width: OCEAN_SIZE_METERS, height: OCEAN_SIZE_METERS, subdivisions, updatable: false },
      this.scene,
    );
    // Concentrate the existing grid around the vessel: ~1 m spacing nearby,
    // progressively wider cells at the horizon. No per-frame geometry rebuild.
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (positions) {
      const halfSize = OCEAN_SIZE_METERS / 2;
      for (let index = 0; index < positions.length; index += 3) {
        for (const axis of [0, 2]) {
          const coordinate = (positions[index + axis] ?? 0) / halfSize;
          positions[index + axis] = coordinate * 65 + coordinate ** 3 * (halfSize - 65);
        }
      }
      mesh.setVerticesData(VertexBuffer.PositionKind, positions, false);
    }
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}
