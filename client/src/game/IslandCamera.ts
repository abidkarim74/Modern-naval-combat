import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, islandHeight } from "@naval/shared";
import type { ControlInput } from "@naval/shared";

/** An independent viewpoint for the opponent's base; never targets the ship. */
export class IslandCamera {
  readonly camera: ArcRotateCamera;

  constructor(scene: Scene, viewDistance: number) {
    this.camera = new ArcRotateCamera("north-watch-island-camera", -1.95, 1.04, 1_250,
      new Vector3(ISLAND_CENTER.x, 85, ISLAND_CENTER.z), scene);
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
    this.camera.lowerRadiusLimit = 12;
    this.camera.checkCollisions = true;
    this.camera.collisionRadius = new Vector3(.65, .9, .65);
    this.camera.upperRadiusLimit = Math.max(1_850, this.overviewRadius() * 1.3);
    this.camera.lowerBetaLimit = .14;
    this.camera.upperBetaLimit = Math.PI / 2 - .045;
    this.camera.allowUpsideDown = false;
    this.camera.wheelDeltaPercentage = .055;
    this.camera.panningSensibility = 42;
    this.camera.panningAxis.set(1, 0, 1);
    this.camera.inertia = .72;
    this.camera.minZ = .3;
    this.camera.maxZ = viewDistance;
    this.camera.fov = .82;
    this.camera.radius = this.overviewRadius();
    this.camera.onAfterCheckInputsObservable.add(() => this.constrainView());
  }

  reset(): void {
    this.camera.inertialAlphaOffset = 0;
    this.camera.inertialBetaOffset = 0;
    this.camera.inertialRadiusOffset = 0;
    this.camera.inertialPanningX = 0;
    this.camera.inertialPanningY = 0;
    this.camera.alpha = -1.95;
    this.camera.beta = 1.04;
    this.camera.radius = this.overviewRadius();
    this.camera.upperRadiusLimit = Math.max(1_850, this.camera.radius * 1.3);
    this.camera.target.set(ISLAND_CENTER.x, 85, ISLAND_CENTER.z);
    // Reset is an intentional jump to the overview, which must finish even
    // when the inspection camera starts beside a tree or inside a courtyard.
    const collisions = this.camera.checkCollisions;
    this.camera.checkCollisions = false;
    this.camera.getViewMatrix(true);
    this.camera.checkCollisions = collisions;
  }

  update(input: ControlInput, delta: number): void {
    const forwardX = -Math.cos(this.camera.alpha);
    const forwardZ = -Math.sin(this.camera.alpha);
    const length = Math.max(1, Math.hypot(input.throttle, input.steering));
    const speed = Math.min(180, Math.max(22, this.camera.radius * .22)) * delta / length;
    this.camera.target.x += (forwardX * input.throttle + forwardZ * input.steering) * speed;
    this.camera.target.z += (forwardZ * input.throttle - forwardX * input.steering) * speed;
    this.constrainView(delta);
  }

  private overviewRadius(): number {
    const engine = this.camera.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    // Fit the long headlands in portrait panels as well as wide game windows.
    return Math.max(1_250, Math.min(4_500, ISLAND_RADIUS_X / (Math.tan(.82 / 2) * aspect * .90)));
  }

  private constrainView(delta = 0): void {
    const target = this.camera.target;
    target.x = Math.max(ISLAND_CENTER.x - ISLAND_RADIUS_X * 1.12,
      Math.min(ISLAND_CENTER.x + ISLAND_RADIUS_X * 1.12, target.x));
    target.z = Math.max(ISLAND_CENTER.z - ISLAND_RADIUS_Z * 1.5,
      Math.min(ISLAND_CENTER.z + ISLAND_RADIUS_Z * 1.12, target.z));
    // Close inspection tracks the ground. The overview aims at the island's
    // whole volume, keeping its beach and pier inside the frame as well.
    const ground = islandHeight(target.x - ISLAND_CENTER.x, target.z - ISLAND_CENTER.z);
    const closeBlend = Math.max(0, Math.min(1, (this.camera.radius - 12) / 43));
    const targetClearance = 2.5 + closeBlend * 11.5;
    const eyeClearance = 1.8 + closeBlend * 8.2;
    const inspectionFloor = Math.max(3 + closeBlend * 9, ground + targetClearance);
    const overviewBlend = Math.max(0, Math.min(1, (this.camera.radius - 750) / 500));
    const targetFloor = inspectionFloor + (Math.min(85, inspectionFloor) - inspectionFloor) * overviewBlend;
    if (target.y < targetFloor) target.y = targetFloor;
    else if (delta > 0) target.y += (targetFloor - target.y) * (1 - Math.exp(-delta * 3));
    // Changing elevation also moves the viewpoint horizontally across the
    // ridges. Keep a verified clear angle throughout the search rather than
    // repeatedly solving against the ground at the previous endpoint.
    const radius = this.camera.radius;
    const axisX = Math.cos(this.camera.alpha);
    const axisZ = Math.sin(this.camera.alpha);
    const clearanceAt = (beta: number) => {
      const reach = radius * Math.sin(beta);
      const x = target.x + axisX * reach - ISLAND_CENTER.x;
      const z = target.z + axisZ * reach - ISLAND_CENTER.z;
      return target.y + radius * Math.cos(beta) - Math.max(2 + closeBlend * 6, islandHeight(x, z) + eyeClearance);
    };
    if (clearanceAt(this.camera.beta) >= 0) return;

    let clearAngle = this.camera.lowerBetaLimit!;
    let blockedAngle = this.camera.beta;
    const highestClearance = clearanceAt(clearAngle);
    // A close target beside a steep cliff may need extra height even at the
    // highest orbit angle. Raising it preserves the sampled horizontal point.
    if (highestClearance < 0) target.y += -highestClearance + .05;
    for (let step = 0; step < 14; step++) {
      const candidate = (clearAngle + blockedAngle) * .5;
      if (clearanceAt(candidate) >= .05) clearAngle = candidate;
      else blockedAngle = candidate;
    }
    this.camera.beta = clearAngle;
    this.camera.inertialBetaOffset = 0;
  }
}
