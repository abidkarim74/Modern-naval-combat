import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TrailMesh } from "@babylonjs/core/Meshes/trailMesh";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { sampleOceanHeight } from "@naval/shared";

const FIRE_INTERVAL_SECONDS = 3.2;
const MUZZLE_FLASH_SECONDS = .2;
const RECOIL_SECONDS = .22;
const RECOIL_METERS = .48;
const GRAVITY_METERS_PER_SECOND_SQUARED = 9.81;
const TARGET_IMPACT_RANGE_METERS = 1_600;

interface Shell {
  readonly mesh: Mesh;
  readonly trail: TrailMesh;
  readonly position: Vector3;
  readonly velocity: Vector3;
  age: number;
}

interface WaterSplash {
  readonly plume: Mesh;
  readonly ring: Mesh;
  readonly material: StandardMaterial;
  readonly position: Vector3;
  age: number;
}

/** Client-side firing visuals for the forward Mk 45. */
export class ForedeckGunFire {
  private readonly flashMaterial: StandardMaterial;
  private readonly shellMaterial: StandardMaterial;
  private readonly tracerMaterial: StandardMaterial;
  private readonly particleTexture: Texture;
  private readonly smoke: ParticleSystem;
  private readonly muzzleFlash: Mesh;
  private readonly muzzleLight: PointLight;
  private readonly shells: Shell[] = [];
  private readonly splashes: WaterSplash[] = [];
  private readonly baseElevationPivotZ: number;
  private fireCooldown = 0;
  private flashTime = 0;
  private recoilTime = 0;
  private smokeBurstTime = 0;

  constructor(
    private readonly scene: Scene,
    private readonly muzzle: Mesh,
    private readonly elevationPivot: TransformNode,
  ) {
    this.baseElevationPivotZ = elevationPivot.position.z;
    this.flashMaterial = new StandardMaterial("Mk45-muzzle-flash-material", scene);
    this.flashMaterial.disableLighting = true;
    this.flashMaterial.diffuseColor = new Color3(1, .56, .16);
    this.flashMaterial.emissiveColor = new Color3(1, .47, .08);

    this.shellMaterial = new StandardMaterial("Mk45-shell-tracer-material", scene);
    this.shellMaterial.disableLighting = true;
    this.shellMaterial.diffuseColor = new Color3(1, .83, .52);
    this.shellMaterial.emissiveColor = new Color3(1, .64, .25);

    this.tracerMaterial = new StandardMaterial("Mk45-tracer-trail-material", scene);
    this.tracerMaterial.disableLighting = true;
    this.tracerMaterial.emissiveColor = new Color3(1, .71, .34);
    this.tracerMaterial.alpha = .9;
    this.particleTexture = createSoftParticleTexture(scene);

    this.muzzleFlash = CreateSphere("Mk45-muzzle-flash", { diameter: 1, segments: 8 }, scene);
    this.muzzleFlash.material = this.flashMaterial;
    this.muzzleFlash.isPickable = false;
    this.muzzleFlash.isVisible = false;

    this.muzzleLight = new PointLight("Mk45-muzzle-light", Vector3.Zero(), scene);
    this.muzzleLight.diffuse = new Color3(1, .48, .18);
    this.muzzleLight.specular = new Color3(1, .72, .38);
    this.muzzleLight.range = 100;
    this.muzzleLight.intensity = 0;

    this.smoke = new ParticleSystem("Mk45-bore-smoke", 140, scene);
    this.smoke.particleTexture = this.particleTexture;
    this.smoke.emitter = muzzle;
    this.smoke.minEmitBox = new Vector3(-.12, -.12, -.12);
    this.smoke.maxEmitBox = new Vector3(.12, .12, .12);
    this.smoke.color1 = new Color4(.43, .44, .43, .88);
    this.smoke.color2 = new Color4(.27, .30, .31, .72);
    this.smoke.colorDead = new Color4(.31, .34, .35, 0);
    this.smoke.minSize = 1.2;
    this.smoke.maxSize = 3.6;
    this.smoke.minLifeTime = 1.1;
    this.smoke.maxLifeTime = 2.8;
    this.smoke.emitRate = 520;
    this.smoke.minEmitPower = 1;
    this.smoke.maxEmitPower = 1;
    this.smoke.updateSpeed = .016;
    this.smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.smoke.gravity = new Vector3(0, 1.8, 0);
    this.smoke.isLocal = false;
  }

