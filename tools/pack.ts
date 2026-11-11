// npm run pack: write dist/packs/rge-<name>-<version>.tgz for each engine package a game outside this repository installs.
//
// The workspace exports TypeScript source ("./src/index.ts"). That works in the repository because the files are not under
// node_modules, and Node refuses to strip types from files that are (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). So a pack
// ships JavaScript and .d.ts files instead: one .js per source file (esbuild, ESM, no bundling, so the module structure and
// import.meta.url stay as they are), .d.ts from tsc, and a package.json whose exports name the built files. The workspace
// keeps exporting source; nothing here changes how Kite, Hearth or the tests run.
//
//   node tools/pack.ts [--out <dir>] [package ...]     (default: dist/packs, every package below)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The packages a game installs. `native` and `cli` join them in M0.2 and M0.3. */
export const PACKABLE = ["runtime", "compiler", "player", "player-node"] as const;

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
  built.files = ["dist"];
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
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--out") out = resolve(args[++i] ?? "");
    else names.push(arg);
  }
  const chosen = names.length > 0 ? names : [...PACKABLE];
  for (const name of chosen) {
    if (!existsSync(join(ROOT, "packages", name, "package.json"))) {
      console.error(`pack: no package named ${name}`);
      process.exit(2);
    }
  }
  for (const tarball of packAll(out, chosen)) console.log(relative(ROOT, tarball));
}
