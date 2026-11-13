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
 * Generates stratified faceted boulders, mossy stream rocks, and 1,600+ instanced
 * river cobbles/pebbles using InstancedMesh and CSM moss/wetness shader blending.
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
  private pebbleGeo: THREE.BufferGeometry | null = null;
  private material: CustomShaderMaterial | null = null;
  private pebbleMat: THREE.MeshStandardMaterial | null = null;

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
    const normalMap = this.assets.getProceduralNormalMap('sedimentary-rock', 256, 10, 2.7, 2);

    this.material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      map: albedo,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.86,
      metalness: 0.04,
      uniforms: {
        uWaterLevel: { value: this.biome.terrain.waterLevel },
      },
      vertexShader: /* glsl */ `
        varying vec3 vRockWorldPos;
        varying vec3 vRockWorldNormal;
        varying vec3 vRockLocalPos;
        void main() {
          vRockLocalPos = position;
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
        varying vec3 vRockLocalPos;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
            mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          // Organic weathered granite mottling (zero periodic stripes)
          float grain = noise2(vRockWorldPos.xz * 2.2 + vRockWorldPos.y * 1.4) * 0.65
                      + noise2(vRockLocalPos.xy * 5.2 + vRockLocalPos.zy * 3.8) * 0.35;
          vec3 rockBase = csm_DiffuseColor.rgb * (0.48 + 0.24 * grain);

          // Velvet moss cap on upward-facing rock surfaces above the waterline
          float mossSlope = smoothstep(0.42, 0.8, vRockWorldNormal.y);
          float aboveWater = smoothstep(uWaterLevel + 0.12, uWaterLevel + 0.85, vRockWorldPos.y);
          float mossPatch = noise2(vRockWorldPos.xz * 1.8);
          float mossMask = clamp(mossSlope * aboveWater * (0.7 + 0.3 * mossPatch), 0.0, 1.0);
          vec3 mossColor = mix(vec3(0.16, 0.32, 0.11), vec3(0.28, 0.48, 0.18), mossPatch);
          csm_DiffuseColor.rgb = mix(rockBase, mossColor, mossMask * 0.86);
          csm_Roughness = mix(csm_Roughness, 0.96, mossMask * 0.72);

          // Wet glossy base near water & waterfall spray zone
          float wet = 1.0 - smoothstep(uWaterLevel - 0.1, uWaterLevel + 0.56, vRockWorldPos.y);
          csm_DiffuseColor.rgb *= mix(1.0, 0.5, wet);
          csm_Roughness = mix(csm_Roughness, 0.16, wet * 0.85);
        }
      `,
    });

    // Build 3 high-detail faceted rock variants
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

    this.buildStreamPebbles(prng, normalMap);
  }

  private buildStreamPebbles(prng: () => number, normalMap: THREE.Texture): void {
    const pebbleCount = 1600;
    const geo = new THREE.IcosahedronGeometry(0.16, 1);
    geo.scale(1.25, 0.48, 0.95);
    this.pebbleGeo = geo;

    this.pebbleMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.42,
      metalness: 0.05,
    });

    const pebbleInst = new THREE.InstancedMesh(geo, this.pebbleMat, pebbleCount);
    pebbleInst.name = 'stream-pebbles';
    pebbleInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const tones = [
      new THREE.Color('#6b7075'),
      new THREE.Color('#8c857b'),
      new THREE.Color('#52595e'),
      new THREE.Color('#a39b8b'),
      new THREE.Color('#475249'),
    ];

    const { poolCenter, poolRadius, waterLevel } = this.biome.terrain;
    let placed = 0;
    let attempts = 0;

    while (placed < pebbleCount && attempts < pebbleCount * 3) {
      attempts++;
      let x: number;
      let z: number;

      if (placed % 2 === 0) {
        // Pool rim & shallow gravel bars
        const a = prng() * Math.PI * 2;
        const r = poolRadius * (0.35 + prng() * 0.72);
        x = poolCenter[0] + Math.cos(a) * r;
        z = poolCenter[1] + Math.sin(a) * r;
      } else {
        // Stream banks from waterfall to south ford
        z = -23 + prng() * 64;
        const sx = this.heightfield.getStreamCenterX(z);
        const side = prng() > 0.5 ? 1 : -1;
        x = sx + side * (1.2 + prng() * 3.8);
      }

      const y = this.heightfield.getHeightAt(x, z);
      if (y < waterLevel - 0.85 || y > waterLevel + 0.55) continue;

      dummy.position.set(x, y - 0.02, z);
      dummy.rotation.set((prng() - 0.5) * 0.4, prng() * Math.PI * 2, (prng() - 0.5) * 0.4);
      const s = 0.45 + prng() * 1.35;
      dummy.scale.set(s * (0.8 + prng() * 0.5), s * 0.7, s);
      dummy.updateMatrix();

      pebbleInst.setMatrixAt(placed, dummy.matrix);
      pebbleInst.setColorAt(placed, tones[placed % tones.length]);
      placed++;
    }

    pebbleInst.count = placed;
    pebbleInst.instanceMatrix.needsUpdate = true;
    if (pebbleInst.instanceColor) pebbleInst.instanceColor.needsUpdate = true;

    this.instancedMeshes.push(pebbleInst);
    this.scene.add(pebbleInst);
  }

  private createStratifiedRockGeometry(seed: string, variant: number): THREE.BufferGeometry {
    const prng = Alea(seed);
    const noise3D = createNoise3D(prng);
    const geo = new THREE.IcosahedronGeometry(1.0, 3);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      const n1 = noise3D(x * 1.35 + variant * 3, y * 2.1, z * 1.35);
      // Ridged multifractal fold for chiseled angular rock faces
      const ridge = 1.0 - Math.abs(noise3D(x * 2.4 - variant * 2, y * 2.8, z * 2.4));
      const strata = Math.sin(y * 8.0 + n1 * 1.9) * 0.085;
      const disp = 0.88 + n1 * 0.22 + ridge * 0.18 + strata;

      x *= disp * (variant === 1 ? 1.22 : 1.0);
      y *= disp * (y < 0 ? 0.62 : 0.84);
      z *= disp * (variant === 2 ? 1.16 : 1.0);
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  update(_dt: number, _elapsed: number): void {
    // Rocks and stream pebbles are static
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

    if (this.pebbleGeo) {
      this.pebbleGeo.dispose();
      this.pebbleGeo = null;
    }

    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    if (this.pebbleMat) {
      this.pebbleMat.dispose();
      this.pebbleMat = null;
    }
    this.obstacles.length = 0;
  }
}
