import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import * as YUKA from 'yuka';
import Alea from 'alea';
import type { AssetLoader } from '../core/AssetLoader';
import type { EventBus } from '../core/EventBus';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';
import type { RockObstacle } from '../world/RockSystem';

type DeerStateId = 'graze' | 'stroll' | 'drink';

export interface DeerLegRig {
  upperGroup: THREE.Group;
  lowerGroup: THREE.Group;
}

function normalizeGeo(
  geo: THREE.BufferGeometry,
  colorHex?: string,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv' && key !== 'color') {
      g.deleteAttribute(key);
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (colorHex !== undefined) {
    const col = new THREE.Color(colorHex);
    const count = g.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  } else if (g.attributes.color) {
    g.deleteAttribute('color');
  }
  return g;
}

export class DeerAgent extends YUKA.Vehicle {
  readonly id: string;
  readonly stateMachine: YUKA.StateMachine<DeerAgent>;
  stateTimer = 3;
  drinkWalkTimer = 0;
  isDrinking = false;
  currentState: DeerStateId = 'graze';
  readonly root: THREE.Group;
  readonly neckGroup: THREE.Group;
  readonly earLeft: THREE.Mesh;
  readonly earRight: THREE.Mesh;
  readonly tailMesh: THREE.Mesh;
  readonly legs: DeerLegRig[];
  readonly wander: YUKA.WanderBehavior;
  readonly arrive: YUKA.ArriveBehavior;
  readonly phase: number;
  readonly homePos: THREE.Vector3;
  readonly drinkSpot: [number, number];
  readonly onDrinkArrive: (agent: DeerAgent) => void;

  constructor(params: {
    id: string;
    root: THREE.Group;
    neckGroup: THREE.Group;
    earLeft: THREE.Mesh;
    earRight: THREE.Mesh;
    tailMesh: THREE.Mesh;
    legs: DeerLegRig[];
    wander: YUKA.WanderBehavior;
    arrive: YUKA.ArriveBehavior;
    avoidance: YUKA.ObstacleAvoidanceBehavior;
    phase: number;
    homePos: THREE.Vector3;
    drinkSpot: [number, number];
    onDrinkArrive: (agent: DeerAgent) => void;
  }) {
    super();
    this.id = params.id;
    this.root = params.root;
    this.neckGroup = params.neckGroup;
    this.earLeft = params.earLeft;
    this.earRight = params.earRight;
    this.tailMesh = params.tailMesh;
    this.legs = params.legs;
    this.wander = params.wander;
    this.arrive = params.arrive;
    this.phase = params.phase;
    this.homePos = params.homePos;
    this.drinkSpot = params.drinkSpot;
    this.onDrinkArrive = params.onDrinkArrive;
    this.boundingRadius = 0.65;
    this.maxSpeed = 1.2;
    this.maxForce = 1.8;
    this.steering.add(this.wander);
    this.steering.add(this.arrive);
    this.steering.add(params.avoidance);
    this.stateMachine = new YUKA.StateMachine(this);
  }
}

class DeerGrazeState extends YUKA.State<DeerAgent> {
  enter(owner: DeerAgent): void {
    owner.currentState = 'graze';
    owner.isDrinking = false;
    owner.stateTimer = 4 + Math.random() * 4;
    owner.wander.active = false;
    owner.arrive.active = false;
    owner.velocity.set(0, 0, 0);
  }
  execute(owner: DeerAgent): void {
    if (owner.stateTimer <= 0) {
      const next = Math.random() < 0.3 ? 'drink' : 'stroll';
      owner.stateMachine.changeTo(next);
    }
  }
  exit(): void {}
}

class DeerStrollState extends YUKA.State<DeerAgent> {
  enter(owner: DeerAgent): void {
    owner.currentState = 'stroll';
    owner.isDrinking = false;
    owner.stateTimer = 5 + Math.random() * 5;
    owner.wander.active = true;
    owner.arrive.active = false;
  }
  execute(owner: DeerAgent): void {
    if (owner.stateTimer <= 0) {
      owner.stateMachine.changeTo('graze');
    }
  }
  exit(): void {}
}

