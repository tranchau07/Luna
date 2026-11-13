# Luna — Ambient 3D World Kit

A modular, production-grade **Vite + TypeScript + Three.js** framework for interactive 3D ambient nature scenes, built with Google Antigravity Workspace Rules (`GEMINI.md`, `.agents/rules/`) and Agent Skills (`.agents/skills/`).

## Key Architecture & Features
- **Modular Lifecycle (`IWorldSystem`):** `Engine` orchestrates `SkyAtmosphere`, `TerrainSystem`, `WaterSystem`, `RockSystem`, `FoliageSystem`, `ArchitectureSystem`, `AIManager`, `ParticleSystem`, `SpatialAudio`, and `RaycastPicker`.
- **Data-Driven Biomes:** `crystalValleyBiome` in `src/config/crystalValley.biome.ts` defines deterministic `simplex-noise` (`alea`) terrain carving, 4 weather presets (`Morning Mist`, `Sunlit Noon`, `Golden Hour`, `Moonlit Night`), and 5 camera presets.
- **Custom Shaders & Postprocessing:** Uses `three-custom-shader-material/vanilla` for wet shorelines, mossy boulders, and GPU wind sway alongside single-pass ACES Filmic tone mapping, SMAA, selective bloom, and tier-gated God Rays via `postprocessing`.
- **Instanced Botany & BVH Acceleration:** Instanced `@dgreenheck/ez-tree` variants, bamboo groves, alpha-cutout ferns, wildflowers, and up to 25,000 grass blades, with `three-mesh-bvh` powering fast click picking and terrain camera collision clamping.
- **Wildlife AI & VFX:** Yuka-driven koi schooling (summonable by clicking water), Sika deer FSM (`Graze` / `Stroll` / `Drink`), birds, butterflies, and `three.quarks` batched waterfall mist, fireflies, and falling leaves.
- **Zero Broken External Assets:** Procedural Sobel normal maps, foliage alpha textures, and Web Audio API spatial nature synthesis run standalone, with local CC0 asset override support in `public/assets/`.
- **Zen HUD & Performance Controls:** Glassmorphism HUD (`[H]` to hide), 25/5 Pomodoro focus timer, Quality Tiers (`Low`, `Medium`, `High`), `Eco 30fps` mode, and Page Visibility auto-pause with `dt <= 0.1` clamping.

## Commands
```bash
npm install
npm run dev        # Start Vite dev server (includes lil-gui & stats-gl)
npm run typecheck  # Strict TypeScript check
npm run lint       # ESLint check
npm test           # Vitest unit tests
npm run build      # Production build (dist/)
npm run smoke      # Headless Chromium WebGL smoke & VRAM leak verification
```

## Real-GPU 60 FPS Profiling
Headless cloud verification uses Chromium SwiftShader software rendering to validate console cleanliness, shader compilation, interactions, screenshots, and `dispose()` memory cleanup. To verify 60 FPS hardware performance, run `npm run dev` on a GPU-equipped machine and inspect the `stats-gl` overlay in Chrome DevTools.
