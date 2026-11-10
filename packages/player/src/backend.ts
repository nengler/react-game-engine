/** How a host opens the window. */
export interface WindowConfig {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  /** Default true. */
  readonly resizable?: boolean;
  /** Default true. */
  readonly vsync?: boolean;
  /** No visible window, for tests and CI. Default false. */
  readonly hidden?: boolean;
  /** Bilinear texture filtering. Default false, which keeps pixel art sharp. */
  readonly smooth?: boolean;
  /** Sharp scaling of a pixel-perfect screen shown at a scale that is not a whole number (see `RGE_OPEN_SHARP`). Default false. */
  readonly sharp?: boolean;
}

/**
 * What a host (Node with koffi, the Rust + QuickJS executable, a test recorder) provides.
 * The player produces the draw records and the host executes them; see `native/include/rge.h`
 * for the record layout and the input and keys buffers.
 */
export interface Backend {
  open(config: WindowConfig): void;
  close(): void;
  /**
   * Full screen on or off (a borderless window at the desktop's size). Returns false when it cannot, for instance in a
   * hidden window. Optional: without it the full-screen key does nothing.
   */
  setFullscreen?(on: boolean): boolean;
  /** A texture handle, or -1 if the file could not be loaded. */
  loadTexture(path: string): number;
  /** A sound handle, or -1 if the file could not be loaded. */
  loadSound(path: string): number;
  /** Play a sound; `volume` is 0 to 1 (default 1). A sound played again while it still sounds plays over itself, up to four voices. */
  playSound(handle: number, volume?: number): void;
  /**
   * Music streams from its file and loops. `loadMusic` gives a handle or -1; the rest ignore -1. Optional: without it music is
   * silent (and a game's music is still counted by a recording backend). Both native hosts implement it (ABI v5).
   */
  loadMusic?(path: string): number;
  playMusic?(handle: number, volume: number, loop: boolean): void;
  setMusicVolume?(handle: number, volume: number): void;
  stopMusic?(handle: number): void;
  /** The dead zone of the gamepad's left stick for `PadLeft` and the other directions, 0 to 1 (ABI v5). */
  setGamepadDeadzone?(deadzone: number): void;
  /**
   * The width and line height in pixels of `text` drawn at `size`, for layout. Optional: without it the player
   * estimates. Both native hosts implement it (ABI v2).
   */
  measureText?(text: string, size: number): { readonly width: number; readonly height: number };
  /** The size in pixels of a loaded texture, for layout. Optional; both native hosts implement it (ABI v2). */
  textureSize?(handle: number): { readonly width: number; readonly height: number };
  /**
   * The pairs of boxes that overlap, for collisions: `boxes[0 .. count * 4)` is minX, minY, maxX, maxY for each box, all
   * finite and with an area. Each overlapping pair is written to `pairs` as two box indices, as many as fit, one first
   * index's pairs together; returns how many pairs there are, which may be more than fit. `order[0 .. count)` is the
   * caller's to keep between calls: it comes back as the box indices by minX, ties by index, and may hold anything going in.
   * Optional: without it the player sweeps in script (`CollisionTracker`), which finds the same pairs. Both native hosts
   * implement it (ABI v4), because an interpreter spends most of a busy frame's collision time there.
   */
  overlaps?(boxes: Float64Array, count: number, order: Int32Array, pairs: Int32Array): number;
  /**
   * Draw and present `records[0, length)` (text records index into `texts`), then poll the
   * devices and write the next frame's input into `input` and `keys`. Blocks until vsync
   * when the window has it.
   */
  frame(clearColor: number, records: Float64Array, length: number, texts: readonly string[], input: Float64Array, keys: Uint8Array): void;
}
