import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { sampleOceanHeight, islandHeight, ISLAND_CENTER, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, islandShoreRadius } from "@naval/shared";
import { configureWeaponParticles, createWeaponFireTexture, createWeaponSmokeTexture } from "./weaponParticles";

const FIRE_INTERVAL_SECONDS = 3.2;
const MUZZLE_FLASH_SECONDS = .045;
const MUZZLE_LIGHT_INTENSITY = 3.6;
const RECOIL_KICK_SECONDS = .055;
const RECOIL_SECONDS = .7;
const RECOIL_METERS = .48;
const GRAVITY_METERS_PER_SECOND_SQUARED = 9.81;

const BARREL_DIRECTION = new Vector3(0, .93, 5.05).normalize();
const SMOKE_WIND = new Vector3(2.4, .8, .7);

// Shell physics
const MUZZLE_VELOCITY_MPS = 808;        // Mk 45 Mod 4 muzzle velocity ~808 m/s
const SHELL_DRAG_COEFFICIENT = 0.00012; // Light aerodynamic drag for 127 mm naval shell


interface Emission {
  readonly position: Vector3;
  readonly velocity: Vector3;
}

interface Shell {
  readonly mesh: Mesh;
  readonly tracer: Mesh;
  readonly tracerMaterial: StandardMaterial;
  readonly position: Vector3;
  readonly velocity: Vector3;
  age: number;
  readonly tracerPositions: Vector3[];  // recent positions for trail
}

interface WaterSplash {
  readonly plume: Mesh;
  readonly ring: Mesh;
  readonly material: StandardMaterial;
  readonly spray: ParticleSystem;
  readonly mist: ParticleSystem;
  readonly position: Vector3;
  age: number;
}

interface LandExplosion {
  readonly fireball: Mesh;
  readonly fireballMaterial: StandardMaterial;
  readonly shockwaveRing: Mesh;
  readonly shockwaveMaterial: StandardMaterial;
  readonly craterSmoke: ParticleSystem;
  readonly debrisParticles: ParticleSystem;
  readonly fireParticles: ParticleSystem;
  readonly light: PointLight;
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
  private readonly explosionTexture: DynamicTexture;
  private readonly debrisTexture: DynamicTexture;
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
  private readonly explosions: LandExplosion[] = [];
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
    this.explosionTexture = createExplosionTexture(scene);
    this.debrisTexture = createDebrisTexture(scene);
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

    // Compute the initial velocity from the barrel direction at realistic muzzle velocity
    // The gun is already aimed at an elevation angle; we use the full direction vector
    // which gives the shell its parabolic arc under gravity.
    const velocity = direction.scale(MUZZLE_VELOCITY_MPS);

    // Create the visible shell mesh
    const shell = CreateSphere("Mk45-127mm-shell", { diameter: .18, segments: 8 }, this.scene);
    shell.material = this.shellMaterial;
    shell.isPickable = false;
    shell.scaling.set(1, 1, 5);
    shell.position.copyFrom(shellPosition);
    orientAlongForward(shell, velocity);

    // Create a glowing tracer mesh that stretches behind the shell
    const tracerMat = new StandardMaterial("Mk45-shell-tracer", this.scene);
    tracerMat.emissiveColor = new Color3(1, .72, .28);
    tracerMat.diffuseColor = new Color3(1, .85, .4);
    tracerMat.disableLighting = true;
    tracerMat.alpha = .85;
    const tracer = CreateCylinder("Mk45-tracer-trail", {
      diameterTop: .04, diameterBottom: .10, height: 2.5, tessellation: 6,
    }, this.scene);
    tracer.material = tracerMat;
    tracer.isPickable = false;
    tracer.position.copyFrom(shellPosition);

