/**
 * Standard lifecycle contract for every world, AI, VFX, audio, and interaction subsystem.
 */
export interface IWorldSystem {
  readonly name: string;
  init(): void | Promise<void>;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}
