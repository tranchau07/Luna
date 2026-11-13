import * as THREE from 'three';
import Alea from 'alea';
import { createNoise2D } from 'simplex-noise';

/**
 * Provides local-first CC0 asset loading with self-contained procedural texture fallbacks
 * (Sobel tangent-space normal maps, foliage alpha-cutout cards, bark, rock, and mist sprites).
 */
export class AssetLoader {
  private textureCache = new Map<string, THREE.Texture>();
  private textureLoader = new THREE.TextureLoader();

  /**
   * Loads a local texture under `public/assets/` if present, otherwise builds the procedural fallback.
   */
  loadTextureWithFallback(
    cacheKey: string,
    localUrl: string | null,
    fallbackFactory: () => THREE.Texture,
  ): THREE.Texture {
    const cached = this.textureCache.get(cacheKey);
    if (cached) return cached;

    const fallback = fallbackFactory();
    this.textureCache.set(cacheKey, fallback);

    if (localUrl) {
      this.textureLoader.load(
        localUrl,
        (loaded) => {
          loaded.wrapS = fallback.wrapS;
          loaded.wrapT = fallback.wrapT;
          loaded.colorSpace = fallback.colorSpace;
          loaded.needsUpdate = true;
          fallback.image = loaded.image;
          fallback.needsUpdate = true;
        },
        undefined,
        () => {
          // Expected when optional CC0 asset is not placed in public/assets/; fallback stays active.
        },
      );
    }

    return fallback;
  }

