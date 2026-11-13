import * as THREE from 'three';
import Alea from 'alea';
import { createNoise2D } from 'simplex-noise';

/**
 * Provides local-first CC0 asset loading with self-contained procedural texture fallbacks
 * (Sobel tangent-space normal maps, foliage alpha-cutout cards, furrowed bark, koi patterns,
 * swallowtail butterfly wings, feathered bird wings, wildflower clusters, and mist sprites).
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
      // Blend 4D-like torus coordinates with rotated domain offsets to avoid X/Y grid alignment
      const a = u * Math.PI * 2;
      const b = v * Math.PI * 2;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const bx = Math.cos(b);
      const by = Math.sin(b);

      let value = 0;
      let amp = 0.5;
      let freq = frequency;
      for (let o = 0; o < 4; o++) {
        const px = ax * freq * 0.72 - by * freq * 0.69 + o * 17.3;
        const py = ay * freq * 0.69 + bx * freq * 0.72 - o * 11.7;
        const qx = bx * freq * 0.64 + ax * freq * 0.77 + 31.1;
        const qy = by * freq * 0.77 - ay * freq * 0.64 + 19.4;
        const n1 = noise2D(px, py);
        const n2 = noise2D(qx, qy);
        value += (n1 * 0.55 + n2 * 0.45) * amp;
        freq *= 2.03;
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
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;

    this.textureCache.set(`normal:${key}`, texture);
    return texture;
  }

  /**
   * Generates a crisp alpha-cutout botanical leaf cluster texture with twigs, veins, and highlights.
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

      // Central woody twig and secondary branchlets
      ctx.strokeStyle = '#3b2c1e';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, size * 0.95);
      ctx.quadraticCurveTo(cx + 3, cy, cx, size * 0.14);
      ctx.stroke();

      for (let b = 0; b < 5; b++) {
        const by = size * (0.78 - b * 0.13);
        const dir = b % 2 === 0 ? 1 : -1;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, by);
        ctx.quadraticCurveTo(cx + dir * 24, by - 14, cx + dir * 48, by - 28);
        ctx.stroke();
      }

      const bladeCount = key.includes('pine') ? 120 : 64;
      for (let i = 0; i < bladeCount; i++) {
        const angle = -Math.PI * 0.92 + (prng() * Math.PI * 0.84 + (i % 2 === 0 ? 0 : 0.08));
        const dist = 18 + prng() * (size * 0.35);
        const baseX = cx + (prng() - 0.5) * 32;
        const baseY = size * 0.84 - prng() * (size * 0.64);
        const tipX = baseX + Math.cos(angle - Math.PI / 2) * dist;
        const tipY = baseY + Math.sin(angle - Math.PI / 2) * dist;

        const shade = Math.floor(88 + prng() * 62);
        const green = Math.floor(132 + prng() * 68);
        const baseCol = `rgb(${Math.floor(shade * 0.62)}, ${green}, ${Math.floor(shade * 0.44)})`;
        ctx.strokeStyle = baseCol;
        ctx.fillStyle = baseCol;

        if (key.includes('pine')) {
          ctx.lineWidth = 2.6 + prng() * 2.2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(baseX, baseY);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
        } else {
          const rx = 10 + prng() * 8;
          const ry = 22 + prng() * 14;
          ctx.save();
          ctx.translate((baseX + tipX) * 0.5, (baseY + tipY) * 0.5);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();

          // Subtle leaf midrib vein
          ctx.strokeStyle = `rgba(215, 245, 175, 0.35)`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(0, ry * 0.75);
          ctx.lineTo(0, -ry * 0.75);
          ctx.stroke();
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
   * Generates a fern frond alpha-cutout texture with serrated pinnae and rachis stem.
   */
  getFernTexture(size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback('fern-frond', null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      ctx.strokeStyle = '#355824';
      ctx.lineWidth = 3.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, size * 0.98);
      ctx.quadraticCurveTo(cx + 2, size * 0.5, cx, size * 0.05);
      ctx.stroke();

      const pairs = 19;
      for (let i = 0; i < pairs; i++) {
        const t = i / (pairs - 1);
        const y = size * (0.91 - t * 0.82);
        const span = Math.sin(t * Math.PI * 0.9 + 0.18) * (size * 0.39);
        const leafletH = 8.5 * (1 - t * 0.48);
        for (const side of [-1, 1]) {
          const grad = ctx.createLinearGradient(cx, y, cx + side * span, y - 6);
          grad.addColorStop(0, '#366123');
          grad.addColorStop(0.65, i % 2 === 0 ? '#4f8233' : '#5e963d');
          grad.addColorStop(1, '#7ab04c');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(
            cx + side * span * 0.54,
            y - 4,
            Math.max(4, span * 0.54),
            Math.max(2.8, leafletH),
            side * -0.25,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates a multi-blossom botanical wildflower cluster texture for crossed meadow cards.
   */
  getWildflowerClusterTexture(size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback('wildflower-cluster', null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);

      const prng = Alea('wildflower-cluster');

      // Draw 5 slender branching green stems from the bottom
      const stems = [
        { x0: size * 0.48, x1: size * 0.32, y1: size * 0.28 },
        { x0: size * 0.5, x1: size * 0.52, y1: size * 0.18 },
        { x0: size * 0.52, x1: size * 0.7, y1: size * 0.32 },
        { x0: size * 0.46, x1: size * 0.24, y1: size * 0.48 },
        { x0: size * 0.54, x1: size * 0.76, y1: size * 0.5 },
      ];

      ctx.lineCap = 'round';
      for (const s of stems) {
        ctx.strokeStyle = '#3d6b2c';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(s.x0, size * 0.96);
        ctx.quadraticCurveTo((s.x0 + s.x1) * 0.5, (size + s.y1) * 0.52, s.x1, s.y1);
        ctx.stroke();

        // Basal lance leaves
        ctx.fillStyle = '#497d34';
        ctx.beginPath();
        ctx.ellipse(
          (s.x0 + s.x1) * 0.5,
          size * 0.72,
          6,
          22,
          (s.x1 - s.x0) * 0.008,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // Draw multi-petal blossoms at stem tips (white/cream petals so instanceColor tints cleanly)
      for (const s of stems) {
        const petals = 6;
        const radius = 16 + prng() * 6;
        for (let p = 0; p < petals; p++) {
          const a = (p / petals) * Math.PI * 2 + prng() * 0.2;
          const px = s.x1 + Math.cos(a) * (radius * 0.58);
          const py = s.y1 + Math.sin(a) * (radius * 0.58);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(a);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(0, 0, radius * 0.48, radius * 0.28, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        // Golden stamen center
        ctx.fillStyle = '#f5a623';
        ctx.beginPath();
        ctx.arc(s.x1, s.y1, radius * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates a furrowed tree bark albedo texture with vertical ridges and subtle lichen spots.
   */
  getBarkAlbedoTexture(size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback('bark-albedo', null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(size, size);
      const prng = Alea('bark-albedo');
      const noise = createNoise2D(prng);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const furrow = Math.sin(x * 0.28 + noise(x * 0.05, y * 0.02) * 3.2);
          const grain = noise(x * 0.18, y * 0.04) * 0.5 + noise(x * 0.4, y * 0.12) * 0.25;
          const lichen = noise(x * 0.06 + 50, y * 0.06 + 50);

          let r = 82 + furrow * 18 + grain * 22;
          let g = 62 + furrow * 14 + grain * 17;
          let b = 46 + furrow * 10 + grain * 13;

          if (lichen > 0.52) {
            const m = Math.min(1, (lichen - 0.52) * 3.0);
            r = r * (1 - m) + 98 * m;
            g = g * (1 - m) + 118 * m;
            b = b * (1 - m) + 84 * m;
          }

          const i = (y * size + x) * 4;
          img.data[i] = Math.max(25, Math.min(200, Math.round(r)));
          img.data[i + 1] = Math.max(20, Math.min(190, Math.round(g)));
          img.data[i + 2] = Math.max(15, Math.min(170, Math.round(b)));
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2, 4);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates authentic Japanese Koi skin patterns (0: Kohaku, 1: Taisho Sanke, 2: Kin Showa).
   */
  getKoiSkinTexture(variant: number, size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback(`koi-skin-${variant}`, null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const prng = Alea(`koi-skin-${variant}`);
      const noise = createNoise2D(prng);

      // Base body tone
      ctx.fillStyle = variant === 2 ? '#f4b63f' : '#fcf8f0';
      ctx.fillRect(0, 0, size, size);

      // Secondary hi (red/orange) blotches
      const hiColor = variant === 0 ? '#df3b18' : variant === 1 ? '#e8501e' : '#d93814';
      const sumiColor = '#1e1d20';

      const img = ctx.getImageData(0, 0, size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          const nHi = noise(u * 4.2 + variant * 7, v * 2.8) + noise(u * 9.0, v * 6.0) * 0.35;
          const nSumi = noise(u * 5.5 + 31 + variant * 5, v * 4.2 + 19);

          // Subtle diamond scale lattice
          const scaleWave =
            (Math.sin(u * Math.PI * 36) * Math.cos(v * Math.PI * 22) * 0.5 + 0.5) * 12;

          let r = variant === 2 ? 242 : 252;
          let g = variant === 2 ? 182 : 247;
          let b = variant === 2 ? 64 : 236;

          if (nHi > 0.08) {
            const hiRgb = variant === 0 ? [224, 58, 24] : [234, 82, 30];
            r = hiRgb[0];
            g = hiRgb[1];
            b = hiRgb[2];
          }
          if (variant > 0 && nSumi > 0.36) {
            r = 32;
            g = 30;
            b = 35;
          }

          // Counter-shading: slightly lighter belly near u = 0 or u = 1
          const belly = Math.pow(Math.abs(u - 0.5) * 2.0, 2.2) * 28;
          const idx = (y * size + x) * 4;
          img.data[idx] = Math.min(255, Math.max(15, Math.round(r + scaleWave + belly)));
          img.data[idx + 1] = Math.min(255, Math.max(15, Math.round(g + scaleWave + belly)));
          img.data[idx + 2] = Math.min(255, Math.max(15, Math.round(b + scaleWave + belly)));
          img.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      // Keep unused color constants referenced cleanly
      void hiColor;
      void sumiColor;

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates an alpha-cutout swallowtail butterfly wing texture with veins and marginal spots.
   */
  getButterflyWingTexture(variant = 0, size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback(`butterfly-wing-${variant}`, null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);

      const palettes = [
        { inner: '#ffbe3d', outer: '#f26419', spot: '#fff3b0' },
        { inner: '#56cfe1', outer: '#2ec4b6', spot: '#e0fbfc' },
        { inner: '#ff8fab', outer: '#fb6f92', spot: '#ffe5ec' },
      ];
      const pal = palettes[variant % palettes.length];

      // Forewing (upper lobe anchored at left x = 8, y = size * 0.52)
      const grad = ctx.createRadialGradient(
        size * 0.2,
        size * 0.45,
        10,
        size * 0.55,
        size * 0.45,
        size * 0.45,
      );
      grad.addColorStop(0, pal.inner);
      grad.addColorStop(0.7, pal.outer);
      grad.addColorStop(0.92, '#1f1a1c');
      grad.addColorStop(1, '#1f1a1c');

      ctx.fillStyle = grad;
      ctx.strokeStyle = '#1d181a';
      ctx.lineWidth = 5;

      // Forewing silhouette
      ctx.beginPath();
      ctx.moveTo(6, size * 0.52);
      ctx.bezierCurveTo(size * 0.25, size * 0.06, size * 0.85, size * 0.04, size * 0.94, size * 0.26);
      ctx.bezierCurveTo(size * 0.96, size * 0.46, size * 0.72, size * 0.58, 6, size * 0.56);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Hindwing silhouette with swallowtail projection
      ctx.beginPath();
      ctx.moveTo(6, size * 0.54);
      ctx.bezierCurveTo(size * 0.65, size * 0.52, size * 0.82, size * 0.68, size * 0.68, size * 0.86);
      ctx.lineTo(size * 0.74, size * 0.97);
      ctx.lineTo(size * 0.56, size * 0.89);
      ctx.bezierCurveTo(size * 0.34, size * 0.95, size * 0.12, size * 0.82, 6, size * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Dark wing veins
      ctx.strokeStyle = 'rgba(24, 18, 20, 0.72)';
      ctx.lineWidth = 2.4;
      const veins = [
        [size * 0.88, size * 0.22],
        [size * 0.86, size * 0.36],
        [size * 0.76, size * 0.48],
        [size * 0.68, size * 0.68],
        [size * 0.58, size * 0.82],
      ];
      for (const [vx, vy] of veins) {
        ctx.beginPath();
        ctx.moveTo(10, size * 0.54);
        ctx.quadraticCurveTo(vx * 0.55, vy * 0.9, vx, vy);
        ctx.stroke();
      }

      // Marginal pearl spots
      ctx.fillStyle = pal.spot;
      for (let s = 0; s < 5; s++) {
        const sx = size * (0.84 - s * 0.06);
        const sy = size * (0.22 + s * 0.13);
        ctx.beginPath();
        ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates an alpha-cutout feathered bird wing texture.
   */
  getBirdWingTexture(size = 256): THREE.CanvasTexture {
    return this.loadTextureWithFallback('bird-wing', null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);

      const grad = ctx.createLinearGradient(0, size * 0.3, size, size * 0.6);
      grad.addColorStop(0, '#f7f4ec');
      grad.addColorStop(0.72, '#e3ddd1');
      grad.addColorStop(1, '#2b3036');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(4, size * 0.35);
      ctx.quadraticCurveTo(size * 0.55, size * 0.18, size * 0.96, size * 0.42);
      // Primary feather tips along trailing edge
      for (let f = 0; f < 7; f++) {
        const t = 1 - f / 7;
        const fx = 8 + t * (size * 0.88);
        const fy = size * (0.58 + Math.sin(t * Math.PI) * 0.18);
        ctx.lineTo(fx, fy);
        ctx.lineTo(fx - 12, fy - 9);
      }
      ctx.lineTo(4, size * 0.62);
      ctx.closePath();
      ctx.fill();

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }) as THREE.CanvasTexture;
  }

  /**
   * Generates an alpha-cutout autumn leaf sprite texture for drifting leaf particles.
   */
  getLeafParticleTexture(size = 128): THREE.CanvasTexture {
    return this.loadTextureWithFallback('leaf-particle', null, () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx, size * 0.08);
      ctx.quadraticCurveTo(size * 0.88, size * 0.35, size * 0.76, size * 0.68);
      ctx.quadraticCurveTo(cx, size * 0.88, cx, size * 0.94);
      ctx.quadraticCurveTo(cx, size * 0.88, size * 0.24, size * 0.68);
      ctx.quadraticCurveTo(size * 0.12, size * 0.35, cx, size * 0.08);
      ctx.fill();

      ctx.strokeStyle = 'rgba(120, 60, 20, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, size * 0.95);
      ctx.lineTo(cx, size * 0.14);
      ctx.stroke();

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
            const speck = noise(x * 0.65, y * 0.65) * 14;
            const v = Math.max(42, Math.min(188, Math.round(108 + n * 44 + speck)));
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
