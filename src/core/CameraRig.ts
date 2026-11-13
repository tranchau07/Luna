import * as THREE from 'three';
import CameraControls from 'camera-controls';
import type { IWorldSystem } from './IWorldSystem';
import type { EventBus } from './EventBus';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';

let cameraControlsInstalled = false;

/**
 * Smooth damped camera controller with preset transitions, terrain floor clamping,
 * BVH collider support, and dynamic wildlife follow-camera targeting.
 */
export class CameraRig implements IWorldSystem {
  readonly name = 'CameraRig';

  readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly biome: BiomeConfig;
  private readonly bus: EventBus;
  private readonly heightfield: TerrainHeightfield;

  private controls!: CameraControls;
  private followTarget: THREE.Object3D | null = null;
  private followOffset = new THREE.Vector3(3.2, 2.1, 3.2);
  private tmpPos = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private unsubPreset: (() => void) | null = null;
  private unsubFollow: (() => void) | null = null;
  private followResolver: ((entityId: string) => THREE.Object3D | null) | null = null;

  constructor(
    domElement: HTMLElement,
    biome: BiomeConfig,
    bus: EventBus,
    heightfield: TerrainHeightfield,
  ) {
    this.domElement = domElement;
    this.biome = biome;
    this.bus = bus;
    this.heightfield = heightfield;

    if (!cameraControlsInstalled) {
      CameraControls.install({ THREE });
      cameraControlsInstalled = true;
    }

    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.2, 420);
  }

  init(): void {
    this.controls = new CameraControls(this.camera, this.domElement);
    this.controls.smoothTime = 0.35;
    this.controls.draggingSmoothTime = 0.16;
    this.controls.dollySpeed = 0.85;
    this.controls.truckSpeed = 1.2;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 72;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.47;

    const first = this.biome.cameraPresets[0];
    this.controls.setLookAt(
      first.position[0],
      first.position[1],
      first.position[2],
      first.target[0],
      first.target[1],
      first.target[2],
      false,
    );

    this.unsubPreset = this.bus.on('camera:preset', ({ presetId }) => {
      this.goToPreset(presetId, true);
    });

    this.unsubFollow = this.bus.on('camera:follow', ({ entityId }) => {
      if (!entityId) {
        this.followTarget = null;
        return;
      }
      const target = this.followResolver ? this.followResolver(entityId) : null;
      if (target) {
        this.followTarget = target;
      }
    });
  }

  setFollowResolver(resolver: (entityId: string) => THREE.Object3D | null): void {
    this.followResolver = resolver;
  }

  addColliderMesh(mesh: THREE.Object3D): void {
    if (this.controls) {
      this.controls.colliderMeshes.push(mesh);
    }
  }

  goToPreset(presetId: string, enableTransition = true): void {
    const preset = this.biome.cameraPresets.find((p) => p.id === presetId);
    if (!preset || !this.controls) return;
    this.followTarget = null;
    void this.controls.setLookAt(
      preset.position[0],
      preset.position[1],
      preset.position[2],
      preset.target[0],
      preset.target[1],
      preset.target[2],
      enableTransition,
    );
  }

  setAspect(width: number, height: number): void {
    this.camera.aspect = Math.max(0.1, width / Math.max(1, height));
    this.camera.updateProjectionMatrix();
  }

  getDistanceToFocus(): number {
    if (!this.controls) return 20;
    this.controls.getPosition(this.tmpPos);
    this.controls.getTarget(this.tmpTarget);
    return this.tmpPos.distanceTo(this.tmpTarget);
  }

  update(dt: number, _elapsed: number): void {
    if (!this.controls) return;

    if (this.followTarget) {
      this.followTarget.getWorldPosition(this.tmpTarget);
      const goalPos = this.tmpPos.copy(this.tmpTarget).add(this.followOffset);
      void this.controls.setLookAt(
        goalPos.x,
        Math.max(goalPos.y, this.heightfield.getHeightAt(goalPos.x, goalPos.z) + 1.4),
        goalPos.z,
        this.tmpTarget.x,
        this.tmpTarget.y + 0.3,
        this.tmpTarget.z,
        true,
      );
    }

    this.controls.update(dt);

    // Clamp camera above terrain surface + water level so user never clips underground
    this.controls.getPosition(this.tmpPos);
    const groundY = Math.max(
      this.heightfield.getHeightAt(this.tmpPos.x, this.tmpPos.z),
      this.biome.terrain.waterLevel,
    );
    const minY = groundY + 1.05;
    if (this.tmpPos.y < minY) {
      this.controls.getTarget(this.tmpTarget);
      void this.controls.setPosition(this.tmpPos.x, minY, this.tmpPos.z, false);
    }
  }

  dispose(): void {
    if (this.unsubPreset) {
      this.unsubPreset();
      this.unsubPreset = null;
    }
    if (this.unsubFollow) {
      this.unsubFollow();
      this.unsubFollow = null;
    }
    if (this.controls) {
      this.controls.dispose();
    }
    this.followTarget = null;
  }
}