    this.shells.push({
      mesh: shell,
      tracer,
      tracerMaterial: tracerMat,
      position: shellPosition.clone(),
      velocity,
      age: 0,
      tracerPositions: [shellPosition.clone()],
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

    // Update shells with ballistic physics
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      shell.age += delta;

      // Apply gravity
      shell.velocity.y -= GRAVITY_METERS_PER_SECOND_SQUARED * delta;

      // Apply light aerodynamic drag (velocity-squared dependent)
      const speed = shell.velocity.length();
      if (speed > 1) {
        const dragForce = SHELL_DRAG_COEFFICIENT * speed * speed;
        const dragDeceleration = Math.min(dragForce, speed / delta * 0.5); // clamp so drag can't reverse
        shell.velocity.x -= (shell.velocity.x / speed) * dragDeceleration * delta;
        shell.velocity.y -= (shell.velocity.y / speed) * dragDeceleration * delta;
        shell.velocity.z -= (shell.velocity.z / speed) * dragDeceleration * delta;
      }

      // Integrate position
      shell.position.addInPlace(shell.velocity.scale(delta));

      // Store tracer trail position (keep last several for the glowing tail)
      shell.tracerPositions.push(shell.position.clone());
      if (shell.tracerPositions.length > 6) shell.tracerPositions.shift();

      // Check impact: land (island terrain) vs water
      const impactResult = this.checkImpact(shell.position, worldTime);

      if (impactResult.hit) {
        if (impactResult.type === "land") {
          this.createLandExplosion(shell.position.x, impactResult.groundY, shell.position.z, shell.velocity);
        } else {
          this.createSplash(shell.position.x, impactResult.groundY, shell.position.z, shell.velocity);
        }
        shell.mesh.dispose();
        shell.tracer.dispose();
        shell.tracerMaterial.dispose();
        this.shells.splice(i, 1);
      } else if (shell.age > 55) {
        shell.mesh.dispose();
        shell.tracer.dispose();
        shell.tracerMaterial.dispose();
        this.shells.splice(i, 1);
      } else {
        // Update visual positions
        shell.mesh.position.copyFrom(shell.position);
        orientAlongForward(shell.mesh, shell.velocity);

        // Update tracer - stretch it along the trajectory behind the shell
        if (shell.tracerPositions.length >= 2) {
          const tail = shell.tracerPositions[0];
          const head = shell.position;
          const trailDir = head.subtract(tail);
          const trailLen = trailDir.length();
          const midpoint = tail.add(trailDir.scale(0.5));
          shell.tracer.position.copyFrom(midpoint);
          shell.tracer.scaling.y = Math.max(0.5, trailLen / 2.5);
          orientTracerAlongDirection(shell.tracer, trailDir);
        }

        // Fade tracer over distance - more opaque at short range for visibility
        const fadeFactor = Math.max(0.15, 1 - shell.age * 0.12);
        shell.tracerMaterial.alpha = .85 * fadeFactor;
        shell.tracerMaterial.emissiveColor = new Color3(
          1 * fadeFactor,
          (.72 - shell.age * .03) * fadeFactor,
          (.28 - shell.age * .02) * fadeFactor,
        );
      }
    }

    // Update water splashes
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const splash = this.splashes[i];
      splash.age += delta;
      const duration = 2.4;
      const progress = Math.min(1, splash.age / duration);
      const fade = 1 - progress;
      splash.material.alpha = fade;

      // Plume rises and expands
      const risePhase = Math.min(1, splash.age / .35);
      const plumeHeight = 2.5 + risePhase * 8.5;
      const fallPhase = Math.max(0, (splash.age - .45) / 1.6);
      splash.plume.position.copyFrom(splash.position);
      splash.plume.position.y += plumeHeight * (1 - fallPhase * .7);
      const plumeWidth = .6 + risePhase * 1.2 + fallPhase * 2.5;
      splash.plume.scaling.set(plumeWidth, 2 + risePhase * 4.5 - fallPhase * 2, plumeWidth);

      // Ring expands outward
      const ringScale = .3 + progress * 16;
      splash.ring.position.copyFrom(splash.position);
      splash.ring.position.y += .08;
      splash.ring.scaling.set(ringScale, ringScale, ringScale);

      if (progress >= 1) {
        splash.plume.dispose();
        splash.ring.dispose();
        splash.material.dispose();
        splash.spray.dispose(false);
        splash.mist.dispose(false);
        this.splashes.splice(i, 1);
      }
    }

