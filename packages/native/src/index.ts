/**
 * Where the prebuilt native parts are. In a pack made by `npm run pack` this package holds
 * `lib/<platform>-<arch>/{desktop,headless}/libtse.*` and `bin/<platform>-<arch>/{desktop,headless}/tse-host*`; in the
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
  return platform === "win32" ? "tse.dll" : platform === "darwin" ? "libtse.dylib" : "libtse.so";
}

export function hostFileName(platform: string = process.platform): string {
  return platform === "win32" ? "tse-host.exe" : "tse-host";
}

/** Where a pack puts libtse for a flavor on this platform (whether or not it is there). */
export function libraryPathIn(
  root: string,
  flavor: NativeFlavor,
  platform: string = process.platform,
  arch: string = process.arch
): string {
  return join(root, "lib", platformFolder(platform, arch), flavor, libraryFileName(platform));
}

export function hostPathIn(root: string, flavor: NativeFlavor, platform: string = process.platform, arch: string = process.arch): string {
  return join(root, "bin", platformFolder(platform, arch), flavor, hostFileName(platform));
}

/** libtse shipped in this package, or null. */
export function nativeLibrary(flavor: NativeFlavor): string | null {
  const path = libraryPathIn(NATIVE_ROOT, flavor);
  return existsSync(path) ? path : null;
}

/** `tse-host` shipped in this package, or null. */
export function nativeHost(flavor: NativeFlavor): string | null {
  const path = hostPathIn(NATIVE_ROOT, flavor);
  return existsSync(path) ? path : null;
}

/**
 * The licenses of the fonts built into libtse (`FONTS.md`), which go with libtse wherever it goes: in a pack, this package's
 * copy; in the repository, `native/FONTS.md`.
 */
export function fontLicenses(): string | null {
  for (const path of [join(NATIVE_ROOT, "FONTS.md"), join(NATIVE_ROOT, "..", "..", "native", "FONTS.md")])
    if (existsSync(path)) return path;
  return null;
}
