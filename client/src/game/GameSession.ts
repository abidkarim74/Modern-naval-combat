import "../engine/sceneShaders";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { FollowCamera } from "@babylonjs/core/Cameras/followCamera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { BoatSimulation, FIXED_SIMULATION_STEP } from "@naval/shared";
import type { ControlInput } from "@naval/shared";
import type { RendererBackend } from "../engine/createRenderer";
import type { DestroyerVisual } from "../ships/createDestroyer";
import type { MaritimeSky } from "../world/createMaritimeSky";
import { BoatKeyboardInput } from "./BoatKeyboardInput";
import {
  DEFAULT_GRAPHICS_QUALITY,
  GRAPHICS_QUALITY_SETTINGS,
} from "./graphicsQuality";
import type { GraphicsQuality } from "./graphicsQuality";
import { createDestroyer } from "../ships/createDestroyer";
import { AmbientSprites } from "../world/createAmbientSprites";
import { OceanRenderer } from "../world/createOcean";
import { BoatWake } from "../world/BoatWake";
import { createMaritimeSky } from "../world/createMaritimeSky";
import { MaritimeAudio } from "../world/MaritimeAudio";
import type { SoundStatus } from "../world/MaritimeAudio";

const MAX_FRAME_SECONDS = 0.1;
const MAX_SIMULATION_STEPS_PER_FRAME = 6;
const HUD_UPDATE_INTERVAL_SECONDS = 0.2;
const METERS_PER_SECOND_TO_KNOTS = 1.943844;

export interface GameTelemetry {
  readonly speedKnots: number;
  readonly throttlePercent: number;
  readonly headingDegrees: number;
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly activeMeshes: number;
  readonly activeParticles: number;
  readonly simulationTimeMs: number;
  readonly soundStatus: SoundStatus;
  readonly activeBirds: number;
}

export type TelemetryListener = (telemetry: GameTelemetry) => void;

export class GameSession {
  readonly scene: Scene;
  readonly simulation = new BoatSimulation();
  readonly audio = new MaritimeAudio();

  private readonly input = new BoatKeyboardInput();
  private readonly inputScratch: ControlInput = { throttle: 0, steering: 0 };
  private readonly boat: DestroyerVisual;
  private readonly sky: MaritimeSky;
  private readonly ocean: OceanRenderer;
  private readonly ambientSprites: AmbientSprites;
  private readonly wake: BoatWake;
  private readonly camera: FollowCamera;
  private readonly forwardCamera: FreeCamera;
  private readonly cameraAnchor: Mesh;
  private qualityValue: GraphicsQuality = DEFAULT_GRAPHICS_QUALITY;
  private accumulator = 0;
  private telemetryAccumulator = 0;
  private simulationMilliseconds = 0;
  private simulationStepCount = 0;
  private lastSimulationTimeMs = 0;

  constructor(
    private readonly engine: AbstractEngine,
    backend: RendererBackend,
    private readonly onTelemetry: TelemetryListener,
  ) {
    const settings = GRAPHICS_QUALITY_SETTINGS[this.qualityValue];
    this.scene = new Scene(engine);
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.imageProcessingConfiguration.exposure = 1.04;
    this.scene.imageProcessingConfiguration.contrast = 1.08;
    this.boat = createDestroyer(this.scene);
    this.sky = createMaritimeSky(this.scene, settings, this.boat.shadowCasters);
    this.ocean = new OceanRenderer(this.scene, backend, settings, this.sky.sunDirection);
    this.ambientSprites = new AmbientSprites(this.scene, settings);
    this.wake = new BoatWake(this.scene);
    this.cameraAnchor = new Mesh("chase-camera-anchor", this.scene);
    this.cameraAnchor.position.y = 0;

    this.camera = new FollowCamera(
      "destroyer-chase-camera",
      new Vector3(-150, 95, -175),
      this.scene,
      this.cameraAnchor,
    );
    this.camera.radius = 125;
    this.camera.heightOffset = 80;
    this.camera.rotationOffset = 320;
    this.camera.cameraAcceleration = 0.035;
    this.camera.lowerRadiusLimit = 105;
    this.camera.upperRadiusLimit = 420;
    this.camera.lowerHeightOffsetLimit = 20;
    this.camera.upperHeightOffsetLimit = 220;
    this.camera.maxCameraSpeed = 80;
    this.camera.minZ = 0.8;
    this.camera.maxZ = settings.viewDistanceMeters;
    this.camera.fov = 0.82;
    this.camera.inputs.removeByType("FollowCameraKeyboardMoveInput");
    this.camera.attachControl(true);
    this.forwardCamera = new FreeCamera("forward-gun-camera", Vector3.Zero(), this.scene);
    this.forwardCamera.fov = 0.94;
    this.forwardCamera.minZ = 0.2;
    this.forwardCamera.maxZ = settings.viewDistanceMeters;
    this.forwardCamera.rotation.set(0, 0, 0);
    this.scene.activeCamera = this.camera;
    this.boat.root.computeWorldMatrix(true);
    this.applyQuality(this.qualityValue);
  }

