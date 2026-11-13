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
  light: THREE.PointLight;
  hitMesh: THREE.Mesh;
}

/**
 * Constructs handcrafted architectural accents: arched ancient stone bridge,
 * river stepping stones, interactive Stone Lanterns (Thach Dang), and riverside campsite.
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
    const stoneNormal = this.assets.getProceduralNormalMap('carved-stone', 256, 7, 1.8, 2);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: '#737673',
      normalMap: stoneNormal,
      roughness: 0.88,
      metalness: 0.05,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: '#4f3827',
      roughness: 0.86,
    });
    const canvasMat = new THREE.MeshStandardMaterial({
      color: '#d9cbb3',
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    this.materials.push(stoneMat, darkWoodMat, canvasMat);

    this.buildArchedStoneBridge(stoneMat);
    this.buildSteppingStones(stoneMat);
    this.buildStoneLanterns(stoneMat);
    this.buildRiversideCamp(stoneMat, darkWoodMat, canvasMat);

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

  private buildArchedStoneBridge(stoneMat: THREE.Material): void {
    const bridgeZ = 6.0;
    const centerX = this.heightfield.getStreamCenterX(bridgeZ);
    const bridge = new THREE.Group();
    bridge.position.set(centerX, 0.25, bridgeZ);

    const plankGeo = this.trackGeo(new THREE.BoxGeometry(0.95, 0.28, 2.7));
    const postGeo = this.trackGeo(new THREE.BoxGeometry(0.24, 0.85, 0.24));
    const steps = 15;
    const span = 10.6;

    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const x = (t - 0.5) * span;
      const archY = Math.sin(t * Math.PI) * 1.65;
      const slopeAngle = Math.cos(t * Math.PI) * 0.34;

      const step = new THREE.Mesh(plankGeo, stoneMat);
      step.position.set(x, archY, 0);
      step.rotation.z = slopeAngle;
      step.castShadow = true;
      step.receiveShadow = true;
      bridge.add(step);

      if (i % 3 === 0) {
        for (const zSide of [-1.2, 1.2]) {
          const post = new THREE.Mesh(postGeo, stoneMat);
          post.position.set(x, archY + 0.5, zSide);
          post.castShadow = true;
          post.receiveShadow = true;
          bridge.add(post);
        }
      }
    }
    this.root.add(bridge);
  }

  private buildSteppingStones(stoneMat: THREE.Material): void {
    const fordZ = 16.5;
    const centerX = this.heightfield.getStreamCenterX(fordZ);
    const stoneGeo = this.trackGeo(new THREE.CylinderGeometry(0.58, 0.68, 0.34, 8));
    const count = 7;

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1) - 0.5;
      const x = centerX + t * 5.8;
      const z = fordZ + Math.sin(i * 1.4) * 0.45;
      const mesh = new THREE.Mesh(stoneGeo, stoneMat);
      mesh.position.set(x, this.biome.terrain.waterLevel + 0.04, z);
      mesh.rotation.y = i * 0.7;
      mesh.scale.set(1.0 + (i % 2) * 0.2, 1, 0.85);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildStoneLanterns(stoneMat: THREE.Material): void {
    const spots: Array<[number, number]> = [
      [this.heightfield.getStreamCenterX(6) - 6.0, 4.3],
      [this.heightfield.getStreamCenterX(6) + 6.0, 7.7],
      [7.2, -3.2],
      [10.8, 8.8],
    ];

    const baseGeo = this.trackGeo(new THREE.CylinderGeometry(0.36, 0.48, 0.26, 6));
    const shaftGeo = this.trackGeo(new THREE.CylinderGeometry(0.14, 0.19, 1.05, 6));
    const chamberGeo = this.trackGeo(new THREE.BoxGeometry(0.42, 0.42, 0.42));
    const roofGeo = this.trackGeo(new THREE.ConeGeometry(0.58, 0.36, 6));
    const coreGeo = this.trackGeo(new THREE.BoxGeometry(0.28, 0.28, 0.28));

    spots.forEach(([x, z], idx) => {
      const y = this.heightfield.getHeightAt(x, z);
      const group = new THREE.Group();
      group.position.set(x, y, z);

      const base = new THREE.Mesh(baseGeo, stoneMat);
      base.position.y = 0.13;
      base.castShadow = true;
      base.receiveShadow = true;

      const shaft = new THREE.Mesh(shaftGeo, stoneMat);
      shaft.position.y = 0.76;
      shaft.castShadow = true;

      const chamber = new THREE.Mesh(chamberGeo, stoneMat);
      chamber.position.y = 1.44;
      chamber.castShadow = true;
      chamber.userData = { interactableType: 'lantern', lanternId: idx };

      const coreMat = new THREE.MeshStandardMaterial({
        color: '#ffcf87',
        emissive: '#ff9c3b',
        emissiveIntensity: 0,
        roughness: 0.4,
      });
      this.materials.push(coreMat);

      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 1.44;
      core.userData = { interactableType: 'lantern', lanternId: idx };

      const roof = new THREE.Mesh(roofGeo, stoneMat);
      roof.position.y = 1.82;
      roof.castShadow = true;

      const light = new THREE.PointLight('#ff9f45', 0, 12, 1.8);
      light.position.set(0, 1.48, 0);

      group.add(base, shaft, chamber, core, roof, light);
      this.root.add(group);

      const entity: LanternEntity = { id: idx, lit: false, coreMat, light, hitMesh: chamber };
      this.lanterns.push(entity);
      this.interactiveLanterns.push(chamber, core);
    });
  }

  private buildRiversideCamp(
    stoneMat: THREE.Material,
    woodMat: THREE.Material,
    canvasMat: THREE.Material,
  ): void {
    const campX = 13.0;
    const campZ = 6.0;
    const campY = this.heightfield.getHeightAt(campX, campZ);

    const camp = new THREE.Group();
    camp.position.set(campX, campY, campZ);

    // Cozy A-frame canvas tent
    const tentGeo = this.trackGeo(new THREE.ConeGeometry(2.1, 2.1, 4, 1, false));
    tentGeo.rotateY(Math.PI / 4);
    const tent = new THREE.Mesh(tentGeo, canvasMat);
    tent.position.set(2.4, 1.0, -1.6);
    tent.scale.set(1.15, 0.95, 1.4);
    tent.castShadow = true;
    tent.receiveShadow = true;
    camp.add(tent);

    // Log benches
    const logGeo = this.trackGeo(new THREE.CylinderGeometry(0.22, 0.24, 1.8, 8));
    logGeo.rotateZ(Math.PI / 2);
    const bench1 = new THREE.Mesh(logGeo, woodMat);
    bench1.position.set(-1.3, 0.22, 1.4);
    bench1.rotation.y = 0.45;
    bench1.castShadow = true;
    bench1.receiveShadow = true;

    const bench2 = new THREE.Mesh(logGeo, woodMat);
    bench2.position.set(1.3, 0.22, 1.6);
    bench2.rotation.y = -0.5;
    bench2.castShadow = true;
    bench2.receiveShadow = true;
    camp.add(bench1, bench2);

    // Stone-ringed campfire pit
    const pebbleGeo = this.trackGeo(new THREE.DodecahedronGeometry(0.18, 0));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(pebbleGeo, stoneMat);
      s.position.set(Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62);
      s.scale.set(1.2, 0.7, 1.0);
      s.castShadow = true;
      camp.add(s);
    }

    // Glowing embers + firewood
    const emberGeo = this.trackGeo(new THREE.SphereGeometry(0.28, 8, 6));
    this.emberMat = new THREE.MeshStandardMaterial({
      color: '#3a1a0c',
      emissive: '#ff5d1a',
      emissiveIntensity: 1.8,
      roughness: 0.85,
    });
    this.materials.push(this.emberMat);
    const ember = new THREE.Mesh(emberGeo, this.emberMat);
    ember.scale.set(1.2, 0.45, 1.2);
    ember.position.y = 0.08;
    camp.add(ember);

    this.campfireLight = new THREE.PointLight('#ff7b29', 2.4, 14, 1.7);
    this.campfireLight.position.set(0, 0.55, 0);
    camp.add(this.campfireLight);

    this.root.add(camp);
  }

  private setLanternState(lantern: LanternEntity, lit: boolean): void {
    lantern.lit = lit;
    lantern.coreMat.emissiveIntensity = lit ? 2.4 : 0;
    lantern.light.intensity = lit ? 2.8 : 0;
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
      this.campfireLight.intensity = 2.4 * flicker;
      this.emberMat.emissiveIntensity = 1.8 * flicker;
    }
    for (const l of this.lanterns) {
      if (l.lit) {
        const glow = 0.92 + Math.sin(elapsed * 4.5 + l.id * 1.7) * 0.08;
        l.light.intensity = 2.8 * glow;
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
    this.interactiveLanterns.length = 0;
    this.campfireLight = null;
    this.emberMat = null;
  }
}
