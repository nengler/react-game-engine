// Prints one hash of everything libtse and tse-host are built from: the C library (native/), the Rust host (host/), the script
// that builds and lays them out (tools/pack.ts) and the workflow that runs it (.github/workflows/release.yml), as git holds
// them in this checkout. The Release workflow keeps it with each release (`native-sources.txt`) and skips the platform builds
// when the latest release's is the same, taking that release's binaries.
//
//   node tools/native-sources.ts
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The paths whose tracked files decide what the binaries are. A file added under one of them changes the hash. */
export const NATIVE_SOURCES = ["native", "host", "tools/pack.ts", ".github/workflows/release.yml"] as const;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The hash: git's own, of the list of those files with each one's mode and content id. */
export function nativeSourcesHash(root: string = ROOT): string {
  const files = execFileSync("git", ["ls-files", "-s", "--", ...NATIVE_SOURCES], { cwd: root });
  if (files.length === 0) throw new Error("native-sources: git lists no native sources here");
  return execFileSync("git", ["hash-object", "--stdin"], { cwd: root, input: files }).toString().trim();
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(nativeSourcesHash());
