export type GraphicsQuality = "High" | "Medium" | "Low";

export interface GraphicsQualitySettings {
  readonly oceanSubdivisions: number;
  readonly oceanCellSizeMeters: number;
  readonly waterDetailLevel: 0 | 1 | 2;
  readonly waterDetailStrength: number;
  readonly waterReflectionStrength: number;
  readonly skyDetailLevel: 0 | 1 | 2;
  readonly cloudCount: number;
  readonly birdCount: number;
  readonly shadowMapSize: number;
  readonly hardwareScaling: number;
  readonly viewDistanceMeters: number;
}

export const GRAPHICS_QUALITY_SETTINGS: Readonly<Record<GraphicsQuality, GraphicsQualitySettings>> = {
  High: {
    oceanSubdivisions: 96,
    oceanCellSizeMeters: 2,
    waterDetailLevel: 2,
    waterDetailStrength: 1,
    waterReflectionStrength: 0.92,
    skyDetailLevel: 2,
    cloudCount: 9,
    birdCount: 12,
    shadowMapSize: 1024,
    hardwareScaling: 1,
    viewDistanceMeters: 8_000,
  },
  Medium: {
    oceanSubdivisions: 64,
    oceanCellSizeMeters: 3,
    waterDetailLevel: 1,
    waterDetailStrength: 0.78,
    waterReflectionStrength: 0.84,
    skyDetailLevel: 1,
    cloudCount: 7,
    birdCount: 10,
    shadowMapSize: 512,
    hardwareScaling: 1,
    viewDistanceMeters: 6_800,
  },
  Low: {
    oceanSubdivisions: 48,
    oceanCellSizeMeters: 4,
    waterDetailLevel: 0,
    waterDetailStrength: 0.48,
    waterReflectionStrength: 0.72,
    skyDetailLevel: 0,
    cloudCount: 4,
    birdCount: 6,
    shadowMapSize: 0,
    hardwareScaling: 1.3,
    viewDistanceMeters: 5_000,
  },
};

export const DEFAULT_GRAPHICS_QUALITY: GraphicsQuality = "Medium";
