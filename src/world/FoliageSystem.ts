import * as THREE from 'three';
import Alea from 'alea';
import { Tree } from '@dgreenheck/ez-tree';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import { QUALITY_PROFILES, type QualityProfile } from '../core/QualityConfig';
import type { EventBus } from '../core/EventBus';
import type { TerrainHeightfield } from './TerrainHeightfield';
import type { RockObstacle } from './RockSystem';

interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  variant: number;
}

/**
 * Botanical system rendering instanced @dgreenheck/ez-tree variants with furrowed bark & SSS leaves,
 * node-ringed bamboo groves, 7-frond 3D arched fern rosettes, multi-blossom wildflower clusters,
 * riverside cattail reeds, and GPU-wind-animated grass blades.
 */
export class FoliageSystem implements IWorldSystem {
  readonly name = 'FoliageSystem';
  readonly treePlacements: TreePlacement[] = [];
  readonly interactiveTrees: THREE.Object3D[] = [];
  readonly obstacles: RockObstacle[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly assets: AssetLoader;
  private readonly bus: EventBus;

  private grassMesh: THREE.InstancedMesh | null = null;
  private grassMat: CustomShaderMaterial | null = null;
  private grassGeo: THREE.BufferGeometry | null = null;
  private maxGrassCount = QUALITY_PROFILES.high.grassCount;

  private fernMesh: THREE.InstancedMesh | null = null;
  private fernMat: CustomShaderMaterial | null = null;
  private fernGeo: THREE.BufferGeometry | null = null;
  private maxFernCount = QUALITY_PROFILES.high.fernCount;

  private flowerMesh: THREE.InstancedMesh | null = null;
  private flowerMat: CustomShaderMaterial | null = null;
  private flowerGeo: THREE.BufferGeometry | null = null;
  private maxFlowerCount = QUALITY_PROFILES.high.flowerCount;

  private reedMesh: THREE.InstancedMesh | null = null;
  private reedMat: CustomShaderMaterial | null = null;
  private reedGeo: THREE.BufferGeometry | null = null;

  private bambooCulms: THREE.InstancedMesh | null = null;
  private bambooLeaves: THREE.InstancedMesh | null = null;
  private bambooGeos: THREE.BufferGeometry[] = [];
  private bambooMats: THREE.Material[] = [];

  private treeInstancedMeshes: THREE.InstancedMesh[] = [];
  private treeGeos: THREE.BufferGeometry[] = [];
  private treeMats: THREE.Material[] = [];

  private shakePulse = 0;
  private shakeOrigin = new THREE.Vector3();
  private unsubShake: (() => void) | null = null;

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    assets: AssetLoader,
    bus: EventBus,
    initialProfile: QualityProfile,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.assets = assets;
    this.bus = bus;
    this.maxGrassCount = QUALITY_PROFILES.high.grassCount;
    this.maxFernCount = QUALITY_PROFILES.high.fernCount;
    this.maxFlowerCount = QUALITY_PROFILES.high.flowerCount;
    this.currentProfile = initialProfile;
  }

  private currentProfile: QualityProfile;

  init(): void {
    this.buildTrees();
    this.buildBambooGroves();
    this.buildGrass();
    this.buildFernsAndFlowers();
    this.buildRiverReeds();
    this.applyQuality(this.currentProfile);

    this.unsubShake = this.bus.on('tree:shake', ({ position }) => {
      this.shakeOrigin.set(position[0], position[1], position[2]);
      this.shakePulse = 1.0;
    });
  }

  getActiveGrassCount(): number {
    return this.grassMesh?.count ?? 0;
  }

  applyQuality(profile: QualityProfile): void {
    this.currentProfile = profile;
    if (this.grassMesh) {
      this.grassMesh.count = Math.min(this.maxGrassCount, profile.grassCount);
    }
    if (this.fernMesh) {
      this.fernMesh.count = Math.min(this.maxFernCount, profile.fernCount);
    }
    if (this.flowerMesh) {
      this.flowerMesh.count = Math.min(this.maxFlowerCount, profile.flowerCount);
    }
  }

  private mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    let totalVerts = 0;
    const indices: number[] = [];

    for (const g of geos) {
      totalVerts += g.attributes.position.count;
    }

    const mergedPos = new Float32Array(totalVerts * 3);
    const mergedNorm = new Float32Array(totalVerts * 3);
    const mergedUv = new Float32Array(totalVerts * 2);

    let vOffset = 0;
    for (const g of geos) {
      const pos = g.attributes.position.array as Float32Array;
      const norm = g.attributes.normal.array as Float32Array;
      const uv = g.attributes.uv
        ? (g.attributes.uv.array as Float32Array)
        : new Float32Array(g.attributes.position.count * 2);

      mergedPos.set(pos, vOffset * 3);
      mergedNorm.set(norm, vOffset * 3);
      mergedUv.set(uv, vOffset * 2);

      if (g.index) {
        const idxArr = g.index.array;
        for (let i = 0; i < idxArr.length; i++) {
          indices.push(idxArr[i] + vOffset);
        }
      } else {
        for (let i = 0; i < g.attributes.position.count; i++) {
          indices.push(i + vOffset);
        }
      }

      vOffset += g.attributes.position.count;
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
    out.setIndex(indices);
    return out;
  }

