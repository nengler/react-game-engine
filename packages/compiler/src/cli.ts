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
 * A `GameState.ts` in srcDir (`export const useGame = createGameState<State>()((set) => ({ … }))`) is the game's
 * global state: components import it and read it with selectors, `useGame((s) => s.player.hp)`. The compiler
 * reads the file to check those selectors; generated code imports it from where it is.
 *
 * `--scenes <dir>` validates every scene (.json) in the directory against
 * those prefabs, and imports every Tiled map (.tmj) to
 * `<outDir>/scenes/<name>.scene.json` and validates that.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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
  const usage = "usage: rge-compile <srcDir> <outDir> [--runtime <module>] [--no-check] [--scenes <dir>]";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--runtime" || arg === "--scenes") {
      // A flag with no value would otherwise be accepted and silently do nothing: CI would pass without checking scenes.
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`${arg} needs a value.\n${usage}`);
        return 2;
      }
      i++;
      if (arg === "--runtime") runtimeModule = value;
      else scenesDir = value;
    } else if (arg === "--no-check") check = false;
    else if (arg.startsWith("--")) {
      console.error(`unknown option ${arg}\n${usage}`);
      return 2;
    } else positional.push(arg);
  }
  const [srcDir, outDir] = positional;
  if (!srcDir || !outDir) {
    console.error(usage);
    return 2;
  }
  for (const [what, dir] of [["source", srcDir], ...(scenesDir === undefined ? [] : [["scenes", scenesDir]])] as const) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      console.error(`The ${what} directory '${dir}' does not exist or is not a directory.`);
      return 2;
    }
  }

  const compiler = new Compiler(runtimeModule ? { runtimeModule } : {});
  const diagnostics: CompilerDiagnostic[] = [];
  const outputs: VirtualFile[] = [];
  const modules: ProjectModule[] = [];
  try {
    mkdirSync(outDir, { recursive: true });
    const statePath = resolve(srcDir, "GameState.ts");
    if (existsSync(statePath)) {
      const { schema, diagnostics: stateDiagnostics } = compiler.parseGameState(relative(process.cwd(), statePath), readFileSync(statePath, "utf8"));
      diagnostics.push(...stateDiagnostics);
      if (schema) {
        // Generated files import the store from where it is: the path from the output directory to the source file.
        const fromOutput = relative(resolve(outDir), statePath).split(sep).join("/");
        compiler.setGameState({ ...schema, importFrom: fromOutput.startsWith(".") ? fromOutput : `./${fromOutput}` });
        console.log(`read GameState.ts (${schema.actions.length} action${schema.actions.length === 1 ? "" : "s"})`);
      }
    }
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
    // The registry and schema describe the whole project. With a file that failed to compile they would silently leave a
    // component out (and a stale one from an earlier run would be left as it was), so they are only written when all compiled.
    const complete = modules.length === sourceNames.length;
    if (!complete && modules.length > 0) console.error("skipped prefabs.ts and prefabs.json: not every file compiled, so they would be missing a component");
    if (complete && modules.length > 0) {
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
