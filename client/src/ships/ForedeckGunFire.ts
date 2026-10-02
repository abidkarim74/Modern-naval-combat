import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { sampleOceanHeight } from "@naval/shared";
import { configureWeaponParticles, createWeaponFireTexture, createWeaponSmokeTexture } from "./weaponParticles";

const FIRE_INTERVAL_SECONDS = 3.2;
const MUZZLE_FLASH_SECONDS = .045;
const MUZZLE_LIGHT_INTENSITY = 3.6;
const RECOIL_KICK_SECONDS = .055;
const RECOIL_SECONDS = .7;
const RECOIL_METERS = .48;
const GRAVITY_METERS_PER_SECOND_SQUARED = 9.81;
const TARGET_IMPACT_RANGE_METERS = 1_600;
const BARREL_DIRECTION = new Vector3(0, .93, 5.05).normalize();
const SMOKE_WIND = new Vector3(2.4, .8, .7);

interface Emission {
  readonly position: Vector3;
  readonly velocity: Vector3;
}

interface Shell {
  readonly mesh: Mesh;
  readonly position: Vector3;
  readonly velocity: Vector3;
  age: number;
}

interface WaterSplash {
  readonly plume: Mesh;
  readonly ring: Mesh;
  readonly material: StandardMaterial;
  readonly spray: ParticleSystem;
  readonly position: Vector3;
  age: number;
}

