import { CruiseMissileSimulation, sampleOceanHeight } from "@naval/shared";
import type { BoatSimulationState, CruiseMissileState, MissileFlightPhase } from "@naval/shared";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateLathe } from "@babylonjs/core/Meshes/Builders/latheBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";
import type { GraphicsQuality } from "../game/graphicsQuality";
import type { MissileLaunchBank, VlsLaunchCell } from "./destroyerVls";
import { configureWeaponParticles, createWeaponSmokeTexture, createWeaponFireTexture } from "./weaponParticles";

const LAUNCH_INTERVAL_SECONDS = 3.5;
const HATCH_OPEN_SECONDS = .34;
const MISSILE_LENGTH = 6.2;
const UP = Vector3.Up();
const WIND = new Vector3(2.4, .85, .7);
const BOOSTER_JET_LENGTH = 12;

export interface MissileTelemetry {
  readonly forwardRemaining: number;
  readonly aftRemaining: number;
  readonly cooldownSeconds: number;
  readonly activeMissiles: number;
  readonly lastLaunchBank: MissileLaunchBank | null;
  readonly phase: MissileFlightPhase | null;
}

interface PendingLaunch {
  readonly cell: VlsLaunchCell;
  age: number;
}

interface FlyingMissile {
  readonly node: TransformNode;
  readonly flight: CruiseMissileSimulation;
  readonly wings: readonly TransformNode[];
  readonly fins: readonly TransformNode[];
  readonly booster: Mesh;
  readonly flame: Mesh;
  readonly core: Mesh;
  readonly previousNozzle: Vector3;
  trailDistance: number;
  deckCloudTime: number;
  readonly cell: VlsLaunchCell;
  separated: boolean;
}

interface BoosterDebris { readonly mesh: Mesh; readonly velocity: Vector3; age: number }
interface Emission { readonly position: Vector3; readonly velocity: Vector3 }

/** Visual sea-trial launches. Flight coefficients are game values, not real weapon data. */
export class MissileVls {
  private readonly missiles: FlyingMissile[] = [];
  private readonly debris: BoosterDebris[] = [];
  private readonly spentCells = new Set<VlsLaunchCell>();
  private readonly hatchAges = new Map<VlsLaunchCell, number>();
  private readonly deckEmissions: Emission[] = [];
  private readonly ventEmissions: Emission[] = [];
  private readonly trailEmissions: Emission[] = [];
  private readonly cruiseEmissions: Emission[] = [];
  private readonly fireEmissions: Emission[] = [];
  private readonly ignitionEmissions: Emission[] = [];
  private readonly smokeTexture: DynamicTexture;
  private readonly fireTexture: DynamicTexture;
  private readonly deckSmoke: ParticleSystem;
  private readonly ventSmoke: ParticleSystem;
  private readonly trailSmoke: ParticleSystem;
  private readonly cruiseSmoke: ParticleSystem;
  private readonly fireParticles: ParticleSystem;
  private readonly ignitionFire: ParticleSystem;
  private readonly bodyPaint: StandardMaterial;
  private readonly darkPaint: StandardMaterial;
  private readonly boosterPaint: StandardMaterial;
  private readonly flamePaint: StandardMaterial;
  private readonly corePaint: StandardMaterial;
  private readonly launchLight: PointLight;
  private pending: PendingLaunch | null = null;
  private latest: CruiseMissileSimulation | null = null;
  private lastBank: MissileLaunchBank | null = null;
  private cooldown = 0;
  private qualityScale = .8;
  private effectDelta = 0;
  private deckRemainder = 0;
  private ventRemainder = 0;
  private fireRemainder = 0;
  private ignitionRemainder = 0;

