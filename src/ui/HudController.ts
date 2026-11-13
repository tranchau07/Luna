import type { EventBus, WeatherMode } from '../core/EventBus';
import type { BiomeConfig } from '../config/BiomeConfig';
import type { QualityTier } from '../core/QualityConfig';

/**
 * Minimalist Glassmorphism Zen HUD with Pomodoro 25/5 timer, camera presets,
 * weather switcher, quality/eco toggles, ambient audio toggle, and [H] hide shortcut.
 */
export class HudController {
  private readonly root: HTMLElement;
  private readonly biome: BiomeConfig;
  private readonly bus: EventBus;

  private hudVisible = true;
  private audioEnabled = false;
  private ecoEnabled = false;
  private qualityTier: QualityTier = 'medium';
  private activeWeather: WeatherMode;
  private activePreset: string;

  // Pomodoro state (25 min focus / 5 min break)
  private pomoMode: 'focus' | 'break' = 'focus';
  private pomoSecondsLeft = 25 * 60;
  private pomoRunning = false;
  private pomoTimerId: number | null = null;

  private toastEl: HTMLElement | null = null;
  private toastTimeout: number | null = null;
  private pomoTimeEl: HTMLElement | null = null;
  private pomoModeEl: HTMLElement | null = null;
  private pomoToggleBtn: HTMLButtonElement | null = null;
  private wrapperEl: HTMLElement | null = null;

