import * as THREE from 'three';
import Alea from 'alea';
import { createNoise3D } from 'simplex-noise';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from './TerrainHeightfield';

export interface RockObstacle {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * Generates stratified sedimentary boulders and mossy stream rocks using InstancedMesh
 * and CSM moss/wetness shader blending.
 */
export class RockSystem implements IWorldSystem {
  readonly name = 'RockSystem';
  readonly obstacles: RockObstacle[] = [];
  readonly instancedMeshes: THREE.InstancedMesh[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly assets: AssetLoader;

  private geometries: THREE.BufferGeometry[] = [];
  private material: CustomShaderMaterial | null = null;

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    assets: AssetLoader,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.assets = assets;
  }

  init(): void {
    const prng = Alea(`${this.biome.seed}-rocks`);
    const albedo = this.assets.getRockAlbedoTexture();
    const normalMap = this.assets.getProceduralNormalMap('sedimentary-rock', 256, 9, 2.5, 2);

    this.material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      map: albedo,
      normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.88,
      metalness: 0.04,
      uniforms: {
        uWaterLevel: { value: this.biome.terrain.waterLevel },
      },
      vertexShader: /* glsl */ `
        varying vec3 vRockWorldPos;
        varying vec3 vRockWorldNormal;
        void main() {
          vec4 localPos = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            vRockWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          #else
            vRockWorldNormal = normalize(mat3(modelMatrix) * normal);
          #endif
          vRockWorldPos = (modelMatrix * localPos).xyz;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uWaterLevel;
        varying vec3 vRockWorldPos;
        varying vec3 vRockWorldNormal;
        void main() {
          // Velvet moss cap on upward-facing rock surfaces above the waterline
          float mossSlope = smoothstep(0.45, 0.82, vRockWorldNormal.y);
          float aboveWater = smoothstep(uWaterLevel + 0.15, uWaterLevel + 0.9, vRockWorldPos.y);
          float mossNoise = fract(sin(dot(floor(vRockWorldPos.xz * 4.0), vec2(12.9898, 78.233))) * 43758.5453);
          float mossMask = clamp(mossSlope * aboveWater * (0.72 + 0.28 * mossNoise), 0.0, 1.0);
          vec3 mossColor = vec3(0.18, 0.34, 0.13);
          csm_DiffuseColor.rgb = mix(csm_DiffuseColor.rgb * vec3(0.55, 0.56, 0.58), mossColor, mossMask * 0.85);
          csm_Roughness = mix(csm_Roughness, 0.96, mossMask * 0.7);

          // Wet glossy base near water
          float wet = 1.0 - smoothstep(uWaterLevel - 0.1, uWaterLevel + 0.52, vRockWorldPos.y);
          csm_DiffuseColor.rgb *= mix(1.0, 0.52, wet);
          csm_Roughness = mix(csm_Roughness, 0.18, wet * 0.85);
        }
      `,
    });

    // Build 3 stratified rock variants
    for (let v = 0; v < 3; v++) {
      const geo = this.createStratifiedRockGeometry(`${this.biome.seed}-rock-v${v}`, v);
      geo.computeBoundsTree();
      this.geometries.push(geo);
    }

    const placements: Array<{ variant: number; matrix: THREE.Matrix4 }> = [];
    const dummy = new THREE.Object3D();