  constructor(
    private readonly scene: Scene,
    private readonly ship: Mesh,
    private readonly cells: readonly VlsLaunchCell[],
    private readonly onIgnition: () => void,
  ) {
    this.bodyPaint = this.paint("Tomahawk-airframe", new Color3(.76, .78, .75));
    this.darkPaint = this.paint("Tomahawk-nozzle-and-bands", new Color3(.15, .17, .16));
    this.boosterPaint = this.paint("Tomahawk-booster", new Color3(.53, .55, .52));
    this.flamePaint = this.paint("VLS-booster-orange-flame", new Color3(1, .32, .045), true);
    this.flamePaint.alpha = .72;
    this.corePaint = this.paint("VLS-booster-white-hot-core", new Color3(1, .92, .64), true);
    this.corePaint.emissiveColor.set(7, 6.3, 4.2);
    this.flamePaint.emissiveColor.set(4.5, 1.8, .22);
    this.launchLight = new PointLight("Mk41-launch-illumination", Vector3.Zero(), scene);
    this.launchLight.diffuse = new Color3(1, .54, .15);
    this.launchLight.specular = new Color3(1, .72, .37);
    this.launchLight.range = 65;
    this.launchLight.intensity = 0;
    this.launchLight.includedOnlyMeshes = ship.getChildMeshes();
    this.smokeTexture = createWeaponSmokeTexture(scene, "VLS-billowing-smoke-density");
    this.fireTexture = createWeaponFireTexture(scene, "VLS-turbulent-fire-density");
    for (const material of [this.flamePaint, this.corePaint]) {
      material.diffuseTexture = this.fireTexture;
      material.emissiveTexture = this.fireTexture;
      material.useAlphaFromDiffuseTexture = true;
      material.alphaMode = Constants.ALPHA_ADD;
      material.disableDepthWrite = true;
    }
    this.deckSmoke = this.createSmoke("Mk41-deck-exhaust-cloud", 2_200, this.deckEmissions, "deck");
    this.ventSmoke = this.createSmoke("Mk41-hot-launch-pressure-billow", 900, this.ventEmissions, "vent");
    this.trailSmoke = this.createSmoke("Tomahawk-world-space-smoke-trail", 6_800, this.trailEmissions, "trail");
    this.cruiseSmoke = this.createSmoke("Tomahawk-faint-cruise-exhaust", 900, this.cruiseEmissions, "cruise");
    this.fireParticles = this.createFire(false);
    this.ignitionFire = this.createFire(true);
    this.scene.registerBeforeRender(this.synchronizeParticleTime);
  }

  get telemetry(): MissileTelemetry {
    return {
      forwardRemaining: this.cells.filter(cell => cell.bank === "forward" && !this.spentCells.has(cell)).length,
      aftRemaining: this.cells.filter(cell => cell.bank === "aft" && !this.spentCells.has(cell)).length,
      cooldownSeconds: this.cooldown,
      activeMissiles: this.missiles.length,
      lastLaunchBank: this.lastBank,
      phase: this.latest?.state.phase ?? null,
    };
  }

  get trackingState(): CruiseMissileState | null {
    return this.missiles.at(-1)?.flight.state ?? null;
  }

  launch(bank: MissileLaunchBank): boolean {
    if (this.cooldown > 0 || this.pending || this.missiles.length >= 12) return false;
    const cell = this.cells.find(candidate => candidate.bank === bank && !this.spentCells.has(candidate));
    if (!cell) return false;
    this.spentCells.add(cell);
    this.pending = { cell, age: 0 };
    this.hatchAges.set(cell, 0);
    this.cooldown = LAUNCH_INTERVAL_SECONDS;
    this.lastBank = bank;
    return true;
  }

  setQuality(quality: GraphicsQuality): void {
    this.qualityScale = quality === "High" ? 1 : quality === "Medium" ? .8 : .5;
  }

