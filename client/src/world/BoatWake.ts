import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { BoatSimulationState } from "@naval/shared";
import { sampleOceanHeight } from "@naval/shared";

const HISTORY_LENGTH = 240;
const SAMPLE_INTERVAL_SECONDS = .20;
const TRAILS = [-1.6, -1, 0, 1, 1.6];
const CROSS_SAMPLES = 9;
const BOW_SAMPLES = 48;
const BOW_TRAILS = 4;
const VERTICES = HISTORY_LENGTH * CROSS_SAMPLES * TRAILS.length;
const BOW_VERTICES = BOW_SAMPLES * CROSS_SAMPLES * BOW_TRAILS;

export class BoatWake {
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
  private boatX = 0;
  private boatZ = 0;
  private flowX = 0;
  private flowZ = 1;
  private rightX = 1;
  private rightZ = 0;
  private speedFactor = 0;

  constructor(scene: Scene) {
    const material = new StandardMaterial("aerated-breaking-water", scene);
    material.disableLighting = true;
    material.diffuseColor = new Color3(.87, .96, .97);
    material.emissiveColor = new Color3(.78, .86, .9);
    material.diffuseTexture = createFoamTexture(scene);
    material.emissiveTexture = material.diffuseTexture;
    material.useAlphaFromDiffuseTexture = true;
    material.alpha = .94;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    this.mesh = this.createRibbon(scene, "world-space-ship-wake", this.positions, this.colors, this.uvs, HISTORY_LENGTH, TRAILS.length);
    this.mesh.material = material;
    const bowUvs = new Float32Array(BOW_VERTICES * 2);
    for (let trail = 0; trail < BOW_TRAILS; trail++) for (let row = 0; row < BOW_SAMPLES; row++) for (let col = 0; col < CROSS_SAMPLES; col++) {
      const index = (trail * BOW_SAMPLES + row) * CROSS_SAMPLES + col;
      bowUvs[index * 2] = col / (CROSS_SAMPLES - 1);
      bowUvs[index * 2 + 1] = row * .19;
    }
    this.bowMesh = this.createRibbon(scene, "breaking-bow-and-shoulder-waves", this.bowPositions, this.bowColors, bowUvs, BOW_SAMPLES, BOW_TRAILS);
    this.bowMesh.material = material;
  }

