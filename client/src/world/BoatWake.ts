import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";
import { OCEAN_WAVES } from "@naval/shared";
import type { RendererBackend } from "../engine/createRenderer";
import type { GraphicsQualitySettings } from "../game/graphicsQuality";
import oceanVertexGlsl from "./shaders/ocean.vertex.glsl?raw";
import oceanVertexWgsl from "./shaders/ocean.vertex.wgsl?raw";
import wakeFragmentGlsl from "./shaders/wake.fragment.glsl?raw";
import wakeFragmentWgsl from "./shaders/wake.fragment.wgsl?raw";

const HISTORY_LENGTH = 240;
const SAMPLE_INTERVAL_SECONDS = .20;
const TRAILS = [-1.6, -1, 0, 1, 1.6];
const CROSS_SAMPLES = 9;
const BOW_SAMPLES = 48;
const BOW_TRAILS = 4;
const VERTICES = HISTORY_LENGTH * CROSS_SAMPLES * TRAILS.length;
const BOW_VERTICES = BOW_SAMPLES * CROSS_SAMPLES * BOW_TRAILS;
const CROSS_ENVELOPES = Array.from({ length: CROSS_SAMPLES }, (_, index) => Math.sin(index / (CROSS_SAMPLES - 1) * Math.PI));
const HULL_HALF_BEAM_STATIONS = [[-78, 7], [-60, 8.4], [-30, 8.5], [25, 8.3], [43, 6.8], [60, 4.0], [78, .2]] as const;

