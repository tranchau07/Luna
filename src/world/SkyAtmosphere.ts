import * as THREE from 'three';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { EventBus, WeatherMode } from '../core/EventBus';
import type { BiomeConfig, WeatherPreset } from '../config/BiomeConfig';
import type { QualityProfile } from '../core/QualityConfig';

/**
 * Physical sky dome, starfield, directional sun/moon shadow light,
 * hemisphere ambient light, exponential fog, and PMREM environment map generator.
 */
export class SkyAtmosphere implements IWorldSystem {
  readonly name = 'SkyAtmosphere';

  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly biome: BiomeConfig;
  private readonly bus: EventBus;

  sunLight!: THREE.DirectionalLight;
  hemiLight!: THREE.HemisphereLight;
  sunDiscMesh!: THREE.Mesh;

  private skyMesh: THREE.Mesh | null = null;
  private skyMat: THREE.ShaderMaterial | null = null;
  private starsPoints: THREE.Points | null = null;
  private starsMat: THREE.PointsMaterial | null = null;
  private pmremGenerator: THREE.PMREMGenerator | null = null;
  private envCache = new Map<WeatherMode, THREE.WebGLRenderTarget>();
  private envScene: THREE.Scene | null = null;
  private envDomeMat: THREE.ShaderMaterial | null = null;
  private unsubWeather: (() => void) | null = null;