    // Update land explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const explosion = this.explosions[i];
      explosion.age += delta;
      const duration = 3.5;
      const progress = Math.min(1, explosion.age / duration);

      // Fireball: rapid expansion then fade
      const fireProgress = Math.min(1, explosion.age / .45);
      const fireFade = Math.max(0, 1 - (explosion.age - .15) / .6);
      const fireScale = 1.5 + fireProgress * 7;
      explosion.fireball.position.copyFrom(explosion.position);
      explosion.fireball.position.y += fireProgress * 4;
      explosion.fireball.scaling.set(fireScale, fireScale * 1.3, fireScale);
      explosion.fireballMaterial.alpha = fireFade * .92;
      explosion.fireballMaterial.emissiveColor = new Color3(
        1 * fireFade,
        (.65 + .15 * Math.sin(explosion.age * 12)) * fireFade,
        .15 * fireFade,
      );

      // Shockwave ring expands fast along the ground
      const shockProgress = Math.min(1, explosion.age / .8);
      const shockScale = 1 + shockProgress * 28;
      const shockFade = 1 - shockProgress;
      explosion.shockwaveRing.position.copyFrom(explosion.position);
      explosion.shockwaveRing.position.y += .15;
      explosion.shockwaveRing.scaling.set(shockScale, shockScale, shockScale);
      explosion.shockwaveMaterial.alpha = shockFade * .45;

      // Point light flash
      if (explosion.age < .25) {
        explosion.light.intensity = 12 * (1 - explosion.age / .25);
      } else {
        explosion.light.intensity = 0;
      }

      if (progress >= 1) {
        explosion.fireball.dispose();
        explosion.fireballMaterial.dispose();
        explosion.shockwaveRing.dispose();
        explosion.shockwaveMaterial.dispose();
        explosion.craterSmoke.dispose(false);
        explosion.debrisParticles.dispose(false);
        explosion.fireParticles.dispose(false);
        explosion.light.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.unregisterBeforeRender(this.synchronizeParticleTime);
    for (const shell of this.shells) {
      shell.mesh.dispose();
      shell.tracer.dispose();
      shell.tracerMaterial.dispose();
    }
    for (const splash of this.splashes) {
      splash.plume.dispose();
      splash.ring.dispose();
      splash.material.dispose();
      splash.spray.dispose(false);
      splash.mist.dispose(false);
    }
    for (const explosion of this.explosions) {
      explosion.fireball.dispose();
      explosion.fireballMaterial.dispose();
      explosion.shockwaveRing.dispose();
      explosion.shockwaveMaterial.dispose();
      explosion.craterSmoke.dispose(false);
      explosion.debrisParticles.dispose(false);
      explosion.fireParticles.dispose(false);
      explosion.light.dispose();
    }
    for (const system of [this.coreFlash, this.flameFlash, this.blastSmoke, this.lingeringSmoke]) system.dispose(false);
    this.smokeTexture.dispose();
    this.fireTexture.dispose();
    this.sprayTexture.dispose();
    this.explosionTexture.dispose();
    this.debrisTexture.dispose();
    this.shellMaterial.dispose();
    this.muzzleLight.dispose();
    this.elevationPivot.position.copyFrom(this.baseElevationPivotPosition);
    this.shells.length = this.splashes.length = this.explosions.length = 0;
    for (const queue of [this.coreEmissions, this.flameEmissions, this.blastEmissions, this.smokeEmissions]) queue.length = 0;
  }