  private buildTrees(): void {
    const prng = Alea(`${this.biome.seed}-trees`);
    const presets = ['Pine Large', 'Pine Medium', 'Oak Medium', 'Ash Small'];
    const pineLeafTex = this.assets.getFoliageAlphaTexture('pine-cluster', 256);
    const broadLeafTex = this.assets.getFoliageAlphaTexture('broadleaf-cluster', 256);
    const barkAlbedo = this.assets.getBarkAlbedoTexture(256);
    const barkNormal = this.assets.getProceduralNormalMap('tree-bark', 128, 9, 1.85, 3);

    const variants: Array<{
      branchGeo: THREE.BufferGeometry;
      branchMat: THREE.Material;
      leafGeo: THREE.BufferGeometry;
      leafMat: THREE.Material;
    }> = [];

    for (let i = 0; i < Math.min(this.biome.foliage.treeVariantCount, presets.length); i++) {
      const tree = new Tree();
      tree.loadPreset(presets[i]);
      tree.options.seed = 1000 + i * 377;
      tree.generate();

      const branchGeo = tree.branchesMesh.geometry.clone();
      const leafGeo = tree.leavesMesh.geometry.clone();
      branchGeo.computeBoundsTree();
      leafGeo.computeBoundsTree();

      const origBranchMat = Array.isArray(tree.branchesMesh.material)
        ? tree.branchesMesh.material[0]
        : tree.branchesMesh.material;

      const branchMat = new THREE.MeshStandardMaterial({
        color: i < 2 ? '#7d624c' : '#8c725a',
        map: barkAlbedo,
        normalMap: barkNormal,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.9,
      });

      const isPine = i < 2;
      const baseLeafColor = new THREE.Color(isPine ? '#345e32' : i === 2 ? '#4d7c38' : '#bf6a32');
      const sssTint = new THREE.Color(isPine ? '#78b84a' : i === 2 ? '#98d452' : '#f5a642');

      const leafMat = new CustomShaderMaterial({
        baseMaterial: THREE.MeshStandardMaterial,
        map: isPine ? pineLeafTex : broadLeafTex,
        alphaTest: 0.36,
        transparent: false,
        side: THREE.DoubleSide,
        roughness: 0.74,
        color: baseLeafColor,
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: this.biome.foliage.windStrength },
          uSssColor: { value: sssTint },
          uShakeOrigin: { value: this.shakeOrigin },
          uShakePulse: { value: 0 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uWind;
          uniform vec3 uShakeOrigin;
          uniform float uShakePulse;
          varying vec3 vLeafWorldPos;
          varying float vCanopyHeight;
          void main() {
            vec3 p = position;
            vec2 instXZ = vec2(0.0);
            #ifdef USE_INSTANCING
              instXZ = instanceMatrix[3].xz;
            #endif
            float phase = instXZ.x * 0.19 + instXZ.y * 0.23;
            vCanopyHeight = clamp(p.y / 14.0, 0.0, 1.0);
            float sway = sin(uTime * 1.6 + phase + p.x * 0.7 + p.y * 0.4) * 0.1 * uWind;
            float flutter = sin(uTime * 4.2 + phase * 1.7 + p.x * 2.5 + p.z * 2.5) * 0.025 * uWind;
            p.x += sway + flutter;
            p.z += cos(uTime * 1.25 + phase + p.z * 0.6) * 0.065 * uWind;
            if (uShakePulse > 0.01) {
              float d = distance(instXZ, uShakeOrigin.xz);
              float gust = sin(uTime * 18.0 + p.y * 1.4) * exp(-d * 0.22) * uShakePulse * 0.48;
              p.x += gust;
              p.z += gust * 0.6;
            }
            csm_Position = p;
            vec4 localPos = vec4(p, 1.0);
            #ifdef USE_INSTANCING
              localPos = instanceMatrix * localPos;
            #endif
            vLeafWorldPos = (modelMatrix * localPos).xyz;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSssColor;
          varying vec3 vLeafWorldPos;
          varying float vCanopyHeight;
          void main() {
            // Subsurface scattering / warm canopy crown illumination
            vec3 viewDir = normalize(cameraPosition - vLeafWorldPos);
            float crownLight = smoothstep(0.15, 0.95, vCanopyHeight);
            float rim = pow(1.0 - abs(dot(viewDir, vec3(0.0, 1.0, 0.0))), 2.0);
            csm_DiffuseColor.rgb = mix(csm_DiffuseColor.rgb * 0.78, csm_DiffuseColor.rgb * 1.12, crownLight);
            csm_DiffuseColor.rgb += uSssColor * (crownLight * 0.18 + rim * 0.12);
          }
        `,
      });

      // Dispose temporary ez-tree generator meshes, materials, and internal textures
      tree.branchesMesh.geometry.dispose();
      tree.leavesMesh.geometry.dispose();
      const disposeMatAndMaps = (m: THREE.Material) => {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.normalMap?.dispose();
        std.aoMap?.dispose();
        std.roughnessMap?.dispose();
        m.dispose();
      };
      if (Array.isArray(tree.branchesMesh.material)) {
        tree.branchesMesh.material.forEach(disposeMatAndMaps);
      } else if (origBranchMat) {
        disposeMatAndMaps(origBranchMat);
      }
      if (Array.isArray(tree.leavesMesh.material)) {
        tree.leavesMesh.material.forEach(disposeMatAndMaps);
      } else {
        disposeMatAndMaps(tree.leavesMesh.material);
      }

      this.treeGeos.push(branchGeo, leafGeo);
      this.treeMats.push(branchMat, leafMat);
      variants.push({ branchGeo, branchMat, leafGeo, leafMat });
    }

    // Collect valid valley placements (avoid stream, pool, bridge, and campsite center)
    const [campX, campZ] = this.biome.landmarks.campsiteCenter;
    const placed: TreePlacement[] = [];
    const fixedHero = [
      { x: -12.5, z: -18.5, variant: 0, scale: 0.34 },
      { x: -14.0, z: -4.5, variant: 2, scale: 0.28 },
      { x: -15.5, z: 19.5, variant: 1, scale: 0.31 },
    ];
    for (const h of fixedHero) {
      const y = this.heightfield.getHeightAt(h.x, h.z) - 0.15;
      placed.push({ x: h.x, y, z: h.z, scale: h.scale, rotY: prng() * Math.PI * 2, variant: h.variant });
    }

    let attempts = 0;
    while (placed.length < this.biome.foliage.treeCount && attempts < 500) {
      attempts++;
      const x = (prng() - 0.5) * 96;
      const z = (prng() - 0.5) * 96;
      if (this.heightfield.isWaterAt(x, z)) continue;
      if (this.heightfield.getSlopeAt(x, z) > 0.36) continue;
      if (Math.hypot(x - campX, z - campZ) < 8.0) continue;
      if (Math.abs(x - this.heightfield.getStreamCenterX(z)) < 4.8 && z > -26) continue;
      // Keep primary overview, waterfall, and bridge camera sightline corridors unobstructed
      if (x > 2 && x < 28 && z > -2 && z < 30) continue;
      if (x > -12 && x < 2 && z > 4 && z < 17) continue;

      const tooClose = placed.some((p) => Math.hypot(p.x - x, p.z - z) < 6.2);
      if (tooClose) continue;

      const y = this.heightfield.getHeightAt(x, z) - 0.18;
      const variant = Math.floor(prng() * variants.length);
      const scale = 0.22 + prng() * 0.14;
      placed.push({ x, y, z, scale, rotY: prng() * Math.PI * 2, variant });
    }

    this.treePlacements.push(...placed);
    for (const p of placed) {
      this.obstacles.push({ x: p.x, y: p.y + 1.0, z: p.z, radius: 0.85 + p.scale * 1.4 });
    }

    const dummy = new THREE.Object3D();
    for (let v = 0; v < variants.length; v++) {
      const items = placed.filter((p) => p.variant === v);
      if (items.length === 0) continue;

      const branchInst = new THREE.InstancedMesh(variants[v].branchGeo, variants[v].branchMat, items.length);
      branchInst.name = `tree-branches-v${v}`;
      branchInst.castShadow = true;
      branchInst.receiveShadow = true;
      branchInst.userData = { interactableType: 'tree' };

      const leafInst = new THREE.InstancedMesh(variants[v].leafGeo, variants[v].leafMat, items.length);
      leafInst.name = `tree-leaves-v${v}`;
      leafInst.castShadow = true;
      leafInst.receiveShadow = true;
      leafInst.userData = { interactableType: 'tree' };

      items.forEach((p, idx) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        branchInst.setMatrixAt(idx, dummy.matrix);
        leafInst.setMatrixAt(idx, dummy.matrix);
      });
      branchInst.instanceMatrix.needsUpdate = true;
      leafInst.instanceMatrix.needsUpdate = true;
      branchInst.computeBoundingSphere();
      leafInst.computeBoundingSphere();

      this.treeInstancedMeshes.push(branchInst, leafInst);
      this.interactiveTrees.push(branchInst, leafInst);
      this.scene.add(branchInst, leafInst);
    }
  }

  private buildBambooGroves(): void {
    const prng = Alea(`${this.biome.seed}-bamboo`);
    const { bambooClusterCount, bambooPerCluster } = this.biome.foliage;
    const totalCulms = bambooClusterCount * bambooPerCluster;

    // Segmented bamboo culm with raised node rings every 1.15m
    const culmGeo = new THREE.CylinderGeometry(0.058, 0.088, 8.2, 8, 28);
    culmGeo.translate(0, 4.1, 0);
    const cPos = culmGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cPos.count; i++) {
      const y = cPos.getY(i);
      const nodeRing = Math.pow(Math.max(0, Math.cos(y * 5.6)), 14.0) * 0.016;
      const arch = Math.pow(y / 8.2, 2.0) * 0.18;
      const x = cPos.getX(i);
      const z = cPos.getZ(i);
      const r = Math.hypot(x, z) || 1;
      const scaleR = (r + nodeRing) / r;
      cPos.setXYZ(i, x * scaleR + arch, y, z * scaleR);
    }
    culmGeo.computeVertexNormals();
    culmGeo.computeBoundsTree();

    const culmMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      color: '#4e7a36',
      roughness: 0.42,
      metalness: 0.04,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: this.biome.foliage.windStrength },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWind;
        varying float vCulmY;
        void main() {
          vCulmY = position.y;
          vec3 p = position;
          vec2 instXZ = vec2(0.0);
          #ifdef USE_INSTANCING
            instXZ = instanceMatrix[3].xz;
          #endif
          float phase = instXZ.x * 0.24 + instXZ.y * 0.18;
          float h = clamp(p.y / 8.2, 0.0, 1.0);
          p.x += sin(uTime * 1.4 + phase + p.y * 0.4) * h * h * 0.32 * uWind;
          csm_Position = p;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vCulmY;
        void main() {
          // Pale sheath ring at each bamboo node
          float nodeBand = pow(max(0.0, cos(vCulmY * 5.6)), 18.0);
          vec3 baseCol = mix(csm_DiffuseColor.rgb * 0.78, csm_DiffuseColor.rgb * 1.08, clamp(vCulmY / 8.0, 0.0, 1.0));
          csm_DiffuseColor.rgb = mix(baseCol, vec3(0.76, 0.82, 0.56), nodeBand * 0.75);
        }
      `,
    });

    const leafTex = this.assets.getFoliageAlphaTexture('bamboo-leaf', 192);
    const canopyGeo = new THREE.PlaneGeometry(1.9, 1.9);
    const canopyMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      map: leafTex,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      color: '#5c943e',
      roughness: 0.7,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: this.biome.foliage.windStrength },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWind;
        void main() {
          vec3 p = position;
          vec2 instXZ = vec2(0.0);
          #ifdef USE_INSTANCING
            instXZ = instanceMatrix[3].xz;
          #endif
          float phase = instXZ.x * 0.24 + instXZ.y * 0.18;
          // Match upper culm sway amplitude so leaves stay coupled to swaying culms
          float culmSway = sin(uTime * 1.4 + phase + 2.4) * 0.22 * uWind;
          float flutter = sin(uTime * 3.8 + phase + position.x * 3.0) * 0.04 * uWind;
          p.x += culmSway + flutter;
          p.z += cos(uTime * 1.3 + phase) * 0.06 * uWind;
          csm_Position = p;
        }
      `,
    });

    const culms = new THREE.InstancedMesh(culmGeo, culmMat, totalCulms);
    culms.castShadow = true;
    culms.receiveShadow = true;
    culms.userData = { interactableType: 'tree' };

    const leaves = new THREE.InstancedMesh(canopyGeo, canopyMat, totalCulms * 2);
    leaves.castShadow = true;

    const dummy = new THREE.Object3D();
    let culmIdx = 0;
    let leafIdx = 0;

    for (let c = 0; c < bambooClusterCount; c++) {
      const cx = -13 - prng() * 19;
      const cz = -22 + prng() * 44;
      if (this.heightfield.isWaterAt(cx, cz)) continue;
      this.obstacles.push({
        x: cx,
        y: this.heightfield.getHeightAt(cx, cz) + 1.0,
        z: cz,
        radius: 2.1,
      });

      for (let k = 0; k < bambooPerCluster; k++) {
        const bx = cx + (prng() - 0.5) * 3.4;
        const bz = cz + (prng() - 0.5) * 3.4;
        const by = this.heightfield.getHeightAt(bx, bz) - 0.1;
        const scaleY = 0.75 + prng() * 0.55;

        dummy.position.set(bx, by, bz);
        dummy.rotation.set((prng() - 0.5) * 0.1, prng() * Math.PI * 2, (prng() - 0.5) * 0.1);
        dummy.scale.set(1, scaleY, 1);
        dummy.updateMatrix();
        culms.setMatrixAt(culmIdx++, dummy.matrix);

        for (let l = 0; l < 2; l++) {
          dummy.position.set(bx, by + 5.8 * scaleY + l * 1.1, bz);
          dummy.rotation.set((prng() - 0.5) * 0.6, prng() * Math.PI * 2, (prng() - 0.5) * 0.5);
          dummy.scale.setScalar(0.9 + prng() * 0.5);
          dummy.updateMatrix();
          leaves.setMatrixAt(leafIdx++, dummy.matrix);
        }
      }
    }

    culms.count = culmIdx;
    leaves.count = leafIdx;
    culms.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    culms.computeBoundingSphere();
    leaves.computeBoundingSphere();

    this.bambooCulms = culms;
    this.bambooLeaves = leaves;
    this.bambooGeos.push(culmGeo, canopyGeo);
    this.bambooMats.push(culmMat, canopyMat);
    this.interactiveTrees.push(culms);
    this.scene.add(culms, leaves);
  }

  private buildGrass(): void {
    const prng = Alea(`${this.biome.seed}-grass`);

    // Build a lush 5-blade arched grass clump per instance (~120,000+ blades on Medium in 1 draw call)
    const blades: THREE.BufferGeometry[] = [];
    const bladeSpecs = [
      { ox: 0.0, oz: 0.0, h: 0.72, w: 0.11, yaw: 0.2, lean: 0.14 },
      { ox: 0.11, oz: 0.06, h: 0.58, w: 0.1, yaw: 1.5, lean: 0.2 },
      { ox: -0.1, oz: 0.08, h: 0.64, w: 0.105, yaw: 2.7, lean: 0.18 },
      { ox: 0.05, oz: -0.11, h: 0.52, w: 0.095, yaw: 4.1, lean: 0.22 },
      { ox: -0.09, oz: -0.08, h: 0.6, w: 0.1, yaw: 5.3, lean: 0.17 },
    ];

    for (const spec of bladeSpecs) {
      const g = new THREE.PlaneGeometry(spec.w, spec.h, 1, 3);
      g.translate(0, spec.h * 0.5, 0);
      const bPos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < bPos.count; i++) {
        const y = bPos.getY(i);
        const t = y / spec.h;
        bPos.setX(i, bPos.getX(i) * (1 - t * 0.9));
        bPos.setZ(i, t * t * spec.lean);
      }
      g.rotateY(spec.yaw);
      g.translate(spec.ox, 0, spec.oz);
      g.computeVertexNormals();
      blades.push(g);
    }

    const clumpGeo = this.mergeBufferGeometries(blades);
    for (const bg of blades) bg.dispose();

    this.grassMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      side: THREE.DoubleSide,
      roughness: 0.76,
      metalness: 0.01,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: this.biome.foliage.windStrength },
        uBaseColor: { value: new THREE.Color(this.biome.foliage.grassBaseColor) },
        uTipColor: { value: new THREE.Color(this.biome.foliage.grassTipColor) },
        uShakeOrigin: { value: this.shakeOrigin },
        uShakePulse: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWind;
        uniform vec3 uShakeOrigin;
        uniform float uShakePulse;
        varying float vHeightT;
        varying float vPatchTint;
        varying float vWindWave;

        float grassHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        void main() {
          vHeightT = clamp(position.y / 0.72, 0.0, 1.0);
          vec3 p = position;
          vec4 instWorld = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            instWorld = instanceMatrix * instWorld;
          #endif
          vPatchTint = grassHash(floor(instWorld.xz * 0.45));

          // Rolling diagonal meadow breeze gusts
          float breeze = sin(uTime * 1.65 + instWorld.x * 0.18 + instWorld.z * 0.14) * 0.15
                       + sin(uTime * 2.9 - instWorld.x * 0.32 + instWorld.z * 0.27) * 0.06;
          vWindWave = clamp(breeze * 2.2 + 0.5, 0.0, 1.0);
          float bend = vHeightT * vHeightT * uWind;
          p.x += breeze * bend;
          p.z += breeze * 0.55 * bend;

          if (uShakePulse > 0.01) {
            float d = distance(instWorld.xz, uShakeOrigin.xz);
            float wave = sin(d * 2.5 - (1.0 - uShakePulse) * 12.0) * exp(-d * 0.15) * uShakePulse;
            p.x += wave * 0.35 * bend;
          }
          csm_Position = p;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBaseColor;
        uniform vec3 uTipColor;
        varying float vHeightT;
        varying float vPatchTint;
        varying float vWindWave;
        void main() {
          vec3 lushTip = mix(uTipColor * vec3(0.88, 0.96, 0.85), uTipColor * vec3(1.16, 1.1, 0.82), vPatchTint);
          lushTip = mix(lushTip, lushTip * 1.12, vWindWave * 0.35);
          vec3 col = mix(uBaseColor, lushTip, pow(vHeightT, 0.72));
          // Natural root AO grounding blending into soil
          col *= mix(0.56, 1.08, vHeightT);
          csm_DiffuseColor.rgb = col;
        }
      `,
    });