  private currentMode: WeatherMode;
  private targetPreset: WeatherPreset;
  private currentExposure = 1.05;
  private exposureOverride: number | null = null;
  private sunDirection = new THREE.Vector3(0.4, 0.5, -0.7).normalize();
  private fog: THREE.FogExp2;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    biome: BiomeConfig,
    bus: EventBus,
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.biome = biome;
    this.bus = bus;
    this.currentMode = biome.defaultWeather;
    this.targetPreset = biome.weatherPresets[this.currentMode];
    this.fog = new THREE.FogExp2(this.targetPreset.fogColor, this.targetPreset.fogDensity);
  }

  init(): void {
    this.scene.fog = this.fog;

    // Sky gradient dome with drifting FBM clouds
    const skyGeo = new THREE.SphereGeometry(260, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uTopColor: { value: new THREE.Color(this.targetPreset.skyTopColor) },
        uHorizonColor: { value: new THREE.Color(this.targetPreset.skyHorizonColor) },
        uSunDir: { value: this.sunDirection.clone() },
        uSunColor: { value: new THREE.Color(this.targetPreset.sunColor) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vWorldDir;

        float hash2(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash2(i);
          float b = hash2(i + vec2(1.0, 0.0));
          float c = hash2(i + vec2(0.0, 1.0));
          float d = hash2(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbmClouds(vec2 uv) {
          float v = 0.0;
          float amp = 0.52;
          for (int i = 0; i < 4; i++) {
            v += valueNoise(uv) * amp;
            uv = uv * 2.07 + vec2(13.7, -9.2);
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.58));

          float sunAmt = max(dot(dir, normalize(uSunDir)), 0.0);
          col += uSunColor * pow(sunAmt, 12.0) * 0.42;

          // Project upper sky hemisphere onto drifting cloud plane
          if (h > 0.04) {
            vec2 cloudUv = dir.xz / (h + 0.22) * 2.2 + vec2(uTime * 0.015, -uTime * 0.008);
            float n = fbmClouds(cloudUv);
            float cloudMask = smoothstep(0.47, 0.78, n) * smoothstep(0.04, 0.26, h);
            vec3 cloudCol = mix(uHorizonColor * 1.12, uSunColor * 1.15, 0.35 + 0.55 * pow(sunAmt, 3.0));
            col = mix(col, cloudCol, cloudMask * 0.56);
          }

          col += uSunColor * pow(sunAmt, 180.0) * 1.1;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.skyMesh.name = 'sky-dome';
    this.scene.add(this.skyMesh);

    // Subtle night starfield
    const starCount = 450;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = ((i * 73.13) % 360) * (Math.PI / 180);
      const phi = Math.acos(0.15 + ((i * 19.37) % 85) / 100);
      const r = 230;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starsMat = new THREE.PointsMaterial({
      color: '#dce8ff',
      size: 1.4,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    this.starsPoints = new THREE.Points(starGeo, this.starsMat);
    this.scene.add(this.starsPoints);

    // Sun/Moon light source disc for GodRaysEffect
    const discGeo = new THREE.SphereGeometry(7.5, 16, 12);
    const discMat = new THREE.MeshBasicMaterial({
      color: this.targetPreset.sunColor,
      fog: false,
    });
    this.sunDiscMesh = new THREE.Mesh(discGeo, discMat);
    this.sunDiscMesh.name = 'sun-disc';
    this.scene.add(this.sunDiscMesh);

    // Primary shadow-casting directional light
    this.sunLight = new THREE.DirectionalLight(
      this.targetPreset.sunColor,
      this.targetPreset.sunIntensity,
    );
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 165;
    const d = 38;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.14;
    this.sunLight.shadow.radius = 2.4;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.sunLight.target.position.set(0, 0, -6);

    // Sky/ground hemisphere fill light
    this.hemiLight = new THREE.HemisphereLight(
      this.targetPreset.ambientSkyColor,
      this.targetPreset.ambientGroundColor,
      this.targetPreset.ambientIntensity,
    );
    this.scene.add(this.hemiLight);

    // Dedicated lightweight sky scene for PMREM baking
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    this.envDomeMat = this.skyMat.clone();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 20, 12), this.envDomeMat));

    this.applyWeatherImmediate(this.currentMode);

    this.unsubWeather = this.bus.on('weather:change', ({ mode }) => {
      this.setWeather(mode);
    });
  }

  getMode(): WeatherMode {
    return this.currentMode;
  }

  getExposure(): number {
    return this.exposureOverride ?? this.currentExposure;
  }

  setExposureOverride(value: number | null): void {
    this.exposureOverride = value;
  }

  getSunDirection(): THREE.Vector3 {
    return this.sunDirection;
  }

  rebuildEnvironmentMaps(): void {
    for (const rt of this.envCache.values()) {
      rt.dispose();
    }
    this.envCache.clear();
    if (this.pmremGenerator) {
      this.pmremGenerator.dispose();
    }
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.applyWeatherImmediate(this.currentMode);
  }

  applyQuality(profile: QualityProfile): void {
    if (!this.sunLight) return;
    if (this.sunLight.shadow.mapSize.x !== profile.shadowMapSize) {
      this.sunLight.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
  }

  setWeather(mode: WeatherMode): void {
    const preset = this.biome.weatherPresets[mode];
    if (!preset) return;
    this.currentMode = mode;
    this.targetPreset = preset;
    this.exposureOverride = null;
    this.applyWeatherImmediate(mode);
  }

  private applyWeatherImmediate(mode: WeatherMode): void {
    const preset = this.biome.weatherPresets[mode];
    const elev = THREE.MathUtils.degToRad(preset.sunElevationDeg);
    const azim = THREE.MathUtils.degToRad(preset.sunAzimuthDeg);

    this.sunDirection.set(
      Math.cos(elev) * Math.sin(azim),
      Math.sin(elev),
      Math.cos(elev) * Math.cos(azim),
    );
    this.sunDirection.normalize();

    this.sunLight.position.copy(this.sunDirection).multiplyScalar(82);
    this.sunLight.position.z -= 6;
    this.sunLight.color.set(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;

    this.sunDiscMesh.position.copy(this.sunDirection).multiplyScalar(195);
    (this.sunDiscMesh.material as THREE.MeshBasicMaterial).color.set(preset.sunColor);

    this.hemiLight.color.set(preset.ambientSkyColor);
    this.hemiLight.groundColor.set(preset.ambientGroundColor);
    this.hemiLight.intensity = preset.ambientIntensity;

    this.fog.color.set(preset.fogColor);
    this.fog.density = preset.fogDensity;
    this.currentExposure = preset.exposure;

    if (this.skyMat) {
      this.skyMat.uniforms.uTopColor.value.set(preset.skyTopColor);
      this.skyMat.uniforms.uHorizonColor.value.set(preset.skyHorizonColor);
      this.skyMat.uniforms.uSunDir.value.copy(this.sunDirection);
      this.skyMat.uniforms.uSunColor.value.set(preset.sunColor);
    }

    if (this.starsMat) {
      this.starsMat.opacity = mode === 'moonlight' ? 0.85 : 0;
    }

    if (this.envDomeMat && this.pmremGenerator && this.envScene) {
      let cachedEnv = this.envCache.get(mode);
      if (!cachedEnv) {
        this.envDomeMat.uniforms.uTopColor.value.set(preset.skyTopColor);
        this.envDomeMat.uniforms.uHorizonColor.value.set(preset.skyHorizonColor);
        this.envDomeMat.uniforms.uSunDir.value.copy(this.sunDirection);
        this.envDomeMat.uniforms.uSunColor.value.set(preset.sunColor);
        cachedEnv = this.pmremGenerator.fromScene(this.envScene, 0.04);
        this.envCache.set(mode, cachedEnv);
      }
      this.scene.environment = cachedEnv.texture;
    }
  }

  update(_dt: number, elapsed: number): void {
    if (this.skyMat) {
      this.skyMat.uniforms.uTime.value = elapsed;
    }
    if (this.starsPoints && this.currentMode === 'moonlight') {
      this.starsPoints.rotation.y = elapsed * 0.004;
    }
  }

  dispose(): void {
    if (this.unsubWeather) {
      this.unsubWeather();
      this.unsubWeather = null;
    }
    if (this.skyMesh) {
      this.scene.remove(this.skyMesh);
      this.skyMesh.geometry.dispose();
      this.skyMesh = null;
    }
    if (this.skyMat) {
      this.skyMat.dispose();
      this.skyMat = null;
    }
    if (this.starsPoints) {
      this.scene.remove(this.starsPoints);
      this.starsPoints.geometry.dispose();
      this.starsPoints = null;
    }
    if (this.starsMat) {
      this.starsMat.dispose();
      this.starsMat = null;
    }
    if (this.sunDiscMesh) {
      this.scene.remove(this.sunDiscMesh);
      this.sunDiscMesh.geometry.dispose();
      (this.sunDiscMesh.material as THREE.Material).dispose();
    }
    if (this.sunLight) {
      this.scene.remove(this.sunLight);
      this.scene.remove(this.sunLight.target);
      this.sunLight.dispose();
    }
    if (this.hemiLight) {
      this.scene.remove(this.hemiLight);
      this.hemiLight.dispose();
    }
    if (this.envScene) {
      this.envScene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
      });
      this.envScene = null;
    }
    if (this.envDomeMat) {
      this.envDomeMat.dispose();
      this.envDomeMat = null;
    }
    for (const rt of this.envCache.values()) {
      rt.dispose();
    }
    this.envCache.clear();
    this.scene.environment = null;
    this.scene.fog = null;
    if (this.pmremGenerator) {
      this.pmremGenerator.dispose();
      this.pmremGenerator = null;
    }
  }
}
