// npm run pack: write dist/packs/rge-<name>-<version>.tgz for each engine package a game outside this repository installs.
//
// The workspace exports TypeScript source ("./src/index.ts"). That works in the repository because the files are not under
// node_modules, and Node refuses to strip types from files that are (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). So a pack
// ships JavaScript and .d.ts files instead: one .js per source file (esbuild, ESM, no bundling, so the module structure and
// import.meta.url stay as they are), .d.ts from tsc, and a package.json whose exports name the built files. The workspace
// keeps exporting source; nothing here changes how Kite, Hearth or the tests run.
//
//   node tools/pack.ts [--out <dir>] [--build] [package ...]     (default: dist/packs, every package below)
//   --build builds librge and rge-host first (headless always, desktop if it can); without it, @rge/native ships what is built.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The packages a game installs. `native` and `cli` join them in M0.2 and M0.3. */
export const PACKABLE = ["runtime", "compiler", "player", "native", "player-node", "cli"] as const;

type Flavor = "desktop" | "headless";
const platform = `${process.platform}-${process.arch}`;
const libName = process.platform === "win32" ? "rge.dll" : process.platform === "darwin" ? "librge.dylib" : "librge.so";
const hostName = process.platform === "win32" ? "rge-host.exe" : "rge-host";

/** Where the CMake and cargo builds put librge and rge-host for a flavor. */
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

/**
 * Build librge and rge-host for a flavor from the repository's CMake and cargo setups. The headless flavor (raylib's
 * software renderer: no window, no GPU, no system libraries) is what CI and `rge package --headless` need; the desktop
 * one needs the platform's windowing libraries, so a failure there is a warning, not an error.
 */
export function buildNative(flavor: Flavor): void {
  const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void => {
    execFileSync(command, args, { cwd: ROOT, stdio: "inherit", env });
  };
  const folder = flavor === "headless" ? "native/build-headless" : "native/build";
  run("cmake", ["-S", "native", "-B", folder, ...(flavor === "headless" ? ["-DRGE_PLATFORM=Memory"] : [])]);
  run("cmake", ["--build", folder, "-j", "--target", "rge"]);
  const cargo = ["build", "--release", "--manifest-path", "host/Cargo.toml", ...(flavor === "headless" ? ["--features", "headless"] : [])];
  run("cargo", cargo, flavor === "headless" ? { ...process.env, CARGO_TARGET_DIR: join(ROOT, "host/target-headless") } : process.env);
}

/** Copy the built librge and rge-host for each flavor that exists into the staged `@rge/native`. Returns what it shipped. */
function addBinaries(stage: string): string[] {
  const shipped: string[] = [];
  for (const flavor of ["desktop", "headless"] as const) {
    const lib = find(BUILDS[flavor].lib, libName);
    // host/target/release is whatever `cargo build` last built there (a headless build, if `host:build:headless` ran last), so
    // it only counts as the desktop host when a desktop librge exists too.
    // Conversely a headless host may be there (`host:build:headless`) with no desktop librge, so it is shipped as the headless one.
    const desktopLib = find(BUILDS.desktop.lib, libName);
    const candidates = flavor === "headless" ? [BUILDS.headless.host, ...(desktopLib === null ? [BUILDS.desktop.host] : [])] : [BUILDS.desktop.host];
    const host = flavor === "desktop" && lib === null ? null : find(candidates, hostName);
    for (const [kind, from, name] of [["lib", lib, libName], ["bin", host, hostName]] as const) {
      if (from === null) continue;
      const to = join(stage, kind, platform, flavor, name);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
      chmodSync(to, 0o755);
      shipped.push(`${kind}/${platform}/${flavor}/${name}`);
    }
  }
  return shipped;
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

export function stagePackage(name: string, staging: string): string {
  const source = join(ROOT, "packages", name);
  const pkg = readJson(join(source, "package.json"));
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
    type: "module",
    exports: mapExports(pkg.exports),
    dependencies: pkg.dependencies,
  };
  if (pkg.bin) {
    built.bin = Object.fromEntries(
      Object.entries(pkg.bin as Record<string, string>).map(([bin, file]) => [bin, builtPath(file, ".js")]),
    );
  }
  built.files = name === "native" ? ["dist", "lib", "bin"] : name === "cli" ? ["dist", "template"] : ["dist"];
  if (name === "cli") cpSync(join(source, "template"), join(stage, "template"), { recursive: true });
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(built, null, 2)}\n`);
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
    }),
  );
  const tsc = join(ROOT, "node_modules/.bin/tsc");
  try {
    execFileSync(tsc, ["-p", tsconfig], { stdio: "pipe", cwd: ROOT });
  } finally {
    rmSync(tsconfig, { force: true });
  }
}

export function packAll(outDir: string, names: readonly string[] = PACKABLE): string[] {
  const staging = mkdtempSync(join(tmpdir(), "rge-pack-"));
  mkdirSync(outDir, { recursive: true });
  const tarballs: string[] = [];
  try {
    for (const name of names) {
      const stage = stagePackage(name, staging);
      if (name === "native") {
        const shipped = addBinaries(stage);
        if (!shipped.some((file) => file.startsWith("lib/") && file.includes("/headless/"))) {
          console.warn("pack: no headless librge found; run with --build (or npm run native:build:headless) first");
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
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--out") out = resolve(args[++i] ?? "");
    else if (arg === "--build") build = true;
    else names.push(arg);
  }
  const chosen = names.length > 0 ? names : [...PACKABLE];
  for (const name of chosen) {
    if (!existsSync(join(ROOT, "packages", name, "package.json"))) {
      console.error(`pack: no package named ${name}`);
      process.exit(2);
    }
  }
  if (build) {
    buildNative("headless");
    try {
      buildNative("desktop");
    } catch {
      console.warn("pack: the desktop build failed (it needs the platform's window libraries); packing the headless one only");
    }
  }
  for (const tarball of packAll(out, chosen)) console.log(relative(ROOT, tarball));
}