  /**
   * Generates a tileable tangent-space RGB normal map via Sobel filtering over FBM noise.
   */
  getProceduralNormalMap(
    key: string,
    size = 256,
    frequency = 6,
    strength = 2.4,
    repeat = 4,
  ): THREE.DataTexture {
    const cached = this.textureCache.get(`normal:${key}`);
    if (cached) return cached as THREE.DataTexture;

    const prng = Alea(key);
    const noise2D = createNoise2D(prng);

    const sampleTileable = (u: number, v: number): number => {
      // Map [0,1)^2 onto a 2D torus slice via trigonometric blending for seamless tiling
      const ax = Math.cos(u * Math.PI * 2);
      const ay = Math.sin(u * Math.PI * 2);
      const bx = Math.cos(v * Math.PI * 2);
      const by = Math.sin(v * Math.PI * 2);

      let value = 0;
      let amp = 0.5;
      let freq = frequency;
      for (let o = 0; o < 4; o++) {
        const n1 = noise2D(ax * freq + bx * 0.5, ay * freq + by * 0.5);
        const n2 = noise2D(bx * freq - ay * 0.5, by * freq + ax * 0.5);
        value += ((n1 + n2) * 0.5) * amp;
        freq *= 2.02;
        amp *= 0.5;
      }
      return value;
    };

    const heights = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        heights[y * size + x] = sampleTileable(x / size, y / size);
      }
    }

    const idx = (x: number, y: number): number => {
      const wx = ((x % size) + size) % size;
      const wy = ((y % size) + size) % size;
      return heights[wy * size + wx];
    };

    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Sobel 3x3 gradient
        const tl = idx(x - 1, y - 1);
        const t = idx(x, y - 1);
        const tr = idx(x + 1, y - 1);
        const l = idx(x - 1, y);
        const r = idx(x + 1, y);
        const bl = idx(x - 1, y + 1);
        const b = idx(x, y + 1);
        const br = idx(x + 1, y + 1);

        const dX = tr + 2 * r + br - (tl + 2 * l + bl);
        const dY = bl + 2 * b + br - (tl + 2 * t + tr);

        let nx = -dX * strength;
        let ny = -dY * strength;
        let nz = 1.0;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        const offset = (y * size + x) * 4;
        data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
        data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        data[offset + 3] = 255;
      }
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;

    this.textureCache.set(`normal:${key}`, texture);
    return texture;
  }

  /**
   * Generates a crisp alpha-cutout botanical leaf cluster texture for trees and bushes.
   */
  getFoliageAlphaTexture(key = 'pine-cluster', size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback(`foliage:${key}`, null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);

      const prng = Alea(`foliage-${key}`);
      const cx = size / 2;
      const cy = size * 0.62;

      // Central twig
      ctx.strokeStyle = '#3b2e21';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, size * 0.94);
      ctx.quadraticCurveTo(cx + 4, cy, cx, size * 0.16);
      ctx.stroke();

      // Pine / broad needle clusters layered for alphaTest cutout
      const bladeCount = key.includes('pine') ? 90 : 48;
      for (let i = 0; i < bladeCount; i++) {
        const angle = -Math.PI * 0.9 + (prng() * Math.PI * 0.8 + (i % 2 === 0 ? 0 : 0.1));
        const dist = 16 + prng() * (size * 0.34);
        const baseX = cx + (prng() - 0.5) * 24;
        const baseY = size * 0.82 - prng() * (size * 0.6);
        const tipX = baseX + Math.cos(angle - Math.PI / 2) * dist;
        const tipY = baseY + Math.sin(angle - Math.PI / 2) * dist;

        const shade = Math.floor(85 + prng() * 55);
        const green = Math.floor(125 + prng() * 65);
        ctx.strokeStyle = `rgb(${Math.floor(shade * 0.6)}, ${green}, ${Math.floor(shade * 0.45)})`;
        ctx.fillStyle = ctx.strokeStyle;

        if (key.includes('pine')) {
          ctx.lineWidth = 3 + prng() * 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(baseX, baseY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
        } else {
          ctx.save();
          ctx.translate((baseX + tipX) * 0.5, (baseY + tipY) * 0.5);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.ellipse(0, 0, 9 + prng() * 7, 22 + prng() * 14, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates a fern frond alpha-cutout texture for forest undergrowth.
   */
  getFernTexture(size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback('fern-frond', null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      ctx.strokeStyle = '#3d5e2a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, size * 0.98);
      ctx.lineTo(cx, size * 0.08);
      ctx.stroke();

      const pairs = 15;
      for (let i = 0; i < pairs; i++) {
        const t = i / (pairs - 1);
        const y = size * (0.9 - t * 0.78);
        const span = Math.sin(t * Math.PI * 0.92 + 0.15) * (size * 0.36);
        const leafletH = 9 * (1 - t * 0.45);
        for (const side of [-1, 1]) {
          ctx.fillStyle = i % 2 === 0 ? '#4d7c32' : '#5e923c';
          ctx.beginPath();
          ctx.ellipse(
            cx + side * span * 0.55,
            y - 4,
            Math.max(4, span * 0.55),
            Math.max(3, leafletH),
            side * -0.28,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates a soft radial mist/firefly particle texture.
   */
  getSoftParticleTexture(size = 128): THREE.CanvasTexture {
    return this.loadTextureWithFallback('soft-particle', null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const half = size / 2;
      const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.65)');
      grad.addColorStop(0.75, 'rgba(255,255,255,0.14)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates a procedural mossy granite albedo map (used alongside vertex AO).
   */
  getRockAlbedoTexture(size = 256, localUrl: string | null = null): THREE.CanvasTexture {
    return this.loadTextureWithFallback(
      'rock-albedo',
      localUrl,
      () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const prng = Alea('rock-albedo');
        const img = ctx.createImageData(size, size);
        const noise = createNoise2D(prng);

        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const n =
              noise(x * 0.04, y * 0.09) * 0.5 +
              noise(x * 0.12, y * 0.12) * 0.3 +
              noise(x * 0.3, y * 0.3) * 0.2;
            const v = Math.max(45, Math.min(180, Math.round(108 + n * 42)));
            const i = (y * size + x) * 4;
            img.data[i] = v;
            img.data[i + 1] = Math.round(v * 1.02);
            img.data[i + 2] = Math.round(v * 0.98);
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      },
    ) as THREE.CanvasTexture;
  }

  dispose(): void {
    for (const tex of this.textureCache.values()) {
      tex.dispose();
    }
    this.textureCache.clear();
  }
}
