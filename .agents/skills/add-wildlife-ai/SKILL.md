---
name: add-wildlife-ai
description: Implements autonomous 3D animals or flocking creatures using Yuka SteeringBehaviors and Finite State Machines synced with articulated Three.js meshes. Use when adding fish, deer, birds, butterflies, or insects.
---
# Add Wildlife AI Workflow

1. **Build Articulated Three.js Rig:** Construct lightweight procedural/articulated `THREE.Group` hierarchies with named pivot groups (e.g., head, neck, tail segments, pectoral fins, legs, wings) sharing `BufferGeometry` and `Material` instances so they dispose cleanly.
2. **Configure Yuka Entities:**
   - Create `Yuka.Vehicle` instances inside `src/ai/` with bounding radii, `maxSpeed`, and `maxForce`.
   - Attach steering behaviors (`WanderBehavior`, `ObstacleAvoidanceBehavior`, `SeparationBehavior`, `AlignmentBehavior`, `CohesionBehavior`, or temporary `ArriveBehavior` targets triggered via `EventBus`).
   - For multi-state animals (e.g., deer), implement `Yuka.StateMachine` states (`Graze`, `Stroll`, `Drink`, `Rest`) with smooth animation blending.
3. **Sync in `AIManager`:** Advance `Yuka.EntityManager.update(dt)` inside `AIManager.update(dt, elapsed)`, clamp entities inside valid terrain/water bounds, and copy world positions/quaternions plus procedural limb/tail sway to the Three.js rigs.
4. **Cleanup:** Dispose shared geometries/materials and clear all `Yuka.EntityManager` entities in `dispose()`.