  /** Determine if a position is over land or water, and the surface Y at that point. */
  private checkImpact(position: Vector3, worldTime: number): { hit: boolean; type: "land" | "water"; groundY: number } {
    // Check if the position is over the island
    const localX = position.x - ISLAND_CENTER.x;
    const localZ = position.z - ISLAND_CENTER.z;
    const normalizedRadius = Math.hypot(localX / ISLAND_RADIUS_X, localZ / ISLAND_RADIUS_Z);
    const angle = Math.atan2(localZ / ISLAND_RADIUS_Z, localX / ISLAND_RADIUS_X);
    const shoreRadius = islandShoreRadius(angle);

    if (normalizedRadius < shoreRadius) {
      // We're over the island - check against terrain height
      const terrainY = islandHeight(localX, localZ);
      if (position.y <= terrainY) {
        return { hit: true, type: "land", groundY: terrainY };
      }
      return { hit: false, type: "land", groundY: terrainY };
    }

    // Over water - check against ocean surface
    const waterY = sampleOceanHeight(position.x, position.z, worldTime);
    if (position.y <= waterY) {
      return { hit: true, type: "water", groundY: waterY };
    }
    return { hit: false, type: "water", groundY: waterY };
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
    for (const splash of this.splashes) {
      splash.spray.updateSpeed = speed;
      splash.mist.updateSpeed = speed;
    }
    for (const explosion of this.explosions) {
      explosion.craterSmoke.updateSpeed = speed;
      explosion.debrisParticles.updateSpeed = speed;
      explosion.fireParticles.updateSpeed = speed;
    }
  };

  /** Enhanced water splash with velocity-based directionality. */
  private createSplash(x: number, y: number, z: number, impactVelocity: Vector3): void {
    const material = new StandardMaterial("Mk45-water-impact-material", this.scene);
    material.disableLighting = true;
    material.diffuseColor = new Color3(.76, .91, .93);
    material.emissiveColor = new Color3(.34, .57, .60);
    material.alpha = 1;
    material.backFaceCulling = false;

    const plume = CreateSphere("Mk45-water-impact-plume", { diameter: 1, segments: 10 }, this.scene);
    plume.material = material;
    plume.isPickable = false;
    plume.position.set(x, y + .8, z);
    plume.scaling.set(.6, 1.5, .6);

    const ring = CreateTorus("Mk45-water-impact-ring", { diameter: 1, thickness: .09, tessellation: 24 }, this.scene);
    ring.material = material;
    ring.isPickable = false;
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y + .08, z);
    ring.scaling.set(.3, .3, .3);

    // Primary upward spray - high energy
    const spray = new ParticleSystem("Mk45-water-impact-spray", 96, this.scene);
    spray.particleTexture = this.sprayTexture;
    spray.emitter = new Vector3(x, y + .2, z);
    spray.minEmitBox = new Vector3(-.3, 0, -.3);
    spray.maxEmitBox = new Vector3(.3, .3, .3);
    spray.color1 = new Color4(.85, .97, 1, .98);
    spray.color2 = new Color4(.55, .80, .90, .75);
    spray.colorDead = new Color4(.78, .94, 1, 0);
    spray.minSize = .35;
    spray.maxSize = .95;
    spray.minLifeTime = .65;
    spray.maxLifeTime = 1.6;
    spray.emitRate = 0;
    spray.manualEmitCount = 80;
    spray.targetStopDuration = .08;
    // The spray direction includes a component from the incoming shell
    const impactSpeed = impactVelocity.length();
    const impactHorizScale = Math.min(1, impactSpeed / 400) * 2;
    spray.minEmitPower = 14;
    spray.maxEmitPower = 32;
    spray.direction1 = new Vector3(-1.5 + impactVelocity.x / impactSpeed * impactHorizScale, 1.2, -1.5 + impactVelocity.z / impactSpeed * impactHorizScale);
    spray.direction2 = new Vector3(1.5 + impactVelocity.x / impactSpeed * impactHorizScale, 3.5, 1.5 + impactVelocity.z / impactSpeed * impactHorizScale);
    spray.gravity = new Vector3(0, -22, 0);
    configureWeaponParticles(spray, this.scene);
    spray.start();

