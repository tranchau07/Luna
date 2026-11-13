import * as THREE from 'three';
import * as YUKA from 'yuka';
import Alea from 'alea';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';

type DeerStateId = 'graze' | 'stroll' | 'drink';

export class DeerAgent extends YUKA.Vehicle {
  readonly id: string;
  readonly stateMachine: YUKA.StateMachine<DeerAgent>;
  stateTimer = 3;
  currentState: DeerStateId = 'graze';
  readonly root: THREE.Group;
  readonly neckGroup: THREE.Group;
  readonly legs: THREE.Mesh[];
  readonly wander: YUKA.WanderBehavior;
  readonly arrive: YUKA.ArriveBehavior;
  readonly phase: number;
  readonly homePos: THREE.Vector3;

  constructor(params: {
    id: string;
    root: THREE.Group;
    neckGroup: THREE.Group;
    legs: THREE.Mesh[];
    wander: YUKA.WanderBehavior;
    arrive: YUKA.ArriveBehavior;
    phase: number;
    homePos: THREE.Vector3;
  }) {
    super();
    this.id = params.id;
    this.root = params.root;
    this.neckGroup = params.neckGroup;
    this.legs = params.legs;
    this.wander = params.wander;
    this.arrive = params.arrive;
    this.phase = params.phase;
    this.homePos = params.homePos;
    this.maxSpeed = 1.2;
    this.maxForce = 1.8;
    this.steering.add(this.wander);
    this.steering.add(this.arrive);
    this.stateMachine = new YUKA.StateMachine(this);
  }
}

class DeerGrazeState extends YUKA.State<DeerAgent> {
  enter(owner: DeerAgent): void {
    owner.currentState = 'graze';
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
    owner.stateTimer = 6.5;
    owner.wander.active = false;
    owner.arrive.active = true;
    // Head towards eastern sandy shore of the koi pool
    owner.arrive.target.set(8.5, 0.35, -7.5 + (Math.random() - 0.5) * 3.0);
  }
  execute(owner: DeerAgent): void {
    if (owner.stateTimer <= 0) {
      owner.stateMachine.changeTo('stroll');
    }
  }
  exit(owner: DeerAgent): void {
    owner.arrive.active = false;
  }
}

interface SkyGlider {
  root: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  vehicle: YUKA.Vehicle;
  orbitRadius: number;
  baseHeight: number;
  phase: number;
}

/**
 * Manages Sika Deer using Yuka StateMachine (Graze / Stroll / Drink),
 * plus gliding valley birds and meadow butterflies.
 */
export class WildlifeFSM {
  readonly deerAgents: DeerAgent[] = [];
  readonly clickableMeshes: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly entityManager: YUKA.EntityManager;

  private birds: SkyGlider[] = [];
  private butterflies: SkyGlider[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private grazeState = new DeerGrazeState();
  private strollState = new DeerStrollState();
  private drinkState = new DeerDrinkState();

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    entityManager: YUKA.EntityManager,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.entityManager = entityManager;
  }

  init(): void {
    this.buildDeer();
    this.buildBirds();
    this.buildButterflies();
  }

