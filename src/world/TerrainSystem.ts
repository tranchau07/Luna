import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import { TerrainHeightfield } from './TerrainHeightfield';

/**
 * Generates high-resolution terrain geometry with vertex AO, BVH acceleration,
 * and CSM shader blending for wet riverbeds, moss, turf, and exposed cliff rock.
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

    const colorBed = new THREE.Color('#2c3834');
    const colorWetBank = new THREE.Color('#3b5435');
    const colorMoss = new THREE.Color('#3e6e2e');
    const colorGrass = new THREE.Color('#588c3c');
    const colorRock = new THREE.Color('#5d6269');
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
      const ao = Math.max(0.54, 1.0 - concavity * 0.36);

      if (y < waterLevel - 0.05) {
        tmp.copy(colorBed);
      } else if (y < waterLevel + 0.42) {
        const t = (y - (waterLevel - 0.05)) / 0.47;
        tmp.copy(colorBed).lerp(colorWetBank, t);
      } else {
        const rockMix = Math.max(0, Math.min(1, (slope - 0.26) / 0.25));
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

    const normalMap = this.assets.getProceduralNormalMap('terrain-soil', 256, 6, 1.2, 14);

    const material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      vertexColors: true,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.9,
      metalness: 0.02,
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
        void main() {
          vec3 col = vTerrainColor;
          // Darken & gloss wet shoreline band near the stream & pool
          float shore = 1.0 - smoothstep(uWaterLevel - 0.2, uWaterLevel + 0.45, vTerrainWorldPos.y);
          col *= mix(1.0, 0.58, shore);
          csm_Roughness = mix(csm_Roughness, 0.22, shore * 0.85);

          // Subtle moss accent on upward-facing valley surfaces
          float up = smoothstep(0.68, 0.92, vTerrainWorldNormal.y);
          col = mix(col, col * vec3(0.92, 1.12, 0.86), up * 0.4);
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