  update(deltaSeconds: number, shipState: BoatSimulationState): void {
    const delta = Math.max(0, Math.min(.1, deltaSeconds));
    this.effectDelta = delta;
    this.cooldown = Math.max(0, this.cooldown - delta);
    // These queues are consumed by Babylon during the following scene render.
    for (const queue of [this.deckEmissions, this.ventEmissions, this.trailEmissions, this.cruiseEmissions, this.fireEmissions, this.ignitionEmissions]) queue.length = 0;
    for (const [cell, age] of this.hatchAges) {
      const next = age + delta;
      this.hatchAges.set(cell, next);
      const open = smoothstep(Math.min(1, next / HATCH_OPEN_SECONDS));
      const close = next > 5 ? smoothstep(Math.min(1, (next - 5) / .85)) : 0;
      cell.hatchPivot.rotation.x = -1.65 * open * (1 - close);
      cell.hatchPivot.computeWorldMatrix(true);
      if (next >= 5.85) this.hatchAges.delete(cell);
    }
    if (this.pending) {
      this.pending.age += delta;
      if (this.pending.age >= HATCH_OPEN_SECONDS) {
        this.ignite(this.pending.cell, shipState);
        this.pending = null;
      }
    }

    let nearestBurningDistance = Infinity;
    // Keep the light's shader layout stable throughout ignition and burnout.
    this.launchLight.intensity = 0;
    for (let index = this.missiles.length - 1; index >= 0; index--) {
      const missile = this.missiles[index];
      missile.flight.update(delta);
      const state = missile.flight.state;
      missile.node.position.set(state.position.x, state.position.y, state.position.z);
      const worldDeck = Vector3.TransformCoordinates(missile.cell.launchPoint, this.ship.getWorldMatrix());
      const direction = new Vector3(state.direction.x, state.direction.y, state.direction.z);
      Quaternion.FromUnitVectorsToRef(UP, direction, missile.node.rotationQuaternion!);
      for (const wing of missile.wings) wing.scaling.x = Math.max(.015, state.wingDeployment);
      const finDeployment = smoothstep(Math.min(1, Math.max(0, (missile.node.position.y - worldDeck.y) / 6)));
      for (const fin of missile.fins) fin.scaling.x = Math.max(.015, finDeployment);
      const flicker = 1 + .09 * Math.sin(state.ageSeconds * 83) + .06 * Math.sin(state.ageSeconds * 137);
      const burning = state.boosterBurning;
      const fade = burning ? Math.min(1, state.ageSeconds / .08) : 0;
      const nozzleAboveDeck = missile.node.position.y > worldDeck.y + .25;
      missile.flame.setEnabled(burning && nozzleAboveDeck);
      missile.core.setEnabled(burning && nozzleAboveDeck);
      missile.flame.isVisible = missile.core.isVisible = burning && nozzleAboveDeck;
      // The soft crossed planes have no hard cone outline; vary width and length
      // independently so the incandescent jet pulses rather than scaling rigidly.
      missile.flame.scaling.set(1 + (flicker - 1) * 1.7, flicker * fade, 1 + (flicker - 1) * 1.7);
      missile.core.scaling.set(1 / flicker, (1 + (flicker - 1) * .6) * fade, 1 / flicker);
      const lightDistance = Vector3.DistanceSquared(missile.node.position, this.ship.position);
      if (burning && lightDistance < 120 ** 2 && lightDistance < nearestBurningDistance) {
        nearestBurningDistance = lightDistance;
        this.launchLight.position.copyFrom(missile.node.position);
        this.launchLight.position.y = Math.max(this.launchLight.position.y, Vector3.TransformCoordinates(missile.cell.launchPoint, this.ship.getWorldMatrix()).y + .7);
        this.launchLight.intensity = 6 * fade * flicker;
      }

      if (!state.boosterAttached && !missile.separated) this.separateBooster(missile);
      if (missile.deckCloudTime < 1.65) {
        missile.deckCloudTime += delta;
        this.emitDeckCloud(worldDeck, delta, missile.deckCloudTime);
      }
      // Start the column at the deck until the booster nozzle clears the cell.
      const nozzle = missile.node.position.clone();
      if (nozzle.y < worldDeck.y) nozzle.copyFrom(worldDeck);
      // Smoke condenses behind the luminous jet, leaving the bright flame and
      // slender airframe readable at the top of the dense exhaust column.
      const exhaust = burning ? nozzle.subtract(direction.scale(BOOSTER_JET_LENGTH * .72)) : nozzle;
      if (exhaust.y < worldDeck.y) exhaust.copyFrom(worldDeck);
      this.emitTrail(missile, exhaust, direction, delta);
      if (burning) this.emitFire(nozzle, direction, delta, missile.node.position.y < worldDeck.y);
      missile.previousNozzle.copyFrom(exhaust);
      if (state.phase === "expired") {
        missile.node.dispose();
        this.missiles.splice(index, 1);
      }
    }
    for (let index = this.debris.length - 1; index >= 0; index--) {
      const booster = this.debris[index];
      booster.age += delta;
      booster.velocity.y -= 9.81 * delta;
      const drag = Math.exp(-delta * .11);
      booster.velocity.scaleInPlace(drag);
      booster.mesh.position.addInPlace(booster.velocity.scale(delta));
      booster.mesh.rotate(Vector3.Right(), delta * 1.7);
      if (booster.age > 16 || booster.mesh.position.y < sampleOceanHeight(booster.mesh.position.x, booster.mesh.position.z, shipState.elapsedTime)) {
        booster.mesh.dispose();
        this.debris.splice(index, 1);
      }
    }
    this.deckSmoke.manualEmitCount = this.deckEmissions.length;
    this.ventSmoke.manualEmitCount = this.ventEmissions.length;
    this.trailSmoke.manualEmitCount = this.trailEmissions.length;
    this.cruiseSmoke.manualEmitCount = this.cruiseEmissions.length;
    this.fireParticles.manualEmitCount = this.fireEmissions.length;
    this.ignitionFire.manualEmitCount = this.ignitionEmissions.length;
  }

