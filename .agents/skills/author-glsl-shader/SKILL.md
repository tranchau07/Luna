---
name: author-glsl-shader
description: Creates and injects custom GLSL shaders (wind sway, water Fresnel/caustics, mossy rock blending, wet shorelines) using three-custom-shader-material/vanilla without breaking Three.js shadows or fog. Use when authoring or debugging shaders and materials.
---
# Author GLSL Shader (CSM Workflow)

1. **Define Typed Uniforms:** Declare a strongly typed `uniforms` record (`Record<string, THREE.IUniform>`) for time, wind direction/strength, water depth, moss threshold, and weather factors.
2. **Procedural Normal Maps (if needed):** Use `AssetLoader.createProceduralNormalMap(...)` (Sobel filter over FBM height data) or load a local CC0 texture from `public/assets/` with procedural fallback.
3. **Extend PBR via `three-custom-shader-material/vanilla`:**
   - Import `CustomShaderMaterial from 'three-custom-shader-material/vanilla'`.
   - Set `baseMaterial: THREE.MeshStandardMaterial` (or `MeshPhysicalMaterial`).
   - Use `csm_Position`, `csm_Normal`, `csm_DiffuseColor`, `csm_Roughness`, and `csm_Emissive` rather than overwriting `gl_FragColor`, preserving `PCFSoftShadowMap`, `FogExp2`, and PMREM environment lighting.
   - For instanced meshes, pass `instanceMatrix` transforms cleanly (CSM respects Three.js `USE_INSTANCING`).
4. **Verify Compilation:** Run `npm run smoke` (or open Chrome DevTools in local Antigravity Browser) and confirm zero `THREE.WebGLProgram: Shader Error` warnings in the console.
