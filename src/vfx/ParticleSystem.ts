import * as THREE from 'three';
import {
  ApplyForce,
  BatchedRenderer,
  Bezier,
  ColorRange,
  ConeEmitter,
  ConstantValue,
  IntervalValue,
  ParticleSystem as QuarksParticleSystem,
  PiecewiseBezier,
  RenderMode,
  SizeOverLife,
  SphereEmitter,
  Vector3 as QVector3,
  Vector4 as QVector4,
} from 'three.quarks';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { AssetLoader } from '../core/AssetLoader';
import type { EventBus, WeatherMode } from '../core/EventBus';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';

/**
 * High-performance batched GPU particle VFX via three.quarks:
 * waterfall mist, nocturnal fireflies, drifting autumn leaves, and interactive bursts.
 */
export class ParticleSystem implements IWorldSystem {
  readonly name = 'ParticleSystem';

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly assets: AssetLoader;
  private readonly bus: EventBus;

  private batchRenderer = new BatchedRenderer();
  private systems: QuarksParticleSystem[] = [];
  private fireflySystem: QuarksParticleSystem | null = null;
  private leafBurstSystem: QuarksParticleSystem | null = null;
  private splashBurstSystem: QuarksParticleSystem | null = null;
  private materials: THREE.Material[] = [];

  private unsubWeather: (() => void) | null = null;
  private unsubShake: (() => void) | null = null;
  private unsubRipple: (() => void) | null = null;

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
    this.batchRenderer.name = 'quarks-vfx-batch';
    this.scene.add(this.batchRenderer);

