import * as THREE from 'three';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { EventBus } from '../core/EventBus';
import type { ArchitectureSystem } from '../world/ArchitectureSystem';

/**
 * BVH-accelerated pointer raycaster handling water ripples & koi summoning,
 * stone lantern toggles, tree shakes, and wildlife follow-camera selection.
 */
export class RaycastPicker implements IWorldSystem {
  readonly name = 'RaycastPicker';

  private readonly domElement: HTMLElement;
  private readonly camera: THREE.Camera;
  private readonly bus: EventBus;
  private readonly architecture: ArchitectureSystem;

  private raycaster = new THREE.Raycaster();
  private pointerDownPos = new THREE.Vector2();
  private ndc = new THREE.Vector2();
  private targets: THREE.Object3D[] = [];

  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(
    domElement: HTMLElement,
    camera: THREE.Camera,
    bus: EventBus,
    architecture: ArchitectureSystem,
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.bus = bus;
    this.architecture = architecture;
    this.raycaster.firstHitOnly = true;

    this.onPointerDownBound = (e) => {
      this.pointerDownPos.set(e.clientX, e.clientY);
    };
    this.onPointerUpBound = (e) => this.handlePointerUp(e);
    this.onKeyDownBound = (e) => {
      if (e.key === 'Escape') {
        this.bus.emit('camera:follow', { entityId: null });
      }
    };
  }

  setTargets(objects: THREE.Object3D[]): void {
    this.targets = objects;
  }

  init(): void {
    this.domElement.addEventListener('pointerdown', this.onPointerDownBound);
    this.domElement.addEventListener('pointerup', this.onPointerUpBound);
    window.addEventListener('keydown', this.onKeyDownBound);
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;
    const dragDist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dragDist > 6) return;

    const rect = this.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.targets, false);
    if (hits.length === 0) return;

    const hit = hits[0];
    const meta = hit.object.userData as {
      interactableType?: string;
      lanternId?: number;
      entityId?: string;
      label?: string;
    };

    const p: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z];

    switch (meta.interactableType) {
      case 'water':
        this.bus.emit('water:ripple', { position: p, intensity: 1.0 });
        this.bus.emit('fish:summon', { position: p });
        this.bus.emit('ui:toast', { message: 'Koi summoned to water ripple' });
        break;
      case 'lantern':
        if (typeof meta.lanternId === 'number') {
          const lit = this.architecture.toggleLantern(meta.lanternId);
          this.bus.emit('lantern:toggle', { id: meta.lanternId, lit });
          this.bus.emit('ui:toast', {
            message: lit ? 'Stone lantern lit' : 'Stone lantern extinguished',
          });
        }
        break;
      case 'tree':
        this.bus.emit('tree:shake', { position: p });
        this.bus.emit('ui:toast', { message: 'Breeze shook autumn leaves' });
        break;
      case 'wildlife':
        if (meta.entityId) {
          this.bus.emit('camera:follow', { entityId: meta.entityId, label: meta.label });
          this.bus.emit('ui:toast', {
            message: `Following ${meta.label ?? meta.entityId} (Esc or preset to exit)`,
          });
        }
        break;
      case 'terrain':
        this.bus.emit('camera:follow', { entityId: null });
        break;
    }
  }

  update(_dt: number, _elapsed: number): void {
    // Event-driven raycasting
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDownBound);
    this.domElement.removeEventListener('pointerup', this.onPointerUpBound);
    window.removeEventListener('keydown', this.onKeyDownBound);
    this.targets = [];
  }
}
