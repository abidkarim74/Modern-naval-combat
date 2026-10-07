import "../engine/sceneShaders";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { FollowCamera } from "@babylonjs/core/Cameras/followCamera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { BoatSimulation, FIXED_SIMULATION_STEP } from "@naval/shared";
import type { ControlInput, CruiseMissileState } from "@naval/shared";
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
import { createIsland } from "../world/createIsland";
import type { IslandVisual } from "../world/createIsland";
import { MaritimeAudio } from "../world/MaritimeAudio";
import type { SoundStatus } from "../world/MaritimeAudio";
import { MissileVls } from "../ships/MissileVls";
import type { MissileTelemetry } from "../ships/MissileVls";
import type { MissileLaunchBank } from "../ships/destroyerVls";
import { IslandCamera } from "./IslandCamera";

const MAX_FRAME_SECONDS = 0.1;
const MAX_SIMULATION_STEPS_PER_FRAME = 6;
const HUD_UPDATE_INTERVAL_SECONDS = 0.2;
const METERS_PER_SECOND_TO_KNOTS = 1.943844;

export interface GameTelemetry {
  readonly cameraView: CameraView;
  readonly speedKnots: number;
  readonly throttlePercent: number;
  readonly distanceMeters: number;
  readonly rudderDegrees: number;
  readonly headingDegrees: number;
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly activeMeshes: number;
  readonly activeParticles: number;
  readonly simulationTimeMs: number;
  readonly soundStatus: SoundStatus;
  readonly activeBirds: number;
  readonly missiles: MissileTelemetry;
}

export type TelemetryListener = (telemetry: GameTelemetry) => void;
export type CameraView = "chase" | "forward" | "missile" | "island";

export class GameSession {
  readonly scene: Scene;
  readonly simulation = new BoatSimulation();
  readonly audio = new MaritimeAudio();

  private readonly input = new BoatKeyboardInput();
  private readonly inputScratch = { throttle: 0, steering: 0 };
  private readonly gunAimScratch = { traverse: 0, elevation: 0 };
  private readonly audioListenerForward = new Vector3(0, 0, 1);
  private readonly islandInputScratch: ControlInput = { throttle: 0, steering: 0 };
  private readonly boat: DestroyerVisual;
  private readonly island: IslandVisual;
  private readonly sky: MaritimeSky;
  private readonly ocean: OceanRenderer;
  private readonly ambientSprites: AmbientSprites;
  private readonly wake: BoatWake;
  private readonly missiles: MissileVls;
  private readonly camera: FollowCamera;
  private readonly forwardCamera: FreeCamera;
  private readonly missileCamera: FreeCamera;
  private readonly islandCamera: IslandCamera;
  private readonly cameraAnchor: Mesh;
  private previousCameraRadius = 190;
  private qualityValue: GraphicsQuality = DEFAULT_GRAPHICS_QUALITY;
  private accumulator = 0;
  private telemetryAccumulator = 0;
  private simulationMilliseconds = 0;
  private simulationStepCount = 0;
  private lastSimulationTimeMs = 0;
  private cameraView: CameraView = "chase";
  private trackedMissileState: CruiseMissileState | null = null;

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
    this.island = createIsland(this.scene);
    this.missiles = new MissileVls(this.scene, this.boat.root, this.boat.missileLaunchCells, () => this.audio.soundMissileLaunch());
    this.sky = createMaritimeSky(this.scene, settings, [...this.boat.shadowCasters, ...this.island.shadowCasters]);
    this.ocean = new OceanRenderer(this.scene, backend, settings, this.sky.sunDirection);
    this.ambientSprites = new AmbientSprites(this.scene, settings);
    this.wake = new BoatWake(this.scene, backend);
    this.cameraAnchor = new Mesh("chase-camera-anchor", this.scene);
    this.cameraAnchor.position.y = 0;