  update(state: BoatSimulationState, time: number): void {
    this.boatX = state.positionX; this.boatZ = state.positionZ;
    const movementHeading = state.heading + (state.forwardSpeed < 0 ? Math.PI : 0);
    this.flowX = Math.sin(movementHeading); this.flowZ = Math.cos(movementHeading);
    this.rightX = Math.cos(state.heading); this.rightZ = -Math.sin(state.heading);
    this.speedFactor = smoothstep(.4, 12, Math.abs(state.forwardSpeed));
    this.updateBow(state, time);
    if (time >= this.nextSampleTime) {
      this.recordPoint(state, time); this.nextSampleTime = time + SAMPLE_INTERVAL_SECONDS;
    }
    this.mesh.isVisible = this.historyCount > 2;
    if (!this.mesh.isVisible || time < this.nextTrailUpdateTime) return;
    // Older world-space froth changes slowly. Keep its CPU surface sampling
    // at 30 Hz while hull physics, bow waves and ocean shading run each frame.
    this.nextTrailUpdateTime = time + 1 / 30;
    for (let trail = 0; trail < TRAILS.length; trail++) {
      const side = TRAILS[trail], outer = Math.abs(side) > 1.1;
      for (let row = 0; row < this.historyCount; row++) {
        // Actual stored emission locations; foam stays in the ocean after a
        // turn, rather than rotating or translating with the current hull.
        const offset = Math.min(row, this.historyCount - 1);
        const index = (this.historyStart - this.historyCount + offset + HISTORY_LENGTH) % HISTORY_LENGTH;
        const newest = row >= this.historyCount - 1;
        const heading = newest ? state.heading : this.historyHeading[index];
        const x = newest ? state.positionX - Math.sin(state.heading) * 75 : this.historyX[index];
        const z = newest ? state.positionZ - Math.cos(state.heading) * 75 : this.historyZ[index];
        const speed = newest ? state.speed : this.historySpeed[index];
        const age = newest ? 0 : Math.max(0, time - this.historyTime[index]);
        const distance = newest ? state.distanceTraveledMeters : this.historyDistance[index];
        const spread = 3.7 + age * speed * (outer ? .21 : .095);
        const width = side === 0 ? 6.5 + age * speed * .055 : (outer ? 2.4 : 3.3) + age * speed * .045;
        const strength = smoothstep(.5, 11, speed) * Math.exp(-age / (outer ? 22 : 29));
        const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
        for (let col = 0; col < CROSS_SAMPLES; col++) {
          const cross = col / (CROSS_SAMPLES - 1);
          const lateral = side * spread + (cross * 2 - 1) * width;
          const wiggle = Math.sin(distance * .11 + trail * 3.1 + age * .4) * Math.min(2.2, age * .16);
          const wx = x + rightX * (lateral + wiggle), wz = z + rightZ * (lateral + wiggle);
          const vertex = (trail * HISTORY_LENGTH + row) * CROSS_SAMPLES + col;
          const edge = Math.sin(cross * Math.PI);
          const breakup = .7 + .3 * Math.sin(distance * .28 + lateral * 1.6 + time * .5);
          this.writeVertex(this.positions, this.colors, vertex, wx, wz, time, .22,
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

  private updateBow(state: BoatSimulationState, time: number): void {
    const strength = smoothstep(.5, 12, Math.abs(state.forwardSpeed));
    this.bowMesh.isVisible = strength > .01;
    if (!this.bowMesh.isVisible) return;
    const reverse = state.forwardSpeed < 0;
    const heading = state.heading + (reverse ? Math.PI : 0);
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
      for (let col = 0; col < CROSS_SAMPLES; col++) {
        const cross = col / (CROSS_SAMPLES - 1);
        const across = side * (edge + cross * width + Math.sin(t * 41 - time * 1.9) * t * (outer ? 1.2 : .3));
        const wx = state.positionX + forwardX * along + forwardZ * across;
        const wz = state.positionZ + forwardZ * along - forwardX * across;
        const vertex = (trail * BOW_SAMPLES + row) * CROSS_SAMPLES + col;
        const crest = Math.sin(cross * Math.PI) * envelope * strength * (outer ? .35 : .65);
        const alpha = Math.sin(cross * Math.PI) * strength * envelope * corrugation * (outer ? .7 : .92);
        this.writeVertex(this.bowPositions, this.bowColors, vertex, wx, wz, time, .10 + crest, alpha);
      }
    }
    this.bowMesh.updateVerticesData(VertexBuffer.PositionKind, this.bowPositions, false, false);
    this.bowMesh.updateVerticesData(VertexBuffer.ColorKind, this.bowColors, false, false);
  }

  private recordPoint(state: BoatSimulationState, time: number): void {
    const i = this.historyStart;
    // Propeller wash is emitted at the real twin-shaft transom, also astern.
    this.historyX[i] = state.positionX - Math.sin(state.heading) * 75;
    this.historyZ[i] = state.positionZ - Math.cos(state.heading) * 75;
    this.historyHeading[i] = state.heading;
    this.historySpeed[i] = Math.abs(state.forwardSpeed);
    this.historyTime[i] = time;
    this.historyDistance[i] = state.distanceTraveledMeters;
    this.historyStart = (i + 1) % HISTORY_LENGTH;
    this.historyCount = Math.min(this.historyCount + 1, HISTORY_LENGTH);
  }

  private writeVertex(positions: Float32Array, colors: Float32Array, vertex: number, x: number, z: number, time: number, height: number, alpha: number): void {
    positions[vertex * 3] = x; positions[vertex * 3 + 1] = this.surfaceHeight(x, z, time) + height; positions[vertex * 3 + 2] = z;
    colors[vertex * 4] = .93; colors[vertex * 4 + 1] = .98; colors[vertex * 4 + 2] = 1; colors[vertex * 4 + 3] = Math.min(.96, Math.max(0, alpha));
  }

  // Match the ship displacement terms in both ocean vertex shaders. Foam
  // otherwise cuts into wave crests and exposes rectangular triangle edges.
  private surfaceHeight(x: number, z: number, time: number): number {
    const base = sampleOceanHeight(x, z, time);
    if (this.speedFactor < .001) return base;
    const dx=x-this.boatX,dz=z-this.boatZ;
    const along=dx*this.flowX+dz*this.flowZ, across=dx*this.rightX+dz*this.rightZ;
    const halfBeam=Math.max(.3,8.5*(1-smoothstep(25,78,along)));
    const bow=Math.abs(along-77)<35&&Math.abs(across)<30 ? gaussian((along-77)/7)*gaussian(across/7):0;
    const shoulder=Math.abs(along)<105&&Math.abs(across)<25 ? gaussian((Math.abs(across)-halfBeam-1.4)/3.4)*Math.exp(-Math.pow(along/69,8)):0;
    const stern=Math.abs(along+77)<45&&Math.abs(across)<50 ? gaussian((along+77)/10)*gaussian(across/12):0;
    const wakeDistance=Math.max(-along-69,0),kelvinDistance=Math.abs(across)-(8+wakeDistance*.354);
    const width=3.5+wakeDistance*.018;
    const kelvin=Math.abs(kelvinDistance)<width*4 ? smoothstep(0,16,wakeDistance)*Math.exp(-wakeDistance/200)*gaussian(kelvinDistance/width):0;
    return base+this.speedFactor*(.45*bow+.12*shoulder*Math.sin(along*.31-time*3.1)-.16*stern+
      .24*kelvin*Math.sin(wakeDistance*.38-Math.abs(across)*.29));
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
  const stations = [[-78, 7], [-60, 8.4], [-30, 8.5], [25, 8.3], [43, 6.8], [60, 4.0], [78, .2]];
  for (let i = 1; i < stations.length; i++) if (z <= stations[i][0]) {
    const a = stations[i - 1], b = stations[i], t = Math.max(0, (z - a[0]) / (b[0] - a[0]));
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

function gaussian(value: number): number { return Math.exp(-value * value); }
