import type { QualityTier } from './QualityConfig';

export type WeatherMode = 'morning' | 'noon' | 'golden' | 'moonlight';

export interface EngineEventMap {
  'camera:preset': { presetId: string };
  'camera:follow': { entityId: string | null; label?: string };
  'weather:change': { mode: WeatherMode };
  'quality:change': { tier: QualityTier };
  'eco:toggle': { enabled: boolean };
  'audio:toggle': { enabled: boolean };
  'audio:volume': { volume: number };
  'audio:muteOnHide': { enabled: boolean };
  'water:ripple': { position: [number, number, number]; intensity?: number };
  'fish:summon': { position: [number, number, number] };
  'tree:shake': { position: [number, number, number] };
  'lantern:toggle': { id: number; lit?: boolean };
  'pomodoro:complete': { nextMode: 'focus' | 'break' };
  'ui:toggleHud': { visible?: boolean };
  'ui:toast': { message: string };
}

type EventHandler<T> = (payload: T) => void;

/**
 * Strongly typed Publish/Subscribe bus decoupling UI controls from 3D engine systems.
 */
export class EventBus {
  private listeners = new Map<keyof EngineEventMap, Set<EventHandler<never>>>();

  on<K extends keyof EngineEventMap>(event: K, handler: EventHandler<EngineEventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof EngineEventMap>(event: K, handler: EventHandler<EngineEventMap[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as EventHandler<never>);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit<K extends keyof EngineEventMap>(event: K, payload: EngineEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      (handler as EventHandler<EngineEventMap[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