  update(frameDeltaSeconds: number): void {
    const frameDelta = Math.min(Math.max(frameDeltaSeconds, 0), MAX_FRAME_SECONDS);
    this.accumulator = Math.min(
      this.accumulator + frameDelta,
      FIXED_SIMULATION_STEP * MAX_SIMULATION_STEPS_PER_FRAME,
    );

    let stepsThisFrame = 0;
    while (this.accumulator >= FIXED_SIMULATION_STEP && stepsThisFrame < MAX_SIMULATION_STEPS_PER_FRAME) {
      this.input.readInto(this.inputScratch);
      const simulationStart = performance.now();
      this.simulation.update(this.inputScratch, FIXED_SIMULATION_STEP);
      this.simulationMilliseconds += performance.now() - simulationStart;
      this.simulationStepCount += 1;
      this.accumulator -= FIXED_SIMULATION_STEP;
      stepsThisFrame += 1;
    }

    if (stepsThisFrame === MAX_SIMULATION_STEPS_PER_FRAME && this.accumulator >= FIXED_SIMULATION_STEP) {
      this.accumulator = 0;
    }

    const state = this.simulation.state;
    const interpolation = this.accumulator / FIXED_SIMULATION_STEP;
    this.boat.update(state, interpolation);
    this.boat.root.computeWorldMatrix(true);
    this.cameraAnchor.position.x = this.boat.root.position.x;
    this.cameraAnchor.position.z = this.boat.root.position.z;
    this.cameraAnchor.position.y += (this.boat.root.position.y - this.cameraAnchor.position.y) *
      (1 - Math.exp(-frameDelta * 2));
    this.cameraAnchor.rotation.y = this.boat.root.rotation.y;
    this.forwardCamera.position.copyFrom(Vector3.TransformCoordinates(
      new Vector3(0, 12.8, 50.5), this.boat.root.getWorldMatrix(),
    ));
    this.forwardCamera.rotation.set(
      this.boat.root.rotation.x + 0.10,
      this.boat.root.rotation.y,
      this.boat.root.rotation.z,
    );
    this.ocean.update(
      state.elapsedTime,
      state.positionX,
      state.positionZ,
      this.scene.activeCamera?.position ?? this.camera.position,
      state.heading,
      state.forwardSpeed,
    );
    this.sky.update(this.boat.root.position);
    this.ambientSprites.update(state.elapsedTime, state.positionX, state.positionZ, state.heading);
    this.wake.update(state, state.elapsedTime);
    this.audio.update(state, this.ambientSprites.activeBirdCount > 0);

    this.telemetryAccumulator += frameDelta;
    if (this.telemetryAccumulator >= HUD_UPDATE_INTERVAL_SECONDS) {
      this.publishTelemetry();
      this.telemetryAccumulator %= HUD_UPDATE_INTERVAL_SECONDS;
    }
  }

  setQuality(quality: GraphicsQuality): void {
    if (quality === this.qualityValue) return;
    this.applyQuality(quality);
  }

  setCameraView(view: "chase" | "forward"): void {
    this.scene.activeCamera = view === "forward" ? this.forwardCamera : this.camera;
  }

  get currentQuality(): GraphicsQuality {
    return this.qualityValue;
  }

  dispose(): void {
    this.audio.dispose();
    this.input.dispose();
    this.camera.detachControl();
    this.forwardCamera.detachControl();
    this.scene.dispose();
  }

  private applyQuality(quality: GraphicsQuality): void {
    this.qualityValue = quality;
    const settings = GRAPHICS_QUALITY_SETTINGS[quality];
    this.engine.setHardwareScalingLevel(settings.hardwareScaling);
    this.engine.resize();
    this.ocean.setQuality(settings);
    this.ambientSprites.setQuality(settings);
    this.sky.setQuality(settings, this.boat.shadowCasters);
    this.camera.maxZ = settings.viewDistanceMeters;
    this.forwardCamera.maxZ = settings.viewDistanceMeters;
    this.scene.fogDensity = 0.00011 * (6_800 / settings.viewDistanceMeters);
  }

  private publishTelemetry(): void {
    const state = this.simulation.state;
    const fps = Math.round(this.engine.getFps());
    let activeParticles = 0;
    for (const particleSystem of this.scene.particleSystems) {
      activeParticles += particleSystem.getActiveCount();
    }

    this.lastSimulationTimeMs =
      this.simulationStepCount > 0
        ? this.simulationMilliseconds / this.simulationStepCount
        : this.lastSimulationTimeMs;
    this.onTelemetry({
      speedKnots: state.speed * METERS_PER_SECOND_TO_KNOTS,
      throttlePercent: state.throttle * 100,
      headingDegrees: normalizeHeading(state.heading),
      fps,
      frameTimeMs: fps > 0 ? 1_000 / fps : 0,
      activeMeshes: this.scene.getActiveMeshes().length,
      activeParticles,
      simulationTimeMs: this.lastSimulationTimeMs,
      soundStatus: this.audio.status,
      activeBirds: this.ambientSprites.activeBirdCount,
    });
    this.simulationMilliseconds = 0;
    this.simulationStepCount = 0;
  }
}

function normalizeHeading(headingRadians: number): number {
  const degrees = (headingRadians * 180) / Math.PI;
  return (degrees % 360 + 360) % 360;
}
