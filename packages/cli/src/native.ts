/** Finding librge and rge-host for a flavor: an environment variable, then @rge/native, then this repository's builds. */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hostFileName, libraryFileName, nativeHost, nativeLibrary, type NativeFlavor } from "@rge/native";

export type { NativeFlavor };

/** The repository root when this package runs from a checkout; the folders below simply do not exist otherwise. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function firstExisting(paths: readonly string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

export function findLibrary(flavor: NativeFlavor, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env["RGE_NATIVE_LIB"];
  if (fromEnv) return existsSync(fromEnv) ? resolve(fromEnv) : null;
  const name = libraryFileName();
  const folder = flavor === "headless" ? "build-headless" : "build";
  return nativeLibrary(flavor) ?? firstExisting([join(REPO, "native", folder, name), join(REPO, "native", folder, "Release", name)]);
}

export function findHost(flavor: NativeFlavor, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env["RGE_HOST_BIN"];
  if (fromEnv) return existsSync(fromEnv) ? resolve(fromEnv) : null;
  const name = hostFileName();
  // host/target/release is whatever `cargo build` last built there; host/target-headless is what `npm run pack --build` builds.
  const repo =
    flavor === "headless"
      ? [join(REPO, "host/target-headless/release", name), join(REPO, "host/target/release", name)]
      : [join(REPO, "host/target/release", name)];
  return nativeHost(flavor) ?? firstExisting(repo);
}
