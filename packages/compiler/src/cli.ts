#!/usr/bin/env node
/**
 * Usage: rge-compile <srcDir> <outDir> [--runtime <module>] [--no-check]
 * Type-checks every .tsx file in srcDir (imports from the authoring module,
 * prop types, hook arguments), compiles each to a .ts file in outDir, writes
 * the IR next to it as .ir.json, then type-checks the output. `--no-check`
 * skips both type-checks.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Compiler, formatDiagnostic, generatedFileName, type CompilerDiagnostic, type VirtualFile } from "./index.ts";

function main(argv: readonly string[]): number {
  const positional: string[] = [];
  let runtimeModule: string | undefined;
  let check = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--runtime") runtimeModule = argv[++i];
    else if (arg === "--no-check") check = false;
    else positional.push(arg);
  }
  const [srcDir, outDir] = positional;
  if (!srcDir || !outDir) {
    console.error("usage: rge-compile <srcDir> <outDir> [--runtime <module>] [--no-check]");
    return 2;
  }

  const compiler = new Compiler(runtimeModule ? { runtimeModule } : {});
  const diagnostics: CompilerDiagnostic[] = [];
  const outputs: VirtualFile[] = [];
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
      console.log(`compiled ${name} -> ${outPath}`);
    }
    if (check && outputs.length > 0) diagnostics.push(...compiler.typeCheck(outputs));
  } finally {
    compiler.close();
  }
  for (const d of diagnostics) console.error(formatDiagnostic(d));
  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
