#!/usr/bin/env node
/**
 * Usage: rge-compile <srcDir> <outDir> [--runtime <module>] [--no-check] [--scenes <dir>]
 * Type-checks every .tsx file in srcDir (imports from the authoring module,
 * prop types, hook arguments), compiles each to a .ts file in outDir, writes
 * the IR next to it as .ir.json, then type-checks the output. `--no-check`
 * skips both type-checks.
 *
 * It also writes `prefabs.ts` (every exported component, for `loadScene`) and
 * `prefabs.json` (their props, as data) to outDir, and checks across files:
 * exported names are unique and no component statically contains itself.
 *
 * `--scenes <dir>` validates every scene (.json) in the directory against
 * those prefabs, and imports every Tiled map (.tmj) to
 * `<outDir>/scenes/<name>.scene.json` and validates that.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  Compiler,
  checkProject,
  formatDiagnostic,
  generatedFileName,
  importTiled,
  prefabsIndexSource,
  prefabsJson,
  projectSchemas,
  type CompilerDiagnostic,
  type ProjectModule,
  type VirtualFile,
} from "./index.ts";

function main(argv: readonly string[]): number {
  const positional: string[] = [];
  let runtimeModule: string | undefined;
  let check = true;
  let scenesDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--runtime") runtimeModule = argv[++i];
    else if (arg === "--scenes") scenesDir = argv[++i];
    else if (arg === "--no-check") check = false;
    else positional.push(arg);
  }
  const [srcDir, outDir] = positional;
  if (!srcDir || !outDir) {
    console.error("usage: rge-compile <srcDir> <outDir> [--runtime <module>] [--no-check] [--scenes <dir>]");
    return 2;
  }

  const compiler = new Compiler(runtimeModule ? { runtimeModule } : {});
  const diagnostics: CompilerDiagnostic[] = [];
  const outputs: VirtualFile[] = [];
  const modules: ProjectModule[] = [];
  try {
    mkdirSync(outDir, { recursive: true });
    const sourceNames = readdirSync(srcDir).filter((f) => f.endsWith(".tsx")).sort();
    if (check && sourceNames.length > 0) {
      diagnostics.push(
        ...compiler.typeCheckSources(sourceNames.map((name) => {
          const sourcePath = resolve(srcDir, name);
          return { fileName: sourcePath, text: readFileSync(sourcePath, "utf8") };
        })),
      );
    }
    for (const name of sourceNames) {
      const sourcePath = resolve(srcDir, name);
      // Use a cwd-relative name so generated headers and IR spans are machine-independent.
      const result = compiler.compile(relative(process.cwd(), sourcePath), readFileSync(sourcePath, "utf8"));
      diagnostics.push(...result.diagnostics);
      if (!result.ok) continue;
      const outPath = resolve(outDir, generatedFileName(name));
      const code = result.code;
      writeFileSync(outPath, code);
      writeFileSync(join(outDir, name.replace(/\.tsx$/, ".ir.json")), JSON.stringify(result.ir, null, 2) + "\n");
      outputs.push({ fileName: outPath, text: code });
      modules.push({ ir: result.ir, generatedName: generatedFileName(name) });
      console.log(`compiled ${name} -> ${outPath}`);
    }
    diagnostics.push(...checkProject(modules));
    if (modules.length > 0) {
      const registryPath = resolve(outDir, "prefabs.ts");
      const registry = prefabsIndexSource(modules);
      writeFileSync(registryPath, registry);
      writeFileSync(join(outDir, "prefabs.json"), prefabsJson(modules));
      outputs.push({ fileName: registryPath, text: registry });
      const count = projectSchemas(modules).size;
      console.log(`wrote prefabs.ts and prefabs.json (${count} prefab${count === 1 ? "" : "s"})`);
    }
    if (check && outputs.length > 0) diagnostics.push(...compiler.typeCheck(outputs));
    if (scenesDir !== undefined) {
      if (diagnostics.some((d) => d.severity === "error")) console.error("skipped scene validation: fix the errors above first (scenes are checked against the compiled prefabs)");
      else diagnostics.push(...checkScenes(compiler, scenesDir, outDir, projectSchemas(modules)));
    }
  } finally {
    compiler.close();
  }
  for (const d of diagnostics) console.error(formatDiagnostic(d));
  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

/** Validate the scenes in `dir`; a Tiled map is imported to `<outDir>/scenes/` first and the result validated. */
function checkScenes(compiler: Compiler, dir: string, outDir: string, prefabs: ReturnType<typeof projectSchemas>): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".tmj")).sort();
  for (const name of files) {
    const path = resolve(dir, name);
    const text = readFileSync(path, "utf8");
    if (name.endsWith(".json")) {
      diagnostics.push(...compiler.validateScene(relative(process.cwd(), path), text, prefabs));
      console.log(`checked scene ${name}`);
      continue;
    }
    const imported = importTiled(relative(process.cwd(), path), text);
    diagnostics.push(...imported.diagnostics);
    if (imported.diagnostics.some((d) => d.severity === "error")) continue;
    const scenesOut = resolve(outDir, "scenes");
    mkdirSync(scenesOut, { recursive: true });
    const scenePath = resolve(scenesOut, name.replace(/\.tmj$/, ".scene.json"));
    const sceneText = JSON.stringify(imported.scene, null, 2) + "\n";
    writeFileSync(scenePath, sceneText);
    diagnostics.push(...compiler.validateScene(relative(process.cwd(), scenePath), sceneText, prefabs));
    console.log(`imported ${name} -> ${scenePath}`);
  }
  return diagnostics;
}

process.exitCode = main(process.argv.slice(2));
