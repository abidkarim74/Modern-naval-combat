import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { GraphicsQualitySettings } from "../game/graphicsQuality";
import type { BirdAudioSnapshot } from "./seabirdAudio";
import { GULL_CAPACITY, GullFlockFlight } from "./gullFlight";
import { createGullBodyGeometry, createGullWingGeometry } from "./gullGeometry";
import type { GullGeometry } from "./gullGeometry";

/** Kept under the existing ambient API; clouds now belong to the maritime sky. */
export class AmbientSprites {
  private readonly flight = new GullFlockFlight();
  private readonly body: Mesh;
  private readonly innerWings: Mesh;
  private readonly outerWings: Mesh;
  private readonly bodyMatrices = new Float32Array(GULL_CAPACITY * 16);
  private readonly innerMatrices = new Float32Array(GULL_CAPACITY * 2 * 16);
  private readonly outerMatrices = new Float32Array(GULL_CAPACITY * 2 * 16);
  private readonly position = Vector3.Zero();
  private readonly scale = Vector3.One();
  private readonly rotation = Quaternion.Identity();
  private readonly bodyMatrix = Matrix.Identity();
  private readonly innerLocal = Matrix.Identity();
  private readonly innerWorld = Matrix.Identity();
  private readonly outerLocal = Matrix.Identity();
  private readonly outerWorld = Matrix.Identity();
  readonly birdAudioSnapshots: readonly BirdAudioSnapshot[] = this.flight.birds;
  activeBirdCount = 0;

  constructor(scene: Scene, settings: GraphicsQualitySettings) {
    const material = new StandardMaterial("adult-gull-plumage", scene);
    material.diffuseColor = Color3.White();
    material.specularColor = new Color3(.035, .035, .035);
    material.specularPower = 16;
    material.backFaceCulling = false;
    // Closed surfaces carry outward normals. A mirrored instance reverses its
    // winding, so gl_FrontFacing-based normal flips would darken the left wing.
    material.twoSidedLighting = false;
    material.maxSimultaneousLights = 2;
    const createSource = (name: string, geometry: GullGeometry, matrices: Float32Array): Mesh => {
      const mesh = new Mesh(name, scene);
      const data = new VertexData();
      data.positions = geometry.positions; data.normals = geometry.normals;
      data.colors = geometry.colors; data.indices = geometry.indices;
      data.applyToMesh(mesh);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.hasVertexAlpha = false;
      // Only three bounded sources exist; skip rescanning moving instance bounds.
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.doNotSyncBoundingInfo = true;
      mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      return mesh;
    };
    this.body = createSource("passing-gull-bodies", createGullBodyGeometry(), this.bodyMatrices);
    this.innerWings = createSource("passing-gull-articulated-inner-wings", createGullWingGeometry(false), this.innerMatrices);
    this.outerWings = createSource("passing-gull-feathered-wingtips", createGullWingGeometry(true), this.outerMatrices);
    this.setQuality(settings);
  }

  setQuality(settings: GraphicsQualitySettings): void {
    this.flight.setBirdCount(settings.birdCount);
  }

  update(timeSeconds: number, focusX: number, focusZ: number, heading: number, focusY = 0): void {
    this.flight.update(timeSeconds, focusX, focusZ, heading, focusY);
    this.activeBirdCount = this.flight.activeBirdCount;
    let instance = 0;
    for (const bird of this.flight.birds) {
      if (!bird.visible) continue;
      this.position.set(bird.x, bird.y, bird.z);
      this.scale.setAll(bird.scale);
      Quaternion.RotationYawPitchRollToRef(bird.yaw, bird.pitch, bird.bank, this.rotation);
      Matrix.ComposeToRef(this.scale, this.rotation, this.position, this.bodyMatrix);
      this.bodyMatrix.copyToArray(this.bodyMatrices, instance * 16);
      for (let wing = 0; wing < 2; wing++) {
        const side = wing === 0 ? 1 : -1;
        this.position.set(side * .065, .026, .018);
        this.scale.set(side, 1, 1);
        Quaternion.RotationYawPitchRollToRef(side * bird.wingSweep, 0, side * bird.wingLift, this.rotation);
        Matrix.ComposeToRef(this.scale, this.rotation, this.position, this.innerLocal);
        this.innerLocal.multiplyToRef(this.bodyMatrix, this.innerWorld);
        this.innerWorld.copyToArray(this.innerMatrices, (instance * 2 + wing) * 16);
        this.position.set(.335, .004, -.023);
        this.scale.setAll(1);
        Quaternion.RotationYawPitchRollToRef(bird.wingSweep * .6, -.015, bird.wingTipLift, this.rotation);
        Matrix.ComposeToRef(this.scale, this.rotation, this.position, this.outerLocal);
        this.outerLocal.multiplyToRef(this.innerWorld, this.outerWorld);
        this.outerWorld.copyToArray(this.outerMatrices, (instance * 2 + wing) * 16);
      }
      instance++;
    }
    this.upload(this.body, instance);
    this.upload(this.innerWings, instance * 2);
    this.upload(this.outerWings, instance * 2);
  }

  private upload(mesh: Mesh, count: number): void {
    mesh.setEnabled(count > 0);
    mesh.thinInstanceCount = count;
    if (count > 0) mesh.thinInstanceBufferUpdated("matrix");
  }
}