    // Secondary fine mist that hangs in the air
    const mist = new ParticleSystem("Mk45-water-impact-mist", 48, this.scene);
    mist.particleTexture = this.sprayTexture;
    mist.emitter = new Vector3(x, y + 1.5, z);
    mist.minEmitBox = new Vector3(-1, 0, -1);
    mist.maxEmitBox = new Vector3(1, 1, 1);
    mist.color1 = new Color4(.90, .96, 1, .42);
    mist.color2 = new Color4(.82, .93, .98, .28);
    mist.colorDead = new Color4(.85, .95, 1, 0);
    mist.minSize = 1.5;
    mist.maxSize = 3.5;
    mist.minLifeTime = 1.2;
    mist.maxLifeTime = 2.6;
    mist.emitRate = 0;
    mist.manualEmitCount = 32;
    mist.targetStopDuration = .04;
    mist.minEmitPower = 2;
    mist.maxEmitPower = 6;
    mist.direction1 = new Vector3(-1, .5, -1);
    mist.direction2 = new Vector3(1, 2, 1);
    mist.gravity = new Vector3(.8, -1.5, .4);
    mist.minInitialRotation = -Math.PI;
    mist.maxInitialRotation = Math.PI;
    mist.minAngularSpeed = -.15;
    mist.maxAngularSpeed = .15;
    configureWeaponParticles(mist, this.scene);
    mist.start();