  fire(worldTime: number): boolean {
    if (this.fireCooldown > 0) return false;

    this.elevationPivot.computeWorldMatrix(true);
    this.muzzle.computeWorldMatrix(true);
    const worldMatrix = this.elevationPivot.getWorldMatrix();
    const direction = Vector3.TransformNormal(
      new Vector3(0, .93, 5.05).normalize(),
      worldMatrix,
    ).normalize();
    const muzzlePosition = this.muzzle.getAbsolutePosition();
    const shellPosition = muzzlePosition.add(direction.scale(.55));
    const horizontalDirection = new Vector3(direction.x, 0, direction.z).normalize();
    const horizontalComponent = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    const tanElevation = Math.max(.12, Math.min(.65, direction.y / Math.max(.1, horizontalComponent)));
    const flightTime = Math.sqrt(2 * (Math.max(1, shellPosition.y) + TARGET_IMPACT_RANGE_METERS * tanElevation) /
      GRAVITY_METERS_PER_SECOND_SQUARED);
    const velocity = horizontalDirection.scale(TARGET_IMPACT_RANGE_METERS / flightTime);
    velocity.y = TARGET_IMPACT_RANGE_METERS * tanElevation / flightTime;

    const shell = CreateSphere("Mk45-127mm-shell", { diameter: .22, segments: 8 }, this.scene);
    shell.material = this.shellMaterial;
    shell.isPickable = false;
    shell.scaling.set(.45, .45, .8);
    shell.position.copyFrom(shellPosition);
    orientAlongForward(shell, velocity);
    const trail = new TrailMesh("Mk45-visible-shell-trail", shell, this.scene, {
      diameter: .18,
      length: 70,
      sections: 8,
    });
    trail.material = this.tracerMaterial;
    trail.isPickable = false;
    trail.alwaysSelectAsActiveMesh = true;
    trail.doNotSyncBoundingInfo = true;
    this.shells.push({
      mesh: shell,
      trail,
      position: shellPosition.clone(),
      velocity,
      age: 0,
    });

    this.muzzleFlash.position.copyFrom(muzzlePosition.add(direction.scale(.2)));
    this.muzzleFlash.scaling.set(1.1, 1.1, 3.3);
    this.flashMaterial.alpha = 1;
    orientAlongForward(this.muzzleFlash, direction);
    this.muzzleFlash.isVisible = true;
    this.muzzleLight.position.copyFrom(muzzlePosition);
    this.muzzleLight.intensity = 8;
    this.flashTime = MUZZLE_FLASH_SECONDS;
    this.recoilTime = RECOIL_SECONDS;
    this.fireCooldown = FIRE_INTERVAL_SECONDS;
    this.smoke.direction1 = direction.scale(3).add(new Vector3(0, 2, 0));
    this.smoke.direction2 = direction.scale(9).add(new Vector3(0, 7, 0));
    this.smokeBurstTime = .28;
    this.smoke.start();
    return true;
  }

