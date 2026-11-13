export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  tier: QualityTier;
  maxPixelRatio: number;
  shadowMapSize: number;
  grassCount: number;
  fernCount: number;
  flowerCount: number;
  enableSmaa: boolean;
  enableBloom: boolean;
  enableGodRays: boolean;
  enablePlanarReflection: boolean;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    tier: 'low',
    maxPixelRatio: 1,
    shadowMapSize: 1024,
    grassCount: 10000,
    fernCount: 180,
    flowerCount: 280,
    enableSmaa: false,
    enableBloom: false,
    enableGodRays: false,
    enablePlanarReflection: false,
  },
  medium: {
    tier: 'medium',
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    grassCount: 24000,
    fernCount: 380,
    flowerCount: 650,
    enableSmaa: true,
    enableBloom: true,
    enableGodRays: false,
    enablePlanarReflection: false,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    grassCount: 36000,
    fernCount: 480,
    flowerCount: 850,
    enableSmaa: true,
    enableBloom: true,
    enableGodRays: true,
    enablePlanarReflection: false,
  },
};