class DeerDrinkState extends YUKA.State<DeerAgent> {
  enter(owner: DeerAgent): void {
    owner.currentState = 'drink';
    owner.isDrinking = false;
    owner.drinkWalkTimer = 14.0;
    owner.stateTimer = 5.5;
    owner.wander.active = false;
    owner.arrive.active = true;
    const [dx, dz] = owner.drinkSpot;
    owner.arrive.target.set(dx, 0.35, dz + (Math.random() - 0.5) * 3.0);
  }
  execute(owner: DeerAgent): void {
    if (!owner.isDrinking) {
      const dist = Math.hypot(
        owner.position.x - owner.arrive.target.x,
        owner.position.z - owner.arrive.target.z,
      );
      if (dist <= 1.35) {
        owner.isDrinking = true;
        owner.arrive.active = false;
        owner.velocity.set(0, 0, 0);
        owner.stateTimer = 5.5;
        owner.onDrinkArrive(owner);
      } else if (owner.drinkWalkTimer <= 0) {
        owner.stateMachine.changeTo('stroll');
      }
      return;
    }

    if (owner.stateTimer <= 0) {
      owner.stateMachine.changeTo('stroll');
    }
  }
  exit(owner: DeerAgent): void {
    owner.arrive.active = false;
    owner.isDrinking = false;
  }
}

interface BirdAgent {
  vehicle: YUKA.Vehicle;
  phase: number;
  baseHeight: number;
}

interface ButterflyAgent {
  vehicle: YUKA.Vehicle;
  phase: number;
  variant: number;
  variantIdx: number;
}

/**
 * Manages anatomically detailed Sika Deer using Yuka StateMachine (Graze / Stroll / Drink)
 * with obstacle avoidance, plus Yuka-flocking instanced valley birds and instanced meadow butterflies.
 */
export class WildlifeFSM {
  readonly deerAgents: DeerAgent[] = [];
  readonly clickableMeshes: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly entityManager: YUKA.EntityManager;
  private readonly obstacles: RockObstacle[];
  private readonly assets: AssetLoader;
  private readonly bus: EventBus;

  private yukaObstacles: YUKA.GameEntity[] = [];
  private birds: BirdAgent[] = [];
  private birdBodyInst: THREE.InstancedMesh | null = null;
  private birdWingInst: THREE.InstancedMesh | null = null;
  private birdWingMat: CustomShaderMaterial | null = null;

  private butterflies: ButterflyAgent[] = [];
  private butterflyBodyInst: THREE.InstancedMesh | null = null;
  private butterflyWingInsts: THREE.InstancedMesh[] = [];
  private butterflyWingMats: CustomShaderMaterial[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private dummy = new THREE.Object3D();

  private grazeState = new DeerGrazeState();
  private strollState = new DeerStrollState();
  private drinkState = new DeerDrinkState();

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    entityManager: YUKA.EntityManager,
    obstacles: RockObstacle[],
    assets: AssetLoader,
    bus: EventBus,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.entityManager = entityManager;
    this.obstacles = obstacles;
    this.assets = assets;
    this.bus = bus;
  }

