import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Sprite } from "@babylonjs/core/Sprites/sprite";
import { SpriteManager } from "@babylonjs/core/Sprites/spriteManager";
import type { Scene } from "@babylonjs/core/scene";
import type { GraphicsQualitySettings } from "../game/graphicsQuality";

const SPRITE_CELL_SIZE = 128;
const CLOUD_CAPACITY = 14;
const BIRD_CAPACITY = 12;
const MAX_SPRITES = CLOUD_CAPACITY + BIRD_CAPACITY;

interface BirdFlight {
  readonly sprite: Sprite;
  readonly phase: number;
  readonly size: number;
}
const FLOCK_PERIOD = 44;
const FLOCK_DURATION = 16;

export class AmbientSprites {
  private readonly manager: SpriteManager;
  private readonly clouds: Sprite[] = [];
  private readonly cloudOffsetsX = new Float32Array(CLOUD_CAPACITY);
  private readonly cloudOffsetsZ = new Float32Array(CLOUD_CAPACITY);
  private readonly birds: BirdFlight[] = [];
  private cloudCount = CLOUD_CAPACITY;
  private birdCount = BIRD_CAPACITY;
  private readonly flocks = [
    { cycle: -1, x: 0, z: 0, heading: 0 },
    { cycle: -1, x: 0, z: 0, heading: 0 },
  ];
  activeBirdCount = 0;

  constructor(scene: Scene, settings: GraphicsQualitySettings) {
    const spriteSheetUrl = createAtmosphereSpriteSheet();
    this.manager = new SpriteManager(
      "clouds-and-birds",
      spriteSheetUrl,
      MAX_SPRITES,
      SPRITE_CELL_SIZE,
      scene,
      0.01,
    );
    this.manager.isPickable = false;
    this.manager.fogEnabled = true;

    this.createClouds();
    this.createBirds();
    this.setQuality(settings);
  }

  update(timeSeconds: number, boatX: number, boatZ: number, heading: number): void {
    for (let index = 0; index < this.clouds.length; index += 1) {
      const cloud = this.clouds[index];
      if (cloud) {
        cloud.position.x = boatX + wrapWorldOffset((this.cloudOffsetsX[index] ?? 0) - boatX, 6000);
        cloud.position.z = boatZ + wrapWorldOffset((this.cloudOffsetsZ[index] ?? 0) - boatZ, 6000);
      }
    }

    this.activeBirdCount = 0;
    for (let index = 0; index < this.birds.length; index += 1) {
      const bird = this.birds[index];
      const group = Math.floor(index / 6);
      const flock = this.flocks[group];
      if (!bird || !flock) continue;
      const flightTime = timeSeconds + group * FLOCK_PERIOD / 2;
      const cycle = Math.floor(flightTime / FLOCK_PERIOD);
      const age = flightTime % FLOCK_PERIOD;
      if (cycle !== flock.cycle) {
        flock.cycle = cycle;
        flock.x = boatX;
        flock.z = boatZ;
        flock.heading = heading;
      }
      const visible = index % 6 < Math.ceil(this.birdCount / 2) && age < FLOCK_DURATION;
      bird.sprite.isVisible = visible;
      if (!visible) continue;
      this.activeBirdCount += 1;
      const lane = index % 6;
      const side = group === 0 ? 1 : -1;
      const x = side * ((age - FLOCK_DURATION * .5) * 16 - lane * 4.8);
      const z = 105 + lane * 4 + Math.sin(age * .25 + bird.phase) * 7;
      const cosine = Math.cos(flock.heading);
      const sine = Math.sin(flock.heading);
      bird.sprite.position.set(
        flock.x + x * cosine + z * sine,
        19 + lane * 1.4 + Math.sin(age * .5 + bird.phase) * 2,
        flock.z - x * sine + z * cosine,
      );
      const flapFrame = Math.floor((timeSeconds * 7 + bird.phase) % 6);
      bird.sprite.cellIndex = timeSeconds % 9 > 6 ? 2 : 1 + Math.min(flapFrame, 6 - flapFrame);
      bird.sprite.width = bird.size;
      bird.sprite.height = bird.size;
      bird.sprite.angle = Math.sin(age * .6 + bird.phase) * .12;
      bird.sprite.color.a = Math.min(1, age, FLOCK_DURATION - age) * .9;
    }
  }

