import { analyzeSourceFile, type SourceAnalysis } from "./analyzer/analyzer.ts";
import { hasErrors, type CompilerDiagnostic } from "./diagnostics/diagnostics.ts";
import { generateModule } from "./generator/generator.ts";
import type { IRModule } from "./ir/types.ts";
import { TsxParser } from "./parser/parser.ts";
import { buildModuleIR } from "./transform/transform.ts";
import { typeCheckFiles, type VirtualFile } from "./typecheck/typecheck.ts";

export * from "./ir/types.ts";
export * from "./diagnostics/diagnostics.ts";
export { analyzeSourceFile, type SourceAnalysis, type ComponentAnalysis, type HookCallAnalysis } from "./analyzer/analyzer.ts";
export { buildModuleIR, type TransformOptions, type TransformResult } from "./transform/transform.ts";
export { generateModule, type GeneratorOptions } from "./generator/generator.ts";
export { TsxParser, spanOf, type ParsedSource } from "./parser/parser.ts";
export { typeCheckFiles, generatedCodeCompilerOptions, type VirtualFile } from "./typecheck/typecheck.ts";

export interface CompilerConfig {
  /** Module specifier generated code imports runtime classes from. Default: `@rge/runtime`. */
  readonly runtimeModule?: string;
  /** Tag names the runtime provides. Default: Entity, Sprite, Collider. */
  readonly intrinsics?: readonly string[];
  /** Intrinsic every component root must be. Default: Entity. */
  readonly hostIntrinsic?: string;
  /** Working directory for the TypeScript process. */
  readonly cwd?: string;
}

export type CompileResult =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly ir: IRModule;
      readonly code: string;
      readonly diagnostics: readonly CompilerDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly fileName: string;
      readonly ir: IRModule | null;
      readonly diagnostics: readonly CompilerDiagnostic[];
    };

export const DEFAULT_INTRINSICS: readonly string[] = ["Entity", "Sprite", "Collider"];

/**
 * Runs the full pipeline: parse → analyze → IR → generate. Owns one
 * TypeScript 7 API process; call `close()` when done.
 */
export class Compiler {
  readonly #parser: TsxParser;
  readonly #runtimeModule: string;
  readonly #intrinsics: readonly string[];
  readonly #hostIntrinsic: string;

  constructor(config: CompilerConfig = {}) {
    this.#parser = new TsxParser({ cwd: config.cwd ?? process.cwd() });
    this.#runtimeModule = config.runtimeModule ?? "@rge/runtime";
    this.#intrinsics = config.intrinsics ?? DEFAULT_INTRINSICS;
    this.#hostIntrinsic = config.hostIntrinsic ?? "Entity";
  }

  /** Parse and analyze only. The callback receives the analysis while its AST is alive. */
  analyze<T>(fileName: string, text: string, use: (analysis: SourceAnalysis) => T): T {
    const parsed = this.#parser.parse(fileName, text);
    try {
      return use(analyzeSourceFile(parsed.sourceFile, fileName));
    } finally {
      parsed.dispose();
    }
  }

  compile(fileName: string, text: string): CompileResult {
    return this.analyze(fileName, text, (analysis) => {
      const transformed = buildModuleIR(analysis, { intrinsics: this.#intrinsics, hostIntrinsic: this.#hostIntrinsic });
      const diagnostics = [...analysis.diagnostics, ...transformed.diagnostics];
      if (hasErrors(diagnostics)) return { ok: false, fileName, ir: transformed.module, diagnostics };
      const code = generateModule(transformed.module, { runtimeModule: this.#runtimeModule });
      return { ok: true, fileName, ir: transformed.module, code, diagnostics };
    });
  }

  /** Type-check generated (or any) TypeScript files with the TypeScript 7.1 checker. */
  typeCheck(files: readonly VirtualFile[]): CompilerDiagnostic[] {
    return typeCheckFiles(this.#parser.api, files);
  }

  close(): void {
    this.#parser.close();
  }
}

/** `Player.tsx` → `Player.ts` */
export function generatedFileName(sourceFileName: string): string {
  return sourceFileName.replace(/\.tsx$/, ".ts");
}
