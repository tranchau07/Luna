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
 * with custom GLSL Fresnel, depth-faded absorption, Voronoi cellular caustics,
 * organic FBM shoreline foam, and interactive click ripples.
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

    const waterNormal = this.assets.getProceduralNormalMap('water-ripples', 256, 4, 0.35, 5);
    const { shallowColor, deepColor, foamColor, causticIntensity, flowSpeed, waveAmplitude } =
      this.biome.water;

    const material = new CustomShaderMaterial({
      baseMaterial: THREE.MeshPhysicalMaterial,
      transparent: true,
      depthWrite: false,
      roughness: 0.14,
      metalness: 0.02,
      ior: 1.333,
      reflectivity: 0.6,
      envMapIntensity: 0.45,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.08, 0.08),
      uniforms: {
        uTime: { value: 0 },
        uFlowSpeed: { value: flowSpeed },
        uWaveAmp: { value: waveAmplitude },
        uShallowColor: { value: new THREE.Color(shallowColor) },
        uDeepColor: { value: new THREE.Color(deepColor) },
        uFoamColor: { value: new THREE.Color(foamColor) },
        uCausticIntensity: { value: causticIntensity },
        uRipples: { value: this.rippleData },
        uPlungePos: {
          value: new THREE.Vector2(
            this.biome.landmarks.waterfallPlungePos[0],
            this.biome.landmarks.waterfallPlungePos[1],
          ),
        },
        uFordZ: { value: this.biome.landmarks.steppingStonesZ },
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
          float w1 = sin(p.x * 0.9 + p.z * 0.35 + uTime * 1.7) * cos(p.z * 0.85 - p.x * 0.25 - uTime * 1.4 * uFlowSpeed);
          float w2 = sin((p.x * 1.7 - p.z * 1.3) - uTime * 2.2) * 0.32;
          float rippleSum = 0.0;
          for (int i = 0; i < 4; i++) {
            float age = uTime - uRipples[i].z;
            if (age > 0.0 && age < 4.5) {
              float dist = distance(p.xz, uRipples[i].xy);
              float ring = sin((dist - age * 3.8) * 5.2) * exp(-dist * 0.35) * exp(-age * 0.9);
              rippleSum += ring * 0.055 * uRipples[i].w;
            }
          }
          p.y += ((w1 + w2) * uWaveAmp * 0.8 + rippleSum) * waveMask;
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
        uniform vec2 uPlungePos;
        uniform float uFordZ;
        varying float vDepth;
        varying vec3 vWaterWorldPos;

        vec2 hash22(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453);
        }

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

        // True cellular Voronoi caustics (organic web filaments, zero parallel grid lines)
        float voronoiCaustic(vec2 uv, float t) {
          vec2 n = floor(uv);
          vec2 f = fract(uv);
          float md1 = 8.0;
          float md2 = 8.0;
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = hash22(n + g);
              o = 0.5 + 0.42 * sin(t * 0.95 + 6.2831 * o);
              vec2 r = g + o - f;
              float d = dot(r, r);
              if (d < md1) {
                md2 = md1;
                md1 = d;
              } else if (d < md2) {
                md2 = d;
              }
            }
          }
          float edge = sqrt(md2) - sqrt(md1);
          return pow(1.0 - clamp(edge * 2.2, 0.0, 1.0), 3.0);
        }

        void main() {
          if (vDepth < -0.02) discard;

          float depthT = clamp(vDepth / 1.65, 0.0, 1.0);
          vec3 baseCol = mix(uShallowColor, uDeepColor, pow(depthT, 0.65));

          // Organic Voronoi bottom caustics in clear shallow water
          vec2 flowUv = vWaterWorldPos.xz * 0.52 - vec2(0.0, uTime * uFlowSpeed * 0.42);
          float caustics = (voronoiCaustic(flowUv, uTime) * 0.65 +
                            voronoiCaustic(flowUv * 1.45 + vec2(3.7, -2.1), -uTime * 0.75) * 0.45)
            * (1.0 - depthT * 0.68);
          baseCol += uFoamColor * caustics * uCausticIntensity * 0.28;

          // Organic frothy shoreline foam (broken up by 2D noise, no parallel rings)
          float foamNoise = noise2(vWaterWorldPos.xz * 2.6 + vec2(0.0, -uTime * 0.65)) * 0.65
                          + noise2(vWaterWorldPos.xz * 5.8 - vec2(uTime * 0.4, 0.0)) * 0.35;
          float shoreEdge = 1.0 - smoothstep(0.0, 0.22, vDepth);
          float shoreFoam = smoothstep(0.45, 0.85, foamNoise + shoreEdge * 0.55) * shoreEdge * 0.52;

          // Waterfall plunge pool aeration foam
          float fallDist = distance(vWaterWorldPos.xz, uPlungePos);
          float plungeMask = 1.0 - smoothstep(1.2, 5.2, fallDist);
          float plungeFoam = plungeMask * smoothstep(0.28, 0.78, foamNoise + plungeMask * 0.45) * 0.72;

          // Stepping-stone ford wake foam near configured steppingStonesZ
          float fordDist = abs(vWaterWorldPos.z - uFordZ);
          float fordMask = (1.0 - smoothstep(0.2, 1.4, fordDist)) * (1.0 - smoothstep(0.05, 0.45, vDepth));
          float fordWake = fordMask * smoothstep(0.42, 0.82, foamNoise) * 0.45;

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

          float foam = clamp(shoreFoam + plungeFoam + fordWake + clickRing * 0.85, 0.0, 1.0);
          vec3 finalCol = mix(baseCol, uFoamColor, foam);

          // Subtle Fresnel sky reflection at grazing view angles
          vec3 viewDir = normalize(cameraPosition - vWaterWorldPos);
          float fresnel = pow(1.0 - clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 3.6);
          finalCol = mix(finalCol, uFoamColor * 0.85, fresnel * 0.24);

          float alpha = clamp(smoothstep(-0.02, 0.12, vDepth) * (0.44 + depthT * 0.34 + foam * 0.38), 0.0, 0.88);
          csm_DiffuseColor = vec4(finalCol, alpha);
        }
      `,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'crystal-stream-water';
    // Prevent directional shadow-map acne stripes across the translucent water plane
    mesh.receiveShadow = false;
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
          float crestArch = sin(uv.y * 3.14159) * 0.24;
          float curtainWave = sin(uv.y * 12.0 + uTime * 6.8 + uv.x * 5.0) * 0.08 * (1.0 - uv.y);
          p.z += crestArch + curtainWave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uWaterColor;
        uniform vec3 uFoamColor;
        void main() {
          float flow1 = vUv.y * 5.5 + uTime * 2.65;
          float flow2 = vUv.y * 11.0 + uTime * 4.1;
          float s1 = sin(vUv.x * 28.0 + sin(flow1 * 1.4)) * 0.5 + 0.5;
          float s2 = sin(vUv.x * 54.0 - cos(flow2 * 1.2)) * 0.5 + 0.5;
          float streaks = s1 * 0.65 + s2 * 0.35;

          float crestFoam = smoothstep(0.65, 0.92, vUv.y) * 0.45;
          float baseBoil = (1.0 - smoothstep(0.0, 0.38, vUv.y)) * 0.65;
          float foamBand = smoothstep(0.32, 0.88, streaks) * 0.68 + crestFoam + baseBoil;

          float edgeX = smoothstep(0.0, 0.24, vUv.x) * (1.0 - smoothstep(0.76, 1.0, vUv.x));
          float edgeY = smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
          vec3 col = mix(uWaterColor, uFoamColor, clamp(foamBand, 0.0, 1.0));
          float alpha = edgeX * edgeY * (0.58 + clamp(foamBand, 0.0, 1.0) * 0.36);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const tiers = [
      { width: 4.5, height: 3.0, pos: new THREE.Vector3(fallX, 6.2, waterfallZ - 3.6), tilt: 0.34 },
      { width: 5.1, height: 3.0, pos: new THREE.Vector3(fallX, 3.8, waterfallZ - 1.5), tilt: 0.36 },
      { width: 5.8, height: 2.9, pos: new THREE.Vector3(fallX, 1.4, waterfallZ + 0.7), tilt: 0.3 },
    ];

    for (const tier of tiers) {
      const geo = new THREE.PlaneGeometry(tier.width, tier.height, 18, 24);
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
