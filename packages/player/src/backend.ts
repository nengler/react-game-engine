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
}

/**
 * What a host (Node with koffi, the Rust + QuickJS executable, a test recorder) provides.
 * The player produces the draw records and the host executes them; see `native/include/rge.h`
 * for the record layout and the input and keys buffers.
 */
export interface Backend {
  open(config: WindowConfig): void;
  close(): void;
  /** A texture handle, or -1 if the file could not be loaded. */
  loadTexture(path: string): number;
  /** A sound handle, or -1 if the file could not be loaded. */
  loadSound(path: string): number;
  playSound(handle: number): void;
  /**
   * The width and line height in pixels of `text` drawn at `size`, for layout. Optional: without it the player
   * estimates. Both native hosts implement it (ABI v2).
   */
  measureText?(text: string, size: number): { readonly width: number; readonly height: number };
  /** The size in pixels of a loaded texture, for layout. Optional; both native hosts implement it (ABI v2). */
  textureSize?(handle: number): { readonly width: number; readonly height: number };
  /**
   * Draw and present `records[0, length)` (text records index into `texts`), then poll the
   * devices and write the next frame's input into `input` and `keys`. Blocks until vsync
   * when the window has it.
   */
  frame(clearColor: number, records: Float64Array, length: number, texts: readonly string[], input: Float64Array, keys: Uint8Array): void;
}
