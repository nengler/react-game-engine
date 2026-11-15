/**
 * The only file that imports koffi: it loads `librge` and declares the functions of
 * `native/include/rge.h`. Everything else in this package talks to the `Native` interface, so
 * moving to `node:ffi` (experimental in Node 26) later means changing this file alone.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nativeLibrary } from "@rge/native";
import { KEYS, RGE_ABI_VERSION } from "@rge/player";
import koffi from "koffi";

/** `librge`, as plain functions. Pointer arguments are typed arrays; koffi copies them in (and, for the two output buffers, back out). */
export interface Native {
  abiVersion(): number;
  keyCount(): number;
  open(width: number, height: number, title: string, options: number): number;
  close(): void;
  /** Full screen on or off; false when librge cannot (no window, or a hidden one). */
  setFullscreen(on: boolean): boolean;
  loadTexture(path: string): number;
  loadShader(path: string): number;
  loadSound(path: string): number;
  playSound(handle: number, volume: number): void;
  loadMusic(path: string): number;
  playMusic(handle: number, volume: number, loop: boolean): void;
  setMusicVolume(handle: number, volume: number): void;
  stopMusic(handle: number): void;
  setGamepadDeadzone(deadzone: number): void;
  /** Width and line height of `text` at `size`, or null when librge cannot say (no window open). */
  measureText(text: string, size: number): { width: number; height: number } | null;
  /** Width and height of a loaded texture, or null for an invalid handle. */
  textureSize(handle: number): { width: number; height: number } | null;
  frame(
    clearColor: number,
    records: Float64Array,
    recordsLength: number,
    text: Uint8Array,
    textOffsets: Int32Array,
    textCount: number,
    input: Float64Array,
    keys: Uint8Array
  ): void;
  /** `rge_overlaps`: the pairs of the `count` boxes that overlap, into `pairs` (`capacity` pairs of room); `order` goes in and comes back sorted. Returns how many pairs there are. */
  overlaps(boxes: Float64Array, count: number, order: Int32Array, pairs: Int32Array, capacity: number): number;
  /** `rge_typed`: the characters typed in the last frame into `out` (as many as fit); returns how many there were. */
  typed(out: Uint32Array, capacity: number): number;
  /** Saved data (ABI v7), as the four `rge_storage_*` calls. `read` copies into `out` only when it fits and returns the entry's size, or -1. */
  storageOpen(gameId: string): number;
  storageRead(name: string, out: Uint8Array | null, capacity: number): number;
  storageWrite(name: string, data: Uint8Array): number;
  storageRemove(name: string): number;
  /** Copies the last captured frame (RGBA8, top row first) into `rgba` if it fits; returns the bytes needed, 0 if there is none. */
  readPixels(rgba: Uint8Array | null, capacity: number): number;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function libraryNames(): string[] {
  if (process.platform === "win32") return ["rge.dll", "Release/rge.dll", "Debug/rge.dll"];
  if (process.platform === "darwin") return ["librge.dylib"];
  return ["librge.so"];
}

export type BuildFlavor = "desktop" | "headless";

/**
 * Where `librge` is, or null. `RGE_NATIVE_LIB` wins; then the prebuilt one in `@rge/native` (an installed game has no
 * repository); otherwise the CMake build folders under `native/`: `build` (a real window) and `build-headless` (the
 * software renderer, for tests). `prefer` picks which flavor is tried first.
 */
export function findNativeLibrary(prefer: BuildFlavor = "desktop", env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env["RGE_NATIVE_LIB"];
  if (fromEnv) return existsSync(fromEnv) ? resolve(fromEnv) : null;
  const flavors: BuildFlavor[] = prefer === "desktop" ? ["desktop", "headless"] : ["headless", "desktop"];
  for (const flavor of flavors) {
    const shipped = nativeLibrary(flavor);
    if (shipped !== null) return shipped;
  }
  const folders = prefer === "desktop" ? ["build", "build-headless"] : ["build-headless", "build"];
  for (const folder of folders) {
    for (const name of libraryNames()) {
      const candidate = join(REPO_ROOT, "native", folder, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * librge of exactly one flavor, or null: the desktop build for drawing on the GPU (`rge screenshot --gpu`), where falling back to the
 * software renderer would hide what a shader or a driver does. `RGE_NATIVE_LIB` still wins.
 */
export function findNativeLibraryOf(flavor: BuildFlavor, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env["RGE_NATIVE_LIB"];
  if (fromEnv) return existsSync(fromEnv) ? resolve(fromEnv) : null;
  const shipped = nativeLibrary(flavor);
  if (shipped !== null) return shipped;
  for (const name of libraryNames()) {
    const candidate = join(REPO_ROOT, "native", flavor === "desktop" ? "build" : "build-headless", name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Throws if the library was built from a different `rge.h` than this package expects. */
export function checkAbi(native: Pick<Native, "abiVersion" | "keyCount">): void {
  const version = native.abiVersion();
  if (version !== RGE_ABI_VERSION) {
    throw new Error(
      `librge speaks ABI version ${version}, but @rge/player expects ${RGE_ABI_VERSION}: rebuild it with \`npm run native:build\`.`
    );
  }
  const keys = native.keyCount();
  if (keys !== KEYS.length) {
    throw new Error(`librge has ${keys} keys, but @rge/player expects ${KEYS.length}: rge.h and protocol.ts have drifted apart.`);
  }
}

/** Load `librge` from `path` and check that it matches this package. */
export function loadNative(path: string): Native {
  const lib = koffi.load(path);
  const abiVersion = lib.func("int32_t rge_abi_version(void)");
  const keyCount = lib.func("int32_t rge_key_count(void)");
  const open = lib.func("int32_t rge_open(int32_t width, int32_t height, const char *title, uint32_t options)");
  const close = lib.func("void rge_close(void)");
  const setFullscreen = lib.func("int32_t rge_set_fullscreen(int32_t on)");
  const loadTexture = lib.func("int32_t rge_load_texture(const char *path)");
  const loadShader = lib.func("int32_t rge_load_shader(const char *path)");
  const loadSound = lib.func("int32_t rge_load_sound(const char *path)");
  const playSound = lib.func("void rge_play_sound_ex(int32_t handle, double volume)");
  const loadMusic = lib.func("int32_t rge_load_music(const char *path)");
  const playMusic = lib.func("void rge_music_play(int32_t handle, double volume, int32_t loop)");
  const setMusicVolume = lib.func("void rge_music_set_volume(int32_t handle, double volume)");
  const stopMusic = lib.func("void rge_music_stop(int32_t handle)");
  const setGamepadDeadzone = lib.func("void rge_set_gamepad_deadzone(double deadzone)");
  const measureText = lib.func("int32_t rge_measure_text(const char *text, double size, _Out_ double *out)");
  const textureSize = lib.func("int32_t rge_texture_size(int32_t handle, _Out_ double *out)");
  const frame = lib.func(
    "void rge_frame(uint32_t clearColor, const double *records, int32_t recordsLength, const uint8_t *text, const int32_t *textOffsets, int32_t textCount, _Out_ double *input, _Out_ uint8_t *keys)"
  );
  const readPixels = lib.func("int32_t rge_read_pixels(_Out_ uint8_t *rgba, int32_t capacity)");
  const storageOpen = lib.func("int32_t rge_storage_open(const char *game_id)");
  const storageRead = lib.func("int32_t rge_storage_read(const char *name, _Out_ uint8_t *out, int32_t capacity)");
  const storageWrite = lib.func("int32_t rge_storage_write(const char *name, const uint8_t *data, int32_t length)");
  const storageRemove = lib.func("int32_t rge_storage_remove(const char *name)");
  const typed = lib.func("int32_t rge_typed(_Out_ uint32_t *out, int32_t capacity)");
  const overlaps = lib.func(
    "int32_t rge_overlaps(const double *boxes, int32_t count, _Inout_ int32_t *order, _Out_ int32_t *pairs, int32_t capacity)"
  );

  const native: Native = {
    abiVersion: () => abiVersion() as number,
    keyCount: () => keyCount() as number,
    open: (width, height, title, options) => open(width, height, title, options) as number,
    close: () => void close(),
    setFullscreen: (on) => (setFullscreen(on ? 1 : 0) as number) === 0,
    loadTexture: (path) => loadTexture(path) as number,
    loadShader: (path) => loadShader(path) as number,
    loadSound: (path) => loadSound(path) as number,
    playSound: (handle, volume) => void playSound(handle, volume),
    loadMusic: (path) => loadMusic(path) as number,
    playMusic: (handle, volume, loop) => void playMusic(handle, volume, loop ? 1 : 0),
    setMusicVolume: (handle, volume) => void setMusicVolume(handle, volume),
    stopMusic: (handle) => void stopMusic(handle),
    setGamepadDeadzone: (deadzone) => void setGamepadDeadzone(deadzone),
    measureText: (text, size) => {
      const out = new Float64Array(2);
      return (measureText(text, size, out) as number) === 0 ? { width: out[0] as number, height: out[1] as number } : null;
    },
    textureSize: (handle) => {
      const out = new Float64Array(2);
      return (textureSize(handle, out) as number) === 0 ? { width: out[0] as number, height: out[1] as number } : null;
    },
    frame: (clearColor, records, recordsLength, text, textOffsets, textCount, input, keys) =>
      void frame(clearColor, records, recordsLength, text, textOffsets, textCount, input, keys),
    storageOpen: (gameId) => storageOpen(gameId) as number,
    storageRead: (name, out, capacity) => storageRead(name, out, capacity) as number,
    storageWrite: (name, data) => storageWrite(name, data, data.length) as number,
    storageRemove: (name) => storageRemove(name) as number,
    overlaps: (boxes, count, order, pairs, capacity) => overlaps(boxes, count, order, pairs, capacity) as number,
    typed: (out, capacity) => typed(out, capacity) as number,
    readPixels: (rgba, capacity) => (rgba === null ? (readPixels(null, 0) as number) : (readPixels(rgba, capacity) as number)),
  };
  checkAbi(native);
  return native;
}
