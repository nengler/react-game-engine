// npm run pack: write dist/packs/tsengine-<name>-<version>.tgz for each engine package a game outside this repository installs.
//
// The workspace exports TypeScript source ("./src/index.ts"). That works in the repository because the files are not under
// node_modules, and Node refuses to strip types from files that are (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). So a pack
// ships JavaScript and .d.ts files instead: one .js per source file (esbuild, ESM, no bundling, so the module structure and
// import.meta.url stay as they are), .d.ts from tsc, and a package.json whose exports name the built files. The workspace
// keeps exporting source; nothing here changes how Kite, Hearth or the tests run.
//
//   node tools/pack.ts [--out <dir>] [--build [--strict]] [--version <x.y.z>] [--native-from <dir>]... [--platforms <list>] [package ...]
//                                                                                    (default: dist/packs, every package below)
//   --build builds libtse and tse-host first (headless always, desktop if it can); without it, @tsengine/native ships what is built.
//     It builds what this machine can: without cmake there is no libtse, without cargo no tse-host, and a build that fails is a
//     warning. It ends by saying what the packs let you do and what to install for the rest. --strict makes any failure an error,
//     the desktop build's included.
//   --native-out <dir> writes this machine's built binaries to <dir> as @tsengine/native lays them out (lib/<platform>-<arch>/…,
//     bin/…) and packs nothing: what each runner of the release workflow's platform matrix uploads.
//   --native-from <dir> adds the binaries in <dir> (that same layout, from other machines) to @tsengine/native; it may be given
//     more than once. --platforms linux-x64,darwin-arm64,… makes a pack lacking any of the four binaries of a listed platform an error.
//   --version stamps the packs with a release's version: each package's own, and its dependencies on the other @tsengine packages,
//     so a game that installs one release's tarballs gets that release throughout (.github/workflows/release.yml uses it).
//   npm run dist is `--build`: from a fresh checkout, `npm install && npm run dist` is all a game outside the repository needs.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { transformSync } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The packages a game installs. `native` and `cli` join them in M0.2 and M0.3; `testing` (a game's tests) with A8; `language-server`
 * (`tse lsp`, which the command line depends on) with D2; `player-web` (the browser backend `tse package --engine web` bundles) with the web build.
 */
export const PACKABLE = [
  "runtime",
  "compiler",
  "player",
  "native",
  "player-node",
  "player-web",
  "testing",
  "language-server",
  "cli",
] as const;

type Flavor = "desktop" | "headless";
const platform = `${process.platform}-${process.arch}`;
const libName = process.platform === "win32" ? "tse.dll" : process.platform === "darwin" ? "libtse.dylib" : "libtse.so";
const hostName = process.platform === "win32" ? "tse-host.exe" : "tse-host";

/** Where the CMake and cargo builds put libtse and tse-host for a flavor. */
const BUILDS: Record<Flavor, { lib: string[]; host: string }> = {
  desktop: { lib: ["native/build"], host: "host/target/release" },
  headless: { lib: ["native/build-headless"], host: "host/target-headless/release" },
};

