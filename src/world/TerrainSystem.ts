import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import { TerrainHeightfield } from './TerrainHeightfield';

/**
 * Generates high-resolution terrain geometry with vertex AO, BVH acceleration,
 * and smooth non-periodic FBM shader blending for riverbeds, lush moss, meadow turf, and cliff rock.
 */
export class TerrainSystem implements IWorldSystem {
  readonly name = 'TerrainSystem';
  readonly heightfield: TerrainHeightfield;

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly assets: AssetLoader;

  mesh: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: CustomShaderMaterial | null = null;

  constructor(scene: THREE.Scene, biome: BiomeConfig, assets: AssetLoader) {
    this.scene = scene;
    this.biome = biome;
    this.assets = assets;
    this.heightfield = new TerrainHeightfield(biome.terrain, biome.seed);
  }

  init(): void {
    const { size, segments, waterLevel } = this.biome.terrain;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    const colorBed = new THREE.Color('#283631');
    const colorWetBank = new THREE.Color('#375234');
    const colorMoss = new THREE.Color('#356129');
    const colorGrass = new THREE.Color('#4c7d34');
    const colorRock = new THREE.Color('#5a5f66');
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightfield.getHeightAt(x, z);
      pos.setY(i, y);
    }

    geometry.computeVertexNormals();
    const normalAttr = geometry.attributes.normal as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = normalAttr.getY(i);
      const slope = 1 - Math.max(0, Math.min(1, ny));

      // Compute vertex AO by comparing local height against neighbor ring
      const avgNeighbor =
        (this.heightfield.getHeightAt(x + 1.5, z) +
          this.heightfield.getHeightAt(x - 1.5, z) +
          this.heightfield.getHeightAt(x, z + 1.5) +
          this.heightfield.getHeightAt(x, z - 1.5)) *
        0.25;
      const concavity = Math.max(0, avgNeighbor - y);
      const ao = Math.max(0.55, 1.0 - concavity * 0.35);

      if (y < waterLevel - 0.05) {
        tmp.copy(colorBed);
      } else if (y < waterLevel + 0.42) {
        const t = (y - (waterLevel - 0.05)) / 0.47;
        tmp.copy(colorBed).lerp(colorWetBank, t);
      } else {
        const rockMix = Math.max(0, Math.min(1, (slope - 0.25) / 0.24));
        const mossMix = Math.max(0, Math.min(1, (y - 0.4) / 4.5));
        tmp.copy(colorMoss).lerp(colorGrass, mossMix * 0.8);
        tmp.lerp(colorRock, rockMix);
      }

      tmp.multiplyScalar(ao);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundsTree();

    const normalMap = this.assets.getProceduralNormalMap('terrain-soil', 256, 5, 0.85, 12);

    const material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      vertexColors: true,
      normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.9,
      metalness: 0.01,
      uniforms: {
        uWaterLevel: { value: waterLevel },
      },
      vertexShader: /* glsl */ `
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;
        varying vec3 vTerrainColor;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vTerrainWorldPos = wp.xyz;
          vTerrainWorldNormal = normalize(mat3(modelMatrix) * normal);
          #ifdef USE_COLOR
            vTerrainColor = color;
          #else
            vTerrainColor = vec3(0.22, 0.38, 0.16);
          #endif
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uWaterLevel;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;
        varying vec3 vTerrainColor;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm2(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += valueNoise(p) * amp;
            p = rot * p * 2.05 + vec2(11.3, 7.1);
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 col = vTerrainColor;
          float slope = 1.0 - clamp(vTerrainWorldNormal.y, 0.0, 1.0);

          // 1. Organic non-periodic rocky grain on steep cliff walls (no horizontal stripes)
          float cliffMask = smoothstep(0.26, 0.54, slope);
          float rockNoise = fbm2(vTerrainWorldPos.xy * 0.45 + vTerrainWorldPos.zy * 0.35);
          float microGrit = valueNoise(vTerrainWorldPos.xz * 2.4 + vTerrainWorldPos.y * 1.8);
          vec3 cliffTint = col * (0.78 + 0.36 * rockNoise) * (0.88 + 0.22 * microGrit);
          col = mix(col, cliffTint, cliffMask * 0.78);

          // 2. Smooth organic meadow & moss mottling via rotated FBM (zero grid lines)
          float organicPatch = fbm2(vTerrainWorldPos.xz * 0.22);
          float fineTurf = valueNoise(vTerrainWorldPos.xz * 1.65);
          float up = smoothstep(0.64, 0.94, vTerrainWorldNormal.y);
          vec3 meadowTint = col * mix(vec3(0.84, 0.94, 0.80), vec3(0.96, 1.14, 0.86), organicPatch);
          meadowTint *= (0.92 + 0.16 * fineTurf);
          col = mix(col, meadowTint, up * 0.62);

          // 3. Smooth organic riverbed gravel & wet shoreline sheen
          float shore = 1.0 - smoothstep(uWaterLevel - 0.35, uWaterLevel + 0.5, vTerrainWorldPos.y);
          float bedSilt = fbm2(vTerrainWorldPos.xz * 1.15);
          col = mix(col, col * (0.76 + 0.44 * bedSilt), shore * 0.58);
          col *= mix(1.0, 0.58, shore);

          csm_Roughness = mix(csm_Roughness, 0.78, cliffMask * 0.45);
          csm_Roughness = mix(csm_Roughness, 0.2, shore * 0.85);
          csm_DiffuseColor.rgb = col;
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'valley-terrain';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData = { interactableType: 'terrain' };

    this.geometry = geometry;
    this.material = material;
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  update(_dt: number, _elapsed: number): void {
    // Static heightfield terrain; dynamic weather updates handled via fog & lights
  }

  dispose(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
    if (this.geometry) {
      this.geometry.disposeBoundsTree();
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }
}
