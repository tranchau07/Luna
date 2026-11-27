import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { EventBus, WeatherMode } from '../core/EventBus';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { QualityProfile, QualityTier } from '../core/QualityConfig';
import type { TerrainHeightfield } from './TerrainHeightfield';
import type { RockObstacle } from './RockSystem';

interface LanternEntity {
  id: number;
  lit: boolean;
  coreMat: THREE.MeshStandardMaterial;
  flameMesh: THREE.Mesh;
  light: THREE.PointLight;
  hitMesh: THREE.Mesh;
}

/**
 * Constructs handcrafted architectural accents with merged static geometries & instanced stones:
 * arched ancient stone bridge with balusters & handrails, instanced river stepping stones,
 * hollow-chamber Stone Lanterns (Thach Dang) with flickering flames,
 * and a detailed riverside campsite with ridgepole tent, split firewood, and cooking tripod.
 */
export class ArchitectureSystem implements IWorldSystem {
  readonly name = 'ArchitectureSystem';
  readonly interactiveLanterns: THREE.Object3D[] = [];
  readonly obstacles: RockObstacle[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly assets: AssetLoader;
  private readonly bus: EventBus;

  private root = new THREE.Group();
  private geometries: THREE.BufferGeometry[] = [];
  private bvhGeometries: THREE.BufferGeometry[] = [];
  private instancedMeshes: THREE.InstancedMesh[] = [];
  private materials: THREE.Material[] = [];
  private lanterns: LanternEntity[] = [];
  private campfireLight: THREE.PointLight | null = null;
  private emberMat: THREE.MeshStandardMaterial | null = null;
  private flameMeshes: THREE.Mesh[] = [];
  private currentQuality: QualityTier = 'medium';

  private unsubLantern: (() => void) | null = null;
  private unsubWeather: (() => void) | null = null;

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    assets: AssetLoader,
    bus: EventBus,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.assets = assets;
    this.bus = bus;
  }

  init(): void {
    this.root.name = 'valley-architecture';
    const stoneNormal = this.assets.getProceduralNormalMap('carved-stone', 256, 5, 1.05, 2);
    const stoneAlbedo = this.assets.getRockAlbedoTexture(256);
    const barkAlbedo = this.assets.getBarkAlbedoTexture(256);

    const stoneMat = new THREE.MeshStandardMaterial({
      color: '#9c9e97',
      map: stoneAlbedo,
      normalMap: stoneNormal,
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 0.86,
      metalness: 0.04,
    });
    const mossyStoneMat = new THREE.MeshStandardMaterial({
      color: '#738268',
      map: stoneAlbedo,
      normalMap: stoneNormal,
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 0.9,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: '#59402d',
      map: barkAlbedo,
      roughness: 0.85,
    });
    const cutWoodMat = new THREE.MeshStandardMaterial({
      color: '#b8926a',
      roughness: 0.78,
    });
    const charredWoodMat = new THREE.MeshStandardMaterial({
      color: '#231c18',
      emissive: '#ff4810',
      emissiveIntensity: 0.28,
      roughness: 0.92,
    });
    const canvasMat = new THREE.MeshStandardMaterial({
      color: '#dfd2bc',
      roughness: 0.88,
      side: THREE.DoubleSide,
    });
    const kettleMat = new THREE.MeshStandardMaterial({
      color: '#38322e',
      roughness: 0.42,
      metalness: 0.78,
    });

    this.materials.push(
      stoneMat,
      mossyStoneMat,
      darkWoodMat,
      cutWoodMat,
      charredWoodMat,
      canvasMat,
      kettleMat,
    );

    this.buildArchedStoneBridge(stoneMat, mossyStoneMat);
    this.buildSteppingStones(stoneMat, mossyStoneMat);
    this.buildStoneLanterns(stoneMat, mossyStoneMat);
    this.buildRiversideCamp(
      stoneMat,
      darkWoodMat,
      cutWoodMat,
      charredWoodMat,
      canvasMat,
      kettleMat,
    );

    this.scene.add(this.root);

    this.applyWeatherLighting(this.biome.defaultWeather);

    this.unsubLantern = this.bus.on('lantern:toggle', ({ id, lit }) => {
      const target = this.lanterns.find((l) => l.id === id);
      if (!target) return;
      const nextLit = lit ?? !target.lit;
      this.setLanternState(target, nextLit);
      if (lit === undefined) {
        this.bus.emit('ui:toast', {
          message: nextLit ? 'Stone lantern lit' : 'Stone lantern extinguished',
        });
      }
    });

    this.unsubWeather = this.bus.on('weather:change', ({ mode }) => {
      this.applyWeatherLighting(mode);
    });
  }