    const mesh = new THREE.InstancedMesh(clumpGeo, this.grassMat, this.maxGrassCount);
    mesh.name = 'valley-grass';
    mesh.receiveShadow = true;

    const [campX, campZ] = this.biome.landmarks.campsiteCenter;
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;
    while (placed < this.maxGrassCount && attempts < this.maxGrassCount * 3) {
      attempts++;
      // Bias 78% of grass clumps into the lush visible valley floor & stream banks
      const nearValley = placed % 5 !== 0;
      const spread = nearValley ? 62 : 90;
      const x = (prng() - 0.5) * spread;
      const z = (prng() - 0.5) * spread - (nearValley ? 2 : 0);

      // Keep inside of tent & stone campfire ring clear
      if (Math.hypot(x - (campX + 2.5), z - (campZ - 1.7)) < 2.15) continue;
      if (Math.hypot(x - campX, z - campZ) < 1.35) continue;

      const y = this.heightfield.getHeightAt(x, z);
      if (y < this.biome.terrain.waterLevel + 0.1) continue;
      if (this.heightfield.getSlopeAt(x, z) > 0.45) continue;

      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set(0, prng() * Math.PI * 2, 0);
      const s = 0.72 + prng() * 0.72;
      dummy.scale.set(s, 0.65 + prng() * 0.75, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed++, dummy.matrix);
    }

