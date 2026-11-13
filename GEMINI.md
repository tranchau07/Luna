# Luna — Ambient 3D World Kit Architecture

## Core Invariants
1. **System Lifecycle (`IWorldSystem`):** Every subsystem in `src/world/`, `src/ai/`, `src/vfx/`, `src/audio/`, and `src/interaction/` MUST implement `IWorldSystem` (`init()`, `update(dt, elapsed)`, `dispose()`).
2. **Data-Driven Biomes:** All scene parameters (terrain noise, water palette, foliage scatter, wildlife counts, weather presets, camera presets) live in `src/config/*.biome.ts` and are validated before use. Systems must not hardcode biome magic numbers.
3. **Typed EventBus Communication:** UI (`HudController`) and 3D engine systems communicate exclusively through the strongly typed `EventBus` in `src/core/EventBus.ts`. UI never mutates Three.js scene objects directly.
4. **Use Official `three/addons`:** Do not install or import `three-stdlib`. Always import official Three.js addons from `three/addons/...` so versions remain locked with `three`.
5. **Deterministic Time & Disposal:** `Engine` clamps frame delta `dt <= 0.1` seconds to prevent physics/AI spikes after tab switching, handles `webglcontextlost`/`webglcontextrestored`, and supports `Low | Medium | High` quality tiers plus `Eco Mode`.

## Directory Layout
- `src/core/`: `IWorldSystem.ts`, `Engine.ts`, `CameraRig.ts`, `AssetLoader.ts`, `EventBus.ts`, `PostPipeline.ts`, `QualityConfig.ts`
- `src/config/`: `BiomeConfig.ts`, `crystalValley.biome.ts`
- `src/world/`: `TerrainSystem.ts`, `WaterSystem.ts`, `RockSystem.ts`, `FoliageSystem.ts`, `ArchitectureSystem.ts`, `SkyAtmosphere.ts`
- `src/ai/`: `AIManager.ts`, `FishFlockAI.ts`, `WildlifeFSM.ts`
- `src/vfx/`: `ParticleSystem.ts`
- `src/audio/`: `SpatialAudio.ts`
- `src/interaction/`: `RaycastPicker.ts`
- `src/ui/`: `HudController.ts`
- `src/debug/`: `DebugPanel.ts` (loaded conditionally when `import.meta.env.DEV`)
