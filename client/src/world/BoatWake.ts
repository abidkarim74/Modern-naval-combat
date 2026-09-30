import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";
import { sampleOceanHeight } from "@naval/shared";

const HISTORY_LENGTH = 96;
const TRAIL_COUNT = 5;
const POINTS_PER_TRAIL = HISTORY_LENGTH * 2;
const VERTEX_COUNT = POINTS_PER_TRAIL * TRAIL_COUNT;
const SAMPLE_INTERVAL_SECONDS = 0.25;
const BOAT_STERN_OFFSET_METERS = 75;
const BOW_SAMPLES = 32;
const BOW_TRAILS = 4;
const BOW_VERTICES_PER_TRAIL = BOW_SAMPLES * 2;

export class BoatWake {
  private readonly mesh: Mesh;
  private readonly bowMesh: Mesh;
  private readonly bowPositions = new Float32Array(BOW_TRAILS * BOW_VERTICES_PER_TRAIL * 3);
  private readonly bowColors = new Float32Array(BOW_TRAILS * BOW_VERTICES_PER_TRAIL * 4);
  private readonly positions = new Float32Array(VERTEX_COUNT * 3);
  private readonly colors = new Float32Array(VERTEX_COUNT * 4);
  private readonly historyX = new Float64Array(HISTORY_LENGTH);
  private readonly historyZ = new Float64Array(HISTORY_LENGTH);
  private readonly historyHeading = new Float32Array(HISTORY_LENGTH);
  private readonly historySpeed = new Float32Array(HISTORY_LENGTH);
  private readonly historyTime = new Float32Array(HISTORY_LENGTH);
  private historyStart = 0;
  private historyCount = 0;
  private nextSampleTime = 0;