  dispose(): void {
    this.scene.unregisterBeforeRender(this.synchronizeParticleTime);
    for (const missile of this.missiles) missile.node.dispose();
    for (const booster of this.debris) booster.mesh.dispose();
    this.deckSmoke.dispose(false);
    this.ventSmoke.dispose(false);
    this.trailSmoke.dispose(false);
    this.cruiseSmoke.dispose(false);
    this.fireParticles.dispose(false);
    this.ignitionFire.dispose(false);
    this.smokeTexture.dispose();
    this.fireTexture.dispose();
    this.launchLight.dispose();
    for (const material of [this.bodyPaint, this.darkPaint, this.boosterPaint, this.flamePaint, this.corePaint]) material.dispose();
    this.missiles.length = this.debris.length = 0;
    this.pending = null;
    this.hatchAges.clear();
  }

  private ignite(cell: VlsLaunchCell, shipState: BoatSimulationState): void {
    this.ship.computeWorldMatrix(true);
    const deck = Vector3.TransformCoordinates(cell.launchPoint, this.ship.getWorldMatrix());
    const axis = Vector3.TransformNormal(UP, this.ship.getWorldMatrix()).normalize();
    const position = deck.subtract(axis.scale(MISSILE_LENGTH + .3));
    const flight = new CruiseMissileSimulation({
      position, direction: axis, headingRadians: shipState.heading,
      inheritedVelocity: { x: shipState.velocityX, y: 0, z: shipState.velocityZ },
    });
    const visual = this.createMissile();
    visual.node.position.copyFrom(position);
    Quaternion.FromUnitVectorsToRef(UP, axis, visual.node.rotationQuaternion!);
    this.missiles.push({
      ...visual, flight, cell,
      previousNozzle: deck.clone(),
      trailDistance: 0, deckCloudTime: 0, separated: false,
    });
    this.latest = flight;
    this.onIgnition();
  }

