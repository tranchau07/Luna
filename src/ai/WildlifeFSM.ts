import * as THREE from 'three';
import * as YUKA from 'yuka';
import Alea from 'alea';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';

type DeerStateId = 'graze' | 'stroll' | 'drink';

export interface DeerLegRig {
  upperGroup: THREE.Group;
  lowerGroup: THREE.Group;
}

export class DeerAgent extends YUKA.Vehicle {
  readonly id: string;
  readonly stateMachine: YUKA.StateMachine<DeerAgent>;
  stateTimer = 3;
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
    phase: number;
    homePos: THREE.Vector3;
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
  wingL: THREE.Object3D;
  wingR: THREE.Object3D;
  vehicle: YUKA.Vehicle;
  orbitRadius: number;
  baseHeight: number;
  phase: number;
}

/**
 * Manages anatomically detailed Sika Deer using Yuka StateMachine (Graze / Stroll / Drink),
 * plus feathered valley birds and swallowtail meadow butterflies.
 */
export class WildlifeFSM {
  readonly deerAgents: DeerAgent[] = [];
  readonly clickableMeshes: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly entityManager: YUKA.EntityManager;
  private readonly assets: AssetLoader;

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
    assets: AssetLoader,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.entityManager = entityManager;
    this.assets = assets;
  }

  init(): void {
    this.buildDeer();
    this.buildBirds();
    this.buildButterflies();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private buildDeer(): void {
    const prng = Alea(`${this.biome.seed}-deer`);

    // Sculpted anatomical torso, chest, rump, neck, head, snout, ears, 2-joint legs, hooves, and branched antlers
    const torsoGeo = this.trackGeo(new THREE.CapsuleGeometry(0.25, 0.72, 8, 12));
    torsoGeo.rotateX(Math.PI / 2);
    const chestGeo = this.trackGeo(new THREE.SphereGeometry(0.27, 10, 8));
    chestGeo.scale(0.92, 1.08, 1.15);
    const rumpGeo = this.trackGeo(new THREE.SphereGeometry(0.26, 10, 8));
    rumpGeo.scale(0.94, 1.05, 1.1);
    const bellyGeo = this.trackGeo(new THREE.CapsuleGeometry(0.21, 0.66, 6, 8));
    bellyGeo.rotateX(Math.PI / 2);

    const neckGeo = this.trackGeo(new THREE.CylinderGeometry(0.105, 0.165, 0.56, 10));
    neckGeo.translate(0, 0.26, 0);

    const craniumGeo = this.trackGeo(new THREE.SphereGeometry(0.135, 10, 8));
    craniumGeo.scale(0.88, 0.92, 1.18);
    const snoutGeo = this.trackGeo(new THREE.CylinderGeometry(0.058, 0.095, 0.24, 8));
    snoutGeo.rotateX(Math.PI / 2);
    const noseGeo = this.trackGeo(new THREE.SphereGeometry(0.036, 6, 6));
    const eyeGeo = this.trackGeo(new THREE.SphereGeometry(0.024, 6, 6));
    const earGeo = this.trackGeo(new THREE.ConeGeometry(0.048, 0.19, 6));
    earGeo.scale(0.55, 1.0, 1.0);
    earGeo.translate(0, 0.09, 0);

    const tailGeo = this.trackGeo(new THREE.ConeGeometry(0.055, 0.22, 6));
    tailGeo.translate(0, -0.09, 0);

    const upperLegGeo = this.trackGeo(new THREE.CylinderGeometry(0.072, 0.048, 0.36, 8));
    upperLegGeo.translate(0, -0.18, 0);
    const lowerLegGeo = this.trackGeo(new THREE.CylinderGeometry(0.044, 0.032, 0.34, 8));
    lowerLegGeo.translate(0, -0.17, 0);
    const hoofGeo = this.trackGeo(new THREE.CylinderGeometry(0.036, 0.046, 0.065, 6));
    hoofGeo.translate(0, -0.34, 0.01);

    const antlerBeamGeo = this.trackGeo(new THREE.CylinderGeometry(0.012, 0.024, 0.44, 6));
    antlerBeamGeo.translate(0, 0.22, 0);
    const antlerTineGeo = this.trackGeo(new THREE.ConeGeometry(0.014, 0.19, 5));
    antlerTineGeo.translate(0, 0.095, 0);

    const spotGeo = this.trackGeo(new THREE.SphereGeometry(0.048, 6, 4));

    const coatMat = new THREE.MeshStandardMaterial({ color: '#a46838', roughness: 0.78 });
    const creamMat = new THREE.MeshStandardMaterial({ color: '#f2e6d0', roughness: 0.82 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: '#523e2c', roughness: 0.62 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1817', roughness: 0.22 });

    this.materials.push(coatMat, creamMat, antlerMat, darkMat);

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
      torso.position.y = 0.82;
      torso.castShadow = true;
      torso.receiveShadow = true;
      torso.userData = userData;

      const chest = new THREE.Mesh(chestGeo, coatMat);
      chest.position.set(0, 0.84, 0.32);
      chest.castShadow = true;
      chest.userData = userData;

      const rump = new THREE.Mesh(rumpGeo, coatMat);
      rump.position.set(0, 0.85, -0.34);
      rump.castShadow = true;
      rump.userData = userData;

      const belly = new THREE.Mesh(bellyGeo, creamMat);
      belly.position.set(0, 0.72, 0);

      // Dappled Sika spots along both flanks
      for (let s = 0; s < 10; s++) {
        const spot = new THREE.Mesh(spotGeo, creamMat);
        const side = s % 2 === 0 ? 1 : -1;
        const row = Math.floor(s / 2);
        spot.position.set(
          side * (0.245 + (row % 2) * 0.015),
          0.82 + (row % 2) * 0.07,
          -0.32 + row * 0.16,
        );
        spot.scale.set(0.32, 0.68, 0.88);
        root.add(spot);
      }

      // White tail tuft
      const tailMesh = new THREE.Mesh(tailGeo, creamMat);
      tailMesh.position.set(0, 0.94, -0.58);
      tailMesh.rotation.x = 0.45;
      root.add(tailMesh);

      // Articulated Neck + Sculpted Head + Snout + Eyes + Ears + Branched Antlers
      const neckGroup = new THREE.Group();
      neckGroup.position.set(0, 0.94, 0.42);
      const neck = new THREE.Mesh(neckGeo, coatMat);
      neck.rotation.x = 0.28;
      neck.castShadow = true;

      const headGroup = new THREE.Group();
      headGroup.position.set(0, 0.52, 0.18);

      const cranium = new THREE.Mesh(craniumGeo, coatMat);
      cranium.castShadow = true;
      cranium.userData = userData;

      const snout = new THREE.Mesh(snoutGeo, coatMat);
      snout.position.set(0, -0.025, 0.17);
      snout.castShadow = true;

      const nose = new THREE.Mesh(noseGeo, darkMat);
      nose.position.set(0, -0.015, 0.29);

      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, darkMat);
        eye.position.set(side * 0.095, 0.03, 0.06);
        headGroup.add(eye);
      }

      const earLeft = new THREE.Mesh(earGeo, coatMat);
      earLeft.position.set(-0.09, 0.08, -0.04);
      earLeft.rotation.set(-0.2, 0, 0.58);

      const earRight = new THREE.Mesh(earGeo, coatMat);
      earRight.position.set(0.09, 0.08, -0.04);
      earRight.rotation.set(-0.2, 0, -0.58);

      headGroup.add(cranium, snout, nose, earLeft, earRight);

      // Multi-tine branched antlers for stags (deer 0 & 1)
      if (i < 2) {
        const antlerScale = i === 0 ? 1.0 : 0.78;
        for (const side of [-1, 1]) {
          const antlerRoot = new THREE.Group();
          antlerRoot.position.set(side * 0.065, 0.11, -0.02);
          antlerRoot.rotation.set(-0.28, 0, side * -0.32);
          antlerRoot.scale.setScalar(antlerScale);

          const beam = new THREE.Mesh(antlerBeamGeo, antlerMat);
          beam.castShadow = true;

          // Brow tine pointing forward
          const browTine = new THREE.Mesh(antlerTineGeo, antlerMat);
          browTine.position.set(0, 0.11, 0.02);
          browTine.rotation.x = 0.85;

          // Royal middle tine pointing outward/upward
          const midTine = new THREE.Mesh(antlerTineGeo, antlerMat);
          midTine.position.set(0, 0.25, 0);
          midTine.rotation.z = side * -0.68;
          midTine.rotation.x = 0.35;

          // Crown fork tine at top
          const topTine = new THREE.Mesh(antlerTineGeo, antlerMat);
          topTine.position.set(0, 0.36, -0.01);
          topTine.rotation.z = side * 0.42;
          topTine.rotation.x = -0.3;

          antlerRoot.add(beam, browTine, midTine, topTine);
          headGroup.add(antlerRoot);
        }
      }

      neckGroup.add(neck, headGroup);

      // 4 two-jointed legs (upper thigh + lower shin + dark cloven hoof)
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

        const lowerMesh = new THREE.Mesh(lowerLegGeo, coatMat);
        lowerMesh.castShadow = true;

        const hoofMesh = new THREE.Mesh(hoofGeo, darkMat);

        lowerGroup.add(lowerMesh, hoofMesh);
        upperGroup.add(upperMesh, lowerGroup);
        root.add(upperGroup);
        return { upperGroup, lowerGroup };
      });

      root.add(torso, chest, rump, belly, neckGroup);
      root.position.set(x, y, z);
      this.scene.add(root);
      this.clickableMeshes.push(torso, chest, rump, cranium);

      const wander = new YUKA.WanderBehavior(1.2, 2.0, 1.5);
      const arrive = new YUKA.ArriveBehavior(new YUKA.Vector3(8.5, 0.3, -7.5), 1.8, 0.4);
      arrive.active = false;

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
    const bodyGeo = this.trackGeo(new THREE.CapsuleGeometry(0.048, 0.22, 5, 8));
    bodyGeo.rotateX(Math.PI / 2);
    const headGeo = this.trackGeo(new THREE.SphereGeometry(0.042, 6, 6));
    const beakGeo = this.trackGeo(new THREE.ConeGeometry(0.016, 0.08, 4));
    beakGeo.rotateX(Math.PI / 2);
    const tailGeo = this.trackGeo(new THREE.ConeGeometry(0.09, 0.18, 3));
    tailGeo.rotateX(-Math.PI / 2);
    tailGeo.scale(1.2, 0.2, 1.0);

    const wingGeo = this.trackGeo(new THREE.PlaneGeometry(0.52, 0.22, 2, 1));
    wingGeo.translate(0.26, 0, 0);

    const wingTex = this.assets.getBirdWingTexture(256);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: '#f4f0e8',
      roughness: 0.55,
    });
    const beakMat = new THREE.MeshStandardMaterial({
      color: '#e09f3e',
      roughness: 0.4,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      map: wingTex,
      alphaTest: 0.25,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    this.materials.push(bodyMat, beakMat, wingMat);

    for (let i = 0; i < this.biome.wildlife.birdCount; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const head = new THREE.Mesh(headGeo, bodyMat);
      head.position.set(0, 0.02, 0.14);
      const beak = new THREE.Mesh(beakGeo, beakMat);
      beak.position.set(0, 0.015, 0.2);
      const tail = new THREE.Mesh(tailGeo, bodyMat);
      tail.position.set(0, 0.01, -0.18);

      const wingL = new THREE.Mesh(wingGeo, wingMat);
      const wingR = new THREE.Mesh(wingGeo, wingMat);
      wingR.scale.x = -1;
      root.add(body, head, beak, tail, wingL, wingR);

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
    const wingGeo = this.trackGeo(new THREE.PlaneGeometry(0.18, 0.22));
    wingGeo.translate(0.09, 0, 0);
    const bodyGeo = this.trackGeo(new THREE.CapsuleGeometry(0.012, 0.09, 4, 6));
    bodyGeo.rotateX(Math.PI / 2);

    const bodyMat = new THREE.MeshStandardMaterial({ color: '#1f1a1c', roughness: 0.6 });
    const wingMats = [0, 1, 2].map((v) => {
      const tex = this.assets.getButterflyWingTexture(v, 256);
      const m = new THREE.MeshStandardMaterial({
        map: tex,
        alphaTest: 0.22,
        emissive: '#3a2208',
        emissiveIntensity: 0.35,
        roughness: 0.42,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return m;
    });
    this.materials.push(bodyMat);

    for (let i = 0; i < this.biome.wildlife.butterflyCount; i++) {
      const root = new THREE.Group();
      const mat = wingMats[i % wingMats.length];
      const thorax = new THREE.Mesh(bodyGeo, bodyMat);
      const wingL = new THREE.Mesh(wingGeo, mat);
      const wingR = new THREE.Mesh(wingGeo, mat);
      wingR.scale.x = -1;
      root.add(thorax, wingL, wingR);

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