    this.maxGrassCount = placed;
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.count = Math.min(placed, this.currentProfile.grassCount);

    this.grassGeo = clumpGeo;
    this.grassMesh = mesh;
    this.scene.add(mesh);
  }

  private buildFernsAndFlowers(): void {
    const prng = Alea(`${this.biome.seed}-undergrowth`);

    // 7-frond 3D arched fern rosette geometry
    const fernTex = this.assets.getFernTexture(256);
    const frondGeos: THREE.BufferGeometry[] = [];
    const frondCount = 7;

    for (let f = 0; f < frondCount; f++) {
      const strip = new THREE.PlaneGeometry(0.46, 0.92, 1, 5);
      strip.translate(0, 0.46, 0);
      const sPos = strip.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sPos.count; i++) {
        const py = sPos.getY(i);
        const t = py / 0.92;
        // Arch outward and droop gracefully toward the tip
        const radiusOut = t * 0.58 + Math.sin(t * Math.PI * 0.85) * 0.18;
        const heightY = Math.sin(t * Math.PI * 0.72) * 0.52;
        sPos.setY(i, heightY);
        sPos.setZ(i, radiusOut);
      }
      strip.rotateY((f / frondCount) * Math.PI * 2 + (f % 2) * 0.18);
      strip.computeVertexNormals();
      frondGeos.push(strip);
    }

    const fernGeo = this.mergeBufferGeometries(frondGeos);
    for (const fg of frondGeos) fg.dispose();

    this.fernMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      map: fernTex,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      roughness: 0.72,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: this.biome.foliage.windStrength },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWind;
        void main() {
          vec3 p = position;
          vec2 instXZ = vec2(0.0);
          #ifdef USE_INSTANCING
            instXZ = instanceMatrix[3].xz;
          #endif
          float phase = instXZ.x * 0.31 + instXZ.y * 0.27;
          float radial = length(p.xz);
          p.y += sin(uTime * 2.1 + phase + p.x * 3.0 + p.z * 3.0) * radial * 0.07 * uWind;
          csm_Position = p;
        }
      `,
    });

    this.fernMesh = new THREE.InstancedMesh(fernGeo, this.fernMat, this.maxFernCount);
    this.fernMesh.castShadow = true;
    this.fernMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let fPlaced = 0;
    let fAttempts = 0;
    while (fPlaced < this.maxFernCount && fAttempts < 2000) {
      fAttempts++;
      const x = (prng() - 0.5) * 70;
      const z = (prng() - 0.5) * 70;
      const y = this.heightfield.getHeightAt(x, z);
      if (y < this.biome.terrain.waterLevel + 0.15 || y > 7.5) continue;
      if (this.heightfield.getSlopeAt(x, z) > 0.35) continue;
      dummy.position.set(x, y - 0.03, z);
      dummy.rotation.set(0, prng() * Math.PI * 2, 0);
      const s = 0.72 + prng() * 0.68;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.fernMesh.setMatrixAt(fPlaced++, dummy.matrix);
    }
    this.maxFernCount = fPlaced;
    this.fernMesh.count = fPlaced;
    this.fernMesh.instanceMatrix.needsUpdate = true;
    this.fernMesh.computeBoundingSphere();
    this.fernGeo = fernGeo;
    this.scene.add(this.fernMesh);

    // Multi-blossom crossed wildflower clusters with stems and petals
    const flowerTex = this.assets.getWildflowerClusterTexture(256);
    const fCardA = new THREE.PlaneGeometry(0.56, 0.58);
    fCardA.translate(0, 0.28, 0);
    const fCardB = fCardA.clone();
    fCardB.rotateY(Math.PI / 2);
    const flowerGeo = this.mergeBufferGeometries([fCardA, fCardB]);
    fCardA.dispose();
    fCardB.dispose();

    this.flowerMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      map: flowerTex,
      alphaTest: 0.35,
      color: '#ffffff',
      roughness: 0.52,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        void main() {
          vec3 p = position;
          vec2 instXZ = vec2(0.0);
          #ifdef USE_INSTANCING
            instXZ = instanceMatrix[3].xz;
          #endif
          float phase = instXZ.x * 0.35 + instXZ.y * 0.29;
          float h = clamp(p.y / 0.58, 0.0, 1.0);
          p.x += sin(uTime * 2.4 + phase + p.z * 4.0) * h * 0.045;
          csm_Position = p;
        }
      `,
    });

    this.flowerMesh = new THREE.InstancedMesh(flowerGeo, this.flowerMat, this.maxFlowerCount);
    const palette = this.biome.foliage.flowerColors.map((c) => new THREE.Color(c));

    let flPlaced = 0;
    let flAttempts = 0;
    while (flPlaced < this.maxFlowerCount && flAttempts < 3000) {
      flAttempts++;
      const x = (prng() - 0.5) * 68;
      const z = (prng() - 0.5) * 68;
      const y = this.heightfield.getHeightAt(x, z);
      if (y < this.biome.terrain.waterLevel + 0.25 || y > 5.5) continue;
      if (this.heightfield.getSlopeAt(x, z) > 0.28) continue;
      dummy.position.set(x, y - 0.03, z);
      dummy.rotation.set((prng() - 0.5) * 0.15, prng() * Math.PI * 2, (prng() - 0.5) * 0.15);
      dummy.scale.setScalar(0.75 + prng() * 0.65);
      dummy.updateMatrix();
      this.flowerMesh.setMatrixAt(flPlaced, dummy.matrix);
      this.flowerMesh.setColorAt(flPlaced, palette[flPlaced % palette.length]);
      flPlaced++;
    }
    this.maxFlowerCount = flPlaced;
    this.flowerMesh.count = flPlaced;
    this.flowerMesh.instanceMatrix.needsUpdate = true;
    if (this.flowerMesh.instanceColor) this.flowerMesh.instanceColor.needsUpdate = true;
    this.flowerMesh.computeBoundingSphere();
    this.flowerGeo = flowerGeo;
    this.scene.add(this.flowerMesh);
  }

  private buildRiverReeds(): void {
    const prng = Alea(`${this.biome.seed}-reeds`);
    const maxReeds = 420;

    // Stalk + fluffy cattail plume merged geometry
    const stalk = new THREE.CylinderGeometry(0.014, 0.024, 1.45, 5, 4);
    stalk.translate(0, 0.725, 0);
    const plume = new THREE.CapsuleGeometry(0.038, 0.26, 4, 6);
    plume.translate(0, 1.26, 0);
    const blade = new THREE.PlaneGeometry(0.06, 1.15, 1, 3);
    blade.translate(0.03, 0.55, 0);
    blade.rotateZ(-0.18);

    const reedGeo = this.mergeBufferGeometries([stalk, plume, blade]);
    stalk.dispose();
    plume.dispose();
    blade.dispose();

    this.reedMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      roughness: 0.75,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: this.biome.foliage.windStrength },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWind;
        varying float vReedY;
        void main() {
          vReedY = position.y;
          vec3 p = position;
          vec4 instWorld = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            instWorld = instanceMatrix * instWorld;
          #endif
          float h = clamp(p.y / 1.45, 0.0, 1.0);
          float sway = sin(uTime * 1.7 + instWorld.x * 0.4 + instWorld.z * 0.3) * 0.18 * h * h * uWind;
          p.x += sway;
          p.z += sway * 0.5;
          csm_Position = p;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vReedY;
        void main() {
          // Olive-green stalk transitioning into warm golden-brown cattail plume at top
          float isPlume = smoothstep(1.06, 1.16, vReedY);
          vec3 stalkCol = mix(vec3(0.22, 0.38, 0.16), vec3(0.45, 0.62, 0.28), clamp(vReedY / 1.1, 0.0, 1.0));
          vec3 plumeCol = vec3(0.68, 0.52, 0.30);
          csm_DiffuseColor.rgb = mix(stalkCol, plumeCol, isPlume);
        }
      `,
    });

    const reedMesh = new THREE.InstancedMesh(reedGeo, this.reedMat, maxReeds);
    reedMesh.name = 'river-reeds';
    reedMesh.castShadow = true;
    reedMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const { poolCenter, poolRadius, waterLevel } = this.biome.terrain;
    let placed = 0;
    let attempts = 0;

    while (placed < maxReeds && attempts < maxReeds * 4) {
      attempts++;
      let x: number;
      let z: number;
      if (placed % 2 === 0) {
        const a = prng() * Math.PI * 2;
        const r = poolRadius * (0.68 + prng() * 0.38);
        x = poolCenter[0] + Math.cos(a) * r;
        z = poolCenter[1] + Math.sin(a) * r;
      } else {
        z = -18 + prng() * 54;
        const sx = this.heightfield.getStreamCenterX(z);
        const side = prng() > 0.5 ? 1 : -1;
        x = sx + side * (2.2 + prng() * 2.4);
      }

      const y = this.heightfield.getHeightAt(x, z);
      if (y < waterLevel - 0.18 || y > waterLevel + 0.35) continue;

      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set((prng() - 0.5) * 0.15, prng() * Math.PI * 2, (prng() - 0.5) * 0.15);
      const s = 0.75 + prng() * 0.55;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      reedMesh.setMatrixAt(placed++, dummy.matrix);
    }

    reedMesh.count = placed;
    reedMesh.instanceMatrix.needsUpdate = true;
    reedMesh.computeBoundingSphere();

    this.reedGeo = reedGeo;
    this.reedMesh = reedMesh;
    this.scene.add(reedMesh);
  }

  update(dt: number, elapsed: number): void {
    if (this.shakePulse > 0) {
      this.shakePulse = Math.max(0, this.shakePulse - dt * 1.35);
    }
    if (this.grassMat) {
      this.grassMat.uniforms.uTime.value = elapsed;
      this.grassMat.uniforms.uShakePulse.value = this.shakePulse;
    }
    if (this.fernMat) {
      this.fernMat.uniforms.uTime.value = elapsed;
    }
    if (this.flowerMat) {
      this.flowerMat.uniforms.uTime.value = elapsed;
    }
    if (this.reedMat) {
      this.reedMat.uniforms.uTime.value = elapsed;
    }
    for (const mat of this.treeMats) {
      if (mat instanceof CustomShaderMaterial && mat.uniforms?.uTime) {
        mat.uniforms.uTime.value = elapsed;
        if (mat.uniforms.uShakePulse) {
          mat.uniforms.uShakePulse.value = this.shakePulse;
        }
      }
    }
    for (const mat of this.bambooMats) {
      if (mat instanceof CustomShaderMaterial && mat.uniforms?.uTime) {
        mat.uniforms.uTime.value = elapsed;
      }
    }
  }

  dispose(): void {
    if (this.unsubShake) {
      this.unsubShake();
      this.unsubShake = null;
    }
    for (const inst of this.treeInstancedMeshes) {
      this.scene.remove(inst);
      inst.dispose();
    }
    this.treeInstancedMeshes = [];
    this.interactiveTrees.length = 0;
    this.obstacles.length = 0;

    for (const geo of this.treeGeos) {
      geo.disposeBoundsTree?.();
      geo.dispose();
    }
    this.treeGeos = [];
    for (const mat of this.treeMats) mat.dispose();
    this.treeMats = [];

    if (this.bambooCulms) {
      this.scene.remove(this.bambooCulms);
      this.bambooCulms.dispose();
      this.bambooCulms = null;
    }
    if (this.bambooLeaves) {
      this.scene.remove(this.bambooLeaves);
      this.bambooLeaves.dispose();
      this.bambooLeaves = null;
    }
    for (const g of this.bambooGeos) {
      g.disposeBoundsTree?.();
      g.dispose();
    }
    this.bambooGeos = [];
    for (const m of this.bambooMats) m.dispose();
    this.bambooMats = [];

    if (this.grassMesh) {
      this.scene.remove(this.grassMesh);
      this.grassMesh.dispose();
      this.grassMesh = null;
    }
    if (this.grassGeo) {
      this.grassGeo.dispose();
      this.grassGeo = null;
    }
    if (this.grassMat) {
      this.grassMat.dispose();
      this.grassMat = null;
    }

    if (this.fernMesh) {
      this.scene.remove(this.fernMesh);
      this.fernMesh.dispose();
      this.fernMesh = null;
    }
    if (this.fernGeo) {
      this.fernGeo.dispose();
      this.fernGeo = null;
    }
    if (this.fernMat) {
      this.fernMat.dispose();
      this.fernMat = null;
    }

    if (this.flowerMesh) {
      this.scene.remove(this.flowerMesh);
      this.flowerMesh.dispose();
      this.flowerMesh = null;
    }
    if (this.flowerGeo) {
      this.flowerGeo.dispose();
      this.flowerGeo = null;
    }
    if (this.flowerMat) {
      this.flowerMat.dispose();
      this.flowerMat = null;
    }

    if (this.reedMesh) {
      this.scene.remove(this.reedMesh);
      this.reedMesh.dispose();
      this.reedMesh = null;
    }
    if (this.reedGeo) {
      this.reedGeo.dispose();
      this.reedGeo = null;
    }
    if (this.reedMat) {
      this.reedMat.dispose();
      this.reedMat = null;
    }
  }
}