  private createMissile(): Pick<FlyingMissile, "node" | "booster" | "wings" | "fins" | "flame" | "core"> {
    const node = new TransformNode("Tomahawk-cruise-missile", this.scene);
    node.rotationQuaternion = Quaternion.Identity();
    const cylinder = (name: string, diameter: number, height: number, y: number, material: StandardMaterial, top = diameter) => {
      const mesh = CreateCylinder(name, { diameterBottom: diameter, diameterTop: top, height, tessellation: 16 }, this.scene);
      mesh.parent = node; mesh.position.y = y; mesh.material = material; mesh.isPickable = false;
      return mesh;
    };
    const booster = cylinder("Tomahawk-launch-booster", .53, 1.18, .59, this.boosterPaint);
    const nozzle = cylinder("Tomahawk-exhaust-nozzle", .34, .16, .08, this.darkPaint, .26);
    nozzle.setParent(booster);
    cylinder("Tomahawk-cruise-body", .52, 4.15, 3.24, this.bodyPaint);
    const nose = CreateLathe("Tomahawk-ogive-nose", {
      shape: [new Vector3(.26, 0, 0), new Vector3(.245, .2, 0), new Vector3(.19, .46, 0),
        new Vector3(.10, .70, 0), new Vector3(.015, .89, 0), new Vector3(0, .92, 0)],
      tessellation: 24, cap: Mesh.CAP_START,
    }, this.scene);
    nose.parent = node; nose.position.y = 5.31; nose.material = this.bodyPaint; nose.isPickable = false;
    cylinder("Tomahawk-forward-band", .524, .095, 5.25, this.darkPaint);
    cylinder("Tomahawk-booster-coupling", .542, .075, 1.2, this.darkPaint);
    cylinder("Tomahawk-airframe-aft-seam", .524, .028, 2.15, this.boosterPaint);
    cylinder("Tomahawk-airframe-forward-seam", .524, .028, 4.55, this.boosterPaint);
    const intake = CreateBox("Tomahawk-folded-engine-inlet", { width: .22, height: .38, depth: .065 }, this.scene);
    intake.parent = node; intake.position.set(0, 2.38, -.265); intake.material = this.darkPaint; intake.isPickable = false;
    const fins: TransformNode[] = [];
    for (let index = 0; index < 4; index++) {
      const pivot = new TransformNode("Tomahawk-folding-tail-fin", this.scene);
      pivot.parent = node;
      pivot.position.set(Math.cos(index * Math.PI / 2) * .24, 1.6, Math.sin(index * Math.PI / 2) * .24);
      pivot.rotation.y = -index * Math.PI / 2;
      pivot.scaling.x = .015;
      const fin = CreateBox("Tomahawk-tail-fin", { width: .52, height: .58, depth: .035 }, this.scene);
      fin.parent = pivot; fin.position.x = .17;
      fin.material = this.bodyPaint; fin.isPickable = false;
      fins.push(pivot);
    }
    const wings: TransformNode[] = [];
    for (const side of [-1, 1]) {
      const pivot = new TransformNode("Tomahawk-wing-root", this.scene);
      pivot.parent = node; pivot.position.set(side * .23, 3.37, 0);
      const wing = CreateBox("Tomahawk-deploying-wing", { width: 1.08, height: .55, depth: .045 }, this.scene);
      wing.parent = pivot; wing.position.x = side * .54; wing.material = this.bodyPaint; wing.isPickable = false;
      // Scale about the root, so extension never stretches across the fuselage.
      pivot.scaling.x = .015;
      wings.push(pivot);
    }
    const jet = (name: string, width: number, length: number, paint: StandardMaterial): Mesh => {
      const planes = Array.from({ length: 3 }, (_, index) => {
        const plane = CreatePlane(`${name}${index ? `-lobe-${index}` : ""}`, { width, height: length }, this.scene);
        plane.material = paint; plane.isPickable = false;
        plane.renderingGroupId = 2;
        plane.rotation.y = index * Math.PI / 3;
        return plane;
      });
      const root = planes[0]; root.parent = node; root.position.y = -length * .47;
      for (const plane of planes.slice(1)) plane.parent = root;
      return root;
    };
    const flame = jet("Tomahawk-booster-flame-envelope", 1.75, BOOSTER_JET_LENGTH, this.flamePaint);
    const core = jet("Tomahawk-booster-incandescent-core", .72, BOOSTER_JET_LENGTH * .78, this.corePaint);
    flame.setEnabled(false); core.setEnabled(false);
    flame.isVisible = core.isVisible = false;
    return { node, booster, wings, fins, flame, core };
  }

