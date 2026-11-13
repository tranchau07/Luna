---
trigger: glob
globs: "src/world/**/*.ts, src/vfx/**/*.ts, src/core/PostPipeline.ts, **/*.glsl"
description: "GLSL shader authoring standards with three-custom-shader-material/vanilla, foliage cutout, and single-pass ACES tone mapping."
---
# Shaders & Lighting Rules

1. **Use `three-custom-shader-material/vanilla`:** Extend `MeshStandardMaterial` or `MeshPhysicalMaterial` via `CustomShaderMaterial` for wind sway, mossy rock top-blending, and wet-shoreline darkening so Three.js `PCFSoftShadowMap`, `FogExp2`, and PMREM environment lighting remain intact.
2. **Single-Pass ACES Tone Mapping:** Because `PostPipeline` uses `postprocessing` (`EffectComposer`), set `renderer.toneMapping = THREE.NoToneMapping` and apply `ToneMappingEffect` (`ToneMappingMode.ACES_FILMIC`) once at the end of the effect pass chain. Tune exposure via `renderer.toneMappingExposure` / post-pass uniforms within `0.95`–`1.15` to avoid blown-out highlights.
3. **Alpha-Cutout Foliage:** Use `alphaTest` (`0.35`–`0.45`) with `THREE.DoubleSide` instead of `transparent: true` on leaves, ferns, grass, and wildflowers to prevent depth-sorting artifacts and keep crisp shadow casting.
4. **Tier-Gated Expensive Effects:** God rays (`GodRaysEffect`) and optional planar water reflection are restricted to `High` quality; water uses Fresnel, depth-faded absorption, procedural caustics, and PMREM environment reflections across all tiers.