  constructor(scene: Scene) {
    this.mesh = new Mesh("boat-wake", scene);
    this.mesh.setVerticesData(VertexBuffer.PositionKind, this.positions, true, 3);
    this.mesh.setVerticesData(VertexBuffer.ColorKind, this.colors, true, 4);
    const uvs = new Float32Array(VERTEX_COUNT * 2);
    for (let trail = 0; trail < TRAIL_COUNT; trail += 1) {
      for (let point = 0; point < HISTORY_LENGTH; point += 1) {
        const vertex = trail * POINTS_PER_TRAIL + point * 2;
        uvs[vertex * 2] = 0;
        uvs[vertex * 2 + 1] = point * .34;
        uvs[(vertex + 1) * 2] = 1;
        uvs[(vertex + 1) * 2 + 1] = point * .34;
      }
    }
    this.mesh.setVerticesData(VertexBuffer.UVKind, uvs, false, 2);
    this.mesh.setIndices(createIndices());
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;

    const material = new StandardMaterial("boat-wake-material", scene);
    material.disableLighting = true;
    material.diffuseColor = new Color3(0.92, 0.97, 0.99);
    material.emissiveColor = new Color3(0.28, 0.32, 0.34);
    material.diffuseTexture = createFoamTexture(scene);
    material.useAlphaFromDiffuseTexture = true;
    material.alpha = 0.86;
    this.mesh.useVertexColors = true;
    this.mesh.hasVertexAlpha = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    this.mesh.material = material;
    this.mesh.isVisible = false;
    this.bowMesh = new Mesh("destroyer-bow-wave", scene);
    this.bowMesh.setVerticesData(VertexBuffer.PositionKind, this.bowPositions, true, 3);
    this.bowMesh.setVerticesData(VertexBuffer.ColorKind, this.bowColors, true, 4);
    const bowUvs: number[] = [];
    const bowIndices: number[] = [];
    for (let trail = 0; trail < BOW_TRAILS; trail++) for (let i = 0; i < BOW_SAMPLES; i++) {
      bowUvs.push(0, i * .32, 1, i * .32);
      const a = trail * BOW_VERTICES_PER_TRAIL + i * 2;
      if (i < BOW_SAMPLES - 1) bowIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.bowMesh.setVerticesData(VertexBuffer.UVKind, bowUvs);
    this.bowMesh.setIndices(bowIndices);
    this.bowMesh.material = material;
    this.bowMesh.useVertexColors = true;
    this.bowMesh.hasVertexAlpha = true;
    this.bowMesh.isPickable = false;
    this.bowMesh.alwaysSelectAsActiveMesh = true;
    this.bowMesh.isVisible = false;
  }

  update(state: BoatSimulationState, timeSeconds: number): void {
    this.updateBowWave(state, timeSeconds);
    if (timeSeconds >= this.nextSampleTime) {
      this.recordPoint(state, timeSeconds);
      this.nextSampleTime = timeSeconds + SAMPLE_INTERVAL_SECONDS;
    }

    this.mesh.isVisible = this.historyCount >= 3 && this.hasRecentMovingSample(timeSeconds);
    if (!this.mesh.isVisible) return;

    for (let trailIndex = 0; trailIndex < TRAIL_COUNT; trailIndex += 1) {
      const side = [-1.55, -1, 0, 1, 1.55][trailIndex] ?? 0;
      const trailBase = trailIndex * POINTS_PER_TRAIL;

      for (let pointIndex = 0; pointIndex < HISTORY_LENGTH; pointIndex += 1) {
        const historyIndex = this.getHistoryIndex(pointIndex);
        const x = this.historyX[historyIndex] ?? state.positionX;
        const z = this.historyZ[historyIndex] ?? state.positionZ;
        const heading = this.historyHeading[historyIndex] ?? state.heading;
        const speed = this.historySpeed[historyIndex] ?? state.speed;
        const ageSeconds = Math.max(0, timeSeconds - (this.historyTime[historyIndex] ?? timeSeconds));
        const rightX = Math.cos(heading);
        const rightZ = -Math.sin(heading);
        const wakeOffset = 3.7 + ageSeconds * speed * .115;
        const wakeCenterX = x + rightX * side * wakeOffset;
        const wakeCenterZ = z + rightZ * side * wakeOffset;
        const outerTrail = Math.abs(side) > 1.1;
        const ribbonWidth = 1.8 + ageSeconds * speed * (outerTrail ? .035 : .045);
        const alpha = clamp(speed / 9, 0, 1) * Math.exp(-ageSeconds / 12.5) *
          (side === 0 ? .72 : outerTrail ? .66 : .92);
        const firstVertex = trailBase + pointIndex * 2;

        this.writeVertex(firstVertex, wakeCenterX - rightX * ribbonWidth, wakeCenterZ - rightZ * ribbonWidth, timeSeconds, alpha);
        this.writeVertex(firstVertex + 1, wakeCenterX + rightX * ribbonWidth, wakeCenterZ + rightZ * ribbonWidth, timeSeconds, alpha * 0.72);
      }
    }

    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
  }

  private updateBowWave(state: BoatSimulationState, time: number): void {
    const strength = clamp(Math.abs(state.forwardSpeed) / 9, 0, 1);
    this.bowMesh.isVisible = strength > .06;
    if (!this.bowMesh.isVisible) return;
    const movementHeading = state.heading + (state.forwardSpeed < 0 ? Math.PI : 0);
    const forwardX = Math.sin(movementHeading), forwardZ = Math.cos(movementHeading);
    for (let trail = 0; trail < BOW_TRAILS; trail++) for (let i = 0; i < BOW_SAMPLES; i++) {
      const t = i / (BOW_SAMPLES - 1);
      const outer = trail % 2 === 1;
      const side = trail < 2 ? -1 : 1;
      const z = outer ? 76 - t * 106 : 76 - t * 59;
      const edge = outer
        ? 1 + t * 42 + (Math.sin(t * 18 - time * 1.4) * 2.2 + Math.sin(t * 39 + time * 1.8) * .8) * t
        : .85 + 8.0 * Math.pow(Math.sin(t * Math.PI / 2), 1.25);
      const width = (outer ? 1.2 + t * 3.3 : 2.2 + t * 4.3) * strength;
      const envelope = outer
        ? Math.sin(Math.PI * Math.min(t / .28, 1) / 2) * Math.pow(1 - t, .7)
        : Math.sin(Math.PI * Math.min(t / .16, 1) / 2) * Math.pow(1 - t, .35);
      const breakup = outer ? .22 + .78 * Math.pow(Math.sin(t * 47 - time * 2.3) * Math.sin(t * 19 + time * .9), 2) :
        .72 + .28 * Math.pow(Math.sin(t * 36 - time * 2.6), 2);
      for (let j = 0; j < 2; j++) {
        const x = side * (edge + j * width);
        const vertex = trail * BOW_VERTICES_PER_TRAIL + i * 2 + j;
        const wx = state.positionX + forwardX * z + forwardZ * x;
        const wz = state.positionZ + forwardZ * z - forwardX * x;
        const positionOffset = vertex * 3;
        this.bowPositions[positionOffset] = wx;
        const crestHeight = outer
          ? .18 + .55 * strength * envelope
          : .22 + 1.15 * strength * envelope;
        this.bowPositions[positionOffset + 1] = sampleOceanHeight(wx, wz, time) +
          (j === 0 ? crestHeight : .12);
        this.bowPositions[positionOffset + 2] = wz;
        const colorOffset = vertex * 4;
        this.bowColors[colorOffset] = .92;
        this.bowColors[colorOffset + 1] = .98;
        this.bowColors[colorOffset + 2] = .96;
        this.bowColors[colorOffset + 3] = strength * envelope * breakup *
          (outer ? (j === 0 ? .60 : .12) : (j === 0 ? .92 : .18));
      }
    }
    this.bowMesh.updateVerticesData(VertexBuffer.PositionKind, this.bowPositions, false, false);
    this.bowMesh.updateVerticesData(VertexBuffer.ColorKind, this.bowColors, false, false);
  }

  private recordPoint(state: BoatSimulationState, timeSeconds: number): void {
    const movementHeading = state.speed > .1
      ? Math.atan2(state.velocityX, state.velocityZ)
      : state.heading + (state.forwardSpeed < 0 ? Math.PI : 0);
    this.historyX[this.historyStart] = state.positionX - Math.sin(movementHeading) * BOAT_STERN_OFFSET_METERS;
    this.historyZ[this.historyStart] = state.positionZ - Math.cos(movementHeading) * BOAT_STERN_OFFSET_METERS;
    this.historyHeading[this.historyStart] = movementHeading;
    this.historySpeed[this.historyStart] = state.speed;
    this.historyTime[this.historyStart] = timeSeconds;
    this.historyStart = (this.historyStart + 1) % HISTORY_LENGTH;
    this.historyCount = Math.min(this.historyCount + 1, HISTORY_LENGTH);
    if (this.historyCount === 1) this.nextSampleTime = timeSeconds + SAMPLE_INTERVAL_SECONDS;
  }

  private hasRecentMovingSample(timeSeconds: number): boolean {
    for (let i = 0; i < this.historyCount; i++) {
      if (this.historySpeed[i] > .5 && timeSeconds - this.historyTime[i] < 24) return true;
    }
    return false;
  }

  private getHistoryIndex(pointIndex: number): number {
    if (this.historyCount < 1) return 0;
    const oldestIndex = (this.historyStart - this.historyCount + HISTORY_LENGTH) % HISTORY_LENGTH;
    const availableOffset = Math.floor((pointIndex / (HISTORY_LENGTH - 1)) * (this.historyCount - 1));
    return (oldestIndex + availableOffset) % HISTORY_LENGTH;
  }

  private writeVertex(vertexIndex: number, x: number, z: number, timeSeconds: number, alpha: number): void {
    const positionOffset = vertexIndex * 3;
    this.positions[positionOffset] = x;
    this.positions[positionOffset + 1] = sampleOceanHeight(x, z, timeSeconds) + 0.065;
    this.positions[positionOffset + 2] = z;

    const colorOffset = vertexIndex * 4;
    this.colors[colorOffset] = 0.9;
    this.colors[colorOffset + 1] = 0.98;
    this.colors[colorOffset + 2] = 1;
    this.colors[colorOffset + 3] = clamp(alpha, 0, 0.85);
  }
}

function createIndices(): number[] {
  const indices: number[] = [];
  for (let trailIndex = 0; trailIndex < TRAIL_COUNT; trailIndex += 1) {
    const base = trailIndex * POINTS_PER_TRAIL;
    for (let pointIndex = 0; pointIndex < HISTORY_LENGTH - 1; pointIndex += 1) {
      const current = base + pointIndex * 2;
      const next = current + 2;
      indices.push(current, current + 1, next, current + 1, next + 1, next);
    }
  }
  return indices;
}

function createFoamTexture(scene: Scene): DynamicTexture {
    const texture = new DynamicTexture("aerated-wake-foam", { width: 256, height: 256 }, scene, true);
  texture.hasAlpha = true;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  const context = texture.getContext();
  let seed = 731;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 1100; i += 1) {
    const x = random() * 256;
    const y = random() * 256;
    const radius = 1 + random() * 5;
    const edgeFade = Math.sin(x / 256 * Math.PI);
    context.fillStyle = `rgba(236,250,250,${edgeFade * (.12 + random() * .5)})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  texture.update();
  return texture;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
