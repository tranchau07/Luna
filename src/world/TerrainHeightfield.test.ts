import { describe, expect, it } from 'vitest';
import { TerrainHeightfield } from './TerrainHeightfield';
import { crystalValleyBiome } from '../config/crystalValley.biome';

describe('TerrainHeightfield', () => {
  it('produces deterministic heights for the same seed', () => {
    const a = new TerrainHeightfield(crystalValleyBiome.terrain, crystalValleyBiome.seed);
    const b = new TerrainHeightfield(crystalValleyBiome.terrain, crystalValleyBiome.seed);

    for (const [x, z] of [
      [0, -10],
      [13, 6],
      [-28, 12],
      [0, -34],
    ]) {
      expect(a.getHeightAt(x, z)).toBeCloseTo(b.getHeightAt(x, z), 6);
    }
  });

  it('carves the koi pool below waterLevel and raises the waterfall cliff', () => {
    const field = new TerrainHeightfield(
      crystalValleyBiome.terrain,
      crystalValleyBiome.seed,
      crystalValleyBiome.landmarks,
    );
    const [px, pz] = crystalValleyBiome.terrain.poolCenter;
    expect(field.getHeightAt(px, pz)).toBeLessThan(crystalValleyBiome.terrain.waterLevel - 0.8);
    expect(field.getHeightAt(12, -35)).toBeGreaterThan(crystalValleyBiome.terrain.waterLevel + 5.0);
  });

  it('flattens terrain around configured campsiteCenter landmark', () => {
    const defaultField = new TerrainHeightfield(
      crystalValleyBiome.terrain,
      crystalValleyBiome.seed,
      crystalValleyBiome.landmarks,
    );
    const customLandmarks = {
      ...crystalValleyBiome.landmarks,
      campsiteCenter: [18.0, 10.0] as [number, number],
    };
    const customField = new TerrainHeightfield(
      crystalValleyBiome.terrain,
      crystalValleyBiome.seed,
      customLandmarks,
    );
    // Moving campsiteCenter to (18, 10) must noticeably alter elevation and reduce slope there
    expect(customField.getHeightAt(18.0, 10.0)).not.toBeCloseTo(defaultField.getHeightAt(18.0, 10.0), 1);
    expect(customField.getSlopeAt(18.0, 10.0)).toBeLessThan(defaultField.getSlopeAt(18.0, 10.0));
  });
});
