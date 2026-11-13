---
trigger: glob
globs: "src/ai/**/*.ts, src/interaction/**/*.ts, src/core/CameraRig.ts"
description: "Yuka AI decoupling standards and three-mesh-bvh accelerated raycasting/collision rules."
---
# Wildlife AI & Raycasting Rules

1. **Decouple AI Simulation from Rendering:** All flocking (koi fish, birds, butterflies) via `Yuka.SteeringBehaviors` and creature behaviors (deer `Yuka.StateMachine`) run in pure simulation entities inside `src/ai/`. Only transform matrices and skeletal/articulated group angles are synced to `THREE.Object3D` during `AIManager.update(dt)`.
2. **BVH Acceleration for Raycasting & Camera Collisions:** Patch `THREE.BufferGeometry.prototype.computeBoundsTree`, `disposeBoundsTree`, and `THREE.Mesh.prototype.raycast` (`acceleratedRaycast`) once at engine initialization. Compute BVH bounds trees for high-resolution terrain and large collision rocks so both `RaycastPicker` clicks and `CameraRig` terrain collision checks stay fast.
