/**
 * Where the prebuilt native parts are. In a pack made by `npm run pack` this package holds
 * `lib/<platform>-<arch>/{desktop,headless}/librge.*` and `bin/<platform>-<arch>/{desktop,headless}/rge-host*`; in the
 * repository's workspace it holds nothing, and every lookup answers null (the callers then look in the CMake and cargo
 * build folders, as they always did).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type NativeFlavor = "desktop" | "headless";

/** The package's own folder: `src/` and `dist/` are both one level below it. */
export const NATIVE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `linux-x64`: the folder name for a platform under `lib/` and `bin/`. */
export function platformFolder(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

export function libraryFileName(platform: string = process.platform): string {
  return platform === "win32" ? "rge.dll" : platform === "darwin" ? "librge.dylib" : "librge.so";
}

export function hostFileName(platform: string = process.platform): string {
  return platform === "win32" ? "rge-host.exe" : "rge-host";
}

/** Where a pack puts librge for a flavor on this platform (whether or not it is there). */
export function libraryPathIn(root: string, flavor: NativeFlavor, platform: string = process.platform, arch: string = process.arch): string {
  return join(root, "lib", platformFolder(platform, arch), flavor, libraryFileName(platform));
}

export function hostPathIn(root: string, flavor: NativeFlavor, platform: string = process.platform, arch: string = process.arch): string {
  return join(root, "bin", platformFolder(platform, arch), flavor, hostFileName(platform));
}

/** librge shipped in this package, or null. */
export function nativeLibrary(flavor: NativeFlavor): string | null {
  const path = libraryPathIn(NATIVE_ROOT, flavor);
  return existsSync(path) ? path : null;
}

/** `rge-host` shipped in this package, or null. */
export function nativeHost(flavor: NativeFlavor): string | null {
  const path = hostPathIn(NATIVE_ROOT, flavor);
  return existsSync(path) ? path : null;
}
