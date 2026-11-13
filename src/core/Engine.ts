import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';
import type { IWorldSystem } from './IWorldSystem';
import { EventBus, type WeatherMode } from './EventBus';
import { QUALITY_PROFILES, type QualityProfile, type QualityTier } from './QualityConfig';
import { AssetLoader } from './AssetLoader';
import { CameraRig } from './CameraRig';
import { PostPipeline } from './PostPipeline';
import type { BiomeConfig } from '../config/BiomeConfig';
import { TerrainSystem } from '../world/TerrainSystem';
import { SkyAtmosphere } from '../world/SkyAtmosphere';

let bvhPatched = false;

export interface DebugBridge {
  isReady: boolean;
  getRenderInfo: () => { geometries: number; textures: number; calls: number; triangles: number };
  getPresets: () => Array<{ id: string; label: string }>;
  getWeatherModes: () => WeatherMode[];
  setCameraPreset: (id: string, transition?: boolean) => void;
  setWeather: (mode: WeatherMode) => void;
  setQuality: (tier: QualityTier) => void;
  setEcoMode: (enabled: boolean) => void;
  setPaused: (paused: boolean) => void;
  disposeScene: () => void;
}

declare global {
  interface Window {
    __LUNA_DEBUG__?: DebugBridge;
  }
}

/**
 * Central 3D engine orchestrating WebGLRenderer, quality tiers, Eco Mode,
 * Page Visibility pause with dt clamping, BVH acceleration, and subsystem lifecycles.
 */
