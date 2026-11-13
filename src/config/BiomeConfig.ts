import type { WeatherMode } from '../core/EventBus';

export interface CameraPreset {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface WeatherPreset {
  mode: WeatherMode;
  label: string;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  sunColor: string;
  sunIntensity: number;
  ambientSkyColor: string;
  ambientGroundColor: string;
  ambientIntensity: number;
  skyTopColor: string;
  skyHorizonColor: string;
  fogColor: string;
  fogDensity: number;
  exposure: number;
  firefliesActive: boolean;
  lanternsAutoLit: boolean;
}

export interface TerrainConfig {
  size: number;
  segments: number;
  maxHeight: number;
  noiseScale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  ridgeWeight: number;
  waterLevel: number;
  streamCenterX: number;
  waterfallZ: number;
  waterfallDropHeight: number;
  poolCenter: [number, number];
  poolRadius: number;
}

export interface WaterPalette {
  shallowColor: string;
  deepColor: string;
  foamColor: string;
  causticIntensity: number;
  flowSpeed: number;
  waveAmplitude: number;
}

export interface FoliagePalette {
  treeVariantCount: number;
  treeCount: number;
  bambooClusterCount: number;
  bambooPerCluster: number;
  grassBaseColor: string;
  grassTipColor: string;
  flowerColors: string[];
  leafFallColors: string[];
  windStrength: number;
}

export interface WildlifeConfig {
  koiCount: number;
  deerCount: number;
  birdCount: number;
  butterflyCount: number;
}

export interface BiomeConfig {
  id: string;
  name: string;
  seed: string;
  terrain: TerrainConfig;
  water: WaterPalette;
  foliage: FoliagePalette;
  wildlife: WildlifeConfig;
  weatherPresets: Record<WeatherMode, WeatherPreset>;
  defaultWeather: WeatherMode;
  cameraPresets: CameraPreset[];
}

/**
 * Validates biome configuration invariants before world generation.
 */
export function validateBiomeConfig(config: BiomeConfig): string[] {
  const errors: string[] = [];

  if (!config.id.trim()) errors.push('Biome id must not be empty');
  if (!config.seed.trim()) errors.push('Biome seed must not be empty');
  if (config.terrain.size <= 0) errors.push('Terrain size must be positive');
  if (config.terrain.segments < 16) errors.push('Terrain segments must be >= 16');
  if (config.terrain.octaves < 1 || config.terrain.octaves > 8) {
    errors.push('Terrain octaves must be between 1 and 8');
  }
  if (config.terrain.poolRadius <= 0) errors.push('Pool radius must be positive');
  if (config.foliage.treeVariantCount < 1 || config.foliage.treeVariantCount > 8) {
    errors.push('Tree variant count must be between 1 and 8');
  }
  if (config.cameraPresets.length === 0) {
    errors.push('At least one camera preset is required');
  }

  for (const mode of Object.keys(config.weatherPresets) as WeatherMode[]) {
    const preset = config.weatherPresets[mode];
    if (preset.exposure < 0.85 || preset.exposure > 1.3) {
      errors.push(`Weather ${mode} exposure (${preset.exposure}) outside safe range [0.85, 1.3]`);
    }
    if (preset.fogDensity < 0) {
      errors.push(`Weather ${mode} fogDensity must be non-negative`);
    }
  }

  if (!config.weatherPresets[config.defaultWeather]) {
    errors.push(`Default weather '${config.defaultWeather}' missing from weatherPresets`);
  }

  return errors;
}