    this.camera = new FollowCamera(
      "destroyer-chase-camera",
      new Vector3(-150, 55, -175),
      this.scene,
      this.cameraAnchor,
    );
    this.camera.radius = 190;
    // Keep some sky and the horizon in the default frame, alongside the hull.
    this.camera.heightOffset = 55;
    this.camera.rotationOffset = 320;
    this.camera.cameraAcceleration = 0.016;
    this.camera.lowerRadiusLimit = 30;
    this.camera.upperRadiusLimit = 420;
    this.camera.lowerHeightOffsetLimit = 12;
    this.camera.upperHeightOffsetLimit = 220;
    this.camera.maxCameraSpeed = 80;
    this.camera.minZ = 0.2;
    this.camera.maxZ = settings.viewDistanceMeters;
    this.camera.fov = 0.82;
    this.previousCameraRadius = this.camera.radius;
    this.camera.onAfterCheckInputsObservable.add(() => {
      // Zoom along the current viewing angle while preserving drag-adjusted height.
      if (this.camera.radius !== this.previousCameraRadius) {
        this.camera.heightOffset = Math.min(
          this.camera.upperHeightOffsetLimit!,
          Math.max(
            this.camera.lowerHeightOffsetLimit!,
            this.camera.heightOffset * this.camera.radius / this.previousCameraRadius,
          ),
        );
        this.previousCameraRadius = this.camera.radius;
      }
    });
    this.camera.inputs.removeByType("FollowCameraKeyboardMoveInput");
    this.camera.attachControl(true);
    this.forwardCamera = new FreeCamera("forward-gun-camera", Vector3.Zero(), this.scene);
    this.forwardCamera.fov = 1.25;
    this.forwardCamera.minZ = 0.2;
    this.forwardCamera.maxZ = settings.viewDistanceMeters;
    this.forwardCamera.parent = this.boat.gunCameraMount;
    this.forwardCamera.position.set(0, 4.12, -8.25);
    this.forwardCamera.rotation.set(-0.18, 0, 0);
    this.missileCamera = new FreeCamera("missile-tracking-camera", Vector3.Zero(), this.scene);
    this.missileCamera.minZ = .2;
    this.missileCamera.maxZ = settings.viewDistanceMeters;
    this.missileCamera.fov = .95;
    this.islandCamera = new IslandCamera(this.scene, settings.viewDistanceMeters);
    this.scene.activeCamera = this.camera;
    this.boat.root.computeWorldMatrix(true);
    this.applyQuality(this.qualityValue);
  }

  update(frameDeltaSeconds: number): void {
    const frameDelta = Math.min(Math.max(frameDeltaSeconds, 0), MAX_FRAME_SECONDS);
    const firePressed = this.input.consumeGunFirePress();
    const launchBank = this.input.consumeMissileLaunchPress();
    if (this.cameraView === "island") {
      this.input.readInto(this.islandInputScratch);
      this.islandCamera.update(this.islandInputScratch, frameDelta);
    }
    this.accumulator = Math.min(
      this.accumulator + frameDelta,
      FIXED_SIMULATION_STEP * MAX_SIMULATION_STEPS_PER_FRAME,
    );

    let stepsThisFrame = 0;
    while (this.accumulator >= FIXED_SIMULATION_STEP && stepsThisFrame < MAX_SIMULATION_STEPS_PER_FRAME) {
      this.readShipControls();
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

    if (this.cameraView === "forward") {
      this.input.readGunAimInto(this.gunAimScratch);
      this.boat.updateGunAim(this.gunAimScratch.traverse, this.gunAimScratch.elevation, frameDelta);
    }

    const state = this.simulation.state;
    const interpolation = this.accumulator / FIXED_SIMULATION_STEP;
    this.boat.update(state, interpolation);
    this.boat.root.computeWorldMatrix(true);
    if (launchBank && this.cameraView !== "island") this.launchMissile(launchBank);
    this.missiles.update(frameDelta, state);
    if (this.cameraView === "missile") this.updateMissileCamera(frameDelta);
    this.boat.updateGunEffects(frameDelta, state.elapsedTime);
    if (this.cameraView === "forward" && firePressed && this.boat.fireGun(state.elapsedTime)) {
      this.audio.soundGunfire();
    }
    this.cameraAnchor.position.x = this.boat.root.position.x;
    this.cameraAnchor.position.z = this.boat.root.position.z;
    this.cameraAnchor.position.y += (this.boat.root.position.y - this.cameraAnchor.position.y) *
      (1 - Math.exp(-frameDelta * 2));
    // A damped camera follows the vessel's travelled path. Heading lag lets
    // the hull turn within the frame before the viewpoint catches up.
    const headingDelta=Math.atan2(Math.sin(this.boat.root.rotation.y-this.cameraAnchor.rotation.y),Math.cos(this.boat.root.rotation.y-this.cameraAnchor.rotation.y));
    this.cameraAnchor.rotation.y += headingDelta * (1-Math.exp(-frameDelta*1.1));
    const targetFov=.82+Math.min(.035,state.speed*.0022);
    this.camera.fov += (targetFov-this.camera.fov)*(1-Math.exp(-frameDelta*1.5));
    // The hull is drawn between the two most recent fixed steps. Use that same
    // smooth clock for the water instead of advancing it in visible 60 Hz jumps.
    const renderTime = Math.max(0, state.elapsedTime - FIXED_SIMULATION_STEP + interpolation * FIXED_SIMULATION_STEP);
    this.ocean.update(
      renderTime,
      this.boat.root.position.x,
      this.boat.root.position.z,
      this.scene.activeCamera?.globalPosition ?? this.camera.position,
      this.boat.root.rotation.y,
      state.forwardSpeed,
      state.yawRate,
      undefined,
    );
    const environmentFocus = this.cameraView === "island" ? this.islandCamera.camera.target : this.boat.root.position;
    this.sky.update(environmentFocus, this.cameraView === "island", renderTime);
    const activeCamera = this.scene.activeCamera ?? this.camera;
    activeCamera.getDirectionToRef(Axis.Z, this.audioListenerForward);
    this.audioListenerForward.normalize();
    const listenerPosition = activeCamera.globalPosition;
    this.island.update(listenerPosition, renderTime);
    const birdFocusHeight = listenerPosition.y + this.audioListenerForward.y * 32;
    this.ambientSprites.update(renderTime, listenerPosition.x, listenerPosition.z,
      Math.atan2(this.audioListenerForward.x, this.audioListenerForward.z), birdFocusHeight);
    this.wake.update(state, renderTime, this.scene.activeCamera?.globalPosition ?? this.camera.position,
      this.boat.root.position, this.boat.root.rotation.y);
    this.audio.update(state, this.ambientSprites.birdAudioSnapshots, listenerPosition, this.audioListenerForward);

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

  setCameraView(view: CameraView): void {
    if (view === "missile" && !this.missiles.trackingState) view = "chase";
    this.input.clear();
    this.camera.detachControl();
    this.islandCamera.camera.detachControl();
    this.cameraView = view;
    this.audio.shipControlsEnabled = view !== "island";
    this.scene.activeCamera = view === "island" ? this.islandCamera.camera
      : view === "forward" ? this.forwardCamera : view === "missile" ? this.missileCamera : this.camera;
    if (view === "island") this.islandCamera.camera.attachControl(false, false, 2);
    else if (view === "chase") this.camera.attachControl(true);
    if (view === "missile") this.updateMissileCamera(0, true);
    this.sky.setQuality(GRAPHICS_QUALITY_SETTINGS[this.qualityValue],
      view === "island" ? this.island.shadowCasters : this.boat.shadowCasters);
    this.publishTelemetry();
  }

  launchMissile(bank: MissileLaunchBank): boolean {
    if (this.cameraView === "island") return false;
    const launched = this.missiles.launch(bank);
    if (launched) this.publishTelemetry();
    return launched;
  }

  viewIsland(): void {
    this.setCameraView("island");
  }

  resetIslandView(): void {
    this.islandCamera.reset();
  }

  get currentQuality(): GraphicsQuality {
    return this.qualityValue;
  }

  dispose(): void {
    this.audio.dispose();
    this.input.dispose();
    this.camera.detachControl();
    this.forwardCamera.detachControl();
    this.missileCamera.detachControl();
    this.islandCamera.camera.detachControl();
    this.missiles.dispose();
    this.scene.dispose();
  }

  private applyQuality(quality: GraphicsQuality): void {
    this.qualityValue = quality;
    const settings = GRAPHICS_QUALITY_SETTINGS[quality];
    this.engine.setHardwareScalingLevel(settings.hardwareScaling);
    this.engine.resize();
    this.ocean.setQuality(settings);
    this.wake.setQuality(settings);
    this.ambientSprites.setQuality(settings);
    this.sky.setQuality(settings, this.cameraView === "island" ? this.island.shadowCasters : this.boat.shadowCasters);
    this.missiles.setQuality(quality);
    this.island.setQuality(quality);
    this.camera.maxZ = settings.viewDistanceMeters;
    this.forwardCamera.maxZ = settings.viewDistanceMeters;
    this.missileCamera.maxZ = settings.viewDistanceMeters;
    this.islandCamera.camera.maxZ = settings.viewDistanceMeters;
    this.scene.fogDensity = 0.00011 * (6_800 / settings.viewDistanceMeters);
  }

  private updateMissileCamera(delta: number, snap = false): void {
    const state = this.missiles.trackingState;
    if (!state) { this.setCameraView("chase"); return; }
    snap ||= state !== this.trackedMissileState;
    this.trackedMissileState = state;
    const position = new Vector3(state.position.x, state.position.y, state.position.z);
    const direction = new Vector3(state.direction.x, state.direction.y, state.direction.z);
    const heading = Math.hypot(state.velocity.x, state.velocity.z) > 5
      ? Math.atan2(state.velocity.x, state.velocity.z) : this.simulation.state.heading;
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading));
    const desiredPosition = position.subtract(direction.scale(22)).add(right.scale(31)).add(new Vector3(0, 14, 0));
    desiredPosition.y = Math.max(12, desiredPosition.y);
    Vector3.LerpToRef(this.missileCamera.position, desiredPosition, snap ? 1 : 1 - Math.exp(-delta * 8), this.missileCamera.position);
    this.missileCamera.setTarget(position.add(direction.scale(3)));
  }

  private readShipControls(): void {
    if (this.cameraView === "island") {
      this.inputScratch.throttle = 0;
      this.inputScratch.steering = 0;
    } else {
      this.input.readInto(this.inputScratch, this.cameraView !== "forward");
    }
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
      cameraView: this.cameraView,
      speedKnots: state.speed * METERS_PER_SECOND_TO_KNOTS,
      throttlePercent: state.throttle * 100,
      distanceMeters: state.distanceTraveledMeters,
      rudderDegrees: state.rudderAngleRadians * 180 / Math.PI,
      headingDegrees: normalizeHeading(state.heading),
      fps,
      frameTimeMs: fps > 0 ? 1_000 / fps : 0,
      activeMeshes: this.scene.getActiveMeshes().length,
      activeParticles,
      simulationTimeMs: this.lastSimulationTimeMs,
      soundStatus: this.audio.status,
      activeBirds: this.ambientSprites.activeBirdCount,
      missiles: this.missiles.telemetry,
    });
    this.simulationMilliseconds = 0;
    this.simulationStepCount = 0;
  }
}

function normalizeHeading(headingRadians: number): number {
  const degrees = (headingRadians * 180) / Math.PI;
  return (degrees % 360 + 360) % 360;
}
