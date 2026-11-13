---
name: create-biome
description: Scaffolds a new data-driven 3D nature biome configuration, procedural terrain heightfield, botanical foliage palette, wildlife counts, and lighting presets. Use when adding a new scene or environment theme.
---
# Create Biome Workflow

1. **Define Config Module:** Create `src/config/<name>.biome.ts` implementing the `BiomeConfig` interface in `src/config/BiomeConfig.ts`.
2. **Terrain & Seed:** Specify a deterministic seed string, `simplex-noise` (`alea`) FBM + ridged multifractal parameters, valley stream carving curve, waterfall ledge heights, and slope/elevation thresholds for rock, moss, grass, and water beds.
3. **Botanical & Material Palette:** Configure `ez-tree` presets, bamboo grove zones, grass/wildflower density per quality tier, and mossy rock colors.
4. **Weather & Camera Presets:** Define lighting presets (`Morning`, `Noon`, `GoldenHour`, `Moonlight`) with sun/moon elevation, fog density, exposure (`0.95`–`1.15`), and named `CameraPreset` coordinates.
5. **Validate & Register:** Add unit tests checking `validateBiomeConfig(config)` and register the biome in `Engine`, ensuring switching biomes calls `dispose()` cleanly without leaking GPU resources.
