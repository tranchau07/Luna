import { describe, expect, it } from 'vitest';
import { validateBiomeConfig } from './BiomeConfig';
import { crystalValleyBiome } from './crystalValley.biome';
import { EventBus } from '../core/EventBus';

describe('BiomeConfig & EventBus', () => {
  it('validates crystalValleyBiome without errors', () => {
    expect(validateBiomeConfig(crystalValleyBiome)).toEqual([]);
  });

  it('rejects invalid exposure and missing presets', () => {
    const broken = structuredClone(crystalValleyBiome);
    broken.weatherPresets.noon.exposure = 2.5;
    broken.cameraPresets = [];
    const errors = validateBiomeConfig(broken);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('emits and unsubscribes typed events on EventBus', () => {
    const bus = new EventBus();
    const received: string[] = [];
    const unsub = bus.on('weather:change', ({ mode }) => received.push(mode));
    bus.emit('weather:change', { mode: 'morning' });
    unsub();
    bus.emit('weather:change', { mode: 'moonlight' });
    expect(received).toEqual(['morning']);
  });
});