    this.splashes.push({ plume, ring, material, spray, mist, position: new Vector3(x, y, z), age: 0 });
  }

  /** Create a dramatic land explosion with fireball, shockwave, debris and smoke. */
  private createLandExplosion(x: number, y: number, z: number, _impactVelocity: Vector3): void {
    // Fireball mesh
    const fireballMaterial = new StandardMaterial("Mk45-explosion-fireball-mat", this.scene);
    fireballMaterial.emissiveColor = new Color3(1, .65, .15);
    fireballMaterial.diffuseColor = new Color3(1, .5, .1);
    fireballMaterial.disableLighting = true;
    fireballMaterial.alpha = .92;
    fireballMaterial.backFaceCulling = false;

    const fireball = CreateSphere("Mk45-explosion-fireball", { diameter: 2, segments: 12 }, this.scene);
    fireball.material = fireballMaterial;
    fireball.isPickable = false;
    fireball.position.set(x, y + 1, z);

    // Ground shockwave ring
    const shockwaveMaterial = new StandardMaterial("Mk45-explosion-shockwave-mat", this.scene);
    shockwaveMaterial.emissiveColor = new Color3(.85, .65, .35);
    shockwaveMaterial.diffuseColor = new Color3(.7, .55, .3);
    shockwaveMaterial.disableLighting = true;
    shockwaveMaterial.alpha = .45;
    shockwaveMaterial.backFaceCulling = false;

    const shockwaveRing = CreateTorus("Mk45-explosion-shockwave", { diameter: 1, thickness: .2, tessellation: 32 }, this.scene);
    shockwaveRing.material = shockwaveMaterial;
    shockwaveRing.isPickable = false;
    shockwaveRing.rotation.x = Math.PI / 2;
    shockwaveRing.position.set(x, y + .15, z);

    // Explosion flash light
    const light = new PointLight("Mk45-explosion-light", new Vector3(x, y + 3, z), this.scene);
    light.diffuse = new Color3(1, .65, .2);
    light.specular = new Color3(1, .8, .4);
    light.range = 80;
    light.intensity = 12;

    // Dirt/debris particles flung upward and outward
    const debrisParticles = new ParticleSystem("Mk45-explosion-debris", 200, this.scene);
    debrisParticles.particleTexture = this.debrisTexture;
    debrisParticles.emitter = new Vector3(x, y + .5, z);
    debrisParticles.minEmitBox = new Vector3(-.5, 0, -.5);
    debrisParticles.maxEmitBox = new Vector3(.5, .5, .5);
    debrisParticles.color1 = new Color4(.45, .38, .28, 1);
    debrisParticles.color2 = new Color4(.32, .28, .22, .9);
    debrisParticles.colorDead = new Color4(.25, .22, .18, 0);
    debrisParticles.minSize = .15;
    debrisParticles.maxSize = .55;
    debrisParticles.minLifeTime = .8;
    debrisParticles.maxLifeTime = 2.2;
    debrisParticles.emitRate = 0;
    debrisParticles.manualEmitCount = 140;
    debrisParticles.targetStopDuration = .06;
    debrisParticles.minEmitPower = 18;
    debrisParticles.maxEmitPower = 42;
    debrisParticles.direction1 = new Vector3(-2, 2, -2);
    debrisParticles.direction2 = new Vector3(2, 5, 2);
    debrisParticles.gravity = new Vector3(0, -25, 0);
    debrisParticles.minAngularSpeed = -4;
    debrisParticles.maxAngularSpeed = 4;
    configureWeaponParticles(debrisParticles, this.scene);
    debrisParticles.start();

    // Fire/flash particles
    const fireParticles = new ParticleSystem("Mk45-explosion-fire", 128, this.scene);
    fireParticles.particleTexture = this.explosionTexture;
    fireParticles.emitter = new Vector3(x, y + 1, z);
    fireParticles.minEmitBox = new Vector3(-.8, 0, -.8);
    fireParticles.maxEmitBox = new Vector3(.8, .5, .8);
    fireParticles.addColorGradient(0, new Color4(1, .95, .7, 1));
    fireParticles.addColorGradient(.15, new Color4(1, .7, .2, .95));
    fireParticles.addColorGradient(.4, new Color4(1, .4, .05, .65));
    fireParticles.addColorGradient(.7, new Color4(.7, .2, .02, .3));
    fireParticles.addColorGradient(1, new Color4(.3, .1, .01, 0));
    fireParticles.minSize = 1.5;
    fireParticles.maxSize = 4.5;
    fireParticles.addSizeGradient(0, 1.5, 3);
    fireParticles.addSizeGradient(.3, 3, 6);
    fireParticles.addSizeGradient(.7, 4, 7);
    fireParticles.addSizeGradient(1, 5, 8);
    fireParticles.minLifeTime = .25;
    fireParticles.maxLifeTime = .75;
    fireParticles.emitRate = 0;
    fireParticles.manualEmitCount = 65;
    fireParticles.targetStopDuration = .04;
    fireParticles.minEmitPower = 6;
    fireParticles.maxEmitPower = 18;
    fireParticles.direction1 = new Vector3(-1.5, 1, -1.5);
    fireParticles.direction2 = new Vector3(1.5, 4, 1.5);
    fireParticles.gravity = new Vector3(0, -3, 0);
    fireParticles.minInitialRotation = -Math.PI;
    fireParticles.maxInitialRotation = Math.PI;
    fireParticles.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
    configureWeaponParticles(fireParticles, this.scene, ParticleSystem.BLENDMODE_ADD);
    fireParticles.start();

    // Thick crater smoke that lingers
    const craterSmoke = new ParticleSystem("Mk45-explosion-crater-smoke", 280, this.scene);
    craterSmoke.particleTexture = this.smokeTexture;
    craterSmoke.emitter = new Vector3(x, y + .8, z);
    craterSmoke.minEmitBox = new Vector3(-1, 0, -1);
    craterSmoke.maxEmitBox = new Vector3(1, .5, 1);
    craterSmoke.addColorGradient(0, new Color4(.42, .38, .32, .88), new Color4(.55, .48, .38, .82));
    craterSmoke.addColorGradient(.1, new Color4(.52, .48, .42, .72));
    craterSmoke.addColorGradient(.35, new Color4(.62, .58, .52, .45));
    craterSmoke.addColorGradient(.65, new Color4(.72, .70, .65, .22));
    craterSmoke.addColorGradient(1, new Color4(.82, .80, .78, 0));
    craterSmoke.addSizeGradient(0, .8, 1.5);
    craterSmoke.addSizeGradient(.15, 2.5, 4);
    craterSmoke.addSizeGradient(.4, 5, 8);
    craterSmoke.addSizeGradient(.7, 7, 10);
    craterSmoke.addSizeGradient(1, 9, 13);
    craterSmoke.minLifeTime = 1.5;
    craterSmoke.maxLifeTime = 4.5;
    craterSmoke.emitRate = 0;
    craterSmoke.manualEmitCount = 85;
    craterSmoke.targetStopDuration = .15;
    craterSmoke.minEmitPower = 4;
    craterSmoke.maxEmitPower = 14;
    craterSmoke.direction1 = new Vector3(-1.5, 1.5, -1.5);
    craterSmoke.direction2 = new Vector3(1.5, 5, 1.5);
    craterSmoke.gravity = new Vector3(1.2, .5, .4);
    craterSmoke.minInitialRotation = -Math.PI;
    craterSmoke.maxInitialRotation = Math.PI;
    craterSmoke.minAngularSpeed = -.3;
    craterSmoke.maxAngularSpeed = .3;
    configureWeaponParticles(craterSmoke, this.scene);
    craterSmoke.start();

    this.explosions.push({
      fireball, fireballMaterial, shockwaveRing, shockwaveMaterial,
      craterSmoke, debrisParticles, fireParticles, light,
      position: new Vector3(x, y, z), age: 0,
    });
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

function orientTracerAlongDirection(mesh: Mesh, direction: Vector3): void {
  const forward = direction.clone().normalize();
  // Cylinder default axis is Y, so we need to rotate Y-axis to point along forward
  const up = Vector3.Up();
  const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, forward))));
  const axis = Vector3.Cross(up, forward);
  if (axis.length() > 0.001) {
    axis.normalize();
    mesh.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
  }
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