    const pushRock = (
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      variant: number,
      recordObstacle = true,
    ) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set((prng() - 0.5) * 0.35, prng() * Math.PI * 2, (prng() - 0.5) * 0.35);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      placements.push({ variant, matrix: dummy.matrix.clone() });
      if (recordObstacle) {
        this.obstacles.push({ x, y, z, radius: Math.max(sx, sz) * 0.95 });
      }
    };

    // Hero cliff boulders flanking the 3-tier waterfall
    const { waterfallZ, poolCenter, poolRadius } = this.biome.terrain;
    const fallX = this.heightfield.getStreamCenterX(waterfallZ);
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const offsetX = side * (3.2 + prng() * 5.8);
      const z = waterfallZ - 4.5 + prng() * 8.5;
      const x = fallX + offsetX;
      const y = this.heightfield.getHeightAt(x, z) - 0.3;
      const s = 1.6 + prng() * 2.2;
      pushRock(x, y, z, s * 1.25, s * 0.9, s * 1.1, i % 3, true);
    }

    // Stream-bank & koi pool boulders (including underwater stepping stones / koi cover)
    for (let i = 0; i < 48; i++) {
      const angle = prng() * Math.PI * 2;
      const isPoolRim = i < 24;
      let x: number;
      let z: number;
      if (isPoolRim) {
        const r = poolRadius * (0.45 + prng() * 0.65);
        x = poolCenter[0] + Math.cos(angle) * r;
        z = poolCenter[1] + Math.sin(angle) * r;
      } else {
        z = -20 + prng() * 58;
        const streamX = this.heightfield.getStreamCenterX(z);
        const side = prng() > 0.5 ? 1 : -1;
        x = streamX + side * (2.1 + prng() * 4.2);
      }

      // Keep clear of bridge at z = 6
      if (Math.abs(z - 6) < 3.4 && Math.abs(x - this.heightfield.getStreamCenterX(6)) < 6) {
        continue;
      }

      const y = this.heightfield.getHeightAt(x, z) - 0.18;
      const s = 0.55 + prng() * 1.35;
      pushRock(x, y, z, s * (1 + prng() * 0.4), s * 0.65, s, i % 3, y > -1.4);
    }

    // Scattered valley slope rocks
    for (let i = 0; i < 28; i++) {
      const x = (prng() - 0.5) * 86;
      const z = (prng() - 0.5) * 86;
      if (this.heightfield.isWaterAt(x, z)) continue;
      if (Math.hypot(x - 13, z - 6) < 6.5) continue;
      const y = this.heightfield.getHeightAt(x, z) - 0.25;
      const s = 0.8 + prng() * 1.8;
      pushRock(x, y, z, s, s * 0.72, s * 1.15, i % 3, false);
    }

    for (let v = 0; v < 3; v++) {
      const groupItems = placements.filter((p) => p.variant === v);
      if (groupItems.length === 0) continue;
      const inst = new THREE.InstancedMesh(this.geometries[v], this.material, groupItems.length);
      inst.name = `rock-variant-${v}`;
      inst.castShadow = true;
      inst.receiveShadow = true;
      groupItems.forEach((item, idx) => inst.setMatrixAt(idx, item.matrix));
      inst.instanceMatrix.needsUpdate = true;
      this.instancedMeshes.push(inst);
      this.scene.add(inst);
    }
  }

  private createStratifiedRockGeometry(seed: string, variant: number): THREE.BufferGeometry {
    const prng = Alea(seed);
    const noise3D = createNoise3D(prng);
    const geo = new THREE.IcosahedronGeometry(1.0, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      const n1 = noise3D(x * 1.4 + variant * 3, y * 2.2, z * 1.4);
      const strata = Math.sin(y * 7.5 + n1 * 1.8) * 0.08;
      const disp = 1.0 + n1 * 0.26 + strata;

      x *= disp * (variant === 1 ? 1.2 : 1.0);
      y *= disp * (y < 0 ? 0.65 : 0.82);
      z *= disp * (variant === 2 ? 1.15 : 1.0);
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  update(_dt: number, _elapsed: number): void {
    // Rocks are static
  }

  dispose(): void {
    for (const inst of this.instancedMeshes) {
      this.scene.remove(inst);
      inst.dispose();
    }
    this.instancedMeshes.length = 0;

    for (const geo of this.geometries) {
      geo.disposeBoundsTree();
      geo.dispose();
    }
    this.geometries = [];

    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.obstacles.length = 0;
  }
}
