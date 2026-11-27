import GUI from 'lil-gui';
import Stats from 'stats-gl';
import type { Engine } from '../core/Engine';
import type { WeatherMode } from '../core/EventBus';
import type { QualityTier } from '../core/QualityConfig';

/**
 * Development-only profiling & live tuning panel (lil-gui + stats-gl).
 * Tree-shaken out of production builds via `import.meta.env.DEV`.
 */
export class DebugPanel {
  private gui: GUI | null = null;
  private stats: Stats | null = null;
  private unsubs: Array<() => void> = [];

  constructor(private readonly engine: Engine) {}

  init(): void {
    this.stats = new Stats({
      trackGPU: false,
      horizontal: true,
    });
    this.stats.init(this.engine.renderer);
    this.stats.dom.style.position = 'fixed';
    this.stats.dom.style.top = '74px';
    this.stats.dom.style.left = '16px';
    this.stats.dom.style.zIndex = '40';
    document.body.appendChild(this.stats.dom);

    this.gui = new GUI({ title: 'Luna World DevTools' });
    this.gui.domElement.style.top = '74px';

    const state = {
      weather: this.engine.sky.getMode(),
      quality: this.engine.getQualityProfile().tier,
      ecoMode: this.engine.isEcoMode(),
      preset: this.engine.biome.cameraPresets[0].id,
      exposure: this.engine.sky.getExposure(),
    };

    const weatherCtrl = this.gui
      .add(state, 'weather', Object.keys(this.engine.biome.weatherPresets) as WeatherMode[])
      .name('Weather')
      .onChange((mode: WeatherMode) => this.engine.bus.emit('weather:change', { mode }));

    const qualityCtrl = this.gui
      .add(state, 'quality', ['low', 'medium', 'high'] as QualityTier[])
      .name('Quality Tier')
      .onChange((tier: QualityTier) => this.engine.bus.emit('quality:change', { tier }));

    const ecoCtrl = this.gui
      .add(state, 'ecoMode')
      .name('Eco 30 FPS')
      .onChange((enabled: boolean) => this.engine.bus.emit('eco:toggle', { enabled }));

    const presetCtrl = this.gui
      .add(
        state,
        'preset',
        this.engine.biome.cameraPresets.map((p) => p.id),
      )
      .name('Camera Preset')
      .onChange((presetId: string) => this.engine.bus.emit('camera:preset', { presetId }));

    const exposureCtrl = this.gui
      .add(state, 'exposure', 0.85, 1.3, 0.01)
      .name('Exposure')
      .onChange((val: number) => {
        this.engine.sky.setExposureOverride(val);
      });

    this.unsubs.push(
      this.engine.bus.on('weather:change', ({ mode }) => {
        state.weather = mode;
        state.exposure = this.engine.sky.getExposure();
        weatherCtrl.updateDisplay();
        exposureCtrl.updateDisplay();
      }),
      this.engine.bus.on('quality:change', ({ tier }) => {
        state.quality = tier;
        qualityCtrl.updateDisplay();
      }),
      this.engine.bus.on('eco:toggle', ({ enabled }) => {
        state.ecoMode = enabled;
        ecoCtrl.updateDisplay();
      }),
      this.engine.bus.on('camera:preset', ({ presetId }) => {
        state.preset = presetId;
        presetCtrl.updateDisplay();
      }),
    );
  }

  update(): void {
    this.stats?.update();
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
    if (this.stats) {
      this.stats.dom.remove();
      this.stats = null;
    }
  }
}