/** A fiery, turbulent texture for the explosion fireball particles. */
function createExplosionTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture("Mk45-explosion-fire-texture", { width: size, height: size }, scene, false);
  texture.hasAlpha = true;
  const context = texture.getContext();
  const imageData = context.getImageData(0, 0, size, size);
  const data = imageData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + .5) / size * 2 - 1;
      const ny = (y + .5) / size * 2 - 1;
      const radius = Math.hypot(nx, ny);
      const core = Math.max(0, 1 - radius * 1.3);
      const edge = Math.max(0, 1 - radius);
      // Turbulent noise-like pattern using sine combinations
      const noise = Math.sin(nx * 7 + ny * 5) * .15 + Math.sin(nx * 13 - ny * 11) * .1;
      const alpha = Math.max(0, edge * (.7 + noise)) ** 1.2;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(255);
      data[offset + 1] = Math.round((180 + 75 * core) * Math.max(0, 1 - radius * .5));
      data[offset + 2] = Math.round(80 * core);
      data[offset + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  context.putImageData(imageData, 0, 0);
  texture.update();
  return texture;
}

/** A small, irregular debris chunk texture for dirt/rock fragments. */
function createDebrisTexture(scene: Scene): DynamicTexture {
  const size = 32;
  const texture = new DynamicTexture("Mk45-debris-chunk-texture", { width: size, height: size }, scene, false);
  texture.hasAlpha = true;
  const context = texture.getContext();
  const imageData = context.getImageData(0, 0, size, size);
  const data = imageData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + .5) / size * 2 - 1;
      const ny = (y + .5) / size * 2 - 1;
      const radius = Math.hypot(nx, ny);
      // Irregular shape with angular edges
      const angle = Math.atan2(ny, nx);
      const irregularity = 1 + .25 * Math.sin(angle * 3) + .15 * Math.sin(angle * 7 + 2);
      const shape = Math.max(0, 1 - radius * irregularity);
      const shade = .3 + .25 * Math.sin(x * .8 + y * .6);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((120 + 40 * shade));
      data[offset + 1] = Math.round((95 + 35 * shade));
      data[offset + 2] = Math.round((70 + 25 * shade));
      data[offset + 3] = Math.round(shape > 0.15 ? 220 : 0);
    }
  }
  context.putImageData(imageData, 0, 0);
  texture.update();
  return texture;
}