  private unsubs: Array<() => void> = [];
  private onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, biome: BiomeConfig, bus: EventBus) {
    this.root = root;
    this.biome = biome;
    this.bus = bus;
    this.activeWeather = biome.defaultWeather;
    this.activePreset = biome.cameraPresets[0]?.id ?? '';
    this.onKeyDownBound = (e) => {
      if (e.key === 'h' || e.key === 'H') {
        this.toggleHud();
      }
    };
  }

  init(): void {
    this.render();
    window.addEventListener('keydown', this.onKeyDownBound);

    this.unsubs.push(
      this.bus.on('ui:toggleHud', ({ visible }) => {
        this.hudVisible = visible ?? !this.hudVisible;
        if (this.wrapperEl) {
          this.wrapperEl.classList.toggle('hud-hidden', !this.hudVisible);
        }
      }),
      this.bus.on('ui:toast', ({ message }) => this.showToast(message)),
      this.bus.on('weather:change', ({ mode }) => {
        this.activeWeather = mode;
        this.syncActiveButtons();
      }),
      this.bus.on('camera:preset', ({ presetId }) => {
        this.activePreset = presetId;
        this.syncActiveButtons();
      }),
    );

    this.pomoTimerId = window.setInterval(() => this.tickPomodoro(), 1000);
  }

  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    if (this.wrapperEl) {
      this.wrapperEl.classList.toggle('hud-hidden', !this.hudVisible);
    }
  }

  private render(): void {
    const presetsHtml = this.biome.cameraPresets
      .map(
        (p) =>
          `<button class="pill-btn ${p.id === this.activePreset ? 'active' : ''}" data-preset="${p.id}">${p.label}</button>`,
      )
      .join('');

    const weatherModes = Object.values(this.biome.weatherPresets);
    const weatherHtml = weatherModes
      .map(
        (w) =>
          `<button class="pill-btn ${w.mode === this.activeWeather ? 'active' : ''}" data-weather="${w.mode}">${w.label}</button>`,
      )
      .join('');

    this.root.innerHTML = `
      <div class="hud-layer" id="hud-wrapper">
        <div class="hud-top">
          <div class="glass-card brand-card">
            <span class="dot-live"></span>
            <div>
              <div class="brand-title">${this.biome.name}</div>
              <div class="brand-sub">Click water for Koi • Click lantern/trees • [H] Hide UI</div>
            </div>
          </div>

          <div class="glass-card pomo-card">
            <span class="pomo-badge" id="pomo-mode">FOCUS</span>
            <span class="pomo-clock" id="pomo-time">25:00</span>
            <button class="icon-btn" id="pomo-toggle" title="Start / Pause Pomodoro">▶</button>
            <button class="icon-btn" id="pomo-reset" title="Reset Pomodoro">↺</button>
          </div>
        </div>

        <div class="hud-toast" id="hud-toast"></div>

        <div class="hud-bottom">
          <div class="glass-dock">
            <div class="dock-group" aria-label="Camera Presets">
              ${presetsHtml}
            </div>
            <div class="dock-sep"></div>
            <div class="dock-group" aria-label="Weather">
              ${weatherHtml}
            </div>
            <div class="dock-sep"></div>
            <div class="dock-group">
              <button class="pill-btn" id="btn-quality">Quality: Medium</button>
              <button class="pill-btn" id="btn-eco">Eco 30fps</button>
              <button class="pill-btn" id="btn-audio">Sound: Off</button>
              <input type="range" id="audio-vol" min="0" max="1" step="0.05" value="0.55" title="Ambient Volume" />
              <button class="pill-btn" id="btn-hide" title="Press H to restore">Hide</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.wrapperEl = this.root.querySelector('#hud-wrapper');
    this.toastEl = this.root.querySelector('#hud-toast');
    this.pomoTimeEl = this.root.querySelector('#pomo-time');
    this.pomoModeEl = this.root.querySelector('#pomo-mode');
    this.pomoToggleBtn = this.root.querySelector('#pomo-toggle');

    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset.preset!;
        this.activePreset = presetId;
        this.bus.emit('camera:preset', { presetId });
        this.syncActiveButtons();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.weather as WeatherMode;
        this.activeWeather = mode;
        this.bus.emit('weather:change', { mode });
        this.syncActiveButtons();
      });
    });

    const qualityBtn = this.root.querySelector<HTMLButtonElement>('#btn-quality');
    qualityBtn?.addEventListener('click', () => {
      const order: QualityTier[] = ['low', 'medium', 'high'];
      const next = order[(order.indexOf(this.qualityTier) + 1) % order.length];
      this.qualityTier = next;
      qualityBtn.textContent = `Quality: ${next[0].toUpperCase()}${next.slice(1)}`;
      this.bus.emit('quality:change', { tier: next });
    });

    const ecoBtn = this.root.querySelector<HTMLButtonElement>('#btn-eco');
    ecoBtn?.addEventListener('click', () => {
      this.ecoEnabled = !this.ecoEnabled;
      ecoBtn.classList.toggle('active', this.ecoEnabled);
      this.bus.emit('eco:toggle', { enabled: this.ecoEnabled });
    });

    const audioBtn = this.root.querySelector<HTMLButtonElement>('#btn-audio');
    audioBtn?.addEventListener('click', () => {
      this.audioEnabled = !this.audioEnabled;
      audioBtn.textContent = this.audioEnabled ? 'Sound: On' : 'Sound: Off';
      audioBtn.classList.toggle('active', this.audioEnabled);
      this.bus.emit('audio:toggle', { enabled: this.audioEnabled });
    });

    const volInput = this.root.querySelector<HTMLInputElement>('#audio-vol');
    volInput?.addEventListener('input', () => {
      this.bus.emit('audio:volume', { volume: Number(volInput.value) });
    });

    const hideBtn = this.root.querySelector<HTMLButtonElement>('#btn-hide');
    hideBtn?.addEventListener('click', () => this.toggleHud());

    this.pomoToggleBtn?.addEventListener('click', () => {
      this.pomoRunning = !this.pomoRunning;
      if (this.pomoToggleBtn) {
        this.pomoToggleBtn.textContent = this.pomoRunning ? '⏸' : '▶';
      }
    });

    const resetBtn = this.root.querySelector<HTMLButtonElement>('#pomo-reset');
    resetBtn?.addEventListener('click', () => {
      this.pomoRunning = false;
      this.pomoMode = 'focus';
      this.pomoSecondsLeft = 25 * 60;
      if (this.pomoToggleBtn) this.pomoToggleBtn.textContent = '▶';
      this.updatePomodoroDisplay();
    });
  }

  private syncActiveButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === this.activePreset);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.weather === this.activeWeather);
    });
  }

  private tickPomodoro(): void {
    if (!this.pomoRunning) return;
    this.pomoSecondsLeft -= 1;
    if (this.pomoSecondsLeft <= 0) {
      this.pomoMode = this.pomoMode === 'focus' ? 'break' : 'focus';
      this.pomoSecondsLeft = (this.pomoMode === 'focus' ? 25 : 5) * 60;
      this.showToast(
        this.pomoMode === 'break' ? 'Focus session complete — take a 5m break' : 'Break finished — back to focus',
      );
    }
    this.updatePomodoroDisplay();
  }

  private updatePomodoroDisplay(): void {
    if (this.pomoTimeEl) {
      const m = Math.floor(this.pomoSecondsLeft / 60);
      const s = this.pomoSecondsLeft % 60;
      this.pomoTimeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    if (this.pomoModeEl) {
      this.pomoModeEl.textContent = this.pomoMode === 'focus' ? 'FOCUS' : 'BREAK';
    }
  }

  private showToast(message: string): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = window.setTimeout(() => {
      this.toastEl?.classList.remove('visible');
    }, 2400);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    if (this.pomoTimerId !== null) {
      window.clearInterval(this.pomoTimerId);
      this.pomoTimerId = null;
    }
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.root.innerHTML = '';
  }
}