  private separateBooster(missile: FlyingMissile): void {
    missile.booster.computeWorldMatrix(true);
    missile.booster.setParent(null);
    const state = missile.flight.state;
    this.debris.push({ mesh: missile.booster, age: 0,
      velocity: new Vector3(state.velocity.x - state.direction.x * 12, state.velocity.y - state.direction.y * 12, state.velocity.z - state.direction.z * 12),
    });
    missile.separated = true;
  }

  private emitDeckCloud(origin: Vector3, delta: number, age: number): void {
    this.deckRemainder += delta * 350 * this.qualityScale * Math.max(0, 1 - age / 1.7);
    const count = Math.floor(this.deckRemainder); this.deckRemainder -= count;
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 8 + Math.random() * 14;
      this.deckEmissions.push({
        position: origin.add(new Vector3(Math.cos(angle) * .6, .2 + Math.random() * .7, Math.sin(angle) * .6)),
        velocity: new Vector3(Math.cos(angle) * speed, 1 + Math.random() * 5, Math.sin(angle) * speed),
      });
    }
    // A brief hot, tan pressure billow rises above the cold white cloud rolling
    // across the deck, as seen in Mk 41 hot-launch photography.
    this.ventRemainder += delta * 170 * this.qualityScale * Math.max(0, 1 - age / .85);
    const vents = Math.floor(this.ventRemainder); this.ventRemainder -= vents;
    for (let index = 0; index < vents; index++) {
      const angle = Math.random() * Math.PI * 2;
      this.ventEmissions.push({
        position: origin.add(new Vector3(Math.cos(angle) * 1.1, 1 + Math.random() * 3.5, Math.sin(angle) * 1.1)),
        velocity: new Vector3(Math.cos(angle) * (3 + Math.random() * 6), 10 + Math.random() * 12, Math.sin(angle) * (3 + Math.random() * 6)),
      });
    }
    this.ignitionRemainder += delta * 230 * this.qualityScale * Math.max(0, 1 - age / .55);
    const flames = Math.floor(this.ignitionRemainder); this.ignitionRemainder -= flames;
    for (let index = 0; index < flames; index++) {
      this.ignitionEmissions.push({
        position: origin.add(new Vector3((Math.random() - .5) * .55, .35 + Math.random() * 1.2, (Math.random() - .5) * .55)),
        velocity: new Vector3((Math.random() - .5) * 5, 12 + Math.random() * 20, (Math.random() - .5) * 5),
      });
    }
  }

  private emitTrail(missile: FlyingMissile, nozzle: Vector3, axis: Vector3, delta: number): void {
    const boost = missile.flight.state.boosterBurning;
    const distance = Vector3.Distance(missile.previousNozzle, nozzle);
    const spacing = (boost ? .62 : 10) / this.qualityScale;
    const carriedDistance = missile.trailDistance;
    const count = Math.min(80, Math.floor((distance + carriedDistance) / spacing));
    missile.trailDistance = (distance + missile.trailDistance) % spacing;
    for (let index = 0; index < count; index++) {
      const t = Math.min(1, (spacing - carriedDistance + index * spacing) / Math.max(.001, distance));
      const point = Vector3.Lerp(missile.previousNozzle, nozzle, t);
      // Leave exhaust at its historical position; it never follows the vessel.
      (boost ? this.trailEmissions : this.cruiseEmissions).push({ position: point,
        velocity: new Vector3((Math.random() - .5) * 2.6, 1.1 + Math.random() * 2, (Math.random() - .5) * 2.6),
      });
      if (boost && missile.flight.state.ageSeconds < 2.2) {
        this.trailEmissions.push({ position: point.add(new Vector3((Math.random() - .5) * 1.1, 0, (Math.random() - .5) * 1.1)),
          velocity: axis.scale(-1.5).add(new Vector3(0, 2, 0)),
        });
      }
    }
    // Retain a stationary base plume during the first moment before motion builds.
    if (distance < .1 && boost && delta > 0) this.trailEmissions.push({ position: nozzle.clone(), velocity: new Vector3(0, 1, 0) });
  }

  private emitFire(nozzle: Vector3, axis: Vector3, delta: number, venting: boolean): void {
    this.fireRemainder += delta * 340 * this.qualityScale;
    const count = Math.floor(this.fireRemainder); this.fireRemainder -= count;
    for (let index = 0; index < count; index++) {
      this.fireEmissions.push({
        position: nozzle.add(axis.scale(venting ? .35 + Math.random() * .6 : -Math.random() * BOOSTER_JET_LENGTH * .75)),
        velocity: axis.scale(venting ? 6 + Math.random() * 8 : -35 - Math.random() * 35).add(new Vector3((Math.random() - .5) * 3, 0, (Math.random() - .5) * 3)),
      });
    }
  }

  private createSmoke(name: string, capacity: number, queue: Emission[], layer: "deck" | "vent" | "trail" | "cruise"): ParticleSystem {
    const deck = layer === "deck", hot = layer === "vent", thin = layer === "cruise";
    const smoke = new ParticleSystem(name, capacity, this.scene);
    smoke.particleTexture = this.smokeTexture;
    smoke.emitter = Vector3.Zero();
    smoke.emitRate = 0; smoke.manualEmitCount = 0;
    smoke.isLocal = false;
    smoke.minLifeTime = thin ? 2 : hot ? 6 : deck ? 9 : 14; smoke.maxLifeTime = thin ? 4 : hot ? 10 : deck ? 15 : 23;
    smoke.minSize = smoke.maxSize = 1;
    smoke.minEmitPower = smoke.maxEmitPower = 1;
    smoke.minInitialRotation = 0; smoke.maxInitialRotation = Math.PI * 2;
    smoke.minAngularSpeed = -.19; smoke.maxAngularSpeed = .19;
    smoke.updateSpeed = 1 / 60;
    smoke.addSizeGradient(0, thin ? .25 : hot ? 2.8 : deck ? 2.8 : 1.25, thin ? .4 : hot ? 4.2 : deck ? 4.8 : 2);
    smoke.addSizeGradient(.06, thin ? .6 : hot ? 5.5 : deck ? 6 : 3.1, thin ? 1 : hot ? 8 : deck ? 9 : 4.8);
    smoke.addSizeGradient(.35, thin ? 1.2 : hot ? 10 : deck ? 13 : 7.5, thin ? 2 : hot ? 15 : deck ? 19 : 11);
    smoke.addSizeGradient(1, thin ? 2.5 : hot ? 18 : deck ? 24 : 17, thin ? 4 : hot ? 25 : deck ? 32 : 25);
    smoke.addColorGradient(0, thin ? new Color4(.94, .95, .93, .16) : hot ? new Color4(.62, .49, .30, .92) : new Color4(.94, .94, .89, .94),
      thin ? new Color4(.94, .95, .93, .12) : hot ? new Color4(.81, .68, .44, .98) : new Color4(1, .99, .95, .98));
    smoke.addColorGradient(.09, hot ? new Color4(.76, .65, .47, .88) : new Color4(.94, .94, .90, thin ? .13 : .90));
    smoke.addColorGradient(.4, new Color4(.89, .90, .87, thin ? .07 : hot ? .55 : .67));
    smoke.addColorGradient(.8, new Color4(.94, .95, .93, thin ? .015 : .17));
    smoke.addColorGradient(1, new Color4(.94, .95, .93, 0));
    this.attachEmissionQueue(smoke, queue);
    const defaultUpdate = smoke.updateFunction;
    smoke.updateFunction = particles => {
      const dt = this.effectDelta;
      for (const particle of particles) {
        const damping = 1 - Math.exp(-dt * (deck ? 1.45 : hot ? .9 : .35));
        const rise = hot ? 2.8 : deck ? 1.5 : 1.1;
        particle.direction.x += (WIND.x - particle.direction.x) * damping;
        particle.direction.y += (rise - particle.direction.y) * damping;
        particle.direction.z += (WIND.z - particle.direction.z) * damping;
        // Slow, spatially varying eddies break the column into rolling billows.
        particle.direction.x += Math.sin(particle.position.y * .24 + particle.age * .9) * dt * 1.1;
        particle.direction.z += Math.cos(particle.position.y * .19 + particle.age * .8) * dt * .9;
      }
      defaultUpdate(particles);
    };
    configureWeaponParticles(smoke, this.scene);
    smoke.start();
    return smoke;
  }

  private createFire(ignition: boolean): ParticleSystem {
    const fire = new ParticleSystem(ignition ? "Mk41-cell-ignition-fire" : "Tomahawk-turbulent-booster-fire", ignition ? 220 : 600, this.scene);
    fire.particleTexture = this.fireTexture; fire.emitter = Vector3.Zero();
    fire.emitRate = 0; fire.manualEmitCount = 0;
    fire.isLocal = false;
    fire.minLifeTime = ignition ? .12 : .06; fire.maxLifeTime = ignition ? .3 : .18;
    fire.minSize = ignition ? 1.2 : .38; fire.maxSize = ignition ? 2.5 : 1.2;
    fire.minScaleY = 1.4; fire.maxScaleY = 2.5;
    fire.minInitialRotation = -Math.PI; fire.maxInitialRotation = Math.PI;
    fire.minEmitPower = fire.maxEmitPower = 1;
    fire.updateSpeed = 1 / 60;
    fire.addColorGradient(0, new Color4(4, 3.5, 2.3, 1));
    fire.addColorGradient(.35, new Color4(3.2, 1.7, .3, .9));
    fire.addColorGradient(.7, new Color4(1.8, .45, .035, .5));
    fire.addColorGradient(1, new Color4(.75, .12, .01, 0));
    fire.addSizeGradient(0, ignition ? 1.2 : .38, ignition ? 2.5 : 1.2);
    fire.addSizeGradient(1, ignition ? 3 : 1.6, ignition ? 4.5 : 2.4);
    this.attachEmissionQueue(fire, ignition ? this.ignitionEmissions : this.fireEmissions);
    configureWeaponParticles(fire, this.scene, ParticleSystem.BLENDMODE_ADD);
    fire.start();
    return fire;
  }

  private attachEmissionQueue(system: ParticleSystem, queue: Emission[]): void {
    let emission: Emission | undefined;
    system.startPositionFunction = (_world, position) => {
      emission = queue.pop();
      position.copyFrom(emission?.position ?? Vector3.Zero());
    };
    system.startDirectionFunction = (_world, direction) => {
      direction.copyFrom(emission?.velocity ?? Vector3.Zero());
    };
  }

  private readonly synchronizeParticleTime = (): void => {
    // Match the bounded game clock even after browser throttling or a slow frame.
    const speed = this.effectDelta / (this.scene.getAnimationRatio() || 1);
    for (const system of [this.deckSmoke, this.ventSmoke, this.trailSmoke, this.cruiseSmoke, this.fireParticles, this.ignitionFire]) system.updateSpeed = speed;
  };

  private paint(name: string, color: Color3, emissive = false): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.specularColor = emissive ? Color3.Black() : new Color3(.12, .12, .12);
    if (emissive) {
      material.disableLighting = true; material.emissiveColor = color;
      material.alphaMode = Constants.ALPHA_COMBINE; material.backFaceCulling = false;
    }
    return material;
  }
}

function smoothstep(t: number): number { return t * t * (3 - 2 * t); }
