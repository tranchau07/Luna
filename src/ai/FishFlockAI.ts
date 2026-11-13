import * as THREE from 'three';
import * as YUKA from 'yuka';
import Alea from 'alea';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { RockObstacle } from '../world/RockSystem';

export interface KoiAgent {
  id: string;
  vehicle: YUKA.Vehicle;
  root: THREE.Group;
  bodyGroup: THREE.Group;
  tailGroup: THREE.Group;
  dorsalFin: THREE.Mesh;
  finLeft: THREE.Mesh;
  finRight: THREE.Mesh;
  arriveBehavior: YUKA.ArriveBehavior;
  wanderBehavior: YUKA.WanderBehavior;
  phase: number;
}

/**
 * Manages a Yuka-driven koi school with Wander, Cohesion, Alignment, Separation,
 * ObstacleAvoidance around boulders, and interactive Arrive summoning when clicking water.
 * Each koi features Kohaku/Sanke/Showa patterned skin, dorsal fin, forked caudal tail, eyes, and barbels.
 */
export class FishFlockAI {
  readonly agents: KoiAgent[] = [];
  readonly clickableMeshes: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly entityManager: YUKA.EntityManager;
  private readonly obstacles: RockObstacle[];
  private readonly assets: AssetLoader;

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private yukaObstacles: YUKA.GameEntity[] = [];
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
    const prng = Alea(`${this.biome.seed}-koi`);
    const [poolX, poolZ] = this.biome.terrain.poolCenter;
    const poolRadius = this.biome.terrain.poolRadius * 0.68;

