import { API, type RetainedSourceFile } from "typescript/sync";
import { ScriptKind, type Node, type SourceFile } from "typescript/ast";
import type { SourceSpan } from "../ir/types.ts";

/**
 * A parsed TSX file. AST nodes are backed by the TypeScript 7 server process
 * and stay valid until `dispose()` is called.
 */
export interface ParsedSource {
  readonly fileName: string;
  readonly sourceFile: SourceFile;
  dispose(): void;
}

/**
 * Thin wrapper around the TypeScript 7.1 synchronous API (`typescript/sync`).
 * TS 7 parses in a native child process; this class owns that process.
 */
export class TsxParser {
  readonly api: API;
  #ownsApi: boolean;

  constructor(options: { readonly cwd?: string; readonly api?: API } = {}) {
    if (options.api) {
      this.api = options.api;
      this.#ownsApi = false;
    } else {
      this.api = new API({ cwd: options.cwd ?? process.cwd() });
      this.#ownsApi = true;
    }
  }

  parse(fileName: string, text: string): ParsedSource {
    return this.#create(fileName, text, ScriptKind.TSX);
  }

  /** Parse a JSON file (a scene) into the same kind of AST, so diagnostics can point at a value's line and column. */
  parseJson(fileName: string, text: string): ParsedSource {
    return this.#create(fileName, text, ScriptKind.JSON);
  }

  #create(fileName: string, text: string, scriptKind: ScriptKind): ParsedSource {
    const retained: RetainedSourceFile = this.api.createSourceFile(fileName, text, { scriptKind });
    return { fileName, sourceFile: retained.sourceFile, dispose: () => retained.dispose() };
  }

  close(): void {
    if (this.#ownsApi) this.api.close();
  }
}

/**
 * Source span of a node, excluding leading trivia. `fileName` defaults to the
 * source file's name, which TypeScript normalises to an absolute path.
 */
export function spanOf(node: Node, sourceFile: SourceFile, fileName: string = sourceFile.fileName): SourceSpan {
  const start = node.getStart(sourceFile);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return { fileName, start, end: node.getEnd(), line: line + 1, column: character + 1 };
}