  applyQuality(profile: QualityProfile): void {
    this.currentQuality = profile.tier;
    for (const l of this.lanterns) {
      l.light.visible = l.lit && this.currentQuality !== 'low';
    }
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private bakePart(base: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
    const g = base.index ? base.toNonIndexed() : base.clone();
    g.applyMatrix4(matrix);
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        g.deleteAttribute(key);
      }
    }
    if (!g.attributes.normal) {
      g.computeVertexNormals();
    }
    if (!g.attributes.uv) {
      g.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2),
      );
    }
    return g;
  }

  private mergeBucket(
    parts: THREE.BufferGeometry[],
    mat: THREE.Material,
    name: string,
    castShadow = true,
    receiveShadow = true,
  ): void {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return;
    merged.computeBoundingSphere();
    this.trackGeo(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    this.root.add(mesh);
  }

  private buildArchedStoneBridge(
    stoneMat: THREE.Material,
    mossyStoneMat: THREE.Material,
  ): void {
    const bridgeZ = this.biome.landmarks.bridgeZ;
    const centerX = this.heightfield.getStreamCenterX(bridgeZ);
    const bridgeOrigin = new THREE.Matrix4().makeTranslation(centerX, 0.25, bridgeZ);

    const slabGeo = new THREE.BoxGeometry(0.68, 0.24, 2.65);
    const curbGeo = new THREE.BoxGeometry(0.76, 0.34, 0.26);
    const postBaseGeo = new THREE.BoxGeometry(0.32, 0.22, 0.32);
    const postShaftGeo = new THREE.BoxGeometry(0.22, 0.78, 0.22);
    const postCapGeo = new THREE.ConeGeometry(0.22, 0.2, 4);
    postCapGeo.rotateY(Math.PI / 4);
    const railSegGeo = new THREE.BoxGeometry(0.82, 0.12, 0.14);

    const stoneParts: THREE.BufferGeometry[] = [];
    const mossyParts: THREE.BufferGeometry[] = [];
    const dummy = new THREE.Object3D();
    const worldMat = new THREE.Matrix4();

    const pushLocal = (
      geo: THREE.BufferGeometry,
      bucket: THREE.BufferGeometry[],
      px: number,
      py: number,
      pz: number,
      rz = 0,
    ) => {
      dummy.position.set(px, py, pz);
      dummy.rotation.set(0, 0, rz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      worldMat.multiplyMatrices(bridgeOrigin, dummy.matrix);
      bucket.push(this.bakePart(geo, worldMat));
    };

    const steps = 17;
    const span = 11.2;

    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const x = (t - 0.5) * span;
      const archY = Math.sin(t * Math.PI) * 1.68;
      const slopeAngle = Math.cos(t * Math.PI) * 0.34;

      // Deck slab
      pushLocal(slabGeo, i % 3 === 0 ? mossyParts : stoneParts, x, archY, 0, slopeAngle);

      // Twin arched stone side curbs & continuous handrail segments
      for (const zSide of [-1.26, 1.26]) {
        pushLocal(curbGeo, mossyParts, x, archY + 0.06, zSide, slopeAngle);

        if (i < steps - 1) {
          pushLocal(
            railSegGeo,
            stoneParts,
            x + (span / (steps - 1)) * 0.5,
            archY + 0.72,
            zSide,
            slopeAngle * 0.92,
          );
        }
      }

      // Carved baluster posts with capstones every 4 steps
      if (i % 4 === 0) {
        for (const zSide of [-1.26, 1.26]) {
          pushLocal(postBaseGeo, mossyParts, x, archY + 0.23, zSide);
          pushLocal(postShaftGeo, stoneParts, x, archY + 0.64, zSide);
          pushLocal(postCapGeo, mossyParts, x, archY + 1.1, zSide);
        }
      }
    }

    slabGeo.dispose();
    curbGeo.dispose();
    postBaseGeo.dispose();
    postShaftGeo.dispose();
    postCapGeo.dispose();
    railSegGeo.dispose();

    this.mergeBucket(stoneParts, stoneMat, 'bridge-stone');
    this.mergeBucket(mossyParts, mossyStoneMat, 'bridge-mossy');
  }

  private buildSteppingStones(
    stoneMat: THREE.Material,
    mossyStoneMat: THREE.Material,
  ): void {
    const fordZ = this.biome.landmarks.steppingStonesZ;
    const centerX = this.heightfield.getStreamCenterX(fordZ);
    const stoneGeo = this.trackGeo(new THREE.CylinderGeometry(0.58, 0.72, 0.34, 9));
    const mossCapGeo = this.trackGeo(new THREE.CylinderGeometry(0.42, 0.52, 0.08, 8));
    mossCapGeo.translate(0, 0.16, 0);
    const count = 7;

    const stoneInst = new THREE.InstancedMesh(stoneGeo, stoneMat, count);
    stoneInst.name = 'stepping-stones';
    stoneInst.castShadow = true;
    stoneInst.receiveShadow = true;

    const mossInst = new THREE.InstancedMesh(mossCapGeo, mossyStoneMat, count);
    mossInst.name = 'stepping-stone-moss';
    mossInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1) - 0.5;
      const x = centerX + t * 5.8;
      const z = fordZ + Math.sin(i * 1.4) * 0.45;
      dummy.position.set(x, this.biome.terrain.waterLevel + 0.04, z);
      dummy.rotation.set(0, i * 0.7, 0);
      dummy.scale.set(1.0 + (i % 2) * 0.22, 1, 0.86);
      dummy.updateMatrix();
      stoneInst.setMatrixAt(i, dummy.matrix);
      mossInst.setMatrixAt(i, dummy.matrix);
    }
    stoneInst.instanceMatrix.needsUpdate = true;
    mossInst.instanceMatrix.needsUpdate = true;
    stoneInst.computeBoundingSphere();
    mossInst.computeBoundingSphere();

    this.instancedMeshes.push(stoneInst, mossInst);
    this.root.add(stoneInst, mossInst);
  }

  private buildStoneLanterns(
    stoneMat: THREE.Material,
    mossyStoneMat: THREE.Material,
  ): void {
    const spots = this.biome.landmarks.lanternPositions;

    // 7-part traditional Toro stone lantern templates (baked into 2 merged static meshes)
    const plinthGeo = new THREE.CylinderGeometry(0.44, 0.54, 0.2, 6);
    const lotusBaseGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.16, 6);
    const shaftGeo = new THREE.CylinderGeometry(0.15, 0.19, 0.96, 8);
    const bandGeo = new THREE.TorusGeometry(0.17, 0.032, 6, 12);
    bandGeo.rotateX(Math.PI / 2);
    const platformGeo = new THREE.CylinderGeometry(0.38, 0.26, 0.16, 6);
    const pillarGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.42, 6);
    const roofGeo = new THREE.ConeGeometry(0.66, 0.36, 6);
    const eaveRingGeo = new THREE.CylinderGeometry(0.68, 0.62, 0.06, 6);
    const finialGeo = new THREE.SphereGeometry(0.09, 8, 6);
    finialGeo.scale(0.85, 1.45, 0.85);

    // Interactive / animated lantern geometries retained
    const hitBoxGeo = this.trackGeo(new THREE.BoxGeometry(0.48, 0.46, 0.48));
    hitBoxGeo.computeBoundsTree();
    this.bvhGeometries.push(hitBoxGeo);
    const flameGeo = this.trackGeo(new THREE.ConeGeometry(0.085, 0.24, 8));

    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.materials.push(hitMat);

    const stoneParts: THREE.BufferGeometry[] = [];
    const mossyParts: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();

    spots.forEach(([x, z], idx) => {
      const y = this.heightfield.getHeightAt(x, z);
      this.obstacles.push({ x, y: y + 1.0, z, radius: 0.9 });

      const addAt = (geo: THREE.BufferGeometry, bucket: THREE.BufferGeometry[], dx: number, dy: number, dz: number) => {
        m.makeTranslation(x + dx, y + dy, z + dz);
        bucket.push(this.bakePart(geo, m));
      };

      addAt(plinthGeo, mossyParts, 0, 0.1, 0);
      addAt(lotusBaseGeo, stoneParts, 0, 0.26, 0);
      addAt(shaftGeo, stoneParts, 0, 0.78, 0);
      addAt(bandGeo, mossyParts, 0, 0.78, 0);
      addAt(platformGeo, stoneParts, 0, 1.32, 0);

      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        addAt(pillarGeo, stoneParts, Math.cos(a) * 0.24, 1.58, Math.sin(a) * 0.24);
      }

      addAt(eaveRingGeo, mossyParts, 0, 1.81, 0);
      addAt(roofGeo, mossyParts, 0, 1.98, 0);
      addAt(finialGeo, stoneParts, 0, 2.22, 0);

      // Inner warm flickering flame & interactive hit box
      const coreMat = new THREE.MeshStandardMaterial({
        color: '#ffe29e',
        emissive: '#ff962e',
        emissiveIntensity: 0,
        roughness: 0.25,
      });
      this.materials.push(coreMat);

      const flame = new THREE.Mesh(flameGeo, coreMat);
      flame.position.set(x, y + 1.54, z);
      flame.userData = { interactableType: 'lantern', lanternId: idx };
      this.flameMeshes.push(flame);

      const chamberHit = new THREE.Mesh(hitBoxGeo, hitMat);
      chamberHit.position.set(x, y + 1.58, z);
      chamberHit.userData = { interactableType: 'lantern', lanternId: idx };

      const light = new THREE.PointLight('#ff9f45', 0, 13, 1.75);
      light.position.set(x, y + 1.56, z);

      this.root.add(flame, chamberHit, light);

      const entity: LanternEntity = {
        id: idx,
        lit: false,
        coreMat,
        flameMesh: flame,
        light,
        hitMesh: chamberHit,
      };
      this.lanterns.push(entity);
      this.interactiveLanterns.push(chamberHit, flame);
    });

    plinthGeo.dispose();
    lotusBaseGeo.dispose();
    shaftGeo.dispose();
    bandGeo.dispose();
    platformGeo.dispose();
    pillarGeo.dispose();
    roofGeo.dispose();
    eaveRingGeo.dispose();
    finialGeo.dispose();

    this.mergeBucket(stoneParts, stoneMat, 'lanterns-stone');
    this.mergeBucket(mossyParts, mossyStoneMat, 'lanterns-mossy');
  }

  private buildRiversideCamp(
    stoneMat: THREE.Material,
    woodMat: THREE.Material,
    cutWoodMat: THREE.Material,
    charredWoodMat: THREE.Material,
    canvasMat: THREE.Material,
    kettleMat: THREE.Material,
  ): void {
    const [campX, campZ] = this.biome.landmarks.campsiteCenter;
    const campY = this.heightfield.getHeightAt(campX, campZ);

    // Record tent and firepit as wildlife avoidance obstacles
    this.obstacles.push(
      { x: campX + 2.5, y: campY + 1.0, z: campZ - 1.7, radius: 2.1 },
      { x: campX, y: campY + 0.5, z: campZ, radius: 1.4 },
    );

    const campOrigin = new THREE.Matrix4().makeTranslation(campX, campY, campZ);
    const canvasParts: THREE.BufferGeometry[] = [];
    const woodParts: THREE.BufferGeometry[] = [];
    const cutWoodParts: THREE.BufferGeometry[] = [];
    const charredParts: THREE.BufferGeometry[] = [];
    const stoneParts: THREE.BufferGeometry[] = [];
    const kettleParts: THREE.BufferGeometry[] = [];

    const dummy = new THREE.Object3D();
    const worldMat = new THREE.Matrix4();

    const bakeUnder = (
      parentMat: THREE.Matrix4,
      geo: THREE.BufferGeometry,
      bucket: THREE.BufferGeometry[],
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
      dummy.position.set(px, py, pz);
      dummy.rotation.set(rx, ry, rz);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      worldMat.multiplyMatrices(parentMat, dummy.matrix);
      bucket.push(this.bakePart(geo, worldMat));
    };

    // 1. Detailed A-frame Ridge Tent with wooden ridgepole and sleeping mat
    dummy.position.set(2.5, 0, -1.7);
    dummy.rotation.set(0, -0.42, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    const tentMat = new THREE.Matrix4().multiplyMatrices(campOrigin, dummy.matrix);

    const panelGeo = new THREE.PlaneGeometry(2.75, 2.08, 4, 4);
    panelGeo.rotateY(Math.PI / 2);
    for (const side of [-1, 1]) {
      bakeUnder(tentMat, panelGeo, canvasParts, side * 0.55, 0.88, 0, 0, 0, side * 0.56);
    }

    const ridgePoleGeo = new THREE.CylinderGeometry(0.045, 0.045, 3.05, 6);
    ridgePoleGeo.rotateX(Math.PI / 2);
    bakeUnder(tentMat, ridgePoleGeo, woodParts, 0, 1.78, 0);

    const uprightPoleGeo = new THREE.CylinderGeometry(0.045, 0.055, 1.84, 6);
    bakeUnder(tentMat, uprightPoleGeo, woodParts, 0, 0.92, 1.38);
    bakeUnder(tentMat, uprightPoleGeo, woodParts, 0, 0.92, -1.38);

    const matGeo = new THREE.BoxGeometry(1.35, 0.06, 2.2);
    bakeUnder(tentMat, matGeo, cutWoodParts, 0, 0.04, -0.1);

    // 2. Split Log Benches with end-grain caps and support chocks
    const logBodyGeo = new THREE.CylinderGeometry(0.22, 0.24, 1.85, 10);
    logBodyGeo.rotateZ(Math.PI / 2);
    const logEndGeo = new THREE.CylinderGeometry(0.19, 0.19, 1.88, 10);
    logEndGeo.rotateZ(Math.PI / 2);
    const chockGeo = new THREE.BoxGeometry(0.26, 0.18, 0.42);

    const addBench = (bx: number, bz: number, rotY: number) => {
      dummy.position.set(bx, 0, bz);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      const benchMat = new THREE.Matrix4().multiplyMatrices(campOrigin, dummy.matrix);
      bakeUnder(benchMat, logBodyGeo, woodParts, 0, 0.25, 0);
      bakeUnder(benchMat, logEndGeo, cutWoodParts, 0, 0.25, 0);
      bakeUnder(benchMat, chockGeo, woodParts, -0.62, 0.09, 0);
      bakeUnder(benchMat, chockGeo, woodParts, 0.62, 0.09, 0);
    };

    addBench(-1.35, 1.45, 0.45);
    addBench(1.35, 1.65, -0.5);

    // 3. Stone-ringed Campfire Pit + Radially Stacked Firewood + Tripod Kettle
    const pebbleGeo = new THREE.DodecahedronGeometry(0.19, 1);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      bakeUnder(
        campOrigin,
        pebbleGeo,
        stoneParts,
        Math.cos(a) * 0.68,
        0.1,
        Math.sin(a) * 0.68,
        0,
        a,
        0,
        1.25,
        0.72,
        1.05,
      );
    }

    const firewoodGeo = new THREE.CylinderGeometry(0.065, 0.08, 0.92, 7);
    for (let f = 0; f < 6; f++) {
      const a = (f / 6) * Math.PI * 2 + 0.2;
      bakeUnder(
        campOrigin,
        firewoodGeo,
        f % 2 === 0 ? charredParts : woodParts,
        Math.cos(a) * 0.24,
        0.18,
        Math.sin(a) * 0.24,
        -Math.sin(a) * 1.05,
        0,
        Math.cos(a) * 1.05,
      );
    }

    const tripodPoleGeo = new THREE.CylinderGeometry(0.028, 0.042, 1.75, 6);
    for (let p = 0; p < 3; p++) {
      const a = (p / 3) * Math.PI * 2 + 0.35;
      bakeUnder(
        campOrigin,
        tripodPoleGeo,
        woodParts,
        Math.cos(a) * 0.42,
        0.78,
        Math.sin(a) * 0.42,
        -Math.sin(a) * 0.46,
        0,
        Math.cos(a) * 0.46,
      );
    }

    const kettleBodyGeo = new THREE.SphereGeometry(0.19, 10, 8);
    kettleBodyGeo.scale(1.15, 0.85, 1.15);
    bakeUnder(campOrigin, kettleBodyGeo, kettleParts, 0, 0.64, 0);

    const chainGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.78, 4);
    bakeUnder(campOrigin, chainGeo, kettleParts, 0, 1.06, 0);

    // Dispose camp template primitives
    panelGeo.dispose();
    ridgePoleGeo.dispose();
    uprightPoleGeo.dispose();
    matGeo.dispose();
    logBodyGeo.dispose();
    logEndGeo.dispose();
    chockGeo.dispose();
    pebbleGeo.dispose();
    firewoodGeo.dispose();
    tripodPoleGeo.dispose();
    kettleBodyGeo.dispose();
    chainGeo.dispose();

    this.mergeBucket(canvasParts, canvasMat, 'camp-canvas');
    this.mergeBucket(woodParts, woodMat, 'camp-wood');
    this.mergeBucket(cutWoodParts, cutWoodMat, 'camp-cut-wood');
    this.mergeBucket(charredParts, charredWoodMat, 'camp-charred');
    this.mergeBucket(stoneParts, stoneMat, 'camp-stones');
    this.mergeBucket(kettleParts, kettleMat, 'camp-kettle');

    // Glowing ember bed (animated intensity) + campfire point light
    const emberGeo = this.trackGeo(new THREE.SphereGeometry(0.32, 10, 8));
    this.emberMat = new THREE.MeshStandardMaterial({
      color: '#3a1a0c',
      emissive: '#ff5d1a',
      emissiveIntensity: 2.1,
      roughness: 0.82,
    });
    this.materials.push(this.emberMat);
    const ember = new THREE.Mesh(emberGeo, this.emberMat);
    ember.scale.set(1.25, 0.42, 1.25);
    ember.position.set(campX, campY + 0.08, campZ);
    this.root.add(ember);

    this.campfireLight = new THREE.PointLight('#ff7b29', 2.6, 15, 1.65);
    this.campfireLight.position.set(campX, campY + 0.58, campZ);
    this.root.add(this.campfireLight);
  }

  private setLanternState(lantern: LanternEntity, lit: boolean): void {
    lantern.lit = lit;
    lantern.coreMat.emissiveIntensity = lit ? 2.8 : 0.05;
    lantern.light.intensity = lit ? 3.0 : 0;
    lantern.light.visible = lit && this.currentQuality !== 'low';
    lantern.flameMesh.visible = true;
  }

  toggleLantern(id: number): boolean {
    const target = this.lanterns.find((l) => l.id === id);
    if (!target) return false;
    this.setLanternState(target, !target.lit);
    return target.lit;
  }

  private applyWeatherLighting(mode: WeatherMode): void {
    const autoLit = this.biome.weatherPresets[mode]?.lanternsAutoLit ?? false;
    for (const l of this.lanterns) {
      this.setLanternState(l, autoLit);
    }
  }

  update(_dt: number, elapsed: number): void {
    if (this.campfireLight && this.emberMat) {
      const flicker = 0.85 + Math.sin(elapsed * 9.3) * 0.1 + Math.cos(elapsed * 14.7) * 0.06;
      this.campfireLight.intensity = 2.6 * flicker;
      this.emberMat.emissiveIntensity = 2.1 * flicker;
    }
    for (const l of this.lanterns) {
      if (l.lit) {
        const glow = 0.92 + Math.sin(elapsed * 4.8 + l.id * 1.7) * 0.09;
        l.light.intensity = 3.0 * glow;
        const s = 0.9 + Math.sin(elapsed * 11.0 + l.id) * 0.12;
        l.flameMesh.scale.set(1, s, 1);
      } else {
        l.flameMesh.scale.set(0.6, 0.5, 0.6);
      }
    }
  }

  dispose(): void {
    if (this.unsubLantern) {
      this.unsubLantern();
      this.unsubLantern = null;
    }
    if (this.unsubWeather) {
      this.unsubWeather();
      this.unsubWeather = null;
    }
    for (const inst of this.instancedMeshes) {
      inst.dispose();
    }
    this.instancedMeshes = [];
    this.scene.remove(this.root);
    this.root.clear();
    for (const g of this.bvhGeometries) {
      g.disposeBoundsTree?.();
    }
    this.bvhGeometries = [];
    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
    this.lanterns = [];
    this.flameMeshes = [];
    this.interactiveLanterns.length = 0;
    this.obstacles.length = 0;
    this.campfireLight = null;
    this.emberMat = null;
  }
}