    // 1. Hydrodynamic teardrop fusiform koi body geometry
    const bodyGeo = new THREE.SphereGeometry(0.15, 16, 12);
    const bPos = bodyGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bPos.count; i++) {
      const x = bPos.getX(i);
      const y = bPos.getY(i);
      const z = bPos.getZ(i);
      // z in [-0.15, +0.15]; +z is head, -z is tail peduncle
      const t = Math.max(0, Math.min(1, (z / 0.15 + 1) * 0.5)); // 0 at tail, 1 at snout
      const widthTaper = Math.sin(Math.pow(t, 0.68) * Math.PI) * 0.92 + 0.14;
      const heightTaper =
        (Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.82 + 0.18) * (y > 0 ? 1.12 : 0.82);
      bPos.setXYZ(i, x * widthTaper, y * heightTaper, z * 2.55);
    }
    bodyGeo.computeVertexNormals();

    // 2. Dorsal fin, pectoral fins, pelvic fins, forked caudal tail, eyes, and barbels
    const dorsalGeo = new THREE.PlaneGeometry(0.24, 0.11, 3, 1);
    dorsalGeo.rotateY(Math.PI / 2);
    dorsalGeo.translate(0, 0.12, -0.02);

    const tailLobeGeo = new THREE.ConeGeometry(0.085, 0.32, 4);
    tailLobeGeo.rotateX(Math.PI / 2);
    tailLobeGeo.scale(0.22, 1.0, 1.0);
    tailLobeGeo.translate(0, 0, -0.15);

    const pectoralGeo = new THREE.ConeGeometry(0.095, 0.22, 4);
    pectoralGeo.rotateZ(Math.PI / 2);
    pectoralGeo.scale(1.0, 0.16, 0.85);

    const eyeGeo = new THREE.SphereGeometry(0.018, 6, 6);
    const barbelGeo = new THREE.CylinderGeometry(0.004, 0.001, 0.065, 4);
    barbelGeo.translate(0, -0.03, 0);

    this.geometries.push(bodyGeo, dorsalGeo, tailLobeGeo, pectoralGeo, eyeGeo, barbelGeo);

    const finColors = ['#fff5eb', '#ffece0', '#fce3b6'];
    const sharedMats = [0, 1, 2].map((variant) => {
      const skinTex = this.assets.getKoiSkinTexture(variant, 256);
      const bodyMat = new THREE.MeshStandardMaterial({
        map: skinTex,
        roughness: 0.2,
        metalness: 0.08,
      });
      const finMat = new THREE.MeshStandardMaterial({
        color: finColors[variant],
        roughness: 0.32,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
      });
      this.materials.push(bodyMat, finMat);
      return { bodyMat, finMat };
    });

    const eyeMat = new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.1 });
    this.materials.push(eyeMat);

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

    for (let i = 0; i < this.biome.wildlife.koiCount; i++) {
      const palette = sharedMats[i % sharedMats.length];
      const angle = prng() * Math.PI * 2;
      const r = 1.5 + prng() * (poolRadius - 2.0);
      const startX = poolX + Math.cos(angle) * r;
      const startZ = poolZ + Math.sin(angle) * r;
      const startY = this.biome.terrain.waterLevel - (0.36 + prng() * 0.42);

      const root = new THREE.Group();
      const id = `koi-${i}`;
      root.name = id;

      const bodyGroup = new THREE.Group();
      const userData = { interactableType: 'wildlife', entityId: id, label: `Koi #${i + 1}` };

      const body = new THREE.Mesh(bodyGeo, palette.bodyMat);
      body.castShadow = true;
      body.userData = userData;

      const dorsalFin = new THREE.Mesh(dorsalGeo, palette.finMat);

      // Eyes & sensory barbels at snout
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(side * 0.068, 0.035, 0.25);
        const barbel = new THREE.Mesh(barbelGeo, palette.finMat);
        barbel.position.set(side * 0.042, -0.015, 0.34);
        barbel.rotation.z = side * 0.45;
        barbel.rotation.x = 0.35;
        bodyGroup.add(eye, barbel);
      }

      // Forked upper and lower caudal tail lobes
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0, -0.34);
      const upperLobe = new THREE.Mesh(tailLobeGeo, palette.finMat);
      upperLobe.rotation.x = 0.24;
      const lowerLobe = new THREE.Mesh(tailLobeGeo, palette.finMat);
      lowerLobe.rotation.x = -0.22;
      lowerLobe.scale.setScalar(0.88);
      tailGroup.add(upperLobe, lowerLobe);

      // Paired pectoral and pelvic fins
      const finLeft = new THREE.Mesh(pectoralGeo, palette.finMat);
      finLeft.position.set(-0.11, -0.03, 0.11);
      finLeft.rotation.y = 0.42;

      const finRight = new THREE.Mesh(pectoralGeo, palette.finMat);
      finRight.position.set(0.11, -0.03, 0.11);
      finRight.rotation.y = -0.42;
      finRight.scale.x = -1;

      const pelvicL = new THREE.Mesh(pectoralGeo, palette.finMat);
      pelvicL.position.set(-0.07, -0.055, -0.1);
      pelvicL.scale.setScalar(0.55);
      pelvicL.rotation.y = 0.55;

      const pelvicR = new THREE.Mesh(pectoralGeo, palette.finMat);
      pelvicR.position.set(0.07, -0.055, -0.1);
      pelvicR.scale.set(-0.55, 0.55, 0.55);
      pelvicR.rotation.y = -0.55;

      bodyGroup.add(body, dorsalFin, tailGroup, finLeft, finRight, pelvicL, pelvicR);
      root.add(bodyGroup);

      const scale = 0.85 + prng() * 0.45;
      root.scale.setScalar(scale);
      root.position.set(startX, startY, startZ);
      this.scene.add(root);
      this.clickableMeshes.push(body);

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
        vehicle,
        root,
        bodyGroup,
        tailGroup,
        dorsalFin,
        finLeft,
        finRight,
        arriveBehavior: arrive,
        wanderBehavior: wander,
        phase: prng() * Math.PI * 2,
      });
    }
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

      // S-curve swimming undulation across body, dorsal fin, pectoral fins, and forked tail
      const speed = v.velocity.length();
      const swimFreq = 5.5 + speed * 4.5;
      const wave = Math.sin(elapsed * swimFreq + agent.phase);
      agent.bodyGroup.rotation.y = wave * 0.09;
      agent.dorsalFin.rotation.z = -wave * 0.16;
      agent.tailGroup.rotation.y = Math.sin(elapsed * swimFreq + agent.phase - 0.85) * 0.46;
      agent.finLeft.rotation.z = Math.sin(elapsed * swimFreq * 0.7 + agent.phase) * 0.26;
      agent.finRight.rotation.z = -agent.finLeft.rotation.z;
    }
  }

  dispose(): void {
    for (const agent of this.agents) {
      this.scene.remove(agent.root);
      this.entityManager.remove(agent.vehicle);
    }
    this.agents.length = 0;
    this.clickableMeshes.length = 0;

    for (const obs of this.yukaObstacles) {
      this.entityManager.remove(obs);
    }
    this.yukaObstacles = [];

    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }
}
