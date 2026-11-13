---
name: verify-webgl-scene
description: Verifies the Three.js WebGL scene via automated headless Chromium smoke tests (zero console/GLSL errors, camera presets, weather changes, raycast interactions, VRAM disposal leak checks, screenshots) or local Antigravity Browser + Chrome DevTools for real-GPU 60 FPS profiling. Use when testing or finalizing the 3D framework.
---
# Verify WebGL Scene Workflow

## Mode A: Cloud / Headless Verification (No GPU)
1. **Static Checks:** Run `npx tsc --noEmit && npm run lint && npm test && npm run build`.
2. **Headless WebGL Smoke Test:** Run `npm run smoke` (`scripts/smoke.mjs` with Playwright + Chromium SwiftShader WebGL):
   - Serve the production `dist/` bundle via `vite preview`.
   - Assert zero uncaught page errors, zero console errors, and zero `THREE.WebGLProgram` shader compilation warnings.
   - Exercise camera presets, weather presets (`Morning`, `Noon`, `GoldenHour`, `Moonlight`), quality tiers (`Low`, `Medium`, `High`), Eco Mode, and simulated canvas clicks (water summon, lantern toggle).
   - Capture PNG screenshots for visual inspection.
   - Invoke `window.__LUNA_DEBUG__.disposeScene()` and assert `renderer.info.memory.geometries` and `textures` return to baseline (zero VRAM leaks).

## Mode B: Local GPU Verification (Antigravity Integrated Browser + DevTools)
1. Start `npm run dev` and open the URL in the integrated browser with Chrome DevTools.
2. Open the DevTools Console and confirm zero runtime errors or shader warnings.
3. Inspect `stats-gl` at `Medium` and `High` quality tiers on real GPU hardware to verify steady 60 FPS (and 30 FPS cap in Eco Mode).
4. Test zoom, orbit, terrain collision clamping, camera presets, weather transitions, water click fish summoning, tree shake leaf drop, lantern toggle, and spatial audio zoom attenuation.
