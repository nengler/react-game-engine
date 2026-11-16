import type { Backend, StorageBackend, WindowConfig } from "@tsengine/player";
import {
  TSE_IN_HEIGHT,
  TSE_IN_WIDTH,
  TSE_TYPED_MAX,
  TSE_OPEN_HIDDEN,
  TSE_OPEN_RESIZABLE,
  TSE_OPEN_HIGHDPI,
  TSE_OPEN_SHARP,
  TSE_OPEN_SMOOTH,
  TSE_OPEN_VSYNC,
} from "@tsengine/player";

import { findNativeLibrary, loadNative, type Native } from "./ffi.ts";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA8, top row first. */
  readonly rgba: Uint8Array;
}

/** A `Backend` over `libtse`. Also reads frames back, which only a hidden window keeps. */
export class NodeBackend implements Backend {
  readonly #native: Native;
  readonly #encoder = new TextEncoder();
  readonly #typed = new Uint32Array(TSE_TYPED_MAX);
  #text = new Uint8Array(256);
  #offsets = new Int32Array(64);
  #width = 0;
  #height = 0;

  constructor(native: Native) {
    this.#native = native;
  }

  /** Saved data in libtse's folder for the game (see `tse.h`): UTF-8 text, written whole and atomically. */
  readonly storage: StorageBackend = {
    open: (gameId) => this.#native.storageOpen(gameId) === 0,
    read: (name) => {
      const size = this.#native.storageRead(name, null, 0);
      if (size < 0) return null;
      const bytes = new Uint8Array(size);
      if (this.#native.storageRead(name, bytes, size) !== size) return null;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return null; // not UTF-8: not one of ours
      }
    },
    write: (name, text) => this.#native.storageWrite(name, this.#encoder.encode(text)) === 0,
    remove: (name) => void this.#native.storageRemove(name),
  };

  open(config: WindowConfig): void {
    let options = 0;
    if (config.resizable ?? true) options |= TSE_OPEN_RESIZABLE;
    if (config.vsync ?? true) options |= TSE_OPEN_VSYNC;
    if (config.hidden ?? false) options |= TSE_OPEN_HIDDEN;
    if (config.smooth ?? false) options |= TSE_OPEN_SMOOTH;
    if (config.sharp ?? false) options |= TSE_OPEN_SHARP;
    if (config.highDpi ?? !(config.hidden ?? false)) options |= TSE_OPEN_HIGHDPI;
    const code = this.#native.open(config.width, config.height, config.title, options);
    if (code !== 0) throw new Error(`Could not open the window (libtse error ${code}).`);
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

  loadShader(path: string): number {
    return this.#native.loadShader(path);
  }

  loadSound(path: string): number {
    return this.#native.loadSound(path);
  }

  playSound(handle: number, volume = 1): void {
    this.#native.playSound(handle, volume);
  }

  loadMusic(path: string): number {
    return this.#native.loadMusic(path);
  }

  playMusic(handle: number, volume: number, loop: boolean): void {
    this.#native.playMusic(handle, volume, loop);
  }

  setMusicVolume(handle: number, volume: number): void {
    this.#native.setMusicVolume(handle, volume);
  }

  stopMusic(handle: number): void {
    this.#native.stopMusic(handle);
  }

  setGamepadDeadzone(deadzone: number): void {
    this.#native.setGamepadDeadzone(deadzone);
  }

  measureText(text: string, size: number): { width: number; height: number } {
    const measured = this.#native.measureText(text, size);
    if (measured === null) throw new Error(`libtse could not measure text at size ${size}.`);
    return measured;
  }

  textureSize(handle: number): { width: number; height: number } {
    const size = this.#native.textureSize(handle);
    if (size === null) throw new Error(`libtse has no texture with handle ${handle}.`);
    return size;
  }

  overlaps(boxes: Float64Array, count: number, order: Int32Array, pairs: Int32Array): number {
    // Only what holds the boxes is handed over (koffi copies each array in, and the two it writes back out), and never more boxes than there is room for.
    const boxCount = Math.max(0, Math.min(count, Math.floor(boxes.length / 4), order.length));
    return this.#native.overlaps(
      boxes.subarray(0, boxCount * 4),
      boxCount,
      order.subarray(0, boxCount),
      pairs,
      Math.floor(pairs.length / 2)
    );
  }

  frame(clearColor: number, records: Float64Array, length: number, texts: readonly string[], input: Float64Array, keys: Uint8Array): void {
    const count = this.#packTexts(texts);
    this.#native.frame(clearColor, records.subarray(0, length), length, this.#text, this.#offsets, count, input, keys);
    this.#width = input[TSE_IN_WIDTH] as number;
    this.#height = input[TSE_IN_HEIGHT] as number;
  }

  /** What was typed in the last frame (see `Backend.typed`). */
  typed(): string {
    const count = Math.min(this.#native.typed(this.#typed, this.#typed.length), this.#typed.length);
    return count === 0 ? "" : String.fromCodePoint(...this.#typed.subarray(0, count));
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

/** Load `libtse` (see `findNativeLibrary`) and wrap it. Throws a helpful error if it has not been built. */
export function createNodeBackend(libraryPath: string | null = findNativeLibrary()): NodeBackend {
  if (libraryPath === null) {
    throw new Error(
      "libtse is not built: run `npm run native:build` (needs cmake, a C compiler and the X11/GL development packages on Linux), or set TSE_NATIVE_LIB."
    );
  }
  return new NodeBackend(loadNative(libraryPath));
}
