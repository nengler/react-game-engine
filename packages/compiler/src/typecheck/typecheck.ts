import { ScriptTarget } from "typescript/ast";
import { createFileSystemLayer } from "typescript/fs";
import { DiagnosticCategory, JsxEmit, ModuleKind, ModuleResolutionKind, type API, type Diagnostic } from "typescript/sync";

import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";

export interface VirtualFile {
  /** Absolute path. The file need not exist on disk; it is layered over the real filesystem. */
  readonly fileName: string;
  readonly text: string;
}

/** Options used to check generated code. `RawCompilerOptions` takes numeric enums, not tsconfig strings. */
export const generatedCodeCompilerOptions = {
  strict: true,
  noEmit: true,
  noImplicitOverride: true,
  noUncheckedIndexedAccess: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  types: [],
  target: ScriptTarget.ES2023,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Bundler,
} satisfies Parameters<API["createProgram"]>[1];

/**
 * Options used to check authored TSX: the same strictness, plus JSX typed by
 * the runtime's authoring module (`@tsengine/runtime/jsx-runtime`), so a wrong
 * prop or an undefined hook is a type error in the source.
 */
export const sourceCompilerOptions = {
  ...generatedCodeCompilerOptions,
  jsx: JsxEmit.ReactJSX,
  jsxImportSource: "@tsengine/runtime",
} satisfies Parameters<API["createProgram"]>[1];

/**
 * Type-check in-memory files with the TypeScript 7.1 checker. The files are
 * supplied as a filesystem layer over the host filesystem, so they can import
 * real packages (e.g. the runtime) from disk.
 */
export function typeCheckFiles(api: API, files: readonly VirtualFile[]): CompilerDiagnostic[] {
  return checkFiles(api, files, generatedCodeCompilerOptions, DiagnosticCode.GeneratedTypeError);
}

/** Type-check authored `.tsx` files. Errors are `TSE9002`, to tell them from errors in generated code (`TSE9001`). */
export function typeCheckSources(api: API, files: readonly VirtualFile[]): CompilerDiagnostic[] {
  return checkFiles(api, files, sourceCompilerOptions, DiagnosticCode.SourceTypeError);
}

function checkFiles(
  api: API,
  files: readonly VirtualFile[],
  compilerOptions: Parameters<API["createProgram"]>[1],
  code: DiagnosticCode
): CompilerDiagnostic[] {
  const snapshot = api.createSnapshot({
    fileSystem: createFileSystemLayer(files.map((f) => [f.fileName, f.text] as const)),
    createPrograms: [{ rootFiles: files.map((f) => f.fileName), compilerOptions }],
  });
  try {
    const program = snapshot.operation.createdPrograms[0];
    const raw: Diagnostic[] = [
      ...program.getConfigFileParsingDiagnostics(),
      ...program.getGlobalDiagnostics(),
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ];
    return raw.map((d) => toCompilerDiagnostic(d, code));
  } finally {
    snapshot.dispose();
  }
}

function toCompilerDiagnostic(d: Diagnostic, code: DiagnosticCode): CompilerDiagnostic {
  const message = [d.text, ...(d.messageChain ?? []).map((m) => m.text)].join(" ");
  return {
    code,
    severity: d.category === DiagnosticCategory.Error ? "error" : "warning",
    message: `TS${d.code}: ${message}`,
    span: d.fileName
      ? {
          fileName: d.fileName,
          start: d.pos,
          end: d.end,
          line: (d.startPosition?.line ?? 0) + 1,
          column: (d.startPosition?.character ?? 0) + 1,
        }
      : null,
  };
}
