import * as THREE from 'three';
import type { IWorldSystem } from '../core/IWorldSystem';
import type { EventBus, WeatherMode } from '../core/EventBus';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';

/**
 * Self-contained 3D spatial nature soundscape synthesized via Web Audio API + THREE.PositionalAudio.
 * Requires zero external MP3 assets and modulates waterfall/stream presence with camera distance.
 */
export class SpatialAudio implements IWorldSystem {
  readonly name = 'SpatialAudio';

  private readonly camera: THREE.Camera;
  private readonly scene: THREE.Scene;
  private readonly biome: BiomeConfig;
  private readonly heightfield: TerrainHeightfield;
  private readonly bus: EventBus;

  private listener: THREE.AudioListener | null = null;
  private waterfallAnchor: THREE.Object3D | null = null;
  private waterfallAudio: THREE.PositionalAudio | null = null;
  private masterGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private enabled = false;
  private volume = 0.55;
  private muteOnHide = false;
  private currentWeather: WeatherMode;
  private chirpCooldown = 3.0;

  private unsubs: Array<() => void> = [];
  private onVisibilityBound: () => void;
  private suspendTimeout: number | null = null;

  constructor(
    camera: THREE.Camera,
    scene: THREE.Scene,
    biome: BiomeConfig,
    heightfield: TerrainHeightfield,
    bus: EventBus,
  ) {
    this.camera = camera;
    this.scene = scene;
    this.biome = biome;
    this.heightfield = heightfield;
    this.bus = bus;
    this.currentWeather = biome.defaultWeather;
    this.onVisibilityBound = () => this.handleVisibility();
  }

  init(): void {
    this.unsubs.push(
      this.bus.on('audio:toggle', ({ enabled }) => this.setEnabled(enabled)),
      this.bus.on('audio:volume', ({ volume }) => this.setVolume(volume)),
      this.bus.on('audio:muteOnHide', ({ enabled }) => {
        this.muteOnHide = enabled;
        this.handleVisibility();
      }),
      this.bus.on('weather:change', ({ mode }) => {
        this.currentWeather = mode;
      }),
      this.bus.on('water:ripple', () => this.playWaterDropChime()),
      this.bus.on('pomodoro:complete', () => this.playSingingBowlChime()),
    );
    document.addEventListener('visibilitychange', this.onVisibilityBound);
  }

  private ensureAudioGraph(): void {
    if (this.listener) return;

    this.listener = new THREE.AudioListener();
    this.camera.add(this.listener);

    const ctx = this.listener.context;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.listener.getInput());

    // Synthesize 4 seconds of seamless pink-ish noise buffer
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.03) * 0.45;
    }

    // 1. Spatial 3D Waterfall Rush anchored at waterfall base
    const { waterfallZ } = this.biome.terrain;
    const fallX = this.heightfield.getStreamCenterX(waterfallZ);
    this.waterfallAnchor = new THREE.Object3D();
    this.waterfallAnchor.position.set(fallX, 2.2, waterfallZ + 1.5);
    this.scene.add(this.waterfallAnchor);

    this.waterfallAudio = new THREE.PositionalAudio(this.listener);
    this.waterfallAudio.setBuffer(buffer);
    this.waterfallAudio.setLoop(true);
    this.waterfallAudio.setRefDistance(7);
    this.waterfallAudio.setMaxDistance(68);
    this.waterfallAudio.setRolloffFactor(1.25);

    const wfFilter = ctx.createBiquadFilter();
    wfFilter.type = 'lowpass';
    wfFilter.frequency.value = 980;
    this.waterfallAudio.setFilter(wfFilter);
    this.waterfallAnchor.add(this.waterfallAudio);

    // 2. Ambient Valley Breeze
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buffer;
    windSrc.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 340;
    this.windFilter.Q.value = 1.6;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.28;

    windSrc.connect(this.windFilter);
    this.windFilter.connect(windGain);
    windGain.connect(this.masterGain);
    windSrc.start();

    if (!this.waterfallAudio.isPlaying) {
      this.waterfallAudio.play();
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.ensureAudioGraph();
    }
    this.syncGain();
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    this.syncGain();
  }

  private handleVisibility(): void {
    this.syncGain();
  }

  private syncGain(): void {
    if (!this.listener) return;
    const ctx = this.listener.context;
    const muted = !this.enabled || (this.muteOnHide && document.hidden);
    const target = muted ? 0 : this.volume;

    if (this.suspendTimeout !== null) {
      window.clearTimeout(this.suspendTimeout);
      this.suspendTimeout = null;
    }

    if (!muted && ctx.state === 'suspended') {
      void ctx.resume();
    }

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
    }
    if (this.waterfallAudio) {
      this.waterfallAudio.setVolume(muted ? 0 : this.volume * 1.15);
    }

    if (muted && ctx.state === 'running') {
      this.suspendTimeout = window.setTimeout(() => {
        this.suspendTimeout = null;
        if (this.listener && (!this.enabled || (this.muteOnHide && document.hidden))) {
          void this.listener.context.suspend();
        }
      }, 220);
    }
  }

  private playWaterDropChime(): void {
    if (!this.enabled || !this.listener || !this.masterGain) return;
    const ctx = this.listener.context;
    const now = ctx.currentTime;

    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0];
    const freq = pentatonic[Math.floor(Math.random() * pentatonic.length)];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.92, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.12, now + 0.09);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.48);
  }

  private playSingingBowlChime(): void {
    if (!this.enabled || !this.listener || !this.masterGain) return;
    const ctx = this.listener.context;
    const now = ctx.currentTime;

    // Warm harmonic singing bowl (fundamental + fifth + shimmer overtone)
    const partials = [
      { freq: 432.0, amp: 0.14, dur: 2.6 },
      { freq: 648.0, amp: 0.06, dur: 2.1 },
      { freq: 864.0, amp: 0.03, dur: 1.6 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(p.amp, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dur);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + p.dur + 0.05);
    }
  }

  private triggerAmbientChirp(): void {
    if (!this.enabled || !this.listener || !this.masterGain) return;
    const ctx = this.listener.context;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (this.currentWeather === 'moonlight') {
      // Soft evening cricket pulse
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(3600, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.025, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      // Gentle daytime bird trill
      const base = 1850 + Math.random() * 750;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 1.32, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(base * 0.96, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.04, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.24);
    }
  }

  update(dt: number, elapsed: number): void {
    if (!this.enabled) return;

    if (this.windFilter && this.listener) {
      this.windFilter.frequency.setTargetAtTime(
        310 + Math.sin(elapsed * 0.35) * 95,
        this.listener.context.currentTime,
        0.2,
      );
    }

    this.chirpCooldown -= dt;
    if (this.chirpCooldown <= 0) {
      this.triggerAmbientChirp();
      this.chirpCooldown = 2.6 + Math.random() * 4.5;
    }
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityBound);
    if (this.suspendTimeout !== null) {
      window.clearTimeout(this.suspendTimeout);
      this.suspendTimeout = null;
    }
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];

    if (this.waterfallAudio) {
      if (this.waterfallAudio.isPlaying) {
        this.waterfallAudio.stop();
      }
      this.waterfallAudio.disconnect();
      this.waterfallAudio = null;
    }
    if (this.waterfallAnchor) {
      this.scene.remove(this.waterfallAnchor);
      this.waterfallAnchor = null;
    }
    if (this.listener) {
      this.camera.remove(this.listener);
      void this.listener.context.close();
      this.listener = null;
    }
    this.masterGain = null;
    this.windFilter = null;
  }
}
