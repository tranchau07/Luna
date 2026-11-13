---
trigger: always_on
description: "WebGL performance constraints, instancing rules, VRAM disposal, quality tiers, and local-first asset policy."
---
# WebGL & GPU Memory Invariants

1. **Instancing for Scattered Entities:** All repeated/scattered elements (grass blades, wildflowers, pebbles, bamboo culms, ferns, stepping stones, falling leaves) MUST use `THREE.InstancedMesh` or GPU particle batches. For `@dgreenheck/ez-tree`, generate 3–5 seeded tree variants and instance their trunk and foliage geometries separately; at most 3 non-instanced "hero trees" are permitted per biome.
2. **Deterministic VRAM Disposal:** Every `IWorldSystem.dispose()` implementation must dispose all created `BufferGeometry`, `Material`, `Texture`, and render targets, remove added `Object3D` nodes from the scene, and detach DOM/event listeners.
3. **Quality Tiers & Background Optimization:** Support `Low`, `Medium`, and `High` quality tiers scaling pixel ratio, shadow map size, grass density, and postprocessing passes. `Eco Mode` caps rendering at 30 FPS and pixel ratio `1`. When `document.hidden === true`, pause WebGL rendering (while keeping ambient audio active unless muted-on-hide is enabled) and clamp `dt <= 0.1` on resume.
4. **Local-First Assets with Procedural Fallback:** Never hardcode remote third-party asset URLs (which break via CORS/404). Store any CC0 textures/HDRIs locally under `public/assets/`, and ensure `AssetLoader` provides 100% self-contained procedural normal maps, foliage alpha textures, and Web Audio synthesis fallbacks.
