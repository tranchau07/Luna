import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { EventBus } from '../core/EventBus';
import type { AssetLoader } from '../core/AssetLoader';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from './TerrainHeightfield';

const MAX_RIPPLES = 4;

/**
 * Renders the crystal valley stream, koi pool, and 3-tier stepped waterfall
 * with custom GLSL Fresnel, depth-faded absorption, caustics, and interactive click ripples.
 */
export class WaterSystem implements IWorldSystem {
  readonly name = 'WaterSystem';

  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly assets: AssetLoader;
  private readonly bus: EventBus;

  waterMesh: THREE.Mesh | null = null;
  private waterGeo: THREE.BufferGeometry | null = null;
  private waterMat: CustomShaderMaterial | null = null;

  private waterfallGroup = new THREE.Group();
  private waterfallGeos: THREE.BufferGeometry[] = [];
  private waterfallMat: THREE.ShaderMaterial | null = null;

  private rippleData: THREE.Vector4[] = Array.from(
    { length: MAX_RIPPLES },
    () => new THREE.Vector4(0, 0, -999, 0),
  );
  private rippleIndex = 0;
  private elapsedRef = 0;
  private unsubRipple: (() => void) | null = null;

  constructor(
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    assets: AssetLoader,
    bus: EventBus,
  ) {
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.assets = assets;
    this.bus = bus;
  }

  init(): void {
    this.buildStreamSurface();
    this.buildThreeTierWaterfall();

    this.unsubRipple = this.bus.on('water:ripple', ({ position, intensity = 1 }) => {
      this.triggerRipple(position[0], position[2], intensity);
    });
  }

  triggerRipple(x: number, z: number, intensity = 1): void {
    this.rippleData[this.rippleIndex].set(x, z, this.elapsedRef, intensity);
    this.rippleIndex = (this.rippleIndex + 1) % MAX_RIPPLES;
  }

  private buildStreamSurface(): void {
    const { waterLevel, waterfallZ } = this.biome.terrain;
    const width = 46;
    const length = 92;
    const geo = new THREE.PlaneGeometry(width, length, 96, 160);
    geo.rotateX(-Math.PI / 2);

    const centerZ = (waterfallZ + 48) * 0.5;
    geo.translate(0, waterLevel, centerZ);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const depths = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      const terrainY = this.heightfield.getHeightAt(wx, wz);
      depths[i] = waterLevel - terrainY;
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
    geo.computeBoundsTree();

    const waterNormal = this.assets.getProceduralNormalMap('water-ripples', 256, 4, 0.42, 5);
    const { shallowColor, deepColor, foamColor, causticIntensity, flowSpeed, waveAmplitude } =
      this.biome.water;

    const material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshPhysicalMaterial,
      transparent: true,
      depthWrite: false,
      roughness: 0.18,
      metalness: 0.02,
      ior: 1.333,
      reflectivity: 0.6,
      envMapIntensity: 0.45,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.14, 0.14),
      uniforms: {
        uTime: { value: 0 },
        uFlowSpeed: { value: flowSpeed },
        uWaveAmp: { value: waveAmplitude },
        uShallowColor: { value: new THREE.Color(shallowColor) },
        uDeepColor: { value: new THREE.Color(deepColor) },
        uFoamColor: { value: new THREE.Color(foamColor) },
        uCausticIntensity: { value: causticIntensity },
        uRipples: { value: this.rippleData },
      },
      vertexShader: /* glsl */ `
        attribute float aDepth;
        uniform float uTime;
        uniform float uFlowSpeed;
        uniform float uWaveAmp;
        uniform vec4 uRipples[4];
        varying float vDepth;
        varying vec3 vWaterWorldPos;

        void main() {
          vDepth = aDepth;
          vec3 p = position;
          float waveMask = smoothstep(0.0, 0.45, aDepth);
          float wave = sin(p.x * 1.1 + uTime * 1.8) * cos(p.z * 0.9 - uTime * 1.4 * uFlowSpeed);
          float rippleSum = 0.0;
          for (int i = 0; i < 4; i++) {
            float age = uTime - uRipples[i].z;
            if (age > 0.0 && age < 4.5) {
              float dist = distance(p.xz, uRipples[i].xy);
              float ring = sin((dist - age * 3.8) * 5.0) * exp(-dist * 0.35) * exp(-age * 0.9);
              rippleSum += ring * 0.05 * uRipples[i].w;
            }
          }
          p.y += (wave * uWaveAmp + rippleSum) * waveMask;
          csm_Position = p;
          vWaterWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uFlowSpeed;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFoamColor;
        uniform float uCausticIntensity;
        uniform vec4 uRipples[4];
        varying float vDepth;
        varying vec3 vWaterWorldPos;

        float causticPattern(vec2 uv, float t) {
          vec2 p = uv * 0.85;
          float c1 = sin(p.x * 2.4 + t * 1.2 + sin(p.y * 2.1 - t * 0.8));
          float c2 = sin(p.y * 2.7 - t * 1.0 + cos(p.x * 1.9 + t * 0.7));
          return pow(max(0.0, 1.0 - abs(c1 + c2) * 0.55), 3.0);
        }

        void main() {
          if (vDepth < -0.02) discard;

          float depthT = clamp(vDepth / 1.65, 0.0, 1.0);
          vec3 baseCol = mix(uShallowColor, uDeepColor, pow(depthT, 0.68));

          // Animated bottom caustics visible in clear shallow water
          vec2 flowUv = vWaterWorldPos.xz - vec2(0.0, uTime * uFlowSpeed * 0.65);
          float caustics = causticPattern(flowUv, uTime) * (1.0 - depthT * 0.65);
          baseCol += uFoamColor * caustics * uCausticIntensity * 0.28;

          // Subtle shoreline foam + waterfall base aeration foam
          float shoreFoam = (1.0 - smoothstep(0.02, 0.14, vDepth)) * 0.32;
          float fallDist = distance(vWaterWorldPos.xz, vec2(0.0, -24.5));
          float plungeFoam = (1.0 - smoothstep(1.2, 4.2, fallDist)) *
            (0.55 + 0.35 * sin(fallDist * 2.6 - uTime * 3.8));

          // Interactive click wave rings
          float clickRing = 0.0;
          for (int i = 0; i < 4; i++) {
            float age = uTime - uRipples[i].z;
            if (age > 0.0 && age < 4.0) {
              float d = distance(vWaterWorldPos.xz, uRipples[i].xy);
              float front = abs(d - age * 3.8);
              clickRing += (1.0 - smoothstep(0.05, 0.45, front)) * exp(-age * 0.95) * uRipples[i].w;
            }
          }

          float foam = clamp(shoreFoam + plungeFoam * 0.62 + clickRing * 0.8, 0.0, 1.0);
          vec3 finalCol = mix(baseCol, uFoamColor, foam);

          // Fresnel boost at grazing view angles
          vec3 viewDir = normalize(cameraPosition - vWaterWorldPos);
          float fresnel = pow(1.0 - clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 3.6);
          finalCol = mix(finalCol, uFoamColor * 0.82, fresnel * 0.22);

          float alpha = clamp(smoothstep(-0.02, 0.12, vDepth) * (0.48 + depthT * 0.3 + foam * 0.35), 0.0, 0.88);
          csm_DiffuseColor = vec4(finalCol, alpha);
        }
      `,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'crystal-stream-water';
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    mesh.userData = { interactableType: 'water' };

