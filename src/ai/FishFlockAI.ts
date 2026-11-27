import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import * as YUKA from 'yuka';
import Alea from 'alea';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { RockObstacle } from '../world/RockSystem';

export interface KoiAgent {
  id: string;
  label: string;
  vehicle: YUKA.Vehicle;
  root: THREE.Object3D;
  arriveBehavior: YUKA.ArriveBehavior;
  wanderBehavior: YUKA.WanderBehavior;
  phase: number;
  scale: number;
  variant: number;
  variantIdx: number;
  globalIdx: number;
}

function normalizeForMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') {
      g.deleteAttribute(key);
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  return g;
}

const KOI_SWIM_VERT = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  void main() {
    vec3 p = position;
    // Traveling S-curve swim wave along koi spine (+z head -> -z caudal tail)
    float tailT = clamp((0.36 - p.z) / 0.85, 0.0, 1.0);
    float wave = sin(uTime * 7.2 + aPhase - p.z * 5.2);
    p.x += wave * (0.018 + tailT * tailT * 0.14);
    // Subtle pectoral fin flutter on outer lateral vertices
    float lateral = smoothstep(0.11, 0.28, abs(p.x));
    p.y += sin(uTime * 5.2 + aPhase) * lateral * 0.032;
    csm_Position = p;
  }