function find(candidates: string[], file: string): string | null {
  for (const dir of candidates) {
    for (const sub of ["", "Release"]) {
      const path = join(ROOT, dir, sub, file);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/** The tools a build needs that a machine may lack: cmake (and a C compiler) for libtse, cargo for tse-host. */
export interface BuildTools {
  readonly cmake: boolean;
  readonly cargo: boolean;
}

/** Which build tools this machine has, found by running each one. */
export function probeTools(): BuildTools {
  const has = (command: string): boolean => {
    try {
      execFileSync(command, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  return { cmake: has("cmake"), cargo: has("cargo") };
}

/**
 * Build libtse and tse-host for a flavor from the repository's CMake and cargo setups, whichever of the two `tools` has. The
 * headless flavor (raylib's software renderer: no window, no GPU, no system libraries) is what CI and `tse package --headless`
 * need; the desktop one needs the platform's windowing libraries, so a failure there is a warning, not an error.
 */
export function buildNative(flavor: Flavor, tools: BuildTools = { cmake: true, cargo: true }): void {
  const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void => {
    execFileSync(command, args, { cwd: ROOT, stdio: "inherit", env });
  };
  if (tools.cmake) {
    const folder = flavor === "headless" ? "native/build-headless" : "native/build";
    run("cmake", ["-S", "native", "-B", folder, ...(flavor === "headless" ? ["-DTSE_PLATFORM=Memory"] : [])]);
    // --config Release: a multi-config generator (Visual Studio, Xcode) builds Debug otherwise; single-config ones ignore it.
    run("cmake", ["--build", folder, "-j", "--config", "Release", "--target", "tse"]);
  }
  if (tools.cargo) {
    const cargo = [
      "build",
      "--release",
      "--manifest-path",
      "host/Cargo.toml",
      ...(flavor === "headless" ? ["--features", "headless"] : []),
    ];
    run("cargo", cargo, flavor === "headless" ? { ...process.env, CARGO_TARGET_DIR: join(ROOT, "host/target-headless") } : process.env);
  }
}

/** The windowing libraries the desktop libtse is built against, for the hint about a missing window. */
const WINDOW_LIBRARIES = "libx11-dev libxrandr-dev libxi-dev libxcursor-dev libxinerama-dev libgl1-mesa-dev";

/**
 * What the packs let an author do, and what to install for the rest, as lines for the end of `--build`. `shipped` is what
 * `@tsengine/native` holds (`lib/<platform>/<flavor>/…`, `bin/…`); `tools` is what the machine has.
 */
export function setupNotes(shipped: readonly string[], tools: BuildTools): string[] {
  const has = (kind: string, flavor: string): boolean =>
    shipped.some((file) => file.startsWith(`${kind}/`) && file.includes(`/${flavor}/`));
  const lines = ["Write, test and check games: ready. `tse create` and `tse check` need only Node."];
  if (has("lib", "desktop")) lines.push("A window (`tse dev`): ready.");
  else
    lines.push(
      "A window (`tse dev`): not built. It needs the platform's windowing libraries (Debian or Ubuntu: sudo apt install " +
        WINDOW_LIBRARIES +
        "), then `npm run dist` again."
    );
  if (has("lib", "headless")) lines.push("Screenshots and `tse package --headless`: ready.");
  else {
    const why = tools.cmake ? "the build failed (see above; it needs a C compiler)" : "cmake was not found";
    lines.push(
      "Screenshots and `tse package`: no libtse, because " +
        why +
        ". Install cmake and a C compiler (Debian or Ubuntu: sudo apt install build-essential cmake; macOS: xcode-select --install and brew install cmake), then `npm run dist` again."
    );
  }
  if (shipped.some((file) => file.startsWith("bin/")))
    lines.push("`tse package --engine quickjs`, and `tse check` against the Rust host: ready.");
  else {
    const why = tools.cargo ? "the build failed (see above)" : "cargo was not found";
    lines.push(
      "`tse package --engine quickjs`, and `tse check` against the Rust host: no tse-host, because " +
        why +
        ". Install Rust (https://rustup.rs), then `npm run dist` again. Until then `tse check` compares against Node only."
    );
  }
  return lines;
}

/** What is built and would ship in `@tsengine/native`: `lib/<platform>/<flavor>/<name>` and `bin/…`, with where each is built. */
function builtBinaries(): { readonly path: string; readonly from: string }[] {
  const found: { path: string; from: string }[] = [];
  for (const flavor of ["desktop", "headless"] as const) {
    const lib = find(BUILDS[flavor].lib, libName);
    // host/target/release is whatever `cargo build` last built there (a headless build, if `host:build:headless` ran last), so
    // it only counts as the desktop host when a desktop libtse exists too.
    // Conversely a headless host may be there (`host:build:headless`) with no desktop libtse, so it is shipped as the headless one.
    const desktopLib = find(BUILDS.desktop.lib, libName);
    const candidates =
      flavor === "headless" ? [BUILDS.headless.host, ...(desktopLib === null ? [BUILDS.desktop.host] : [])] : [BUILDS.desktop.host];
    const host = flavor === "desktop" && lib === null ? null : find(candidates, hostName);
    for (const [kind, from, name] of [
      ["lib", lib, libName],
      ["bin", host, hostName],
    ] as const) {
      if (from !== null) found.push({ path: `${kind}/${platform}/${flavor}/${name}`, from });
    }
  }
  return found;
}

/** The file names of libtse and tse-host on a platform folder (`win32-x64`), as `@tsengine/native` looks them up. */
function binaryNames(platformFolder: string): { readonly lib: string; readonly bin: string } {
  const os = platformFolder.split("-")[0];
  return {
    lib: os === "win32" ? "tse.dll" : os === "darwin" ? "libtse.dylib" : "libtse.so",
    bin: os === "win32" ? "tse-host.exe" : "tse-host",
  };
}

/**
 * What is wrong with a set of `@tsengine/native` files (paths like `lib/linux-x64/headless/libtse.so`): a path that is not a
 * binary where the package looks for one, and each of the four binaries (libtse and tse-host, desktop and headless) missing
 * for a platform in `platforms`. Empty when all is well.
 */
export function nativeProblems(files: readonly string[], platforms: readonly string[] = []): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const match = /^(lib|bin)\/([a-z0-9]+-[a-z0-9]+)\/(desktop|headless)\/([^/]+)$/.exec(file);
    const names = match ? binaryNames(match[2] as string) : null;
    if (!match || !names || match[4] !== (match[1] === "lib" ? names.lib : names.bin))
      problems.push(`${file}: not where @tsengine/native looks for a binary`);
  }
  for (const platformFolder of platforms) {
    const names = binaryNames(platformFolder);
    for (const flavor of ["desktop", "headless"])
      for (const path of [`lib/${platformFolder}/${flavor}/${names.lib}`, `bin/${platformFolder}/${flavor}/${names.bin}`])
        if (!files.includes(path)) problems.push(`${path}: missing`);
  }
  return problems;
}

/** Every file under `dir`, as a path relative to it with forward slashes. */
function filesUnder(dir: string): string[] {
  return walk(dir).map((file) => relative(dir, file).split(/[\\/]/).join("/"));
}

/** Copy one binary into place, executable. */
function copyBinary(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  chmodSync(to, 0o755);
}

/**
 * Copy the built libtse and tse-host for each flavor that exists into `stage` (the staged `@tsengine/native`, or the folder of
 * `--native-out`), and then the binaries under each of `from` (`--native-from`). Returns what it shipped.
 */
function addBinaries(stage: string, from: readonly string[] = []): string[] {
  const shipped = new Set<string>();
  for (const { path, from: source } of builtBinaries()) {
    copyBinary(source, join(stage, path));
    shipped.add(path);
  }
  for (const dir of from) {
    const files = filesUnder(dir);
    const problems = nativeProblems(files);
    if (problems.length > 0) throw new Error(`pack: --native-from ${dir}:\n  ${problems.join("\n  ")}`);
    for (const file of files) {
      copyBinary(join(dir, file), join(stage, file));
      shipped.add(file);
    }
  }
  return [...shipped].sort();
}

/** Where the binaries of `@tsengine/native` come from, besides this machine's builds, and which platforms it must have. */
export interface NativeSources {
  readonly from?: readonly string[];
  readonly platforms?: readonly string[];
}

type Json = Record<string, unknown>;

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** `./foo.ts` -> `./foo.js` in import/export specifiers and dynamic imports, relative specifiers only. */
export function rewriteSpecifiers(js: string): string {
  return js.replace(/(\b(?:from|import)\s*\(?\s*)(["'])(\.{1,2}\/[^"']*?)\.tsx?\2/g, "$1$2$3.js$2");
}

/** `./src/index.ts` -> `./dist/index.js` (the declaration goes beside it with `.d.ts`). */
function builtPath(source: string, ext: ".js" | ".d.ts"): string {
  return source.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ext);
}

function mapExports(exports: unknown): unknown {
  if (typeof exports === "string") return { types: builtPath(exports, ".d.ts"), default: builtPath(exports, ".js") };
  if (exports && typeof exports === "object") {
    return Object.fromEntries(Object.entries(exports).map(([key, value]) => [key, mapExports(value)]));
  }
  return exports;
}

/**
 * A package.json with `version` set, and its dependencies on other `@tsengine/*` packages pinned to the same version. Without a
 * version it is returned as it is (every workspace package is 0.0.0).
 */
export function stampVersion(pkg: Json, version: string | undefined): Json {
  if (version === undefined) return pkg;
  const deps = pkg.dependencies as Record<string, string> | undefined;
  return {
    ...pkg,
    version,
    ...(deps && {
      dependencies: Object.fromEntries(Object.entries(deps).map(([dep, range]) => [dep, dep.startsWith("@tsengine/") ? version : range])),
    }),
  };
}

export function stagePackage(name: string, staging: string, version?: string): string {
  const source = join(ROOT, "packages", name);
  const pkg = stampVersion(readJson(join(source, "package.json")), version);
  const stage = join(staging, name);
  const src = join(source, "src");
  mkdirSync(join(stage, "dist"), { recursive: true });

  for (const file of walk(src)) {
    if (!/\.tsx?$/.test(file)) {
      // Data files that sit beside the source (none today) are copied as they are.
      const target = join(stage, "dist", relative(src, file));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(file, target);
      continue;
    }
    if (file.endsWith(".d.ts")) continue;
    const out = transformSync(readFileSync(file, "utf8"), {
      loader: file.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: "es2022",
      sourcefile: relative(source, file),
      // Keep what the file says: no helper rewrites, no minifying, so a stack trace reads like the source.
      keepNames: false,
      minify: false,
    });
    const target = join(stage, "dist", relative(src, file).replace(/\.tsx?$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, rewriteSpecifiers(out.code));
  }

  emitDeclarations(name, stage);

  const built: Json = {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    // Where it is built from: npm's provenance check compares this with the repository the release workflow ran in.
    repository: { type: "git", url: "git+https://github.com/nengler/tse.git", directory: `packages/${name}` },
    // A scoped package is private on npm unless it says otherwise.
    publishConfig: { access: "public" },
    type: "module",
    exports: mapExports(pkg.exports),
    dependencies: pkg.dependencies,
  };
  if (pkg.bin) {
    built.bin = Object.fromEntries(Object.entries(pkg.bin as Record<string, string>).map(([bin, file]) => [bin, builtPath(file, ".js")]));
  }
  built.files = name === "native" ? ["dist", "lib", "bin", "FONTS.md"] : name === "cli" ? ["dist", "template", "templates"] : ["dist"];
  if (name === "cli") {
    cpSync(join(source, "template"), join(stage, "template"), { recursive: true });
    cpSync(join(source, "templates"), join(stage, "templates"), { recursive: true });
  }
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(built, null, 2)}\n`);
  // The engine's license goes with every pack (npm includes a LICENSE file at a package's root).
  cpSync(join(ROOT, "LICENSE"), join(stage, "LICENSE"));
  // libtse holds fonts under their own licenses, which go where it goes (`fontLicenses()` in @tsengine/native finds them).
  if (name === "native") cpSync(join(ROOT, "native", "FONTS.md"), join(stage, "FONTS.md"));
  return stage;
}

/** `.d.ts` files from tsc into `<stage>/dist`, with `.ts` specifiers rewritten the way the `.js` files are. */
function emitDeclarations(name: string, stage: string): void {
  const source = join(ROOT, "packages", name);
  const tsconfig = join(stage, "tsconfig.pack.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        allowImportingTsExtensions: true,
        rewriteRelativeImportExtensions: true,
        erasableSyntaxOnly: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        noUncheckedIndexedAccess: true,
        types: ["node"],
        typeRoots: [join(ROOT, "node_modules/@types")],
        rootDir: join(source, "src"),
        outDir: join(stage, "dist"),
      },
      include: [join(source, "src")],
    })
  );
  const tsc = join(ROOT, "node_modules/.bin/tsc");
  try {
    execFileSync(tsc, ["-p", tsconfig], { stdio: "pipe", cwd: ROOT });
  } finally {
    rmSync(tsconfig, { force: true });
  }
}

export function packAll(outDir: string, names: readonly string[] = PACKABLE, version?: string, native: NativeSources = {}): string[] {
  const staging = mkdtempSync(join(tmpdir(), "tse-pack-"));
  mkdirSync(outDir, { recursive: true });
  const tarballs: string[] = [];
  try {
    for (const name of names) {
      const stage = stagePackage(name, staging, version);
      if (name === "native") {
        const shipped = addBinaries(stage, native.from);
        const problems = nativeProblems(shipped, native.platforms);
        if (problems.length > 0) throw new Error(`pack: @tsengine/native is incomplete:\n  ${problems.join("\n  ")}`);
        if (!shipped.some((file) => file.startsWith("lib/") && file.includes("/headless/"))) {
          console.warn("pack: no headless libtse found; run with --build (or npm run native:build:headless) first");
        }
      }
      const printed = execFileSync("npm", ["pack", "--json", "--pack-destination", outDir, "--silent"], {
        cwd: stage,
        encoding: "utf8",
      });
      const [info] = JSON.parse(printed) as { filename: string }[];
      if (!info) throw new Error(`npm pack printed nothing for ${name}`);
      tarballs.push(join(outDir, info.filename));
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return tarballs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let out = join(ROOT, "dist", "packs");
  const names: string[] = [];
  let build = false;
  let strict = false;
  let version: string | undefined;
  let nativeOut: string | undefined;
  const nativeFrom: string[] = [];
  let platforms: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--out") out = resolve(args[++i] ?? "");
    else if (arg === "--native-out") nativeOut = resolve(args[++i] ?? "");
    else if (arg === "--native-from") nativeFrom.push(resolve(args[++i] ?? ""));
    else if (arg === "--platforms") platforms = (args[++i] ?? "").split(",").filter(Boolean);
    else if (arg === "--build") build = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "--version") version = args[++i] ?? "";
    else names.push(arg);
  }
  if (version !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`pack: --version wants a version like 0.1.0, not "${version}"`);
    process.exit(2);
  }
  const chosen = names.length > 0 ? names : [...PACKABLE];
  for (const name of chosen) {
    if (!existsSync(join(ROOT, "packages", name, "package.json"))) {
      console.error(`pack: no package named ${name}`);
      process.exit(2);
    }
  }
  const tools = build ? probeTools() : { cmake: true, cargo: true };
  if (build) {
    // Build what this machine can, and keep going when a piece fails: the packs without a libtse still write and check games.
    // --strict is for CI, where a missing piece is an error.
    const attempt = (what: string, run: () => void): void => {
      try {
        run();
      } catch (error) {
        if (strict) throw error;
        console.warn(`pack: ${what} failed; packing without it (see above)`);
      }
    };
    if (strict && !(tools.cmake && tools.cargo)) {
      console.error(`pack --strict: ${[!tools.cmake && "cmake", !tools.cargo && "cargo"].filter(Boolean).join(" and ")} not found`);
      process.exit(1);
    }
    attempt("the headless build", () => buildNative("headless", tools));
    try {
      buildNative("desktop", tools);
    } catch (error) {
      if (strict) throw error;
      console.warn("pack: the desktop build failed (it needs the platform's window libraries); packing the headless one only");
    }
  }
  if (nativeOut !== undefined) {
    const written = addBinaries(nativeOut);
    for (const path of written) console.log(path);
    const problems = nativeProblems(written, strict ? [platform] : []);
    if (problems.length > 0) {
      console.error(`pack --native-out:\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    process.exit(0);
  }
  const tarballs = packAll(out, chosen, version, { from: nativeFrom, platforms });
  for (const tarball of tarballs) console.log(relative(ROOT, tarball));
  if (build) {
    console.log("");
    for (const line of setupNotes(
      builtBinaries().map((b) => b.path),
      tools
    ))
      console.log(line);
    console.log(`\nNext: node packages/cli/src/cli.ts create ~/my-game --packs ${relative(process.cwd(), out) || "."}`);
  }
}