    this.waterGeo = geo;
    this.waterMat = material;
    this.waterMesh = mesh;
    this.scene.add(mesh);
  }

  private buildThreeTierWaterfall(): void {
    const { waterfallZ } = this.biome.terrain;
    const fallX = this.heightfield.getStreamCenterX(waterfallZ);
    this.waterfallGroup.name = 'waterfall-3tier';

    this.waterfallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWaterColor: { value: new THREE.Color(this.biome.water.shallowColor) },
        uFoamColor: { value: new THREE.Color(this.biome.water.foamColor) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(uv.y * 10.0 + uTime * 6.0) * 0.08 * (1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uWaterColor;
        uniform vec3 uFoamColor;
        void main() {
          float flow = vUv.y * 5.0 + uTime * 2.4;
          float streaks = sin(vUv.x * 26.0 + sin(flow * 1.3)) * 0.5 + 0.5;
          float foamBand = smoothstep(0.35, 0.9, streaks) * 0.65 + (1.0 - vUv.y) * 0.55;
          float edgeX = smoothstep(0.0, 0.24, vUv.x) * (1.0 - smoothstep(0.76, 1.0, vUv.x));
          float edgeY = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
          vec3 col = mix(uWaterColor, uFoamColor, clamp(foamBand, 0.0, 1.0));
          float alpha = edgeX * edgeY * (0.55 + foamBand * 0.35);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    // 3 cascading waterfall tiers descending into the koi pool
    const tiers = [
      { width: 4.4, height: 2.9, pos: new THREE.Vector3(fallX, 6.2, waterfallZ - 3.6), tilt: 0.34 },
      { width: 5.0, height: 2.9, pos: new THREE.Vector3(fallX, 3.8, waterfallZ - 1.5), tilt: 0.36 },
      { width: 5.6, height: 2.8, pos: new THREE.Vector3(fallX, 1.4, waterfallZ + 0.7), tilt: 0.3 },
    ];

    for (const tier of tiers) {
      const geo = new THREE.PlaneGeometry(tier.width, tier.height, 14, 18);
      const mesh = new THREE.Mesh(geo, this.waterfallMat);
      mesh.position.copy(tier.pos);
      mesh.rotation.x = tier.tilt;
      mesh.renderOrder = 3;
      this.waterfallGeos.push(geo);
      this.waterfallGroup.add(mesh);
    }

    this.scene.add(this.waterfallGroup);
  }

  update(_dt: number, elapsed: number): void {
    this.elapsedRef = elapsed;
    if (this.waterMat) {
      this.waterMat.uniforms.uTime.value = elapsed;
    }
    if (this.waterfallMat) {
      this.waterfallMat.uniforms.uTime.value = elapsed;
    }
  }

  dispose(): void {
    if (this.unsubRipple) {
      this.unsubRipple();
      this.unsubRipple = null;
    }
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh = null;
    }
    if (this.waterGeo) {
      this.waterGeo.disposeBoundsTree();
      this.waterGeo.dispose();
      this.waterGeo = null;
    }
    if (this.waterMat) {
      this.waterMat.dispose();
      this.waterMat = null;
    }
    this.scene.remove(this.waterfallGroup);
    for (const g of this.waterfallGeos) {
      g.dispose();
    }
    this.waterfallGeos = [];
    this.waterfallGroup.clear();
    if (this.waterfallMat) {
      this.waterfallMat.dispose();
      this.waterfallMat = null;
    }
  }
}
