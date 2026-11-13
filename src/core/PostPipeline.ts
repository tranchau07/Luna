import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  KernelSize,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import type { QualityProfile } from './QualityConfig';

/**
 * Manages postprocessing composer with SMAA, subtle selective bloom,
 * tier-gated God Rays, and single-pass ACES Filmic tone mapping.
 */
export class PostPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly sunDiscMesh: THREE.Mesh;

  private composer: EffectComposer;
  private renderPass: RenderPass;
  private effectPass: EffectPass | null = null;
  private toneMappingEffect: ToneMappingEffect;
  private activeProfile: QualityProfile;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    sunDiscMesh: THREE.Mesh,
    initialProfile: QualityProfile,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sunDiscMesh = sunDiscMesh;
    this.activeProfile = initialProfile;

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.toneMappingEffect = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });

    this.rebuildPasses(initialProfile);
  }

  rebuildPasses(profile: QualityProfile): void {
    this.activeProfile = profile;
    if (this.effectPass) {
      this.composer.removePass(this.effectPass);
      this.effectPass.dispose();
      this.effectPass = null;
    }

    const effects: Array<SMAAEffect | BloomEffect | GodRaysEffect | ToneMappingEffect> = [];

    if (profile.enableSmaa) {
      effects.push(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    }

    if (profile.enableBloom) {
      effects.push(
        new BloomEffect({
          mipmapBlur: true,
          luminanceThreshold: 0.92,
          luminanceSmoothing: 0.25,
          intensity: 0.42,
        }),
      );
    }

    if (profile.enableGodRays) {
      effects.push(
        new GodRaysEffect(this.camera, this.sunDiscMesh, {
          kernelSize: KernelSize.SMALL,
          density: 0.88,
          decay: 0.91,
          weight: 0.26,
          exposure: 0.38,
          samples: 36,
          clampMax: 0.85,
        }),
      );
    }

    // Single-pass ACES tone mapping must be applied last
    effects.push(this.toneMappingEffect);

    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);
  }

  getProfile(): QualityProfile {
    return this.activeProfile;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    if (this.effectPass) {
      this.composer.removePass(this.effectPass);
      this.effectPass.dispose();
      this.effectPass = null;
    }
    this.renderPass.dispose();
    this.composer.dispose();
  }
}
