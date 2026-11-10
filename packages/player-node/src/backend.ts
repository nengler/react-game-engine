import type { Backend, WindowConfig } from "@rge/player";
import { RGE_IN_HEIGHT, RGE_IN_WIDTH, RGE_OPEN_HIDDEN, RGE_OPEN_RESIZABLE, RGE_OPEN_SMOOTH, RGE_OPEN_VSYNC } from "@rge/player";
import { findNativeLibrary, loadNative, type Native } from "./ffi.ts";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA8, top row first. */
  readonly rgba: Uint8Array;
}

/** A `Backend` over `librge`. Also reads frames back, which only a hidden window keeps. */
export class NodeBackend implements Backend {
  readonly #native: Native;
  readonly #encoder = new TextEncoder();
  #text = new Uint8Array(256);
  #offsets = new Int32Array(64);
  #width = 0;
  #height = 0;

  constructor(native: Native) {
    this.#native = native;
  }

  open(config: WindowConfig): void {
    let options = 0;
    if (config.resizable ?? true) options |= RGE_OPEN_RESIZABLE;
    if (config.vsync ?? true) options |= RGE_OPEN_VSYNC;
    if (config.hidden ?? false) options |= RGE_OPEN_HIDDEN;
    if (config.smooth ?? false) options |= RGE_OPEN_SMOOTH;
    const code = this.#native.open(config.width, config.height, config.title, options);
    if (code !== 0) throw new Error(`Could not open the window (librge error ${code}).`);
    this.#width = config.width;
    this.#height = config.height;
  }

  close(): void {
    this.#native.close();
  }

  setFullscreen(on: boolean): boolean {
    return this.#native.setFullscreen(on);
  }

  loadTexture(path: string): number {
    return this.#native.loadTexture(path);
  }

  loadSound(path: string): number {
    return this.#native.loadSound(path);
  }

  playSound(handle: number): void {
    this.#native.playSound(handle);
  }

  measureText(text: string, size: number): { width: number; height: number } {
    const measured = this.#native.measureText(text, size);
    if (measured === null) throw new Error(`librge could not measure text at size ${size}.`);
    return measured;
  }

  textureSize(handle: number): { width: number; height: number } {
    const size = this.#native.textureSize(handle);
    if (size === null) throw new Error(`librge has no texture with handle ${handle}.`);
    return size;
  }

  frame(clearColor: number, records: Float64Array, length: number, texts: readonly string[], input: Float64Array, keys: Uint8Array): void {
    const count = this.#packTexts(texts);
    this.#native.frame(clearColor, records.subarray(0, length), length, this.#text, this.#offsets, count, input, keys);
    this.#width = input[RGE_IN_WIDTH] as number;
    this.#height = input[RGE_IN_HEIGHT] as number;
  }

  /** The last presented frame, or null if the window is not hidden (nothing is captured) or no frame was drawn. */
  readPixels(): Pixels | null {
    const needed = this.#native.readPixels(null, 0);
    if (needed <= 0) return null;
    const rgba = new Uint8Array(needed);
    this.#native.readPixels(rgba, needed);
    return { width: this.#width, height: this.#height, rgba };
  }

  /** NUL-terminated UTF-8 strings back to back in `#text`, their offsets in `#offsets`. Returns the count. */
  #packTexts(texts: readonly string[]): number {
    if (this.#offsets.length < texts.length) this.#offsets = new Int32Array(Math.max(texts.length, this.#offsets.length * 2));
    let at = 0;
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i] as string;
      const room = text.length * 3 + 1; // UTF-8 takes at most 3 bytes per UTF-16 unit
      if (at + room > this.#text.length) {
        const grown = new Uint8Array(Math.max(this.#text.length * 2, at + room));
        grown.set(this.#text.subarray(0, at));
        this.#text = grown;
      }
      this.#offsets[i] = at;
      at += this.#encoder.encodeInto(text, this.#text.subarray(at)).written;
      this.#text[at++] = 0;
    }
    return texts.length;
  }
}

/** Load `librge` (see `findNativeLibrary`) and wrap it. Throws a helpful error if it has not been built. */
export function createNodeBackend(libraryPath: string | null = findNativeLibrary()): NodeBackend {
  if (libraryPath === null) {
    throw new Error("librge is not built: run `npm run native:build` (needs cmake, a C compiler and the X11/GL development packages on Linux), or set RGE_NATIVE_LIB.");
  }
  return new NodeBackend(loadNative(libraryPath));
}
