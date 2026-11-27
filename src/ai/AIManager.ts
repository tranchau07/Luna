import * as THREE from 'three';
import * as YUKA from 'yuka';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { AssetLoader } from '../core/AssetLoader';
import type { EventBus } from '../core/EventBus';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';
import type { RockObstacle } from '../world/RockSystem';
import { FishFlockAI } from './FishFlockAI';
import { WildlifeFSM } from './WildlifeFSM';

/**
 * Coordinates Yuka EntityManager updates and synchronizes AI entities with Three.js rigs.
 */
export class AIManager implements IWorldSystem {
  readonly name = 'AIManager';

  private readonly entityManager = new YUKA.EntityManager();
  private readonly fishFlock: FishFlockAI;
  private readonly wildlife: WildlifeFSM;
  private readonly bus: EventBus;
  private unsubSummon: (() => void) | null = null;

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    obstacles: RockObstacle[],
    assets: AssetLoader,
    bus: EventBus,
  ) {
    this.bus = bus;
    this.fishFlock = new FishFlockAI(scene, biome, this.entityManager, obstacles, assets);
    this.wildlife = new WildlifeFSM(scene, biome, heightfield, this.entityManager, obstacles, assets, bus);
  }

  init(): void {
    this.fishFlock.init();
    this.wildlife.init();

    this.unsubSummon = this.bus.on('fish:summon', ({ position }) => {
      this.fishFlock.summonTo(position[0], position[2]);
    });
  }

  getClickableMeshes(): THREE.Object3D[] {
    return [...this.fishFlock.clickableMeshes, ...this.wildlife.clickableMeshes];
  }

  resolveEntityObject(entityId: string): THREE.Object3D | null {
    const koi = this.fishFlock.agents.find((k) => k.id === entityId);
    if (koi) return koi.root;
    const deer = this.wildlife.deerAgents.find((d) => d.id === entityId);
    if (deer) return deer.root;
    return null;
  }

  update(dt: number, elapsed: number): void {
    this.entityManager.update(dt);
    this.fishFlock.update(dt, elapsed);
    this.wildlife.update(dt, elapsed);
  }

  dispose(): void {
    if (this.unsubSummon) {
      this.unsubSummon();
      this.unsubSummon = null;
    }
    this.fishFlock.dispose();
    this.wildlife.dispose();
    this.entityManager.clear();
  }
}