/** Client-side firing visuals for the forward Mk 45. */
export class ForedeckGunFire {
  private readonly shellMaterial: StandardMaterial;
  private readonly muzzleLight: PointLight;
  private readonly smokeTexture: DynamicTexture;
  private readonly fireTexture: DynamicTexture;
  private readonly sprayTexture: DynamicTexture;
  private readonly coreFlash: ParticleSystem;
  private readonly flameFlash: ParticleSystem;
  private readonly blastSmoke: ParticleSystem;
  private readonly lingeringSmoke: ParticleSystem;
  private readonly coreEmissions: Emission[] = [];
  private readonly flameEmissions: Emission[] = [];
  private readonly blastEmissions: Emission[] = [];
  private readonly smokeEmissions: Emission[] = [];
  private readonly shells: Shell[] = [];
  private readonly splashes: WaterSplash[] = [];
  private readonly baseElevationPivotPosition: Vector3;
  private fireCooldown = 0;
  private flashTime = 0;
  private recoilTime = 0;
  private effectDelta = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly muzzle: Mesh,
    private readonly elevationPivot: TransformNode,
  ) {
    this.baseElevationPivotPosition = elevationPivot.position.clone();
    // A conventional 127 mm shell has no burning tracer or rocket exhaust.
    this.shellMaterial = new StandardMaterial("Mk45-shell-material", scene);
    this.shellMaterial.diffuseColor = new Color3(.24, .25, .23);

    this.muzzleLight = new PointLight("Mk45-muzzle-light", Vector3.Zero(), scene);
    this.muzzleLight.diffuse = new Color3(1, .48, .18);
    this.muzzleLight.specular = new Color3(1, .72, .38);
    this.muzzleLight.range = 36;
    this.muzzleLight.intensity = 0;
    this.muzzleLight.includedOnlyMeshes = [muzzle];
    this.smokeTexture = createWeaponSmokeTexture(scene, "Mk45-billowing-smoke-texture");
    this.fireTexture = createWeaponFireTexture(scene, "Mk45-turbulent-flash-texture");
    this.sprayTexture = createSoftParticleTexture(scene);
    this.coreFlash = this.createFlash("Mk45-white-hot-muzzle-core", this.coreEmissions, true);
    this.flameFlash = this.createFlash("Mk45-directional-muzzle-fire", this.flameEmissions, false);
    this.blastSmoke = this.createSmoke("Mk45-propellant-blast", this.blastEmissions, true);
    this.lingeringSmoke = this.createSmoke("Mk45-propellant-plume", this.smokeEmissions, false);
    this.scene.registerBeforeRender(this.synchronizeParticleTime);
    this.scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  fire(_worldTime: number): boolean {
    if (this.disposed || this.fireCooldown > 0) return false;

    this.elevationPivot.computeWorldMatrix(true);
    this.muzzle.computeWorldMatrix(true);
    const worldMatrix = this.elevationPivot.getWorldMatrix();
    const direction = Vector3.TransformNormal(
      BARREL_DIRECTION,
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

    const shell = CreateSphere("Mk45-127mm-shell", { diameter: .127, segments: 8 }, this.scene);
    shell.material = this.shellMaterial;
    shell.isPickable = false;
    shell.scaling.set(1, 1, 4);
    shell.position.copyFrom(shellPosition);
    orientAlongForward(shell, velocity);
    this.shells.push({
      mesh: shell,
      position: shellPosition.clone(),
      velocity,
      age: 0,
    });

    this.muzzleLight.position.copyFrom(muzzlePosition);
    // Resolve after static batching, so the flash illuminates surviving ship
    // meshes without changing the sky, island, or ocean lighting.
    this.muzzleLight.includedOnlyMeshes = this.elevationPivot.parent?.parent?.getChildMeshes() ?? [this.muzzle];
    this.muzzleLight.intensity = MUZZLE_LIGHT_INTENSITY;
    this.flashTime = MUZZLE_FLASH_SECONDS;
    this.recoilTime = RECOIL_SECONDS;
    this.fireCooldown = FIRE_INTERVAL_SECONDS;
    this.emitMuzzleBurst(muzzlePosition, direction);
    return true;
  }

  update(deltaSeconds: number, worldTime: number): void {
    if (this.disposed) return;
    const delta = Math.max(0, Math.min(.1, deltaSeconds));
    this.effectDelta = delta;
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
    this.flashTime = Math.max(0, this.flashTime - delta);
    this.muzzleLight.intensity = MUZZLE_LIGHT_INTENSITY * (this.flashTime / MUZZLE_FLASH_SECONDS);
    if (this.flashTime === 0) this.muzzleLight.intensity = 0;

    this.recoilTime = Math.max(0, this.recoilTime - delta);
    const elapsed = RECOIL_SECONDS - this.recoilTime;
    const returnProgress = Math.max(0, (elapsed - RECOIL_KICK_SECONDS) /
      (RECOIL_SECONDS - RECOIL_KICK_SECONDS));
    const recoil = this.recoilTime <= 0 ? 0 : elapsed < RECOIL_KICK_SECONDS
      ? RECOIL_METERS * Math.sin(elapsed / RECOIL_KICK_SECONDS * Math.PI / 2)
      : RECOIL_METERS * (1 - returnProgress) ** 2;
    const elevation = Math.atan2(BARREL_DIRECTION.y, BARREL_DIRECTION.z) - this.elevationPivot.rotation.x;
    this.elevationPivot.position.copyFrom(this.baseElevationPivotPosition);
    this.elevationPivot.position.y -= Math.sin(elevation) * recoil;
    this.elevationPivot.position.z -= Math.cos(elevation) * recoil;

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      shell.age += delta;
      shell.velocity.y -= GRAVITY_METERS_PER_SECOND_SQUARED * delta;
      shell.position.addInPlace(shell.velocity.scale(delta));
      const waterHeight = sampleOceanHeight(shell.position.x, shell.position.z, worldTime);
      if (shell.position.y <= waterHeight) {
        this.createSplash(shell.position.x, waterHeight, shell.position.z);
        shell.mesh.dispose();
        this.shells.splice(i, 1);
      } else if (shell.age > 55) {
        shell.mesh.dispose();
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
        splash.spray.dispose(false);
        this.splashes.splice(i, 1);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.unregisterBeforeRender(this.synchronizeParticleTime);
    for (const shell of this.shells) shell.mesh.dispose();
    for (const splash of this.splashes) {
      splash.plume.dispose();
      splash.ring.dispose();
      splash.material.dispose();
      splash.spray.dispose(false);
    }
    for (const system of [this.coreFlash, this.flameFlash, this.blastSmoke, this.lingeringSmoke]) system.dispose(false);
    this.smokeTexture.dispose();
    this.fireTexture.dispose();
    this.sprayTexture.dispose();
    this.shellMaterial.dispose();
    this.muzzleLight.dispose();
    this.elevationPivot.position.copyFrom(this.baseElevationPivotPosition);
    this.shells.length = this.splashes.length = 0;
    for (const queue of [this.coreEmissions, this.flameEmissions, this.blastEmissions, this.smokeEmissions]) queue.length = 0;
  }

  private emitMuzzleBurst(position: Vector3, direction: Vector3): void {
    // Snapshot the bore in world space; neither the smoke nor the flash follows
    // the ship or the barrel after the propellant leaves the muzzle.
    const side = Vector3.Cross(Vector3.Up(), direction).normalize();
    const up = Vector3.Cross(direction, side).normalize();
    // A fire request can arrive while rendering is suspended. Replace an
    // unseen old burst instead of accumulating queued emissions indefinitely.
    for (const queue of [this.coreEmissions, this.flameEmissions, this.blastEmissions, this.smokeEmissions]) queue.length = 0;
    const emit = (queue: Emission[], count: number, spread: number, speed: number, length: number): void => {
      for (let index = 0; index < count; index++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random());
        const radial = side.scale(Math.cos(angle) * radius).add(up.scale(Math.sin(angle) * radius));
        queue.push({
          position: position.add(direction.scale(.2 + Math.random() * length)).add(radial.scale(.12)),
          velocity: direction.scale(speed * (.65 + Math.random() * .7)).add(radial.scale(speed * spread)),
        });
      }
    };
    emit(this.coreEmissions, 28, .09, 38, 1.25);
    emit(this.flameEmissions, 68, .34, 34, 2.3);
    emit(this.blastEmissions, 64, .64, 42, .65);
    emit(this.smokeEmissions, 112, .4, 26, .35);
    this.coreFlash.manualEmitCount = this.coreEmissions.length;
    this.flameFlash.manualEmitCount = this.flameEmissions.length;
    this.blastSmoke.manualEmitCount = this.blastEmissions.length;
    this.lingeringSmoke.manualEmitCount = this.smokeEmissions.length;
  }

  private createFlash(name: string, emissions: Emission[], core: boolean): ParticleSystem {
    const fire = new ParticleSystem(name, core ? 48 : 96, this.scene);
    fire.particleTexture = this.fireTexture;
    fire.minLifeTime = core ? .018 : .026;
    fire.maxLifeTime = core ? .034 : .055;
    fire.minSize = core ? .25 : .6;
    fire.maxSize = core ? .7 : 1.7;
    fire.minScaleX = .7; fire.maxScaleX = 1.2;
    fire.minScaleY = core ? 1.6 : 1.1; fire.maxScaleY = core ? 2.8 : 1.9;
    fire.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    fire.addColorGradient(0, core ? new Color4(1, .98, .88, 1) : new Color4(1, .85, .43, .94));
    fire.addColorGradient(.32, core ? new Color4(1, .93, .63, .9) : new Color4(1, .53, .1, .68));
    fire.addColorGradient(1, new Color4(1, .28, .025, 0));
    fire.addSizeGradient(0, core ? .25 : .6, core ? .7 : 1.7);
    fire.addSizeGradient(.45, core ? .3 : 1, core ? .8 : 2.3);
    fire.addSizeGradient(1, core ? .2 : 1.2, core ? .6 : 2.6);
    this.attachEmissions(fire, emissions);
    configureWeaponParticles(fire, this.scene, ParticleSystem.BLENDMODE_ADD);
    fire.start();
    return fire;
  }

  private createSmoke(name: string, emissions: Emission[], blast: boolean): ParticleSystem {
    const smoke = new ParticleSystem(name, blast ? 160 : 520, this.scene);
    smoke.particleTexture = this.smokeTexture;
    smoke.minLifeTime = blast ? .35 : 3.4;
    smoke.maxLifeTime = blast ? .7 : 5.8;
    smoke.minSize = smoke.maxSize = 1;
    smoke.minInitialRotation = -Math.PI;
    smoke.maxInitialRotation = Math.PI;
    smoke.minAngularSpeed = -.25;
    smoke.maxAngularSpeed = .25;
    smoke.addColorGradient(0, blast ? new Color4(.66, .62, .53, .76) : new Color4(.76, .77, .73, .74), blast ? new Color4(.88, .83, .69, .7) : new Color4(.91, .91, .85, .68));
    smoke.addColorGradient(.1, new Color4(.77, .78, .74, blast ? .54 : .48));
    smoke.addColorGradient(.42, new Color4(.85, .86, .82, blast ? .22 : .20));
    smoke.addColorGradient(.8, new Color4(.9, .91, .88, blast ? .045 : .04));
    smoke.addColorGradient(1, new Color4(.93, .94, .92, 0));
    smoke.addSizeGradient(0, blast ? .55 : .7, blast ? 1.1 : 1.3);
    smoke.addSizeGradient(.1, blast ? 1.8 : 2.4, blast ? 3.2 : 3.7);
    smoke.addSizeGradient(.42, blast ? 4 : 4.3, blast ? 6.2 : 6.1);
    smoke.addSizeGradient(1, blast ? 7 : 7.5, blast ? 9.5 : 10);
    this.attachEmissions(smoke, emissions);
    // Air resistance arrests the initial jet, then carries every puff downwind.
    const updateParticles = smoke.updateFunction;
    smoke.updateFunction = (particles) => {
      const delta = this.effectDelta;
      const drag = 1 - Math.exp(-delta * (blast ? 2.2 : 3.5));
      for (const particle of particles) {
        Vector3.LerpToRef(particle.direction, SMOKE_WIND, drag, particle.direction);
        particle.direction.x += Math.sin(particle.position.z * .5 + particle.age * 1.5) * delta * .5;
        particle.direction.z += Math.cos(particle.position.x * .4 + particle.age) * delta * .4;
      }
      updateParticles(particles);
    };
    configureWeaponParticles(smoke, this.scene);
    smoke.start();
    return smoke;
  }

  private attachEmissions(system: ParticleSystem, emissions: Emission[]): void {
    system.emitter = Vector3.Zero();
    system.isLocal = false;
    system.emitRate = 0;
    system.manualEmitCount = 0;
    system.minEmitPower = system.maxEmitPower = 1;
    system.updateSpeed = 0;
    let emission: Emission | undefined;
    system.startPositionFunction = (_world, position) => {
      emission = emissions.pop();
      position.copyFrom(emission?.position ?? Vector3.Zero());
    };
    system.startDirectionFunction = (_world, direction) => {
      direction.copyFrom(emission?.velocity ?? Vector3.Zero());
    };
  }

  private readonly synchronizeParticleTime = (): void => {
    const speed = this.effectDelta / (this.scene.getAnimationRatio() || 1);
    for (const system of [this.coreFlash, this.flameFlash, this.blastSmoke, this.lingeringSmoke]) system.updateSpeed = speed;
    for (const splash of this.splashes) splash.spray.updateSpeed = speed;
  };

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
    spray.particleTexture = this.sprayTexture;
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
    spray.emitRate = 0;
    spray.manualEmitCount = 56;
    spray.targetStopDuration = .08;
    spray.minEmitPower = 10;
    spray.maxEmitPower = 24;
    spray.direction1 = new Vector3(-1, 1.0, -1);
    spray.direction2 = new Vector3(1, 2.5, 1);
    spray.gravity = new Vector3(0, -18, 0);
    configureWeaponParticles(spray, this.scene);
    spray.start();

    this.splashes.push({ plume, ring, material, spray, position: new Vector3(x, y, z), age: 0 });
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
  const texture = new DynamicTexture("Mk45-soft-water-spray-texture", { width: 64, height: 64 }, scene, false);
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