  init(): void {
    this.buildLandObstacles();
    this.buildDeer();
    this.buildBirds();
    this.buildButterflies();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private buildLandObstacles(): void {
    const [drinkX, drinkZ] = this.biome.landmarks.deerDrinkSpot;
    for (const obs of this.obstacles) {
      // Skip underwater pool rocks and keep immediate drinking shoreline unobstructed
      if (this.heightfield.isWaterAt(obs.x, obs.z)) continue;
      if (Math.hypot(obs.x - drinkX, obs.z - drinkZ) < 2.6) continue;
      const entity = new YUKA.GameEntity();
      entity.position.set(obs.x, obs.y, obs.z);
      entity.boundingRadius = obs.radius + 0.45;
      this.yukaObstacles.push(entity);
      this.entityManager.add(entity);
    }
  }

  private buildDeer(): void {
    const prng = Alea(`${this.biome.seed}-deer`);

    // 1. Merge torso + chest + rump + cream belly + 10 Sika spots with vertex colors (1 draw call per deer)
    const torsoT = new THREE.CapsuleGeometry(0.25, 0.72, 8, 12);
    torsoT.rotateX(Math.PI / 2);
    torsoT.translate(0, 0.82, 0);

    const chestT = new THREE.SphereGeometry(0.27, 10, 8);
    chestT.scale(0.92, 1.08, 1.15);
    chestT.translate(0, 0.84, 0.32);

    const rumpT = new THREE.SphereGeometry(0.26, 10, 8);
    rumpT.scale(0.94, 1.05, 1.1);
    rumpT.translate(0, 0.85, -0.34);

    const bellyT = new THREE.CapsuleGeometry(0.21, 0.66, 6, 8);
    bellyT.rotateX(Math.PI / 2);
    bellyT.translate(0, 0.72, 0);
    const spotT = new THREE.SphereGeometry(0.048, 6, 4);

    const bodyParts: THREE.BufferGeometry[] = [
      normalizeGeo(torsoT, '#a46838'),
      normalizeGeo(chestT, '#a46838'),
      normalizeGeo(rumpT, '#a46838'),
      normalizeGeo(bellyT, '#f2e6d0'),
    ];
    for (let s = 0; s < 10; s++) {
      const side = s % 2 === 0 ? 1 : -1;
      const row = Math.floor(s / 2);
      const sp = normalizeGeo(spotT, '#f2e6d0');
      sp.scale(0.32, 0.68, 0.88);
      sp.translate(
        side * (0.245 + (row % 2) * 0.015),
        0.82 + (row % 2) * 0.07,
        -0.32 + row * 0.16,
      );
      bodyParts.push(sp);
    }
    const deerBodyGeo = this.trackGeo(mergeGeometries(bodyParts, false)!);
    torsoT.dispose();
    chestT.dispose();
    rumpT.dispose();
    bellyT.dispose();
    spotT.dispose();
    bodyParts.forEach((g) => g.dispose());

    // 2. Merge cranium + snout + dark nose + 2 eyes with vertex colors (1 draw call per deer)
    const craniumT = new THREE.SphereGeometry(0.135, 10, 8);
    craniumT.scale(0.88, 0.92, 1.18);
    const snoutT = new THREE.CylinderGeometry(0.058, 0.095, 0.24, 8);
    snoutT.rotateX(Math.PI / 2);
    snoutT.translate(0, -0.025, 0.17);
    const noseT = new THREE.SphereGeometry(0.036, 6, 6);
    noseT.translate(0, -0.015, 0.29);
    const eyeT = new THREE.SphereGeometry(0.024, 6, 6);
    const headParts: THREE.BufferGeometry[] = [
      normalizeGeo(craniumT, '#a46838'),
      normalizeGeo(snoutT, '#a46838'),
      normalizeGeo(noseT, '#1b1817'),
    ];
    for (const side of [-1, 1]) {
      const e = normalizeGeo(eyeT, '#1b1817');
      e.translate(side * 0.095, 0.03, 0.06);
      headParts.push(e);
    }
    const deerHeadGeo = this.trackGeo(mergeGeometries(headParts, false)!);
    craniumT.dispose();
    snoutT.dispose();
    noseT.dispose();
    eyeT.dispose();
    headParts.forEach((g) => g.dispose());

    // 3. Merge multi-tine stag antlers (both sides) into 1 shared geometry
    const antlerBeamT = new THREE.CylinderGeometry(0.012, 0.024, 0.44, 6);
    antlerBeamT.translate(0, 0.22, 0);
    const antlerTineT = new THREE.ConeGeometry(0.014, 0.19, 5);
    antlerTineT.translate(0, 0.095, 0);
    const antlerParts: THREE.BufferGeometry[] = [];
    const tmpObj = new THREE.Object3D();
    const partObj = new THREE.Object3D();
    const combinedMat = new THREE.Matrix4();

    for (const side of [-1, 1]) {
      tmpObj.position.set(side * 0.065, 0.11, -0.02);
      tmpObj.rotation.set(-0.28, 0, side * -0.32);
      tmpObj.scale.set(1, 1, 1);
      tmpObj.updateMatrix();

      const addAntlerPart = (
        template: THREE.BufferGeometry,
        px: number,
        py: number,
        pz: number,
        rx: number,
        rz: number,
      ) => {
        partObj.position.set(px, py, pz);
        partObj.rotation.set(rx, 0, rz);
        partObj.scale.set(1, 1, 1);
        partObj.updateMatrix();
        combinedMat.multiplyMatrices(tmpObj.matrix, partObj.matrix);
        const baked = normalizeGeo(template);
        baked.applyMatrix4(combinedMat);
        antlerParts.push(baked);
      };

      addAntlerPart(antlerBeamT, 0, 0, 0, 0, 0);
      addAntlerPart(antlerTineT, 0, 0.11, 0.02, 0.85, 0);
      addAntlerPart(antlerTineT, 0, 0.25, 0, 0.35, side * -0.68);
      addAntlerPart(antlerTineT, 0, 0.36, -0.01, -0.3, side * 0.42);
    }
    const antlersGeo = this.trackGeo(mergeGeometries(antlerParts, false)!);
    antlerBeamT.dispose();
    antlerTineT.dispose();
    antlerParts.forEach((g) => g.dispose());

    // 4. Articulated neck, ears, tail, upper leg, and merged lower leg + dark hoof
    const neckGeo = this.trackGeo(new THREE.CylinderGeometry(0.105, 0.165, 0.56, 10));
    neckGeo.translate(0, 0.26, 0);

    const earGeo = this.trackGeo(new THREE.ConeGeometry(0.048, 0.19, 6));
    earGeo.scale(0.55, 1.0, 1.0);
    earGeo.translate(0, 0.09, 0);

    const tailGeo = this.trackGeo(new THREE.ConeGeometry(0.055, 0.22, 6));
    tailGeo.translate(0, -0.09, 0);

    const upperLegGeo = this.trackGeo(new THREE.CylinderGeometry(0.072, 0.048, 0.36, 8));
    upperLegGeo.translate(0, -0.18, 0);

    const lowerShinT = new THREE.CylinderGeometry(0.044, 0.032, 0.34, 8);
    lowerShinT.translate(0, -0.17, 0);
    const hoofT = new THREE.CylinderGeometry(0.036, 0.046, 0.065, 6);
    hoofT.translate(0, -0.34, 0.01);
    const lowerLegParts = [normalizeGeo(lowerShinT, '#a46838'), normalizeGeo(hoofT, '#1b1817')];
    const lowerLegGeo = this.trackGeo(mergeGeometries(lowerLegParts, false)!);
    lowerShinT.dispose();
    hoofT.dispose();
    lowerLegParts.forEach((g) => g.dispose());

    const vertexColorCoatMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
    });
    const coatMat = new THREE.MeshStandardMaterial({ color: '#a46838', roughness: 0.78 });
    const creamMat = new THREE.MeshStandardMaterial({ color: '#f2e6d0', roughness: 0.82 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: '#523e2c', roughness: 0.62 });
    this.materials.push(vertexColorCoatMat, coatMat, creamMat, antlerMat);