export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly bus = new EventBus();
  readonly assets = new AssetLoader();
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly biome: BiomeConfig;

  readonly sky: SkyAtmosphere;
  readonly terrain: TerrainSystem;
  readonly cameraRig: CameraRig;
  readonly postPipeline: PostPipeline;

  private systems: IWorldSystem[] = [];
  private qualityProfile: QualityProfile;
  private ecoMode = false;
  private disposed = false;
  private rafId: number | null = null;
  private lastTimeMs = 0;
  private lastRenderMs = 0;
  private elapsedSec = 0;
  private isHidden = false;

  private onResizeBound: () => void;
  private onVisibilityBound: () => void;
  private onContextLostBound: (e: Event) => void;
  private onContextRestoredBound: () => void;
  private unsubQuality: (() => void) | null = null;
  private unsubEco: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    biome: BiomeConfig,
    initialQuality: QualityTier = 'medium',
  ) {
    this.canvas = canvas;
    this.biome = biome;
    this.qualityProfile = QUALITY_PROFILES[initialQuality];

    if (!bvhPatched) {
      THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
      THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
      THREE.Mesh.prototype.raycast = acceleratedRaycast;
      bvhPatched = true;
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    // Single-pass ACES tone mapping is handled inside PostPipeline
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = biome.weatherPresets[biome.defaultWeather].exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.sky = new SkyAtmosphere(this.scene, this.renderer, this.biome, this.bus);
    this.terrain = new TerrainSystem(this.scene, this.biome, this.assets);
    this.cameraRig = new CameraRig(this.canvas, this.biome, this.bus, this.terrain.heightfield);

    this.registerSystem(this.sky);
    this.registerSystem(this.terrain);
    this.registerSystem(this.cameraRig);

    // Initialize core subsystems so sunDiscMesh & camera exist for PostPipeline
    this.sky.init();
    this.terrain.init();
    this.cameraRig.init();

    if (this.terrain.mesh) {
      this.cameraRig.addColliderMesh(this.terrain.mesh);
    }

    this.postPipeline = new PostPipeline(
      this.renderer,
      this.scene,
      this.cameraRig.camera,
      this.sky.sunDiscMesh,
      this.qualityProfile,
    );

    this.onResizeBound = () => this.handleResize();
    this.onVisibilityBound = () => this.handleVisibilityChange();
    this.onContextLostBound = (e: Event) => {
      e.preventDefault();
      this.stopLoop();
    };
    this.onContextRestoredBound = () => {
      this.lastTimeMs = performance.now();
      this.startLoop();
    };

    window.addEventListener('resize', this.onResizeBound);
    document.addEventListener('visibilitychange', this.onVisibilityBound);
    this.canvas.addEventListener('webglcontextlost', this.onContextLostBound);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestoredBound);

    this.unsubQuality = this.bus.on('quality:change', ({ tier }) => {
      this.setQualityTier(tier);
    });
    this.unsubEco = this.bus.on('eco:toggle', ({ enabled }) => {
      this.setEcoMode(enabled);
    });

    this.applyQualityAndSize();
    this.exposeDebugBridge();
  }

  registerSystem(system: IWorldSystem): void {
    if (!this.systems.includes(system)) {
      this.systems.push(system);
    }
  }

  initAdditionalSystems(): void {
    for (const sys of this.systems) {
      if (sys !== this.sky && sys !== this.terrain && sys !== this.cameraRig) {
        void sys.init();
      }
    }
    if (window.__LUNA_DEBUG__) {
      window.__LUNA_DEBUG__.isReady = true;
    }
  }

  getQualityProfile(): QualityProfile {
    return this.qualityProfile;
  }

  isEcoMode(): boolean {
    return this.ecoMode;
  }

  setQualityTier(tier: QualityTier): void {
    this.qualityProfile = QUALITY_PROFILES[tier];
    this.sky.applyQuality(this.qualityProfile);
    this.postPipeline.rebuildPasses(this.qualityProfile);
    this.applyQualityAndSize();
  }

  setEcoMode(enabled: boolean): void {
    this.ecoMode = enabled;
    this.applyQualityAndSize();
  }

  private applyQualityAndSize(): void {
    const pixelRatioCap = this.ecoMode ? 1 : this.qualityProfile.maxPixelRatio;
    const dpr = Math.min(window.devicePixelRatio || 1, pixelRatioCap);
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.cameraRig.setAspect(width, height);
    this.postPipeline.setSize(width, height);
  }

  private handleResize(): void {
    if (this.disposed) return;
    this.applyQualityAndSize();
  }

  private handleVisibilityChange(): void {
    this.isHidden = document.hidden;
    if (this.isHidden) {
      this.stopLoop();
    } else if (!this.disposed) {
      this.lastTimeMs = performance.now();
      this.lastRenderMs = this.lastTimeMs;
      this.startLoop();
    }
  }

  startLoop(): void {
    if (this.disposed || this.rafId !== null || this.isHidden) return;
    this.lastTimeMs = performance.now();
    this.lastRenderMs = this.lastTimeMs;

    const tick = (nowMs: number) => {
      if (this.disposed || this.isHidden) {
        this.rafId = null;
        return;
      }

      if (this.ecoMode) {
        const elapsedSinceRender = nowMs - this.lastRenderMs;
        if (elapsedSinceRender < 33.33) {
          this.rafId = requestAnimationFrame(tick);
          return;
        }
        this.lastRenderMs = nowMs;
      }

      // Clamp delta time <= 0.1s to prevent physics/AI leaps after frame pauses
      const rawDt = (nowMs - this.lastTimeMs) / 1000;
      const dt = Math.min(0.1, Math.max(0.0001, rawDt));
      this.lastTimeMs = nowMs;
      this.elapsedSec += dt;

      this.renderer.toneMappingExposure = this.sky.getExposure();

      for (const sys of this.systems) {
        sys.update(dt, this.elapsedSec);
      }

      this.postPipeline.render(dt);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setPaused(paused: boolean): void {
    if (paused) {
      this.stopLoop();
    } else if (!this.disposed && !this.isHidden) {
      this.startLoop();
    }
  }

  private exposeDebugBridge(): void {
    window.__LUNA_DEBUG__ = {
      isReady: false,
      getRenderInfo: () => ({
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }),
      getPresets: () => this.biome.cameraPresets.map((p) => ({ id: p.id, label: p.label })),
      getWeatherModes: () => Object.keys(this.biome.weatherPresets) as WeatherMode[],
      setCameraPreset: (id: string, transition = true) =>
        this.cameraRig.goToPreset(id, transition),
      setWeather: (mode: WeatherMode) => this.bus.emit('weather:change', { mode }),
      setQuality: (tier: QualityTier) => this.bus.emit('quality:change', { tier }),
      setEcoMode: (enabled: boolean) => this.bus.emit('eco:toggle', { enabled }),
      setPaused: (paused: boolean) => this.setPaused(paused),
      disposeScene: () => this.dispose(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();

    window.removeEventListener('resize', this.onResizeBound);
    document.removeEventListener('visibilitychange', this.onVisibilityBound);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLostBound);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestoredBound);

    if (this.unsubQuality) {
      this.unsubQuality();
      this.unsubQuality = null;
    }
    if (this.unsubEco) {
      this.unsubEco();
      this.unsubEco = null;
    }

    for (let i = this.systems.length - 1; i >= 0; i--) {
      this.systems[i].dispose();
    }
    this.systems = [];

    this.postPipeline.dispose();
    this.assets.dispose();
    this.bus.clear();
    this.renderer.dispose();
  }
}