  update(deltaSeconds: number, worldTime: number): void {
    const delta = Math.max(0, deltaSeconds);
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
    this.flashTime = Math.max(0, this.flashTime - delta);
    this.flashMaterial.alpha = this.flashTime / MUZZLE_FLASH_SECONDS;
    this.muzzleFlash.isVisible = this.flashTime > 0;
    this.muzzleLight.intensity = 8 * (this.flashTime / MUZZLE_FLASH_SECONDS);
    if (this.flashTime === 0) this.muzzleLight.intensity = 0;

    this.recoilTime = Math.max(0, this.recoilTime - delta);
    const recoilProgress = 1 - this.recoilTime / RECOIL_SECONDS;
    const recoil = this.recoilTime > 0 ? Math.sin(recoilProgress * Math.PI) * RECOIL_METERS : 0;
    this.elevationPivot.position.z = this.baseElevationPivotZ - recoil;

    if (this.smokeBurstTime > 0) {
      this.smokeBurstTime = Math.max(0, this.smokeBurstTime - delta);
      if (this.smokeBurstTime === 0) this.smoke.stop();
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      shell.age += delta;
      shell.velocity.y -= GRAVITY_METERS_PER_SECOND_SQUARED * delta;
      shell.position.addInPlace(shell.velocity.scale(delta));
      const waterHeight = sampleOceanHeight(shell.position.x, shell.position.z, worldTime);
      if (shell.position.y <= waterHeight) {
        this.createSplash(shell.position.x, waterHeight, shell.position.z);
        shell.mesh.dispose();
        shell.trail.dispose();
        this.shells.splice(i, 1);
      } else if (shell.age > 55) {
        shell.mesh.dispose();
        shell.trail.dispose();
        this.shells.splice(i, 1);
      } else {
        shell.mesh.position.copyFrom(shell.position);
        orientAlongForward(shell.mesh, shell.velocity);
      }
    }

    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const splash = this.splashes[i];
      splash.age += delta;
      const progress = Math.min(1, splash.age / 1.6);
      const fade = 1 - progress;
      splash.material.alpha = fade;
      splash.plume.position.copyFrom(splash.position);
      splash.plume.position.y += .8 + progress * 1.8;
      splash.plume.scaling.set(.85 + progress * 1.4, 1.5 + progress * 2.3, .85 + progress * 1.4);
      const ringScale = .4 + progress * 11;
      splash.ring.position.copyFrom(splash.position);
      splash.ring.position.y += .08;
      splash.ring.scaling.set(ringScale, ringScale, ringScale);
      if (progress >= 1) {
        splash.plume.dispose();
        splash.ring.dispose();
        splash.material.dispose();
        this.splashes.splice(i, 1);
      }
    }
  }

  private createSplash(x: number, y: number, z: number): void {
    const material = new StandardMaterial("Mk45-water-impact-material", this.scene);
    material.disableLighting = true;
    material.diffuseColor = new Color3(.76, .91, .93);
    material.emissiveColor = new Color3(.34, .57, .60);
    material.alpha = 1;
    material.backFaceCulling = false;

    const plume = CreateSphere("Mk45-water-impact-plume", { diameter: 1, segments: 8 }, this.scene);
    plume.material = material;
    plume.isPickable = false;
    plume.position.set(x, y + .8, z);
    plume.scaling.set(.85, 1.5, .85);

    const ring = CreateTorus("Mk45-water-impact-ring", { diameter: 1, thickness: .075, tessellation: 20 }, this.scene);
    ring.material = material;
    ring.isPickable = false;
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y + .08, z);
    ring.scaling.set(.3, .3, .3);

    const spray = new ParticleSystem("Mk45-water-impact-spray", 64, this.scene);
    spray.particleTexture = this.particleTexture;
    spray.emitter = new Vector3(x, y + .2, z);
    spray.minEmitBox = new Vector3(-.2, 0, -.2);
    spray.maxEmitBox = new Vector3(.2, .2, .2);
    spray.color1 = new Color4(.82, .96, 1, .98);
    spray.color2 = new Color4(.50, .78, .88, .72);
    spray.colorDead = new Color4(.78, .94, 1, 0);
    spray.minSize = .24;
    spray.maxSize = .72;
    spray.minLifeTime = .55;
    spray.maxLifeTime = 1.25;
    spray.emitRate = 700;
    spray.targetStopDuration = .08;
    spray.minEmitPower = 10;
    spray.maxEmitPower = 24;
    spray.direction1 = new Vector3(-1, 1.0, -1);
    spray.direction2 = new Vector3(1, 2.5, 1);
    spray.gravity = new Vector3(0, -18, 0);
    spray.disposeOnStop = true;
    spray.start();

    this.splashes.push({ plume, ring, material, position: new Vector3(x, y, z), age: 0 });
  }
}

function orientAlongForward(mesh: Mesh, direction: Vector3): void {
  const forward = direction.clone().normalize();
  mesh.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(
    Vector3.Cross(Vector3.Up(), forward).normalize(),
    Vector3.Up().subtract(forward.scale(forward.y)).normalize(),
    forward,
  );
}

function createSoftParticleTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("Mk45-soft-smoke-texture", { width: 64, height: 64 }, scene, false);
  texture.hasAlpha = true;
  const context = texture.getContext();
  const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255,255,255,0.96)");
  gradient.addColorStop(.34, "rgba(255,255,255,0.72)");
  gradient.addColorStop(.72, "rgba(255,255,255,0.26)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.update();
  return texture;
}