    const spawnZones = this.biome.landmarks.deerSpawnZones;
    const drinkSpot = this.biome.landmarks.deerDrinkSpot;
    const [poolX, poolZ] = this.biome.terrain.poolCenter;

    for (let i = 0; i < this.biome.wildlife.deerCount; i++) {
      const [sx, sz] = spawnZones[i % spawnZones.length];
      const x = sx + (prng() - 0.5) * 2.5;
      const z = sz + (prng() - 0.5) * 2.5;
      const y = this.heightfield.getHeightAt(x, z);

      const id = `deer-${i}`;
      const root = new THREE.Group();
      root.name = id;

      const userData = { interactableType: 'wildlife', entityId: id, label: `Sika Deer #${i + 1}` };

      const bodyMesh = new THREE.Mesh(deerBodyGeo, vertexColorCoatMat);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      bodyMesh.userData = userData;

      const tailMesh = new THREE.Mesh(tailGeo, creamMat);
      tailMesh.position.set(0, 0.94, -0.58);
      tailMesh.rotation.x = 0.45;
      root.add(tailMesh);

      const neckGroup = new THREE.Group();
      neckGroup.position.set(0, 0.94, 0.42);
      const neck = new THREE.Mesh(neckGeo, coatMat);
      neck.rotation.x = 0.28;
      neck.castShadow = true;

      const headGroup = new THREE.Group();
      headGroup.position.set(0, 0.52, 0.18);

      const headMesh = new THREE.Mesh(deerHeadGeo, vertexColorCoatMat);
      headMesh.castShadow = true;
      headMesh.userData = userData;

      const earLeft = new THREE.Mesh(earGeo, coatMat);
      earLeft.position.set(-0.09, 0.08, -0.04);
      earLeft.rotation.set(-0.2, 0, 0.58);

      const earRight = new THREE.Mesh(earGeo, coatMat);
      earRight.position.set(0.09, 0.08, -0.04);
      earRight.rotation.set(-0.2, 0, -0.58);

      headGroup.add(headMesh, earLeft, earRight);

      // Multi-tine branched antlers for stags (deer 0 & 1)
      if (i < 2) {
        const antlers = new THREE.Mesh(antlersGeo, antlerMat);
        antlers.scale.setScalar(i === 0 ? 1.0 : 0.78);
        antlers.castShadow = true;
        headGroup.add(antlers);
      }

      neckGroup.add(neck, headGroup);

      const legOffsets: Array<[number, number]> = [
        [-0.145, 0.34],
        [0.145, 0.34],
        [-0.145, -0.35],
        [0.145, -0.35],
      ];
      const legs: DeerLegRig[] = legOffsets.map(([lx, lz]) => {
        const upperGroup = new THREE.Group();
        upperGroup.position.set(lx, 0.7, lz);

        const upperMesh = new THREE.Mesh(upperLegGeo, coatMat);
        upperMesh.castShadow = true;

        const lowerGroup = new THREE.Group();
        lowerGroup.position.set(0, -0.34, 0);

        const lowerMesh = new THREE.Mesh(lowerLegGeo, vertexColorCoatMat);

        lowerGroup.add(lowerMesh);
        upperGroup.add(upperMesh, lowerGroup);
        root.add(upperGroup);
        return { upperGroup, lowerGroup };
      });

      root.add(bodyMesh, neckGroup);
      root.position.set(x, y, z);
      this.scene.add(root);
      this.clickableMeshes.push(bodyMesh, headMesh);

      const wander = new YUKA.WanderBehavior(1.2, 2.0, 1.5);
      const arrive = new YUKA.ArriveBehavior(
        new YUKA.Vector3(drinkSpot[0], 0.3, drinkSpot[1]),
        1.8,
        0.4,
      );
      arrive.active = false;
      const avoidance = new YUKA.ObstacleAvoidanceBehavior(this.yukaObstacles);
      avoidance.weight = 2.2;

      const agent = new DeerAgent({
        id,
        root,
        neckGroup,
        earLeft,
        earRight,
        tailMesh,
        legs,
        wander,
        arrive,
        avoidance,
        phase: prng() * Math.PI * 2,
        homePos: new THREE.Vector3(x, y, z),
        drinkSpot,
        onDrinkArrive: (a) => {
          // Turn gently toward water center and trigger subtle drinking ripple
          const dx = poolX - a.position.x;
          const dz = poolZ - a.position.z;
          const len = Math.hypot(dx, dz) || 1;
          const yaw = Math.atan2(dx, dz);
          a.root.rotation.set(0, yaw, 0);
          this.bus.emit('water:ripple', {
            position: [
              a.position.x + (dx / len) * 0.9,
              this.biome.terrain.waterLevel,
              a.position.z + (dz / len) * 0.9,
            ],
            intensity: 0.35,
          });
        },
      });
      agent.position.set(x, y, z);
      this.entityManager.add(agent);

      agent.stateMachine.add('graze', this.grazeState);
      agent.stateMachine.add('stroll', this.strollState);
      agent.stateMachine.add('drink', this.drinkState);
      agent.stateMachine.changeTo(i === 0 ? 'stroll' : 'graze');

      this.deerAgents.push(agent);
    }
  }

  private buildBirds(): void {
    const count = this.biome.wildlife.birdCount;
    if (count <= 0) return;
    const prng = Alea(`${this.biome.seed}-birds`);

    // 1. Merge bird body + head + tail + golden beak with vertex colors (1 draw call for all birds)
    const bodyT = new THREE.CapsuleGeometry(0.048, 0.22, 5, 8);
    bodyT.rotateX(Math.PI / 2);
    const headT = new THREE.SphereGeometry(0.042, 6, 6);
    headT.translate(0, 0.02, 0.14);
    const beakT = new THREE.ConeGeometry(0.016, 0.08, 4);
    beakT.rotateX(Math.PI / 2);
    beakT.translate(0, 0.015, 0.2);
    const tailT = new THREE.ConeGeometry(0.09, 0.18, 3);
    tailT.rotateX(-Math.PI / 2);
    tailT.scale(1.2, 0.2, 1.0);
    tailT.translate(0, 0.01, -0.18);

    const bodyParts = [
      normalizeGeo(bodyT, '#f4f0e8'),
      normalizeGeo(headT, '#f4f0e8'),
      normalizeGeo(beakT, '#e09f3e'),
      normalizeGeo(tailT, '#f4f0e8'),
    ];
    const mergedBirdBodyGeo = this.trackGeo(mergeGeometries(bodyParts, false)!);
    bodyT.dispose();
    headT.dispose();
    beakT.dispose();
    tailT.dispose();
    bodyParts.forEach((g) => g.dispose());

    // 2. Merge left & right feathered wings into 1 GPU-flapping geometry
    const wingR = new THREE.PlaneGeometry(0.52, 0.22, 2, 1);
    wingR.translate(0.26, 0, 0);
    const wingL = new THREE.PlaneGeometry(0.52, 0.22, 2, 1);
    wingL.translate(0.26, 0, 0);
    wingL.scale(-1, 1, 1);
    const wingParts = [normalizeGeo(wingR), normalizeGeo(wingL)];
    const mergedWingGeo = this.trackGeo(mergeGeometries(wingParts, false)!);
    wingR.dispose();
    wingL.dispose();
    wingParts.forEach((g) => g.dispose());

    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      phases[i] = prng() * Math.PI * 2;
    }
    mergedWingGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
    });
    const wingTex = this.assets.getBirdWingTexture(256);
    this.birdWingMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      map: wingTex,
      alphaTest: 0.25,
      roughness: 0.55,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        void main() {
          vec3 p = position;
          float side = sign(p.x);
          float dist = abs(p.x);
          float angle = sin(uTime * 6.8 + aPhase) * 0.5;
          float c = cos(angle);
          float s = sin(angle);
          p.x = side * (dist * c - p.y * s);
          p.y = dist * s + p.y * c;
          csm_Position = p;
        }
      `,
    });
    this.materials.push(bodyMat, this.birdWingMat);

    this.birdBodyInst = new THREE.InstancedMesh(mergedBirdBodyGeo, bodyMat, count);
    this.birdBodyInst.name = 'valley-birds-body';
    this.birdBodyInst.frustumCulled = false;

    this.birdWingInst = new THREE.InstancedMesh(mergedWingGeo, this.birdWingMat, count);
    this.birdWingInst.name = 'valley-birds-wings';
    this.birdWingInst.frustumCulled = false;

    this.scene.add(this.birdBodyInst, this.birdWingInst);

    // Real Yuka flocking vehicles (Wander + Cohesion + Alignment + Separation)
    for (let i = 0; i < count; i++) {
      const vehicle = new YUKA.Vehicle();
      const angle = (i / count) * Math.PI * 2 + prng() * 0.4;
      const r = 10 + prng() * 12;
      const h = 11.5 + prng() * 5.5;
      vehicle.position.set(Math.cos(angle) * r, h, Math.sin(angle) * r - 8);
      vehicle.velocity.set(-Math.sin(angle) * 3.5, 0, Math.cos(angle) * 3.5);
      vehicle.maxSpeed = 5.4 + prng() * 1.2;
      vehicle.maxForce = 3.2;
      vehicle.boundingRadius = 0.8;
      vehicle.updateNeighborhood = true;
      vehicle.neighborhoodRadius = 12.0;

      const wander = new YUKA.WanderBehavior(2.2, 4.5, 1.8);
      wander.weight = 1.1;
      const separation = new YUKA.SeparationBehavior();
      separation.weight = 1.8;
      const alignment = new YUKA.AlignmentBehavior();
      alignment.weight = 0.9;
      const cohesion = new YUKA.CohesionBehavior();
      cohesion.weight = 0.75;

      vehicle.steering.add(wander);
      vehicle.steering.add(separation);
      vehicle.steering.add(alignment);
      vehicle.steering.add(cohesion);
      this.entityManager.add(vehicle);

      this.birds.push({ vehicle, phase: phases[i], baseHeight: h });
    }
  }

  private buildButterflies(): void {
    const count = this.biome.wildlife.butterflyCount;
    if (count <= 0) return;
    const prng = Alea(`${this.biome.seed}-butterflies`);

    const bodyGeo = this.trackGeo(new THREE.CapsuleGeometry(0.012, 0.09, 4, 6));
    bodyGeo.rotateX(Math.PI / 2);

    const wingR = new THREE.PlaneGeometry(0.18, 0.22);
    wingR.translate(0.09, 0, 0);
    const wingL = new THREE.PlaneGeometry(0.18, 0.22);
    wingL.translate(0.09, 0, 0);
    wingL.scale(-1, 1, 1);
    const baseWingParts = [normalizeGeo(wingR), normalizeGeo(wingL)];
    const baseWingGeo = mergeGeometries(baseWingParts, false)!;
    wingR.dispose();
    wingL.dispose();
    baseWingParts.forEach((g) => g.dispose());

    const bodyMat = new THREE.MeshStandardMaterial({ color: '#1f1a1c', roughness: 0.6 });
    this.materials.push(bodyMat);

    this.butterflyBodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    this.butterflyBodyInst.name = 'valley-butterflies-body';
    this.butterflyBodyInst.frustumCulled = false;
    this.scene.add(this.butterflyBodyInst);

    const variantPhases: number[][] = [[], [], []];
    for (let i = 0; i < count; i++) {
      const variant = i % 3;
      const phase = prng() * Math.PI * 2;
      const variantIdx = variantPhases[variant].length;
      variantPhases[variant].push(phase);

      const vehicle = new YUKA.Vehicle();
      const cx = (prng() - 0.5) * 26;
      const cz = (prng() - 0.5) * 26;
      const h = Math.max(0.9, this.heightfield.getHeightAt(cx, cz) + 0.9 + prng() * 1.2);
      vehicle.position.set(cx, h, cz);
      vehicle.maxSpeed = 1.1;
      const wander = new YUKA.WanderBehavior(0.8, 1.4, 2.0);
      vehicle.steering.add(wander);
      this.entityManager.add(vehicle);

      this.butterflies.push({ vehicle, phase, variant, variantIdx });
    }

    for (let v = 0; v < 3; v++) {
      const vPhases = variantPhases[v];
      if (vPhases.length === 0) continue;

      const vGeo = this.trackGeo(baseWingGeo.clone());
      vGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(vPhases), 1));

      const tex = this.assets.getButterflyWingTexture(v, 256);
      const wingMat = new CustomShaderMaterial({
        baseMaterial: THREE.MeshStandardMaterial,
        map: tex,
        alphaTest: 0.22,
        emissive: '#3a2208',
        emissiveIntensity: 0.35,
        roughness: 0.42,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aPhase;
          uniform float uTime;
          void main() {
            vec3 p = position;
            float side = sign(p.x);
            float dist = abs(p.x);
            float angle = sin(uTime * 18.0 + aPhase) * 0.85;
            float c = cos(angle);
            float s = sin(angle);
            p.x = side * (dist * c - p.y * s);
            p.y = dist * s + p.y * c;
            csm_Position = p;
          }
        `,
      });
      this.materials.push(wingMat);
      this.butterflyWingMats.push(wingMat);

      const inst = new THREE.InstancedMesh(vGeo, wingMat, vPhases.length);
      inst.name = `valley-butterflies-wings-v${v}`;
      inst.frustumCulled = false;
      this.butterflyWingInsts.push(inst);
      this.scene.add(inst);
    }

    baseWingGeo.dispose();
  }

  update(dt: number, elapsed: number): void {
    for (const deer of this.deerAgents) {
      if (deer.currentState === 'drink' && !deer.isDrinking) {
        deer.drinkWalkTimer -= dt;
      } else {
        deer.stateTimer -= dt;
      }
      deer.stateMachine.update();

      const groundY = this.heightfield.getHeightAt(deer.position.x, deer.position.z);
      if (groundY < this.biome.terrain.waterLevel + 0.08 && deer.currentState !== 'drink') {
        deer.velocity.x += (deer.homePos.x - deer.position.x) * dt * 2.5;
        deer.velocity.z += (deer.homePos.z - deer.position.z) * dt * 2.5;
      }
      if (Math.hypot(deer.position.x, deer.position.z) > 36) {
        deer.velocity.x += (deer.homePos.x - deer.position.x) * dt * 1.5;
        deer.velocity.z += (deer.homePos.z - deer.position.z) * dt * 1.5;
      }

      deer.position.y = THREE.MathUtils.lerp(deer.position.y, Math.max(0.05, groundY), 0.25);
      deer.velocity.y = 0;

      deer.root.position.set(deer.position.x, deer.position.y, deer.position.z);
      if (deer.velocity.length() > 0.08) {
        deer.root.quaternion.set(deer.rotation.x, deer.rotation.y, deer.rotation.z, deer.rotation.w);
      }

      // 2-jointed walk cycle with knee articulation
      const speed = deer.velocity.length();
      const amp = Math.min(0.46, speed * 0.48);
      const phases = [0, Math.PI, Math.PI, 0];
      for (let l = 0; l < 4; l++) {
        const cyc = elapsed * 5.2 + deer.phase + phases[l];
        const swing = Math.sin(cyc) * amp;
        const kneeBend = Math.max(0, -Math.cos(cyc)) * amp * 1.15;
        deer.legs[l].upperGroup.rotation.x = swing;
        deer.legs[l].lowerGroup.rotation.x = l < 2 ? -kneeBend : kneeBend * 0.85;
      }

      // Subtle ear twitch and tail flick
      const earTwitch = Math.sin(elapsed * 3.7 + deer.phase) * 0.12;
      deer.earLeft.rotation.z = 0.58 + earTwitch;
      deer.earRight.rotation.z = -0.58 - earTwitch;
      deer.tailMesh.rotation.z = Math.sin(elapsed * 6.5 + deer.phase) * 0.18;

      const shouldLowerHead =
        deer.currentState === 'graze' || (deer.currentState === 'drink' && deer.isDrinking);
      const targetPitch = shouldLowerHead ? 0.95 : 0.05;
      deer.neckGroup.rotation.x = THREE.MathUtils.lerp(
        deer.neckGroup.rotation.x,
        targetPitch + Math.sin(elapsed * 2.2 + deer.phase) * 0.08,
        dt * 4,
      );
    }

    // Update instanced Yuka flocking birds
    if (this.birdWingMat) {
      this.birdWingMat.uniforms.uTime.value = elapsed;
    }
    if (this.birdBodyInst && this.birdWingInst) {
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i];
        const v = b.vehicle;
        const dx = v.position.x;
        const dz = v.position.z + 8;
        const radial = Math.hypot(dx, dz);
        if (radial > 26) {
          const pull = (radial - 26) * 0.35;
          v.velocity.x -= (dx / radial) * pull * dt * 4;
          v.velocity.z -= (dz / radial) * pull * dt * 4;
        }
        const targetAlt = b.baseHeight + Math.sin(elapsed * 0.7 + b.phase) * 1.4;
        v.velocity.y += (targetAlt - v.position.y) * dt * 1.4;
        v.position.y = THREE.MathUtils.clamp(v.position.y, 9.5, 22.0);

        this.dummy.position.set(v.position.x, v.position.y, v.position.z);
        this.dummy.quaternion.set(v.rotation.x, v.rotation.y, v.rotation.z, v.rotation.w);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.birdBodyInst.setMatrixAt(i, this.dummy.matrix);
        this.birdWingInst.setMatrixAt(i, this.dummy.matrix);
      }
      this.birdBodyInst.instanceMatrix.needsUpdate = true;
      this.birdWingInst.instanceMatrix.needsUpdate = true;
    }

    // Update instanced Yuka meadow butterflies
    for (const mat of this.butterflyWingMats) {
      mat.uniforms.uTime.value = elapsed;
    }
    if (this.butterflyBodyInst) {
      for (let i = 0; i < this.butterflies.length; i++) {
        const bf = this.butterflies[i];
        const v = bf.vehicle;
        const gy = Math.max(0.3, this.heightfield.getHeightAt(v.position.x, v.position.z));
        v.position.y = gy + 0.85 + Math.sin(elapsed * 2.8 + bf.phase) * 0.35;
        if (Math.hypot(v.position.x, v.position.z) > 26) {
          v.velocity.x -= v.position.x * 0.15 * dt;
          v.velocity.z -= v.position.z * 0.15 * dt;
        }

        this.dummy.position.set(v.position.x, v.position.y, v.position.z);
        this.dummy.quaternion.set(v.rotation.x, v.rotation.y, v.rotation.z, v.rotation.w);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.butterflyBodyInst.setMatrixAt(i, this.dummy.matrix);
        const wingInst = this.butterflyWingInsts[bf.variant];
        if (wingInst) {
          wingInst.setMatrixAt(bf.variantIdx, this.dummy.matrix);
        }
      }
      this.butterflyBodyInst.instanceMatrix.needsUpdate = true;
      for (const inst of this.butterflyWingInsts) {
        inst.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const d of this.deerAgents) {
      this.scene.remove(d.root);
      this.entityManager.remove(d);
    }
    this.deerAgents.length = 0;
    this.clickableMeshes.length = 0;

    for (const obs of this.yukaObstacles) {
      this.entityManager.remove(obs);
    }
    this.yukaObstacles = [];

    for (const b of this.birds) {
      this.entityManager.remove(b.vehicle);
    }
    this.birds = [];
    if (this.birdBodyInst) {
      this.scene.remove(this.birdBodyInst);
      this.birdBodyInst.dispose();
      this.birdBodyInst = null;
    }
    if (this.birdWingInst) {
      this.scene.remove(this.birdWingInst);
      this.birdWingInst.dispose();
      this.birdWingInst = null;
    }
    this.birdWingMat = null;

    for (const bf of this.butterflies) {
      this.entityManager.remove(bf.vehicle);
    }
    this.butterflies = [];
    if (this.butterflyBodyInst) {
      this.scene.remove(this.butterflyBodyInst);
      this.butterflyBodyInst.dispose();
      this.butterflyBodyInst = null;
    }
    for (const inst of this.butterflyWingInsts) {
      this.scene.remove(inst);
      inst.dispose();
    }
    this.butterflyWingInsts = [];
    this.butterflyWingMats = [];

    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }
}