  private buildDeer(): void {
    const prng = Alea(`${this.biome.seed}-deer`);

    const torsoGeo = new THREE.CapsuleGeometry(0.28, 0.72, 6, 10);
    torsoGeo.rotateX(Math.PI / 2);
    const neckGeo = new THREE.CylinderGeometry(0.11, 0.15, 0.52, 8);
    neckGeo.translate(0, 0.24, 0);
    const headGeo = new THREE.BoxGeometry(0.2, 0.2, 0.34);
    const legGeo = new THREE.CylinderGeometry(0.055, 0.04, 0.65, 6);
    legGeo.translate(0, -0.32, 0);
    const antlerGeo = new THREE.CylinderGeometry(0.015, 0.025, 0.35, 5);
    const spotGeo = new THREE.SphereGeometry(0.05, 6, 4);

    const coatMat = new THREE.MeshStandardMaterial({ color: '#9c663a', roughness: 0.8 });
    const creamMat = new THREE.MeshStandardMaterial({ color: '#eadbc3', roughness: 0.85 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: '#423326', roughness: 0.7 });

    this.geometries.push(torsoGeo, neckGeo, headGeo, legGeo, antlerGeo, spotGeo);
    this.materials.push(coatMat, creamMat, antlerMat);

    const spawnZones: Array<[number, number]> = [
      [11.5, -14.0],
      [15.5, -6.0],
      [-12.5, 2.5],
    ];

    for (let i = 0; i < this.biome.wildlife.deerCount; i++) {
      const [sx, sz] = spawnZones[i % spawnZones.length];
      const x = sx + (prng() - 0.5) * 2.5;
      const z = sz + (prng() - 0.5) * 2.5;
      const y = this.heightfield.getHeightAt(x, z);

      const id = `deer-${i}`;
      const root = new THREE.Group();
      root.name = id;

      const userData = { interactableType: 'wildlife', entityId: id, label: `Sika Deer #${i + 1}` };

      const torso = new THREE.Mesh(torsoGeo, coatMat);
      torso.position.y = 0.78;
      torso.castShadow = true;
      torso.receiveShadow = true;
      torso.userData = userData;

      for (let s = 0; s < 6; s++) {
        const spot = new THREE.Mesh(spotGeo, creamMat);
        spot.position.set(
          (s % 2 === 0 ? 1 : -1) * 0.25,
          0.83 + (s % 3) * 0.05,
          -0.28 + Math.floor(s / 2) * 0.26,
        );
        spot.scale.set(0.35, 0.7, 0.85);
        root.add(spot);
      }

      const neckGroup = new THREE.Group();
      neckGroup.position.set(0, 0.92, 0.42);
      const neck = new THREE.Mesh(neckGeo, coatMat);
      neck.rotation.x = 0.32;
      neck.castShadow = true;

      const head = new THREE.Mesh(headGeo, coatMat);
      head.position.set(0, 0.48, 0.22);
      head.castShadow = true;
      head.userData = userData;
      neckGroup.add(neck, head);

      if (i === 0) {
        for (const side of [-1, 1]) {
          const antler = new THREE.Mesh(antlerGeo, antlerMat);
          antler.position.set(side * 0.08, 0.68, 0.14);
          antler.rotation.z = side * -0.25;
          neckGroup.add(antler);
        }
      }

      const legOffsets: Array<[number, number]> = [
        [-0.14, 0.34],
        [0.14, 0.34],
        [-0.14, -0.34],
        [0.14, -0.34],
      ];
      const legs: THREE.Mesh[] = legOffsets.map(([lx, lz]) => {
        const leg = new THREE.Mesh(legGeo, coatMat);
        leg.position.set(lx, 0.65, lz);
        leg.castShadow = true;
        root.add(leg);
        return leg;
      });

      root.add(torso, neckGroup);
      root.position.set(x, y, z);
      this.scene.add(root);
      this.clickableMeshes.push(torso, head);

      const wander = new YUKA.WanderBehavior(1.2, 2.0, 1.5);
      const arrive = new YUKA.ArriveBehavior(new YUKA.Vector3(8.5, 0.3, -7.5), 1.8, 0.4);
      arrive.active = false;

      const agent = new DeerAgent({
        id,
        root,
        neckGroup,
        legs,
        wander,
        arrive,
        phase: prng() * Math.PI * 2,
        homePos: new THREE.Vector3(x, y, z),
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
    const prng = Alea(`${this.biome.seed}-birds`);
    const bodyGeo = new THREE.ConeGeometry(0.06, 0.34, 5);
    bodyGeo.rotateX(Math.PI / 2);
    const wingGeo = new THREE.PlaneGeometry(0.45, 0.16);
    wingGeo.translate(0.22, 0, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: '#f4f0e8',
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    this.geometries.push(bodyGeo, wingGeo);
    this.materials.push(mat);

    for (let i = 0; i < this.biome.wildlife.birdCount; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, mat);
      const wingL = new THREE.Mesh(wingGeo, mat);
      const wingR = new THREE.Mesh(wingGeo, mat);
      wingR.scale.x = -1;
      root.add(body, wingL, wingR);

      const vehicle = new YUKA.Vehicle();
      const r = 14 + prng() * 14;
      const h = 11 + prng() * 6;
      const phase = prng() * Math.PI * 2;
      vehicle.position.set(Math.cos(phase) * r, h, Math.sin(phase) * r - 8);
      this.entityManager.add(vehicle);
      this.scene.add(root);

      this.birds.push({ root, wingL, wingR, vehicle, orbitRadius: r, baseHeight: h, phase });
    }
  }

  private buildButterflies(): void {
    const prng = Alea(`${this.biome.seed}-butterflies`);
    const wingGeo = new THREE.PlaneGeometry(0.14, 0.16);
    wingGeo.translate(0.07, 0, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: '#f2b84b',
      emissive: '#59360a',
      roughness: 0.45,
      side: THREE.DoubleSide,
    });
    this.geometries.push(wingGeo);
    this.materials.push(mat);

    for (let i = 0; i < this.biome.wildlife.butterflyCount; i++) {
      const root = new THREE.Group();
      const wingL = new THREE.Mesh(wingGeo, mat);
      const wingR = new THREE.Mesh(wingGeo, mat);
      wingR.scale.x = -1;
      root.add(wingL, wingR);

      const vehicle = new YUKA.Vehicle();
      const cx = (prng() - 0.5) * 26;
      const cz = (prng() - 0.5) * 26;
      const h = Math.max(0.9, this.heightfield.getHeightAt(cx, cz) + 0.9 + prng() * 1.2);
      vehicle.position.set(cx, h, cz);
      vehicle.maxSpeed = 1.1;
      const wander = new YUKA.WanderBehavior(0.8, 1.4, 2.0);
      vehicle.steering.add(wander);
      this.entityManager.add(vehicle);
      this.scene.add(root);

      this.butterflies.push({
        root,
        wingL,
        wingR,
        vehicle,
        orbitRadius: 24,
        baseHeight: h,
        phase: prng() * Math.PI * 2,
      });
    }
  }

  update(dt: number, elapsed: number): void {
    for (const deer of this.deerAgents) {
      deer.stateTimer -= dt;
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

      const speed = deer.velocity.length();
      const stride = Math.sin(elapsed * 5.2 + deer.phase) * Math.min(0.45, speed * 0.45);
      deer.legs[0].rotation.x = stride;
      deer.legs[1].rotation.x = -stride;
      deer.legs[2].rotation.x = -stride;
      deer.legs[3].rotation.x = stride;

      const targetPitch = deer.currentState === 'graze' || deer.currentState === 'drink' ? 0.95 : 0.05;
      deer.neckGroup.rotation.x = THREE.MathUtils.lerp(
        deer.neckGroup.rotation.x,
        targetPitch + Math.sin(elapsed * 2.2 + deer.phase) * 0.08,
        dt * 4,
      );
    }

    for (const b of this.birds) {
      const a = elapsed * 0.28 + b.phase;
      const nx = Math.cos(a) * b.orbitRadius;
      const nz = Math.sin(a) * b.orbitRadius - 8;
      const ny = b.baseHeight + Math.sin(elapsed * 0.8 + b.phase) * 1.1;
      b.root.position.set(nx, ny, nz);
      b.root.rotation.y = -a;
      const flap = Math.sin(elapsed * 6.5 + b.phase) * 0.48;
      b.wingL.rotation.z = flap;
      b.wingR.rotation.z = -flap;
    }

    for (const bf of this.butterflies) {
      const v = bf.vehicle;
      const gy = Math.max(0.3, this.heightfield.getHeightAt(v.position.x, v.position.z));
      v.position.y = gy + 0.85 + Math.sin(elapsed * 2.8 + bf.phase) * 0.35;
      if (Math.hypot(v.position.x, v.position.z) > 26) {
        v.velocity.x -= v.position.x * 0.15 * dt;
        v.velocity.z -= v.position.z * 0.15 * dt;
      }
      bf.root.position.set(v.position.x, v.position.y, v.position.z);
      bf.root.quaternion.set(v.rotation.x, v.rotation.y, v.rotation.z, v.rotation.w);
      const flap = Math.sin(elapsed * 18 + bf.phase) * 0.85;
      bf.wingL.rotation.z = flap;
      bf.wingR.rotation.z = -flap;
    }
  }

  dispose(): void {
    for (const d of this.deerAgents) {
      this.scene.remove(d.root);
      this.entityManager.remove(d);
    }
    this.deerAgents.length = 0;

    for (const b of [...this.birds, ...this.butterflies]) {
      this.scene.remove(b.root);
      this.entityManager.remove(b.vehicle);
    }
    this.birds = [];
    this.butterflies = [];
    this.clickableMeshes.length = 0;

    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }
}