export class BoatWake {
  private readonly material: ShaderMaterial;
  private readonly boatPosition = new Vector3();
  private readonly waterGrid = new Vector4(0, 0, 96, 3);
  private readonly mesh: Mesh;
  private readonly bowMesh: Mesh;
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 4);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly bowPositions = new Float32Array(BOW_VERTICES * 3);
  private readonly bowColors = new Float32Array(BOW_VERTICES * 4);
  private readonly historyX = new Float64Array(HISTORY_LENGTH);
  private readonly historyZ = new Float64Array(HISTORY_LENGTH);
  private readonly historyHeading = new Float32Array(HISTORY_LENGTH);
  private readonly historySpeed = new Float32Array(HISTORY_LENGTH);
  private readonly historyTime = new Float64Array(HISTORY_LENGTH);
  private readonly historyDistance = new Float64Array(HISTORY_LENGTH);
  private historyStart = 0;
  private historyCount = 0;
  private nextSampleTime = 0;
  private nextTrailUpdateTime = 0;

  constructor(scene: Scene, backend: RendererBackend) {
    const isWebGpu = backend === "WebGPU";
    this.material = new ShaderMaterial("aerated-breaking-water", scene, {
      vertexSource: isWebGpu ? oceanVertexWgsl : oceanVertexGlsl,
      fragmentSource: isWebGpu ? wakeFragmentWgsl : wakeFragmentGlsl,
    }, {
      attributes: ["position", "uv", "color"],
      uniforms: ["world", "worldViewProjection", "time", "boatPosition", "boatHeading", "boatSpeed", "waterGrid",
        ...OCEAN_WAVES.flatMap((_, index) => [`wave${index}`, `waveFrequency${index}`, `wavePhase${index}`])],
      samplers: ["foamSampler"],
      defines: ["WAKE_SURFACE"],
      needAlphaBlending: true,
      shaderLanguage: isWebGpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    });
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.setVector4("waterGrid", this.waterGrid);
    this.material.setTexture("foamSampler", createFoamTexture(scene));
    for (let index = 0; index < OCEAN_WAVES.length; index++) {
      const wave = OCEAN_WAVES[index];
      this.material.setVector4(`wave${index}`, new Vector4(wave.directionX, wave.directionZ, wave.waveNumber, wave.amplitude));
      this.material.setFloat(`waveFrequency${index}`, wave.angularFrequency);
      this.material.setFloat(`wavePhase${index}`, wave.phase);
    }
    this.mesh = this.createRibbon(scene, "world-space-ship-wake", this.positions, this.colors, this.uvs, HISTORY_LENGTH, TRAILS.length);
    this.mesh.material = this.material;
    const bowUvs = new Float32Array(BOW_VERTICES * 2);
    for (let trail = 0; trail < BOW_TRAILS; trail++) for (let row = 0; row < BOW_SAMPLES; row++) for (let col = 0; col < CROSS_SAMPLES; col++) {
      const index = (trail * BOW_SAMPLES + row) * CROSS_SAMPLES + col;
      bowUvs[index * 2] = col / (CROSS_SAMPLES - 1);
      bowUvs[index * 2 + 1] = row * .19;
    }
    this.bowMesh = this.createRibbon(scene, "breaking-bow-and-shoulder-waves", this.bowPositions, this.bowColors, bowUvs, BOW_SAMPLES, BOW_TRAILS);
    this.bowMesh.material = this.material;
  }

  reset(): void {
    this.historyStart = 0;
    this.historyCount = 0;
    this.nextSampleTime = 0;
    this.nextTrailUpdateTime = 0;
    this.mesh.isVisible = false;
    this.bowMesh.isVisible = false;
  }

  setQuality(settings: GraphicsQualitySettings): void {
    this.waterGrid.z = settings.oceanSubdivisions * settings.oceanCellSizeMeters / 2;
    this.waterGrid.w = settings.oceanCellSizeMeters;
    this.material.setVector4("waterGrid", this.waterGrid);
  }

  update(state: BoatSimulationState, time: number, eyePosition?: Vector3, renderPosition?: Vector3, renderHeading?: number): void {
    const heading = renderHeading ?? state.heading;
    if (renderPosition) this.boatPosition.copyFrom(renderPosition);
    else this.boatPosition.set(state.positionX, 0, state.positionZ);
    this.waterGrid.x = eyePosition?.x ?? state.positionX;
    this.waterGrid.y = eyePosition?.z ?? state.positionZ;
    this.material.setVector4("waterGrid", this.waterGrid);
    this.material.setVector3("boatPosition", this.boatPosition);
    this.material.setFloat("boatHeading", heading);
    this.material.setFloat("boatSpeed", state.forwardSpeed);
    this.material.setFloat("time", time);
    this.updateBow(state, time, this.boatPosition, heading);
    if (time >= this.nextSampleTime) {
      this.recordPoint(state, time, this.boatPosition, heading); this.nextSampleTime = time + SAMPLE_INTERVAL_SECONDS;
    }
    this.mesh.isVisible = this.historyCount > 2;
    if (!this.mesh.isVisible || time < this.nextTrailUpdateTime) return;
    // Older froth spreads and fades at 30 Hz. The shared ocean vertex shader
    // conforms both foam meshes to the animated surface every rendered frame.
    this.nextTrailUpdateTime = time + 1 / 30;
    for (let trail = 0; trail < TRAILS.length; trail++) {
      const side = TRAILS[trail], outer = Math.abs(side) > 1.1;
      for (let row = 0; row < this.historyCount; row++) {
        // Actual stored emission locations; foam stays in the ocean after a
        // turn, rather than rotating or translating with the current hull.
        const offset = Math.min(row, this.historyCount - 1);
        const index = (this.historyStart - this.historyCount + offset + HISTORY_LENGTH) % HISTORY_LENGTH;
        const newest = row >= this.historyCount - 1;
        const sampleHeading = newest ? heading : this.historyHeading[index];
        const x = newest ? this.boatPosition.x - Math.sin(heading) * 75 : this.historyX[index];
        const z = newest ? this.boatPosition.z - Math.cos(heading) * 75 : this.historyZ[index];
        const speed = newest ? state.speed : this.historySpeed[index];
        const age = newest ? 0 : Math.max(0, time - this.historyTime[index]);
        const distance = newest ? state.distanceTraveledMeters : this.historyDistance[index];
        const spread = 3.7 + age * speed * (outer ? .21 : .095);
        const width = side === 0 ? 6.5 + age * speed * .055 : (outer ? 2.4 : 3.3) + age * speed * .045;
        const strength = smoothstep(.5, 11, speed) * Math.exp(-age / (outer ? 22 : 29));
        const rightX = Math.cos(sampleHeading), rightZ = -Math.sin(sampleHeading);
        const wiggle = Math.sin(distance * .11 + trail * 3.1 + age * .4) * Math.min(2.2, age * .16);
        for (let col = 0; col < CROSS_SAMPLES; col++) {
          const cross = col / (CROSS_SAMPLES - 1);
          const lateral = side * spread + (cross * 2 - 1) * width;
          const wx = x + rightX * (lateral + wiggle), wz = z + rightZ * (lateral + wiggle);
          const vertex = (trail * HISTORY_LENGTH + row) * CROSS_SAMPLES + col;
          const edge = CROSS_ENVELOPES[col];
          const breakup = .7 + .3 * Math.sin(distance * .28 + lateral * 1.6 + time * .5);
          this.writeVertex(this.positions, this.colors, vertex, wx, wz, .22,
            newest && row > this.historyCount - 1 ? 0 : strength * edge * breakup * (outer ? .58 : side === 0 ? .62 : .94));
          this.uvs[vertex * 2] = cross * (side === 0 ? 2 : 1);
          // Texture repeats in metres travelled, not in history array slots.
          this.uvs[vertex * 2 + 1] = distance / 16 + age * .006;
        }
      }
    }
    // Collapse unused history rows onto the newest sample. Their alpha stays
    // zero, and there is no repeated wave evaluation before the trail fills.
    if (this.historyCount < HISTORY_LENGTH) for (let trail=0;trail<TRAILS.length;trail++) {
      const rowSize=CROSS_SAMPLES*3,last=(trail*HISTORY_LENGTH+this.historyCount-1)*rowSize;
      for(let dest=last+rowSize;dest<(trail+1)*HISTORY_LENGTH*rowSize;dest+=rowSize)
        this.positions.copyWithin(dest,last,last+rowSize);
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
    this.mesh.updateVerticesData(VertexBuffer.UVKind, this.uvs, false, false);
  }

  private updateBow(state: BoatSimulationState, time: number, position: Vector3, renderHeading: number): void {
    const strength = smoothstep(.5, 12, Math.abs(state.forwardSpeed));
    this.bowMesh.isVisible = strength > .01;
    if (!this.bowMesh.isVisible) return;
    const reverse = state.forwardSpeed < 0;
    const heading = renderHeading + (reverse ? Math.PI : 0);
    const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
    for (let trail = 0; trail < BOW_TRAILS; trail++) for (let row = 0; row < BOW_SAMPLES; row++) {
      const t = row / (BOW_SAMPLES - 1), outer = trail % 2 === 1, side = trail < 2 ? -1 : 1;
      const along = 77 - t * (outer ? 160 : 143);
      const hullZ = reverse ? -along : along;
      const beam = hullHalfBeam(hullZ);
      const edge = outer ? (reverse ? 7.5 : .5) + t * 57 : beam + .18;
      const width = (outer ? 1.8 + t * 5.2 : 3.2 + t * 4.1) * strength;
      const envelope = smoothstep(0, .10, t) * (1 - smoothstep(.75, 1, t));
      const corrugation = .8 + .2 * Math.sin(t * 45 + time * state.speed * .34);
      const edgeWave = Math.sin(t * 41 - time * 1.9) * t * (outer ? 1.2 : .3);
      for (let col = 0; col < CROSS_SAMPLES; col++) {
        const cross = col / (CROSS_SAMPLES - 1);
        const across = side * (edge + cross * width + edgeWave);
        const wx = position.x + forwardX * along + forwardZ * across;
        const wz = position.z + forwardZ * along - forwardX * across;
        const vertex = (trail * BOW_SAMPLES + row) * CROSS_SAMPLES + col;
        const crossEnvelope = CROSS_ENVELOPES[col];
        const crest = crossEnvelope * envelope * strength * (outer ? .35 : .65);
        // Feather the aerated sheet well inside its boundary. The smooth
        // quadratic taper prevents a visible straight ribbon edge at low views.
        const alpha = crossEnvelope * crossEnvelope * strength * envelope * corrugation * (outer ? .7 : .92);
        this.writeVertex(this.bowPositions, this.bowColors, vertex, wx, wz, .10 + crest, alpha);
      }
    }
    this.bowMesh.updateVerticesData(VertexBuffer.PositionKind, this.bowPositions, false, false);
    this.bowMesh.updateVerticesData(VertexBuffer.ColorKind, this.bowColors, false, false);
  }

  private recordPoint(state: BoatSimulationState, time: number, position: Vector3, heading: number): void {
    const i = this.historyStart;
    // Propeller wash is emitted at the real twin-shaft transom, also astern.
    this.historyX[i] = position.x - Math.sin(heading) * 75;
    this.historyZ[i] = position.z - Math.cos(heading) * 75;
    this.historyHeading[i] = heading;
    this.historySpeed[i] = Math.abs(state.forwardSpeed);
    this.historyTime[i] = time;
    this.historyDistance[i] = state.distanceTraveledMeters;
    this.historyStart = (i + 1) % HISTORY_LENGTH;
    this.historyCount = Math.min(this.historyCount + 1, HISTORY_LENGTH);
  }

  private writeVertex(positions: Float32Array, colors: Float32Array, vertex: number, x: number, z: number, height: number, alpha: number): void {
    // Position.y is a small offset above the GPU-evaluated ocean surface.
    positions[vertex * 3] = x; positions[vertex * 3 + 1] = height; positions[vertex * 3 + 2] = z;
    colors[vertex * 4] = .93; colors[vertex * 4 + 1] = .98; colors[vertex * 4 + 2] = 1; colors[vertex * 4 + 3] = Math.min(.96, Math.max(0, alpha));
  }

  private createRibbon(scene: Scene, name: string, positions: Float32Array, colors: Float32Array, uvs: Float32Array, rows: number, trails: number): Mesh {
    const mesh = new Mesh(name, scene), indices: number[] = [];
    mesh.setVerticesData(VertexBuffer.PositionKind, positions, true, 3);
    mesh.setVerticesData(VertexBuffer.ColorKind, colors, true, 4);
    mesh.setVerticesData(VertexBuffer.UVKind, uvs, true, 2);
    for (let trail = 0; trail < trails; trail++) for (let row = 0; row < rows - 1; row++) for (let col = 0; col < CROSS_SAMPLES - 1; col++) {
      const a = (trail * rows + row) * CROSS_SAMPLES + col, b = a + CROSS_SAMPLES;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    mesh.setIndices(indices); mesh.useVertexColors = true; mesh.hasVertexAlpha = true;
    mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; mesh.doNotSyncBoundingInfo = true; mesh.isVisible = false;
    return mesh;
  }
}

function hullHalfBeam(z: number): number {
  for (let i = 1; i < HULL_HALF_BEAM_STATIONS.length; i++) if (z <= HULL_HALF_BEAM_STATIONS[i][0]) {
    const a = HULL_HALF_BEAM_STATIONS[i - 1], b = HULL_HALF_BEAM_STATIONS[i], t = Math.max(0, (z - a[0]) / (b[0] - a[0]));
    return a[1] + (b[1] - a[1]) * t;
  } return .2;
}
function smoothstep(a: number, b: number, value: number): number { const t = Math.min(1, Math.max(0, (value - a) / (b - a))); return t * t * (3 - 2 * t); }

function createFoamTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("cellular-breaking-foam", { width: 512, height: 512 }, scene, true);
  texture.hasAlpha = true; texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  const ctx = texture.getContext(); let seed = 731;
  const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  // Interconnected froth with transparent blue pockets, rather than solid ribbons.
  for (let i = 0; i < 3800; i++) {
    const x = random() * 512, y = random() * 512, radius = 1.2 + Math.pow(random(), 2) * 18;
    ctx.fillStyle = `rgba(236,250,251,${.10 + random() * .37})`;
    ctx.strokeStyle = `rgba(245,253,253,${.24 + random() * .55})`; ctx.lineWidth = .7 + random() * 1.7;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  texture.update(); return texture;
}
