import Alea from 'alea';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import type { TerrainConfig } from '../config/BiomeConfig';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic procedural heightfield combining FBM, ridged noise, stream carving,
 * koi pool basin, stepped waterfall cliff, and cozy meadow clearing.
 */
export class TerrainHeightfield {
  private readonly noiseMain: NoiseFunction2D;
  private readonly noiseDetail: NoiseFunction2D;
  readonly config: TerrainConfig;

  constructor(config: TerrainConfig, seed: string) {
    this.config = config;
    const prng = Alea(seed);
    this.noiseMain = createNoise2D(prng);
    this.noiseDetail = createNoise2D(Alea(`${seed}-detail`));
  }

  /**
   * Returns the horizontal X center of the winding stream at coordinate Z.
   */
  getStreamCenterX(z: number): number {
    return this.config.streamCenterX + Math.sin(z * 0.075) * 4.2 + Math.cos(z * 0.032) * 1.8;
  }

  /**
   * Evaluates deterministic FBM + ridged multifractal terrain height in world units.
   */
  getHeightAt(x: number, z: number): number {
    const {
      noiseScale,
      octaves,
      persistence,
      lacunarity,
      maxHeight,
      ridgeWeight,
      waterfallZ,
      waterfallDropHeight,
      poolCenter,
      poolRadius,
    } = this.config;

    let fbm = 0;
    let ridged = 0;
    let amp = 1;
    let freq = noiseScale;
    let weight = 1;
    let norm = 0;

    for (let i = 0; i < octaves; i++) {
      const n = this.noiseMain(x * freq, z * freq);
      fbm += n * amp;

      let r = 1 - Math.abs(n);
      r = r * r * weight;
      weight = Math.max(0, Math.min(1, r * 1.8));
      ridged += r * amp;

      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }

    fbm /= norm;
    ridged /= norm;

    const micro = this.noiseDetail(x * 0.09, z * 0.09) * 0.45;
    let height = (fbm * (1 - ridgeWeight) + (ridged * 2 - 0.6) * ridgeWeight) * (maxHeight * 0.35);

    // Valley amphitheater walls enclosing the left, right, and rear cliff
    const streamX = this.getStreamCenterX(z);
    const distFromStream = Math.abs(x - streamX);
    const valleySlope = smoothstep(8, 52, distFromStream) * (maxHeight * 0.72);
    height += valleySlope;

    // Stepped 3-tier cliff ledge behind the waterfall (z < waterfallZ)
    if (z < waterfallZ + 4) {
      const cliffRise = smoothstep(waterfallZ + 3, waterfallZ - 8, z);
      // Terraced steps for visual stratified rock ledges
      const stepBlend = cliffRise * 0.75 + Math.floor(cliffRise * 3) / 3 * 0.25;
      height += stepBlend * waterfallDropHeight;

      // Carve an upper stream channel feeding the waterfall crest
      const upperChannel = 1 - smoothstep(1.8, 5.5, Math.abs(x - streamX));
      height -= upperChannel * 1.45 * cliffRise;
    }

    // Carve main koi pool basin
    const dxPool = x - poolCenter[0];
    const dzPool = z - poolCenter[1];
    const distPool = Math.hypot(dxPool, dzPool);
    const poolMask = 1 - smoothstep(poolRadius * 0.42, poolRadius * 1.15, distPool);

    // Carve winding lower stream channel (z > poolCenter[1])
    const streamWidth = z > poolCenter[1] ? 3.2 : 2.6;
    const streamMask =
      z > waterfallZ - 1
        ? 1 - smoothstep(streamWidth * 0.55, streamWidth * 2.1, distFromStream)
        : 0;

    // Flatten east campsite clearing around (12, 5)
    const distCamp = Math.hypot(x - 13, z - 6);
    const campMask = 1 - smoothstep(3.5, 11.5, distCamp);
    height = height * (1 - campMask * 0.78) + 1.45 * (campMask * 0.78);

    // Flatten gently around bridge approaches near z = 6
    const distBridgeBank = Math.hypot(Math.abs(x - this.getStreamCenterX(6)) - 5.5, z - 6);
    const bridgeMask = 1 - smoothstep(1.5, 5.5, distBridgeBank);
    height = height * (1 - bridgeMask * 0.65) + 0.85 * (bridgeMask * 0.65);

    const baseElevation = Math.max(0.35, height + 1.35 + micro * (1 - poolMask));
    const carvedStream = baseElevation * (1 - streamMask) + -1.15 * streamMask;
    const carvedPool = carvedStream * (1 - poolMask) + -1.95 * poolMask;

    return carvedPool;
  }

  /**
   * Computes approximate terrain surface slope in [0, 1] where 0 is flat and 1 is vertical.
   */
  getSlopeAt(x: number, z: number): number {
    const eps = 0.6;
    const hL = this.getHeightAt(x - eps, z);
    const hR = this.getHeightAt(x + eps, z);
    const hD = this.getHeightAt(x, z - eps);
    const hU = this.getHeightAt(x, z + eps);

    const dx = (hR - hL) / (2 * eps);
    const dz = (hU - hD) / (2 * eps);
    const ny = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    return 1 - ny;
  }

  /**
   * Checks whether a world XZ coordinate lies inside the water stream or koi pool.
   */
  isWaterAt(x: number, z: number): boolean {
    return this.getHeightAt(x, z) < this.config.waterLevel - 0.15;
  }
}
