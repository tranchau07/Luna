import * as THREE from 'three';
import * as YUKA from 'yuka';
import Alea from 'alea';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { RockObstacle } from '../world/RockSystem';

export interface KoiAgent {
  id: string;
  vehicle: YUKA.Vehicle;
  root: THREE.Group;
  tailGroup: THREE.Group;
  finLeft: THREE.Mesh;
  finRight: THREE.Mesh;
  arriveBehavior: YUKA.ArriveBehavior;
  wanderBehavior: YUKA.WanderBehavior;
  phase: number;
}

/**
 * Manages a Yuka-driven koi school with Wander, Cohesion, Alignment, Separation,
 * ObstacleAvoidance around boulders, and interactive Arrive summoning when clicking water.
 */
export class FishFlockAI {
  readonly agents: KoiAgent[] = [];
  readonly clickableMeshes: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly entityManager: YUKA.EntityManager;
  private readonly obstacles: RockObstacle[];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private yukaObstacles: YUKA.GameEntity[] = [];
  private summonTimer = 0;

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    entityManager: YUKA.EntityManager,
    obstacles: RockObstacle[],
  ) {
    this.scene = scene;
    this.biome = biome;
    this.entityManager = entityManager;
    this.obstacles = obstacles;
  }

  init(): void {
    const prng = Alea(`${this.biome.seed}-koi`);
    const [poolX, poolZ] = this.biome.terrain.poolCenter;
    const poolRadius = this.biome.terrain.poolRadius * 0.68;

    // Shared geometries for articulated koi rigs
    const bodyGeo = new THREE.SphereGeometry(0.14, 12, 8);
    bodyGeo.scale(0.85, 0.72, 2.25);

    const headGeo = new THREE.SphereGeometry(0.11, 10, 8);
    headGeo.scale(0.9, 0.75, 1.15);

    const tailGeo = new THREE.ConeGeometry(0.12, 0.34, 4);
    tailGeo.rotateX(Math.PI / 2);
    tailGeo.scale(0.32, 1.0, 1.0);
    tailGeo.translate(0, 0, -0.18);

    const finGeo = new THREE.ConeGeometry(0.08, 0.18, 3);
    finGeo.rotateZ(Math.PI / 2);
    finGeo.scale(1.0, 0.2, 0.75);

    this.geometries.push(bodyGeo, headGeo, tailGeo, finGeo);

    const koiPalettes = [
      { body: '#eb5e28', accent: '#fffaf0' },
      { body: '#fffaf0', accent: '#d9381e' },
      { body: '#f2a93b', accent: '#262422' },
    ];

    const sharedMats = koiPalettes.map((p) => {
      const bodyMat = new THREE.MeshStandardMaterial({ color: p.body, roughness: 0.25, metalness: 0.05 });
      const finMat = new THREE.MeshStandardMaterial({
        color: p.accent,
        roughness: 0.35,
        side: THREE.DoubleSide,
      });
      this.materials.push(bodyMat, finMat);
      return { bodyMat, finMat };
    });

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

    const flockNeighbors: YUKA.Vehicle[] = [];

    for (let i = 0; i < this.biome.wildlife.koiCount; i++) {
      const palette = sharedMats[i % sharedMats.length];
      const angle = prng() * Math.PI * 2;
      const r = 1.5 + prng() * (poolRadius - 2.0);
      const startX = poolX + Math.cos(angle) * r;
      const startZ = poolZ + Math.sin(angle) * r;
      const startY = this.biome.terrain.waterLevel - (0.38 + prng() * 0.45);

      const root = new THREE.Group();
      const id = `koi-${i}`;
      root.name = id;

      const body = new THREE.Mesh(bodyGeo, palette.bodyMat);
      body.castShadow = true;
      body.userData = { interactableType: 'wildlife', entityId: id, label: `Koi #${i + 1}` };

      const head = new THREE.Mesh(headGeo, palette.finMat);
      head.position.set(0, 0.01, 0.22);
      head.userData = body.userData;

      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0, -0.25);
      const tailMesh = new THREE.Mesh(tailGeo, palette.finMat);
      tailGroup.add(tailMesh);

      const finLeft = new THREE.Mesh(finGeo, palette.finMat);
      finLeft.position.set(-0.11, -0.02, 0.08);
      finLeft.rotation.y = 0.4;

      const finRight = new THREE.Mesh(finGeo, palette.finMat);
      finRight.position.set(0.11, -0.02, 0.08);
      finRight.rotation.y = -0.4;
      finRight.scale.x = -1;

      root.add(body, head, tailGroup, finLeft, finRight);
      const scale = 0.8 + prng() * 0.45;
      root.scale.setScalar(scale);
      root.position.set(startX, startY, startZ);
      this.scene.add(root);
      this.clickableMeshes.push(body, head);

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
      flockNeighbors.push(vehicle);

      this.agents.push({
        id,
        vehicle,
        root,
        tailGroup,
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
    const targetY = this.biome.terrain.waterLevel - 0.5;

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
      // Keep koi gently swimming in a horizontal water stratum inside the pool
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

      const speed = v.velocity.length();
      const swimFreq = 5.5 + speed * 4.5;
      agent.tailGroup.rotation.y = Math.sin(elapsed * swimFreq + agent.phase) * 0.42;
      agent.finLeft.rotation.z = Math.sin(elapsed * swimFreq * 0.7 + agent.phase) * 0.25;
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
