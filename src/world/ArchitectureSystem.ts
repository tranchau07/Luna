import * as THREE from 'three';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { EventBus, WeatherMode } from '../core/EventBus';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from './TerrainHeightfield';

interface LanternEntity {
  id: number;
  lit: boolean;
  coreMat: THREE.MeshStandardMaterial;
  flameMesh: THREE.Mesh;
  light: THREE.PointLight;
  hitMesh: THREE.Mesh;
}

/**
 * Constructs handcrafted architectural accents: arched ancient stone bridge with balusters & handrails,
 * river stepping stones, hollow-chamber Stone Lanterns (Thach Dang) with flickering flames,
 * and a detailed riverside campsite with ridgepole tent, split firewood, and cooking tripod.
 */
export class ArchitectureSystem implements IWorldSystem {
  readonly name = 'ArchitectureSystem';
  readonly interactiveLanterns: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly assets: AssetLoader;
  private readonly bus: EventBus;

  private root = new THREE.Group();
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private lanterns: LanternEntity[] = [];
  private campfireLight: THREE.PointLight | null = null;
  private emberMat: THREE.MeshStandardMaterial | null = null;
  private flameMeshes: THREE.Mesh[] = [];

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
      if (target) {
        this.setLanternState(target, lit);
      }
    });

    this.unsubWeather = this.bus.on('weather:change', ({ mode }) => {
      this.applyWeatherLighting(mode);
    });
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private buildArchedStoneBridge(
    stoneMat: THREE.Material,
    mossyStoneMat: THREE.Material,
  ): void {
    const bridgeZ = 6.0;
    const centerX = this.heightfield.getStreamCenterX(bridgeZ);
    const bridge = new THREE.Group();
    bridge.position.set(centerX, 0.25, bridgeZ);

    const slabGeo = this.trackGeo(new THREE.BoxGeometry(0.68, 0.24, 2.65));
    const curbGeo = this.trackGeo(new THREE.BoxGeometry(0.76, 0.34, 0.26));
    const postBaseGeo = this.trackGeo(new THREE.BoxGeometry(0.32, 0.22, 0.32));
    const postShaftGeo = this.trackGeo(new THREE.BoxGeometry(0.22, 0.78, 0.22));
    const postCapGeo = this.trackGeo(new THREE.ConeGeometry(0.22, 0.2, 4));
    postCapGeo.rotateY(Math.PI / 4);
    const railSegGeo = this.trackGeo(new THREE.BoxGeometry(0.82, 0.12, 0.14));

    const steps = 17;
    const span = 11.2;

    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const x = (t - 0.5) * span;
      const archY = Math.sin(t * Math.PI) * 1.68;
      const slopeAngle = Math.cos(t * Math.PI) * 0.34;

      // Deck slab
      const step = new THREE.Mesh(slabGeo, i % 3 === 0 ? mossyStoneMat : stoneMat);
      step.position.set(x, archY, 0);
      step.rotation.z = slopeAngle;
      step.castShadow = true;
      step.receiveShadow = true;
      bridge.add(step);

      // Twin arched stone side curbs & continuous handrail segments
      for (const zSide of [-1.26, 1.26]) {
        const curb = new THREE.Mesh(curbGeo, mossyStoneMat);
        curb.position.set(x, archY + 0.06, zSide);
        curb.rotation.z = slopeAngle;
        curb.castShadow = true;
        curb.receiveShadow = true;
        bridge.add(curb);

        if (i < steps - 1) {
          const rail = new THREE.Mesh(railSegGeo, stoneMat);
          rail.position.set(x + (span / (steps - 1)) * 0.5, archY + 0.72, zSide);
          rail.rotation.z = slopeAngle * 0.92;
          rail.castShadow = true;
          bridge.add(rail);
        }
      }

      // Carved baluster posts with capstones every 4 steps
      if (i % 4 === 0) {
        for (const zSide of [-1.26, 1.26]) {
          const postGroup = new THREE.Group();
          postGroup.position.set(x, archY + 0.12, zSide);

          const pBase = new THREE.Mesh(postBaseGeo, mossyStoneMat);
          pBase.position.y = 0.11;
          const pShaft = new THREE.Mesh(postShaftGeo, stoneMat);
          pShaft.position.y = 0.52;
          pShaft.castShadow = true;
          const pCap = new THREE.Mesh(postCapGeo, mossyStoneMat);
          pCap.position.y = 0.98;
          pCap.castShadow = true;

          postGroup.add(pBase, pShaft, pCap);
          bridge.add(postGroup);
        }
      }
    }
    this.root.add(bridge);
  }

  private buildSteppingStones(
    stoneMat: THREE.Material,
    mossyStoneMat: THREE.Material,
  ): void {
    const fordZ = 16.5;
    const centerX = this.heightfield.getStreamCenterX(fordZ);
    const stoneGeo = this.trackGeo(new THREE.CylinderGeometry(0.58, 0.72, 0.34, 9));
    const mossCapGeo = this.trackGeo(new THREE.CylinderGeometry(0.42, 0.52, 0.08, 8));
    const count = 7;

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1) - 0.5;
      const x = centerX + t * 5.8;
      const z = fordZ + Math.sin(i * 1.4) * 0.45;
      const group = new THREE.Group();
      group.position.set(x, this.biome.terrain.waterLevel + 0.04, z);
      group.rotation.y = i * 0.7;
      group.scale.set(1.0 + (i % 2) * 0.22, 1, 0.86);

      const mesh = new THREE.Mesh(stoneGeo, stoneMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const cap = new THREE.Mesh(mossCapGeo, mossyStoneMat);
      cap.position.y = 0.16;
      cap.receiveShadow = true;

      group.add(mesh, cap);
      this.root.add(group);
    }
  }

  private buildStoneLanterns(
    stoneMat: THREE.Material,
    mossyStoneMat: THREE.Material,
  ): void {
    const spots: Array<[number, number]> = [
      [this.heightfield.getStreamCenterX(6) - 6.0, 4.3],
      [this.heightfield.getStreamCenterX(6) + 6.0, 7.7],
      [7.2, -3.2],
      [10.8, 8.8],
    ];

    // 7-part traditional Tōrō stone lantern geometries
    const plinthGeo = this.trackGeo(new THREE.CylinderGeometry(0.44, 0.54, 0.2, 6));
    const lotusBaseGeo = this.trackGeo(new THREE.CylinderGeometry(0.32, 0.4, 0.16, 6));
    const shaftGeo = this.trackGeo(new THREE.CylinderGeometry(0.15, 0.19, 0.96, 8));
    const bandGeo = this.trackGeo(new THREE.TorusGeometry(0.17, 0.032, 6, 12));
    bandGeo.rotateX(Math.PI / 2);
    const platformGeo = this.trackGeo(new THREE.CylinderGeometry(0.38, 0.26, 0.16, 6));
    const pillarGeo = this.trackGeo(new THREE.CylinderGeometry(0.032, 0.036, 0.42, 6));
    const hitBoxGeo = this.trackGeo(new THREE.BoxGeometry(0.48, 0.46, 0.48));
    const flameGeo = this.trackGeo(new THREE.ConeGeometry(0.085, 0.24, 8));
    const roofGeo = this.trackGeo(new THREE.ConeGeometry(0.66, 0.36, 6));
    const eaveRingGeo = this.trackGeo(new THREE.CylinderGeometry(0.68, 0.62, 0.06, 6));
    const finialGeo = this.trackGeo(new THREE.SphereGeometry(0.09, 8, 6));
    finialGeo.scale(0.85, 1.45, 0.85);

    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.materials.push(hitMat);

    spots.forEach(([x, z], idx) => {
      const y = this.heightfield.getHeightAt(x, z);
      const group = new THREE.Group();
      group.position.set(x, y, z);

      const plinth = new THREE.Mesh(plinthGeo, mossyStoneMat);
      plinth.position.y = 0.1;
      plinth.castShadow = true;
      plinth.receiveShadow = true;

      const lotusBase = new THREE.Mesh(lotusBaseGeo, stoneMat);
      lotusBase.position.y = 0.26;
      lotusBase.castShadow = true;

      const shaft = new THREE.Mesh(shaftGeo, stoneMat);
      shaft.position.y = 0.78;
      shaft.castShadow = true;

      const band = new THREE.Mesh(bandGeo, mossyStoneMat);
      band.position.y = 0.78;

      const platform = new THREE.Mesh(platformGeo, stoneMat);
      platform.position.y = 1.32;
      platform.castShadow = true;

      // Hollow 6-pillar fire chamber (hibukuro)
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        const pillar = new THREE.Mesh(pillarGeo, stoneMat);
        pillar.position.set(Math.cos(a) * 0.24, 1.58, Math.sin(a) * 0.24);
        pillar.castShadow = true;
        group.add(pillar);
      }

      // Inner warm flickering flame & translucent paper/lattice core
      const coreMat = new THREE.MeshStandardMaterial({
        color: '#ffe29e',
        emissive: '#ff962e',
        emissiveIntensity: 0,
        roughness: 0.25,
      });
      this.materials.push(coreMat);

      const flame = new THREE.Mesh(flameGeo, coreMat);
      flame.position.y = 1.54;
      flame.userData = { interactableType: 'lantern', lanternId: idx };
      this.flameMeshes.push(flame);

      // Invisible hit volume around the fire chamber for easy clicking
      const chamberHit = new THREE.Mesh(hitBoxGeo, hitMat);
      chamberHit.position.y = 1.58;
      chamberHit.userData = { interactableType: 'lantern', lanternId: idx };

      const eaveRing = new THREE.Mesh(eaveRingGeo, mossyStoneMat);
      eaveRing.position.y = 1.81;
      eaveRing.castShadow = true;

      const roof = new THREE.Mesh(roofGeo, mossyStoneMat);
      roof.position.y = 1.98;
      roof.castShadow = true;

      const finial = new THREE.Mesh(finialGeo, stoneMat);
      finial.position.y = 2.22;
      finial.castShadow = true;

      const light = new THREE.PointLight('#ff9f45', 0, 13, 1.75);
      light.position.set(0, 1.56, 0);

      group.add(
        plinth,
        lotusBase,
        shaft,
        band,
        platform,
        flame,
        chamberHit,
        eaveRing,
        roof,
        finial,
        light,
      );
      this.root.add(group);

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
  }

  private buildRiversideCamp(
    stoneMat: THREE.Material,
    woodMat: THREE.Material,
    cutWoodMat: THREE.Material,
    charredWoodMat: THREE.Material,
    canvasMat: THREE.Material,
    kettleMat: THREE.Material,
  ): void {
    const campX = 13.0;
    const campZ = 6.0;
    const campY = this.heightfield.getHeightAt(campX, campZ);

    const camp = new THREE.Group();
    camp.position.set(campX, campY, campZ);

    // 1. Detailed A-frame Ridge Tent with wooden ridgepole, stakes, and woven mat
    const tentGroup = new THREE.Group();
    tentGroup.position.set(2.5, 0, -1.7);
    tentGroup.rotation.y = -0.42;

    const panelGeo = this.trackGeo(new THREE.PlaneGeometry(2.75, 2.08, 4, 4));
    panelGeo.rotateY(Math.PI / 2);
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(panelGeo, canvasMat);
      panel.position.set(side * 0.55, 0.88, 0);
      panel.rotation.z = side * 0.56;
      panel.castShadow = true;
      panel.receiveShadow = true;
      tentGroup.add(panel);
    }

    const ridgePoleGeo = this.trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 3.05, 6));
    ridgePoleGeo.rotateX(Math.PI / 2);
    const ridgePole = new THREE.Mesh(ridgePoleGeo, woodMat);
    ridgePole.position.set(0, 1.78, 0);
    ridgePole.castShadow = true;

    const uprightPoleGeo = this.trackGeo(new THREE.CylinderGeometry(0.045, 0.055, 1.84, 6));
    const frontPole = new THREE.Mesh(uprightPoleGeo, woodMat);
    frontPole.position.set(0, 0.92, 1.38);
    const backPole = new THREE.Mesh(uprightPoleGeo, woodMat);
    backPole.position.set(0, 0.92, -1.38);

    // Warm woven sleeping mat inside tent
    const matGeo = this.trackGeo(new THREE.BoxGeometry(1.35, 0.06, 2.2));
    const sleepingMat = new THREE.Mesh(matGeo, cutWoodMat);
    sleepingMat.position.set(0, 0.04, -0.1);
    sleepingMat.receiveShadow = true;

    tentGroup.add(ridgePole, frontPole, backPole, sleepingMat);
    camp.add(tentGroup);

    // 2. Split Log Benches with end-grain caps and support chocks
    const logBodyGeo = this.trackGeo(new THREE.CylinderGeometry(0.22, 0.24, 1.85, 10));
    logBodyGeo.rotateZ(Math.PI / 2);
    const logEndGeo = this.trackGeo(new THREE.CylinderGeometry(0.19, 0.19, 1.88, 10));
    logEndGeo.rotateZ(Math.PI / 2);
    const chockGeo = this.trackGeo(new THREE.BoxGeometry(0.26, 0.18, 0.42));

    const makeBench = (bx: number, bz: number, rotY: number) => {
      const bGroup = new THREE.Group();
      bGroup.position.set(bx, 0, bz);
      bGroup.rotation.y = rotY;

      const bark = new THREE.Mesh(logBodyGeo, woodMat);
      bark.position.y = 0.25;
      bark.castShadow = true;
      bark.receiveShadow = true;

      const ends = new THREE.Mesh(logEndGeo, cutWoodMat);
      ends.position.y = 0.25;

      const chockL = new THREE.Mesh(chockGeo, woodMat);
      chockL.position.set(-0.62, 0.09, 0);
      const chockR = new THREE.Mesh(chockGeo, woodMat);
      chockR.position.set(0.62, 0.09, 0);

      bGroup.add(bark, ends, chockL, chockR);
      camp.add(bGroup);
    };

    makeBench(-1.35, 1.45, 0.45);
    makeBench(1.35, 1.65, -0.5);

    // 3. Stone-ringed Campfire Pit + Radially Stacked Firewood + Tripod Kettle
    const pebbleGeo = this.trackGeo(new THREE.DodecahedronGeometry(0.19, 1));
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const s = new THREE.Mesh(pebbleGeo, stoneMat);
      s.position.set(Math.cos(a) * 0.68, 0.1, Math.sin(a) * 0.68);
      s.scale.set(1.25, 0.72, 1.05);
      s.rotation.y = a;
      s.castShadow = true;
      camp.add(s);
    }

    // Radially stacked firewood logs with glowing charred tips
    const firewoodGeo = this.trackGeo(new THREE.CylinderGeometry(0.065, 0.08, 0.92, 7));
    for (let f = 0; f < 6; f++) {
      const a = (f / 6) * Math.PI * 2 + 0.2;
      const log = new THREE.Mesh(firewoodGeo, f % 2 === 0 ? charredWoodMat : woodMat);
      log.position.set(Math.cos(a) * 0.24, 0.18, Math.sin(a) * 0.24);
      log.rotation.z = Math.cos(a) * 1.05;
      log.rotation.x = -Math.sin(a) * 1.05;
      log.castShadow = true;
      camp.add(log);
    }

    // Glowing ember bed + inner flame cone
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
    ember.position.y = 0.08;
    camp.add(ember);

    // Wooden tripod & suspended cast-iron kettle over the fire
    const tripodPoleGeo = this.trackGeo(new THREE.CylinderGeometry(0.028, 0.042, 1.75, 6));
    for (let p = 0; p < 3; p++) {
      const a = (p / 3) * Math.PI * 2 + 0.35;
      const pole = new THREE.Mesh(tripodPoleGeo, woodMat);
      pole.position.set(Math.cos(a) * 0.42, 0.78, Math.sin(a) * 0.42);
      pole.rotation.z = Math.cos(a) * 0.46;
      pole.rotation.x = -Math.sin(a) * 0.46;
      pole.castShadow = true;
      camp.add(pole);
    }

    const kettleBodyGeo = this.trackGeo(new THREE.SphereGeometry(0.19, 10, 8));
    kettleBodyGeo.scale(1.15, 0.85, 1.15);
    const kettle = new THREE.Mesh(kettleBodyGeo, kettleMat);
    kettle.position.set(0, 0.64, 0);
    kettle.castShadow = true;

    const chainGeo = this.trackGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.78, 4));
    const chain = new THREE.Mesh(chainGeo, kettleMat);
    chain.position.set(0, 1.06, 0);
    camp.add(kettle, chain);

    this.campfireLight = new THREE.PointLight('#ff7b29', 2.6, 15, 1.65);
    this.campfireLight.position.set(0, 0.58, 0);
    camp.add(this.campfireLight);

    this.root.add(camp);
  }

  private setLanternState(lantern: LanternEntity, lit: boolean): void {
    lantern.lit = lit;
    lantern.coreMat.emissiveIntensity = lit ? 2.8 : 0.05;
    lantern.light.intensity = lit ? 3.0 : 0;
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
    this.scene.remove(this.root);
    this.root.clear();
    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
    this.lanterns = [];
    this.flameMeshes = [];
    this.interactiveLanterns.length = 0;
    this.campfireLight = null;
    this.emberMat = null;
  }
}
