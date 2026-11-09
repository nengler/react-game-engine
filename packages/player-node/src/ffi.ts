/**
 * The only file that imports koffi: it loads `librge` and declares the functions of
 * `native/include/rge.h`. Everything else in this package talks to the `Native` interface, so
 * moving to `node:ffi` (experimental in Node 26) later means changing this file alone.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { KEYS, RGE_ABI_VERSION } from "@rge/player";

/** `librge`, as plain functions. Pointer arguments are typed arrays; koffi copies them in (and, for the two output buffers, back out). */
export interface Native {
  abiVersion(): number;
  keyCount(): number;
  open(width: number, height: number, title: string, options: number): number;
  close(): void;
  loadTexture(path: string): number;
  loadSound(path: string): number;
  playSound(handle: number): void;
  frame(clearColor: number, records: Float64Array, recordsLength: number, text: Uint8Array, textOffsets: Int32Array, textCount: number, input: Float64Array, keys: Uint8Array): void;
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
 * Where `librge` is, or null. `RGE_NATIVE_LIB` wins; otherwise the CMake build folders under `native/`:
 * `build` (a real window) and `build-headless` (the software renderer, for tests). `prefer` picks which
 * is tried first.
 */
export function findNativeLibrary(prefer: BuildFlavor = "desktop", env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env["RGE_NATIVE_LIB"];
  if (fromEnv) return existsSync(fromEnv) ? resolve(fromEnv) : null;
  const folders = prefer === "desktop" ? ["build", "build-headless"] : ["build-headless", "build"];
  for (const folder of folders) {
    for (const name of libraryNames()) {
      const candidate = join(REPO_ROOT, "native", folder, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Throws if the library was built from a different `rge.h` than this package expects. */
export function checkAbi(native: Pick<Native, "abiVersion" | "keyCount">): void {
  const version = native.abiVersion();
  if (version !== RGE_ABI_VERSION) {
    throw new Error(`librge speaks ABI version ${version}, but @rge/player expects ${RGE_ABI_VERSION}: rebuild it with \`npm run native:build\`.`);
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
  const loadTexture = lib.func("int32_t rge_load_texture(const char *path)");
  const loadSound = lib.func("int32_t rge_load_sound(const char *path)");
  const playSound = lib.func("void rge_play_sound(int32_t handle)");
  const frame = lib.func(
    "void rge_frame(uint32_t clearColor, const double *records, int32_t recordsLength, const uint8_t *text, const int32_t *textOffsets, int32_t textCount, _Out_ double *input, _Out_ uint8_t *keys)",
  );
  const readPixels = lib.func("int32_t rge_read_pixels(_Out_ uint8_t *rgba, int32_t capacity)");

  const native: Native = {
    abiVersion: () => abiVersion() as number,
    keyCount: () => keyCount() as number,
    open: (width, height, title, options) => open(width, height, title, options) as number,
    close: () => void close(),
    loadTexture: (path) => loadTexture(path) as number,
    loadSound: (path) => loadSound(path) as number,
    playSound: (handle) => void playSound(handle),
    frame: (clearColor, records, recordsLength, text, textOffsets, textCount, input, keys) =>
      void frame(clearColor, records, recordsLength, text, textOffsets, textCount, input, keys),
    readPixels: (rgba, capacity) => (rgba === null ? (readPixels(null, 0) as number) : (readPixels(rgba, capacity) as number)),
  };
  checkAbi(native);
  return native;
}
