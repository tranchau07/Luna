import * as THREE from 'three';
import Alea from 'alea';
import { Tree } from '@dgreenheck/ez-tree';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { QualityProfile } from '../core/QualityConfig';
import type { EventBus } from '../core/EventBus';
import type { TerrainHeightfield } from './TerrainHeightfield';

interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  variant: number;
}

/**
 * Botanical system rendering instanced @dgreenheck/ez-tree variants, bamboo groves,
 * alpha-cutout ferns, wildflowers, and GPU-wind-animated grass blades.
 */
export class FoliageSystem implements IWorldSystem {
  readonly name = 'FoliageSystem';
  readonly treePlacements: TreePlacement[] = [];
  readonly interactiveTrees: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly assets: AssetLoader;
  private readonly bus: EventBus;

  private grassMesh: THREE.InstancedMesh | null = null;
  private grassMat: CustomShaderMaterial | null = null;
  private grassGeo: THREE.BufferGeometry | null = null;
  private maxGrassCount = 25000;

  private fernMesh: THREE.InstancedMesh | null = null;
  private fernMat: THREE.MeshStandardMaterial | null = null;
  private fernGeo: THREE.BufferGeometry | null = null;
  private maxFernCount = 480;

  private flowerMesh: THREE.InstancedMesh | null = null;
  private flowerMat: THREE.MeshStandardMaterial | null = null;
  private flowerGeo: THREE.BufferGeometry | null = null;
  private maxFlowerCount = 850;

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
    this.maxGrassCount = 25000;
    this.currentProfile = initialProfile;
  }

  private currentProfile: QualityProfile;

  init(): void {
    this.buildTrees();
    this.buildBambooGroves();
    this.buildGrass();
    this.buildFernsAndFlowers();
    this.applyQuality(this.currentProfile);

    this.unsubShake = this.bus.on('tree:shake', ({ position }) => {
      this.shakeOrigin.set(position[0], position[1], position[2]);
      this.shakePulse = 1.0;
    });
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

  private buildTrees(): void {
    const prng = Alea(`${this.biome.seed}-trees`);
    const presets = ['Pine Large', 'Pine Medium', 'Oak Medium', 'Ash Small'];
    const leafTex = this.assets.getFoliageAlphaTexture('pine-cluster', 256);

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

      const origBranchMat = Array.isArray(tree.branchesMesh.material)
        ? tree.branchesMesh.material[0]
        : tree.branchesMesh.material;
      const barkNormal = this.assets.getProceduralNormalMap('tree-bark', 128, 8, 1.6, 3);
      const branchMat = new THREE.MeshStandardMaterial({
        color: i < 2 ? '#4d3a2c' : '#594637',
        normalMap: barkNormal,
        roughness: 0.92,
      });

      const leafMat = new CustomShaderMaterial({
        baseMaterial: THREE.MeshStandardMaterial,
        map: leafTex,
        alphaTest: 0.38,
        transparent: false,
        side: THREE.DoubleSide,
        roughness: 0.78,
        color: new THREE.Color(i < 2 ? '#345e32' : i === 2 ? '#4b7838' : '#b86832'),
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: this.biome.foliage.windStrength },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uWind;
          void main() {
            vec3 p = position;
            float sway = sin(uTime * 1.6 + p.x * 0.7 + p.y * 0.4) * 0.09 * uWind;
            p.x += sway;
            p.z += cos(uTime * 1.2 + p.z * 0.6) * 0.06 * uWind;
            csm_Position = p;
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
    const placed: TreePlacement[] = [];
    const fixedHero = [
      { x: -12.5, z: -18.5, variant: 0, scale: 0.34 },
      { x: -14.0, z: -4.5, variant: 2, scale: 0.28 },
      { x: -11.5, z: 14.0, variant: 1, scale: 0.31 },
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
      if (Math.hypot(x - 13, z - 6) < 8.0) continue;
      if (Math.abs(x - this.heightfield.getStreamCenterX(z)) < 4.8 && z > -26) continue;
      // Keep primary overview & waterfall camera sightline corridors unobstructed
      if (x > 2 && x < 28 && z > -2 && z < 30) continue;

      const tooClose = placed.some((p) => Math.hypot(p.x - x, p.z - z) < 6.2);
      if (tooClose) continue;

      const y = this.heightfield.getHeightAt(x, z) - 0.18;
      const variant = Math.floor(prng() * variants.length);
      const scale = 0.22 + prng() * 0.14;
      placed.push({ x, y, z, scale, rotY: prng() * Math.PI * 2, variant });
    }

    this.treePlacements.push(...placed);

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

      this.treeInstancedMeshes.push(branchInst, leafInst);
      this.interactiveTrees.push(branchInst, leafInst);
      this.scene.add(branchInst, leafInst);
    }
  }

  private buildBambooGroves(): void {
    const prng = Alea(`${this.biome.seed}-bamboo`);
    const { bambooClusterCount, bambooPerCluster } = this.biome.foliage;
    const totalCulms = bambooClusterCount * bambooPerCluster;

    const culmGeo = new THREE.CylinderGeometry(0.06, 0.085, 8.2, 6, 4);
    culmGeo.translate(0, 4.1, 0);
    const culmMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      color: '#4e7736',
      roughness: 0.55,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        void main() {
          vec3 p = position;
          float h = clamp(p.y / 8.2, 0.0, 1.0);
          p.x += sin(uTime * 1.4 + p.y * 0.4) * h * h * 0.32;
          csm_Position = p;
        }
      `,
    });

    const leafTex = this.assets.getFoliageAlphaTexture('bamboo-leaf', 192);
    const canopyGeo = new THREE.PlaneGeometry(1.9, 1.9);
    const canopyMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      color: '#5a8f3d',
      roughness: 0.72,
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
      // Cluster bamboo groves on the western misty bank
      const cx = -13 - prng() * 19;
      const cz = -22 + prng() * 44;
      if (this.heightfield.isWaterAt(cx, cz)) continue;

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

    this.bambooCulms = culms;
    this.bambooLeaves = leaves;
    this.bambooGeos.push(culmGeo, canopyGeo);
    this.bambooMats.push(culmMat, canopyMat);
    this.interactiveTrees.push(culms);
    this.scene.add(culms, leaves);
  }

  private buildGrass(): void {
    const prng = Alea(`${this.biome.seed}-grass`);
    const bladeGeo = new THREE.PlaneGeometry(0.17, 0.85, 1, 3);
    bladeGeo.translate(0, 0.425, 0);
    // Taper top vertices into a crisp grass tip
    const pos = bladeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = y / 0.85;
      pos.setX(i, pos.getX(i) * (1 - t * 0.85));
      pos.setZ(i, t * t * 0.1);
    }
    bladeGeo.computeVertexNormals();

    this.grassMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.0,
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

        void main() {
          vHeightT = clamp(position.y / 0.72, 0.0, 1.0);
          vec3 p = position;
          vec4 instWorld = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            instWorld = instanceMatrix * instWorld;
          #endif
          float gust = sin(uTime * 1.9 + instWorld.x * 0.25 + instWorld.z * 0.18) * 0.16
                     + cos(uTime * 3.1 + instWorld.x * 0.6) * 0.05;
          float bend = vHeightT * vHeightT * uWind;
          p.x += gust * bend;
          p.z += gust * 0.45 * bend;

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
        void main() {
          vec3 col = mix(uBaseColor, uTipColor, pow(vHeightT, 0.8));
          // Darken grass root for natural AO grounding
          col *= mix(0.55, 1.05, vHeightT);
          csm_DiffuseColor.rgb = col;
        }
      `,
    });

    const mesh = new THREE.InstancedMesh(bladeGeo, this.grassMat, this.maxGrassCount);
    mesh.name = 'valley-grass';
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;
    while (placed < this.maxGrassCount && attempts < this.maxGrassCount * 3) {
      attempts++;
      const x = (prng() - 0.5) * 84;
      const z = (prng() - 0.5) * 84;
      const y = this.heightfield.getHeightAt(x, z);
      if (y < this.biome.terrain.waterLevel + 0.18) continue;
      if (this.heightfield.getSlopeAt(x, z) > 0.34) continue;

      dummy.position.set(x, y - 0.04, z);
      dummy.rotation.set(0, prng() * Math.PI * 2, 0);
      const s = 0.65 + prng() * 0.75;
      dummy.scale.set(s, 0.7 + prng() * 0.7, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed++, dummy.matrix);
    }

    this.maxGrassCount = placed;
    mesh.count = Math.min(placed, this.currentProfile.grassCount);
    mesh.instanceMatrix.needsUpdate = true;

    this.grassGeo = bladeGeo;
    this.grassMesh = mesh;
    this.scene.add(mesh);
  }

  private buildFernsAndFlowers(): void {
    const prng = Alea(`${this.biome.seed}-undergrowth`);

    // Crossed alpha-cutout fern cards
    const fernTex = this.assets.getFernTexture(256);
    const cardA = new THREE.PlaneGeometry(0.95, 0.85);
    cardA.translate(0, 0.42, 0);
    const cardB = cardA.clone();
    cardB.rotateY(Math.PI / 2);

    // Simple 2-quad crossed geometry
    const fernGeo = new THREE.BufferGeometry();
    const posA = cardA.attributes.position.array as Float32Array;
    const posB = cardB.attributes.position.array as Float32Array;
    const uvA = cardA.attributes.uv.array as Float32Array;
    const uvB = cardB.attributes.uv.array as Float32Array;
    const normA = cardA.attributes.normal.array as Float32Array;
    const normB = cardB.attributes.normal.array as Float32Array;
    const idxA = Array.from(cardA.index!.array);
    const idxB = Array.from(cardB.index!.array).map((v) => v + posA.length / 3);

    const mergedPos = new Float32Array(posA.length + posB.length);
    mergedPos.set(posA, 0);
    mergedPos.set(posB, posA.length);
    const mergedUv = new Float32Array(uvA.length + uvB.length);
    mergedUv.set(uvA, 0);
    mergedUv.set(uvB, uvA.length);
    const mergedNorm = new Float32Array(normA.length + normB.length);
    mergedNorm.set(normA, 0);
    mergedNorm.set(normB, normA.length);

    fernGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    fernGeo.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
    fernGeo.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
    fernGeo.setIndex([...idxA, ...idxB]);
    cardA.dispose();
    cardB.dispose();

    this.fernMat = new THREE.MeshStandardMaterial({
      map: fernTex,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.78,
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
      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set(0, prng() * Math.PI * 2, 0);
      const s = 0.65 + prng() * 0.7;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.fernMesh.setMatrixAt(fPlaced++, dummy.matrix);
    }
    this.maxFernCount = fPlaced;
    this.fernMesh.instanceMatrix.needsUpdate = true;
    this.fernGeo = fernGeo;
    this.scene.add(this.fernMesh);

    // Instanced Wildflowers
    const flowerGeo = new THREE.ConeGeometry(0.11, 0.08, 5, 1, true);
    flowerGeo.rotateX(Math.PI);
    flowerGeo.translate(0, 0.28, 0);
    this.flowerMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.55,
      side: THREE.DoubleSide,
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
      dummy.position.set(x, y, z);
      dummy.rotation.set((prng() - 0.5) * 0.3, prng() * Math.PI * 2, (prng() - 0.5) * 0.3);
      dummy.scale.setScalar(0.7 + prng() * 0.6);
      dummy.updateMatrix();
      this.flowerMesh.setMatrixAt(flPlaced, dummy.matrix);
      this.flowerMesh.setColorAt(flPlaced, palette[flPlaced % palette.length]);
      flPlaced++;
    }
    this.maxFlowerCount = flPlaced;
    this.flowerMesh.instanceMatrix.needsUpdate = true;
    if (this.flowerMesh.instanceColor) this.flowerMesh.instanceColor.needsUpdate = true;
    this.flowerGeo = flowerGeo;
    this.scene.add(this.flowerMesh);
  }

  update(dt: number, elapsed: number): void {
    if (this.shakePulse > 0) {
      this.shakePulse = Math.max(0, this.shakePulse - dt * 1.35);
    }
    if (this.grassMat) {
      this.grassMat.uniforms.uTime.value = elapsed;
      this.grassMat.uniforms.uShakePulse.value = this.shakePulse;
    }
    for (const mat of this.treeMats) {
      if (mat instanceof CustomShaderMaterial && mat.uniforms?.uTime) {
        mat.uniforms.uTime.value = elapsed;
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

    for (const geo of this.treeGeos) geo.dispose();
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
    for (const g of this.bambooGeos) g.dispose();
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
  }
}
