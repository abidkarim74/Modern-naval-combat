export type GraphicsQuality = "High" | "Medium" | "Low";

export interface GraphicsQualitySettings {
  readonly oceanSubdivisions: number;
  readonly waterDetailStrength: number;
  readonly waterReflectionStrength: number;
  readonly cloudCount: number;
  readonly birdCount: number;
  readonly shadowMapSize: number;
  readonly hardwareScaling: number;
  readonly viewDistanceMeters: number;
}

export const GRAPHICS_QUALITY_SETTINGS: Readonly<Record<GraphicsQuality, GraphicsQualitySettings>> = {
  High: {
    oceanSubdivisions: 300,
    waterDetailStrength: 1,
    waterReflectionStrength: 0.92,
    cloudCount: 9,
    birdCount: 12,
    shadowMapSize: 1024,
    hardwareScaling: 1,
    viewDistanceMeters: 8_000,
  },
  Medium: {
    oceanSubdivisions: 220,
    waterDetailStrength: 0.78,
    waterReflectionStrength: 0.84,
    cloudCount: 7,
    birdCount: 10,
    shadowMapSize: 512,
    hardwareScaling: 1,
    viewDistanceMeters: 6_800,
  },
  Low: {
    oceanSubdivisions: 160,
    waterDetailStrength: 0.48,
    waterReflectionStrength: 0.72,
    cloudCount: 4,
    birdCount: 6,
    shadowMapSize: 0,
    hardwareScaling: 1.3,
    viewDistanceMeters: 5_000,
  },
};

export const DEFAULT_GRAPHICS_QUALITY: GraphicsQuality = "Medium";