    const softTex = this.assets.getSoftParticleTexture(128);
    const mistMat = new THREE.MeshBasicMaterial({
      map: softTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      map: softTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const leafMat = new THREE.MeshBasicMaterial({
      color: '#e59a45',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(mistMat, glowMat, leafMat);

    // 1. Waterfall Plunge Mist
    const { waterfallZ } = this.biome.terrain;
    const fallX = this.heightfield.getStreamCenterX(waterfallZ);
    const mist = new QuarksParticleSystem({
      duration: 5,
      looping: true,
      prewarm: true,
      startLife: new IntervalValue(2.0, 3.8),
      startSpeed: new IntervalValue(0.6, 1.8),
      startSize: new IntervalValue(1.4, 3.1),
      startColor: new ColorRange(new QVector4(0.88, 0.96, 0.98, 0.28), new QVector4(0.95, 0.99, 1.0, 0.14)),
      emissionOverTime: new ConstantValue(11),
      shape: new SphereEmitter({ radius: 2.8, thickness: 0.9 }),
      material: mistMat,
      renderMode: RenderMode.BillBoard,
      renderOrder: 5,
      behaviors: [
        new ApplyForce(new QVector3(0, 0.45, 0.35), new ConstantValue(1)),
        new SizeOverLife(new PiecewiseBezier([[new Bezier(0.6, 1.0, 1.35, 1.7), 0]])),
      ],
    });
    mist.emitter.position.set(fallX, 0.55, waterfallZ + 2.2);
    this.registerQuarksSystem(mist);

    // 2. Nocturnal Fireflies (toggled by weather preset)
    const fireflies = new QuarksParticleSystem({
      duration: 6,
      looping: true,
      startLife: new IntervalValue(3.0, 5.5),
      startSpeed: new IntervalValue(0.15, 0.48),
      startSize: new IntervalValue(0.16, 0.32),
      startColor: new ColorRange(new QVector4(0.75, 1.0, 0.38, 0.95), new QVector4(1.0, 0.92, 0.45, 0.85)),
      emissionOverTime: new ConstantValue(10),
      shape: new SphereEmitter({ radius: 18, thickness: 1 }),
      material: glowMat,
      renderMode: RenderMode.BillBoard,
      renderOrder: 6,
      behaviors: [new ApplyForce(new QVector3(0, 0.12, 0), new ConstantValue(1))],
    });
    fireflies.emitter.position.set(0, 2.0, -4);
    this.fireflySystem = fireflies;
    this.registerQuarksSystem(fireflies);

    // 3. Ambient Drifting Leaves
    const leaves = new QuarksParticleSystem({
      duration: 8,
      looping: true,
      prewarm: true,
      startLife: new IntervalValue(4.5, 7.5),
      startSpeed: new IntervalValue(0.25, 0.65),
      startSize: new IntervalValue(0.14, 0.24),
      startRotation: new IntervalValue(0, Math.PI * 2),
      startColor: new ColorRange(new QVector4(0.85, 0.45, 0.2, 0.92), new QVector4(0.92, 0.72, 0.3, 0.9)),
      emissionOverTime: new ConstantValue(4.5),
      shape: new SphereEmitter({ radius: 22, thickness: 0.7 }),
      material: leafMat,
      renderMode: RenderMode.BillBoard,
      behaviors: [new ApplyForce(new QVector3(0.25, -0.45, 0.15), new ConstantValue(1))],
    });
    leaves.emitter.position.set(0, 9.5, 0);
    this.registerQuarksSystem(leaves);

    // 4. Interactive Tree-Shake Leaf Burst (emissionBurst triggered on click)
    const leafBurst = new QuarksParticleSystem({
      duration: 2.5,
      looping: false,
      startLife: new IntervalValue(2.2, 3.8),
      startSpeed: new IntervalValue(0.7, 2.0),
      startSize: new IntervalValue(0.16, 0.26),
      startColor: new ColorRange(new QVector4(0.88, 0.44, 0.2, 0.95), new QVector4(0.95, 0.74, 0.28, 0.95)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(24), cycle: 1, interval: 0, probability: 1 }],
      shape: new SphereEmitter({ radius: 2.2, thickness: 0.8 }),
      material: leafMat,
      renderMode: RenderMode.BillBoard,
      behaviors: [new ApplyForce(new QVector3(0.3, -1.2, 0.1), new ConstantValue(1))],
    });
    leafBurst.pause();
    this.leafBurstSystem = leafBurst;
    this.registerQuarksSystem(leafBurst);

    // 5. Interactive Water Click Splash
    const splash = new QuarksParticleSystem({
      duration: 1.2,
      looping: false,
      startLife: new IntervalValue(0.45, 0.85),
      startSpeed: new IntervalValue(1.1, 2.4),
      startSize: new IntervalValue(0.14, 0.28),
      startColor: new ColorRange(new QVector4(0.85, 0.98, 1.0, 0.8), new QVector4(1.0, 1.0, 1.0, 0.5)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(16), cycle: 1, interval: 0, probability: 1 }],
      shape: new ConeEmitter({ radius: 0.35, angle: 0.65 }),
      material: mistMat,
      renderMode: RenderMode.BillBoard,
      renderOrder: 6,
      behaviors: [new ApplyForce(new QVector3(0, -4.5, 0), new ConstantValue(1))],
    });
    splash.emitter.rotation.x = -Math.PI / 2;
    splash.pause();
    this.splashBurstSystem = splash;
    this.registerQuarksSystem(splash);

    this.applyWeather(this.biome.defaultWeather);

    this.unsubWeather = this.bus.on('weather:change', ({ mode }) => this.applyWeather(mode));
    this.unsubShake = this.bus.on('tree:shake', ({ position }) => {
      if (this.leafBurstSystem) {
        this.leafBurstSystem.emitter.position.set(position[0], position[1] + 4.5, position[2]);
        this.leafBurstSystem.restart();
        this.leafBurstSystem.play();
      }
    });
    this.unsubRipple = this.bus.on('water:ripple', ({ position }) => {
      if (this.splashBurstSystem) {
        this.splashBurstSystem.emitter.position.set(position[0], position[1] + 0.08, position[2]);
        this.splashBurstSystem.restart();
        this.splashBurstSystem.play();
      }
    });
  }

  private registerQuarksSystem(ps: QuarksParticleSystem): void {
    this.systems.push(ps);
    this.scene.add(ps.emitter);
    this.batchRenderer.addSystem(ps);
  }

  private applyWeather(mode: WeatherMode): void {
    const active = this.biome.weatherPresets[mode]?.firefliesActive ?? false;
    if (this.fireflySystem) {
      if (active) {
        this.fireflySystem.play();
      } else {
        this.fireflySystem.pause();
      }
    }
  }

  update(dt: number, _elapsed: number): void {
    this.batchRenderer.update(dt);
  }

  dispose(): void {
    if (this.unsubWeather) {
      this.unsubWeather();
      this.unsubWeather = null;
    }
    if (this.unsubShake) {
      this.unsubShake();
      this.unsubShake = null;
    }
    if (this.unsubRipple) {
      this.unsubRipple();
      this.unsubRipple = null;
    }
    for (const ps of this.systems) {
      this.batchRenderer.deleteSystem(ps);
      this.scene.remove(ps.emitter);
    }
    this.systems = [];
    this.fireflySystem = null;
    this.leafBurstSystem = null;
    this.splashBurstSystem = null;

    this.scene.remove(this.batchRenderer);
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }
}