  setQuality(settings: GraphicsQualitySettings): void {
    this.cloudCount = settings.cloudCount;
    this.birdCount = settings.birdCount;
    this.clouds.forEach((sprite, index) => {
      sprite.isVisible = index < this.cloudCount;
    });
    this.birds.forEach((bird, index) => {
      bird.sprite.isVisible = index < this.birdCount;
    });
  }

  private createClouds(): void {
    for (let index = 0; index < CLOUD_CAPACITY; index += 1) {
      const angle = (index / CLOUD_CAPACITY) * Math.PI * 2 + 0.38;
      const distance = 1_150 + ((index * 733) % 1_300);
      const offsetX = Math.cos(angle) * distance;
      const offsetZ = Math.sin(angle) * distance;
      const cloud = new Sprite(`horizon-cloud-${index}`, this.manager);
      cloud.cellIndex = 0;
      cloud.position = new Vector3(offsetX, 220 + ((index * 71) % 260), offsetZ);
      cloud.width = 230 + ((index * 83) % 240);
      cloud.height = 72 + ((index * 47) % 65);
      cloud.color = new Color4(0.94, 0.98, 1, 0.82 + (index % 3) * 0.04);
      cloud.isPickable = false;
      this.cloudOffsetsX[index] = offsetX;
      this.cloudOffsetsZ[index] = offsetZ;
      this.clouds.push(cloud);
    }
  }

  private createBirds(): void {
    for (let index = 0; index < BIRD_CAPACITY; index += 1) {
      const sprite = new Sprite(`passing-gull-${index}`, this.manager);
      sprite.cellIndex = 1;
      sprite.color = new Color4(.34, .40, .43, .9);
      sprite.isPickable = false;
      sprite.isVisible = false;
      this.birds.push({ sprite, phase: index * 2.399, size: 2.6 + (index % 3) * .2 });
    }
  }
}

function createAtmosphereSpriteSheet(): string {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_CELL_SIZE * 5;
  canvas.height = SPRITE_CELL_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create the atmosphere sprite canvas");

  drawCloudCell(context);
  for (let frame = 0; frame < 4; frame += 1) drawBirdCell(context, frame);
  return canvas.toDataURL("image/png");
}

function drawCloudCell(context: CanvasRenderingContext2D): void {
  const centerX = SPRITE_CELL_SIZE * 0.5;
  const centerY = SPRITE_CELL_SIZE * 0.62;
  const puffs = [
    { x: -37, y: 12, radius: 25 },
    { x: -18, y: -3, radius: 31 },
    { x: 8, y: -10, radius: 35 },
    { x: 31, y: 0, radius: 29 },
    { x: 41, y: 11, radius: 18 },
  ];

  for (const puff of puffs) {
    const x = centerX + puff.x;
    const y = centerY + puff.y;
    const gradient = context.createRadialGradient(x - 8, y - 10, 2, x, y, puff.radius);
    gradient.addColorStop(0, "rgba(255,255,255,0.93)");
    gradient.addColorStop(0.48, "rgba(255,255,255,0.78)");
    gradient.addColorStop(0.78, "rgba(255,255,255,0.38)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(x - puff.radius, y - puff.radius, puff.radius * 2, puff.radius * 2);
  }

}

function drawBirdCell(context: CanvasRenderingContext2D, frame: number): void {
  context.save();
  context.translate(SPRITE_CELL_SIZE * (frame + 1), 0);
  const wingY = [25, 47, 71, 91][frame] ?? 50;
  context.fillStyle = "#edf4f4";
  context.strokeStyle = "#4e5a61";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(64, 68);
  context.quadraticCurveTo(37, wingY - 7, 8, wingY);
  context.quadraticCurveTo(34, wingY + 14, 61, 76);
  context.lineTo(66, 76);
  context.quadraticCurveTo(93, wingY + 14, 120, wingY);
  context.quadraticCurveTo(91, wingY - 7, 64, 68);
  context.fill();
  context.stroke();
  context.fillStyle = "#c4d2d6";
  context.beginPath();
  context.ellipse(64, 71, 4, 13, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

// Clouds keep fixed world positions until they wrap beyond the visible range.
function wrapWorldOffset(value: number, span: number): number { return ((value + span / 2) % span + span) % span - span / 2; }