`;

/**
 * Manages a Yuka-driven koi school with Wander, Cohesion, Alignment, Separation,
 * ObstacleAvoidance around boulders, and interactive Arrive summoning when clicking water.
 * Rendered via 5 GPU-animated InstancedMeshes (3 skin variants + 1 fins/tail + 1 eyes)
 * with smooth vertex-shader S-curve undulation and per-instance click picking.
 */
export class FishFlockAI {
  readonly agents: KoiAgent[] = [];
  readonly clickableMeshes: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly entityManager: YUKA.EntityManager;
  private readonly obstacles: RockObstacle[];
  private readonly assets: AssetLoader;

  private bodyInsts: THREE.InstancedMesh[] = [];
  private finInst: THREE.InstancedMesh | null = null;
  private eyeInst: THREE.InstancedMesh | null = null;
  private swimMats: CustomShaderMaterial[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private yukaObstacles: YUKA.GameEntity[] = [];
  private dummy = new THREE.Object3D();
  private summonTimer = 0;

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    entityManager: YUKA.EntityManager,
    obstacles: RockObstacle[],
    assets: AssetLoader,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.entityManager = entityManager;
    this.obstacles = obstacles;
    this.assets = assets;
  }

  init(): void {
    const count = this.biome.wildlife.koiCount;
    if (count <= 0) return;

    const prng = Alea(`${this.biome.seed}-koi`);
    const [poolX, poolZ] = this.biome.terrain.poolCenter;
    const poolRadius = this.biome.terrain.poolRadius * 0.68;

    // 1. Hydrodynamic teardrop fusiform koi body template
    const baseBodyGeo = new THREE.SphereGeometry(0.15, 16, 12);
    const bPos = baseBodyGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bPos.count; i++) {
      const x = bPos.getX(i);
      const y = bPos.getY(i);
      const z = bPos.getZ(i);
      const t = Math.max(0, Math.min(1, (z / 0.15 + 1) * 0.5));
      const widthTaper = Math.sin(Math.pow(t, 0.68) * Math.PI) * 0.92 + 0.14;
      const heightTaper =
        (Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.82 + 0.18) * (y > 0 ? 1.12 : 0.82);
      bPos.setXYZ(i, x * widthTaper, y * heightTaper, z * 2.55);
    }
    baseBodyGeo.computeVertexNormals();

    // 2. Merge dorsal fin, forked caudal tail, pectoral fins, pelvic fins, and barbels into 1 fin geometry
    const finParts: THREE.BufferGeometry[] = [];
    const tmp = new THREE.Object3D();
    const pushFinPart = (
      template: THREE.BufferGeometry,
      px: number,
      py: number,
      pz: number,
      rx = 0,
      ry = 0,
      rz = 0,
      sx = 1,
      sy = 1,
      sz = 1,
    ) => {
      const g = normalizeForMerge(template);
      tmp.position.set(px, py, pz);
      tmp.rotation.set(rx, ry, rz);
      tmp.scale.set(sx, sy, sz);
      tmp.updateMatrix();
      g.applyMatrix4(tmp.matrix);
      finParts.push(g);
    };

    const dorsalT = new THREE.PlaneGeometry(0.24, 0.11, 3, 1);
    dorsalT.rotateY(Math.PI / 2);
    pushFinPart(dorsalT, 0, 0.12, -0.02);

    const tailLobeT = new THREE.ConeGeometry(0.085, 0.32, 4);
    tailLobeT.rotateX(Math.PI / 2);
    tailLobeT.scale(0.22, 1.0, 1.0);
    tailLobeT.translate(0, 0, -0.15);
    pushFinPart(tailLobeT, 0, 0, -0.34, 0.24, 0, 0, 1, 1, 1);
    pushFinPart(tailLobeT, 0, 0, -0.34, -0.22, 0, 0, 0.88, 0.88, 0.88);

    const pectoralT = new THREE.ConeGeometry(0.095, 0.22, 4);
    pectoralT.rotateZ(Math.PI / 2);
    pectoralT.scale(1.0, 0.16, 0.85);
    pushFinPart(pectoralT, -0.11, -0.03, 0.11, 0, 0.42, 0, 1, 1, 1);
    pushFinPart(pectoralT, 0.11, -0.03, 0.11, 0, -0.42, 0, -1, 1, 1);
    pushFinPart(pectoralT, -0.07, -0.055, -0.1, 0, 0.55, 0, 0.55, 0.55, 0.55);
    pushFinPart(pectoralT, 0.07, -0.055, -0.1, 0, -0.55, 0, -0.55, 0.55, 0.55);

    const barbelT = new THREE.CylinderGeometry(0.004, 0.001, 0.065, 4);
    barbelT.translate(0, -0.03, 0);
    for (const side of [-1, 1]) {
      pushFinPart(barbelT, side * 0.042, -0.015, 0.34, 0.35, 0, side * 0.45);
    }

    const allFinsGeo = mergeGeometries(finParts, false)!;
    dorsalT.dispose();
    tailLobeT.dispose();
    pectoralT.dispose();
    barbelT.dispose();
    finParts.forEach((p) => p.dispose());

    // 3. Merge paired eyes into 1 geometry
    const eyeT = new THREE.SphereGeometry(0.018, 6, 6);
    const eyeParts = [-1, 1].map((side) => {
      const e = normalizeForMerge(eyeT);
      e.translate(side * 0.068, 0.035, 0.25);
      return e;
    });
    const eyesGeo = mergeGeometries(eyeParts, false)!;
    eyeT.dispose();
    eyeParts.forEach((p) => p.dispose());

    // Convert underwater/rim rock obstacles into Yuka avoidance entities
    for (const obs of this.obstacles) {
      if (Math.hypot(obs.x - poolX, obs.z - poolZ) < poolRadius + 3) {
        const entity = new YUKA.GameEntity();
        entity.position.set(obs.x, this.biome.terrain.waterLevel - 0.55, obs.z);
        entity.boundingRadius = obs.radius + 0.5;
        this.yukaObstacles.push(entity);
        this.entityManager.add(entity);
      }
    }

    const variantPhases: number[][] = [[], [], []];
    const variantIds: string[][] = [[], [], []];
    const variantLabels: string[][] = [[], [], []];
    const allPhases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const variant = i % 3;
      const variantIdx = variantPhases[variant].length;
      const phase = prng() * Math.PI * 2;
      const scale = 0.85 + prng() * 0.45;
      const id = `koi-${i}`;
      const label = `Koi #${i + 1}`;

      variantPhases[variant].push(phase);
      variantIds[variant].push(id);
      variantLabels[variant].push(label);
      allPhases[i] = phase;

      const angle = prng() * Math.PI * 2;
      const r = 1.5 + prng() * (poolRadius - 2.0);
      const startX = poolX + Math.cos(angle) * r;
      const startZ = poolZ + Math.sin(angle) * r;
      const startY = this.biome.terrain.waterLevel - (0.36 + prng() * 0.42);

      // Lightweight anchor Object3D so CameraRig follow-camera can track individual koi
      const root = new THREE.Object3D();
      root.name = id;
      root.position.set(startX, startY, startZ);

      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(startX, startY, startZ);
      vehicle.maxSpeed = 1.55 + prng() * 0.45;
      vehicle.maxForce = 2.6;
      vehicle.boundingRadius = 0.42;
      vehicle.updateNeighborhood = true;
      vehicle.neighborhoodRadius = 4.2;

      const wander = new YUKA.WanderBehavior(1.4, 2.5, 1.2);
      wander.weight = 1.2;

      const separation = new YUKA.SeparationBehavior();
      separation.weight = 1.6;

      const alignment = new YUKA.AlignmentBehavior();
      alignment.weight = 0.7;

      const cohesion = new YUKA.CohesionBehavior();
      cohesion.weight = 0.65;

      const avoidance = new YUKA.ObstacleAvoidanceBehavior(this.yukaObstacles);
      avoidance.weight = 2.4;

      const arrive = new YUKA.ArriveBehavior(new YUKA.Vector3(poolX, startY, poolZ), 2.5, 0.5);
      arrive.active = false;
      arrive.weight = 2.6;

      vehicle.steering.add(wander);
      vehicle.steering.add(separation);
      vehicle.steering.add(alignment);
      vehicle.steering.add(cohesion);
      vehicle.steering.add(avoidance);
      vehicle.steering.add(arrive);

      this.entityManager.add(vehicle);

      this.agents.push({
        id,
        label,
        vehicle,
        root,
        arriveBehavior: arrive,
        wanderBehavior: wander,
        phase,
        scale,
        variant,
        variantIdx,
        globalIdx: i,
      });
    }

    // Build 3 instanced koi body meshes (1 per skin pattern variant)
    for (let v = 0; v < 3; v++) {
      const vCount = variantPhases[v].length;
      if (vCount === 0) continue;

      const bodyGeo = baseBodyGeo.clone();
      bodyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(variantPhases[v]), 1));
      bodyGeo.computeBoundsTree();
      this.geometries.push(bodyGeo);

      const skinTex = this.assets.getKoiSkinTexture(v, 256);
      const bodyMat = new CustomShaderMaterial({
        baseMaterial: THREE.MeshStandardMaterial,
        map: skinTex,
        roughness: 0.2,
        metalness: 0.08,
        uniforms: { uTime: { value: 0 } },
        vertexShader: KOI_SWIM_VERT,
      });
      this.materials.push(bodyMat);
      this.swimMats.push(bodyMat);

      const inst = new THREE.InstancedMesh(bodyGeo, bodyMat, vCount);
      inst.name = `koi-bodies-v${v}`;
      inst.castShadow = true;
      inst.frustumCulled = false;
      inst.userData = {
        interactableType: 'wildlife',
        instanceEntityIds: variantIds[v],
        instanceLabels: variantLabels[v],
      };
      this.bodyInsts.push(inst);
      this.clickableMeshes.push(inst);
      this.scene.add(inst);
    }
    baseBodyGeo.dispose();

    // Build 1 shared instanced mesh for all koi fins & forked tails
    allFinsGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(allPhases, 1));
    this.geometries.push(allFinsGeo);

    const finMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      color: '#ffffff',
      roughness: 0.32,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: KOI_SWIM_VERT,
    });
    this.materials.push(finMat);
    this.swimMats.push(finMat);

    this.finInst = new THREE.InstancedMesh(allFinsGeo, finMat, count);
    this.finInst.name = 'koi-fins';
    this.finInst.frustumCulled = false;
    const finColors = ['#fff5eb', '#ffece0', '#fce3b6'].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      this.finInst.setColorAt(i, finColors[i % finColors.length]);
    }
    if (this.finInst.instanceColor) this.finInst.instanceColor.needsUpdate = true;
    this.scene.add(this.finInst);

    // Build 1 shared instanced mesh for all koi eyes
    eyesGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(allPhases.slice(), 1));
    this.geometries.push(eyesGeo);

    const eyeMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      color: '#111317',
      roughness: 0.1,
      uniforms: { uTime: { value: 0 } },
      vertexShader: KOI_SWIM_VERT,
    });
    this.materials.push(eyeMat);
    this.swimMats.push(eyeMat);

    this.eyeInst = new THREE.InstancedMesh(eyesGeo, eyeMat, count);
    this.eyeInst.name = 'koi-eyes';
    this.eyeInst.frustumCulled = false;
    this.scene.add(this.eyeInst);
  }

  summonTo(x: number, z: number): void {
    const [poolX, poolZ] = this.biome.terrain.poolCenter;
    const dx = x - poolX;
    const dz = z - poolZ;
    const maxR = this.biome.terrain.poolRadius * 0.72;
    const dist = Math.hypot(dx, dz);
    const clampedX = dist > maxR ? poolX + (dx / dist) * maxR : x;
    const clampedZ = dist > maxR ? poolZ + (dz / dist) * maxR : z;

    this.summonTimer = 6.5;
    for (const agent of this.agents) {
      agent.arriveBehavior.target.set(clampedX, agent.vehicle.position.y, clampedZ);
      agent.arriveBehavior.active = true;
      agent.wanderBehavior.weight = 0.45;
    }
  }

  update(dt: number, elapsed: number): void {
    const [poolX, poolZ] = this.biome.terrain.poolCenter;
    const maxR = this.biome.terrain.poolRadius * 0.68;
    const targetY = this.biome.terrain.waterLevel - 0.48;

    if (this.summonTimer > 0) {
      this.summonTimer -= dt;
      if (this.summonTimer <= 0) {
        for (const agent of this.agents) {
          agent.arriveBehavior.active = false;
          agent.wanderBehavior.weight = 1.2;
        }
      }
    }

    for (const mat of this.swimMats) {
      mat.uniforms.uTime.value = elapsed;
    }

    for (const agent of this.agents) {
      const v = agent.vehicle;
      v.position.y = THREE.MathUtils.lerp(v.position.y, targetY, 0.15);
      v.velocity.y = 0;

      const dx = v.position.x - poolX;
      const dz = v.position.z - poolZ;
      const dist = Math.hypot(dx, dz);
      if (dist > maxR) {
        const pull = (dist - maxR) * 1.4;
        v.velocity.x -= (dx / dist) * pull * dt * 5;
        v.velocity.z -= (dz / dist) * pull * dt * 5;
      }

      agent.root.position.set(v.position.x, v.position.y, v.position.z);
      agent.root.quaternion.set(v.rotation.x, v.rotation.y, v.rotation.z, v.rotation.w);

      this.dummy.position.copy(agent.root.position);
      this.dummy.quaternion.copy(agent.root.quaternion);
      this.dummy.scale.setScalar(agent.scale);
      this.dummy.updateMatrix();

      this.bodyInsts[agent.variant]?.setMatrixAt(agent.variantIdx, this.dummy.matrix);
      this.finInst?.setMatrixAt(agent.globalIdx, this.dummy.matrix);
      this.eyeInst?.setMatrixAt(agent.globalIdx, this.dummy.matrix);
    }

    for (const inst of this.bodyInsts) {
      inst.instanceMatrix.needsUpdate = true;
    }
    if (this.finInst) this.finInst.instanceMatrix.needsUpdate = true;
    if (this.eyeInst) this.eyeInst.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const agent of this.agents) {
      this.entityManager.remove(agent.vehicle);
    }
    this.agents.length = 0;
    this.clickableMeshes.length = 0;

    for (const inst of this.bodyInsts) {
      this.scene.remove(inst);
      inst.dispose();
    }
    this.bodyInsts = [];

    if (this.finInst) {
      this.scene.remove(this.finInst);
      this.finInst.dispose();
      this.finInst = null;
    }
    if (this.eyeInst) {
      this.scene.remove(this.eyeInst);
      this.eyeInst.dispose();
      this.eyeInst = null;
    }
    this.swimMats = [];

    for (const obs of this.yukaObstacles) {
      this.entityManager.remove(obs);
    }
    this.yukaObstacles = [];

    for (const g of this.geometries) {
      g.disposeBoundsTree?.();
      g.dispose();
    }
    this.geometries = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }
}
