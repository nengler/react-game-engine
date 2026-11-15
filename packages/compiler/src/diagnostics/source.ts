// Moving a diagnostic found in generated code (a type error, TSE9001) back to the component source it was written for.
import { relative, resolve } from "node:path";

import type { LineOrigin } from "../generator/writer.ts";
import type { CompilerDiagnostic } from "./diagnostics.ts";

/** A generated file, and what `compile` said about where its lines came from. */
export interface GeneratedFile {
  /** The generated file's path, as it was given to the type-check. */
  readonly fileName: string;
  /** The source's path, as it was given to `compile` (and as diagnostics in the source name it). */
  readonly sourceFile: string;
  readonly sourceText: string;
  readonly origins: readonly LineOrigin[];
}

/**
 * Each diagnostic in a generated file moves to the line of the source it was written for: the component, hook or element
 * (a line-level map, so the column is that construct's). The message keeps where it was found in the generated file. A
 * diagnostic on a line written for no construct (an import, the class header), or in another file, is left as it is.
 */
export function mapToSource(
  diagnostics: readonly CompilerDiagnostic[],
  files: readonly GeneratedFile[],
  cwd: string = process.cwd()
): CompilerDiagnostic[] {
  const byPath = new Map(files.map((f) => [resolve(cwd, f.fileName), f]));
  return diagnostics.map((d) => {
    const file = d.span ? byPath.get(resolve(cwd, d.span.fileName)) : undefined;
    if (!d.span || !file) return d;
    const origin = file.origins.find((o) => o.line === d.span!.line - 1);
    if (!origin) return d;
    const start = offsetOf(file.sourceText, origin.source.line, origin.source.column);
    const lineEnd = file.sourceText.indexOf("\n", start);
    return {
      ...d,
      message: `${d.message} (in the generated ${relative(cwd, resolve(cwd, d.span.fileName))}:${d.span.line}:${d.span.column})`,
      span: {
        fileName: file.sourceFile,
        start,
        end: lineEnd === -1 ? file.sourceText.length : lineEnd,
        line: origin.source.line,
        column: origin.source.column,
      },
    };
  });
}

/** The offset of a 1-based line and column in `text`. */
function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return Math.min(text.length, offset + column - 1);
}
