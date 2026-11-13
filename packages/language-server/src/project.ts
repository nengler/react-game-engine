/**
 * A game, as the language server sees it: its folder, its source folder, and a compiler kept alive between edits. `diagnose` runs
 * the compiler's front half on one `.tsx` as it is in the editor (parse, custom hooks, analysis, the IR) and returns its `RGE`
 * diagnostics. Type checking stays with TypeScript's own server in the editor, and with `rge check` and `rge dev`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Compiler, type CompilerDiagnostic } from "@rge/compiler";

/** Reads a file as the editor has it (an open, unsaved document) or else from disk; null when there is none. */
export type ReadFile = (path: string) => string | null;

export const readFromDisk: ReadFile = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

interface PackageJson {
  readonly rge?: { readonly src?: string; readonly generated?: string };
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/** A game's folder: one whose package.json has an `"rge"` field or depends on `@rge/runtime`. */
export interface GameFolder {
  readonly dir: string;
  /** Where its components are (`src` unless the `"rge"` field says otherwise), absolute. */
  readonly src: string;
  readonly generated: string;
}

function readPackage(dir: string): PackageJson | null {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

/** The game a file belongs to: the nearest folder above it that is a game. Null when there is none. */
export function findGame(file: string): GameFolder | null {
  let dir = dirname(resolve(file));
  for (;;) {
    const pkg = readPackage(dir);
    if (pkg !== null && (pkg.rge !== undefined || pkg.dependencies?.["@rge/runtime"] !== undefined || pkg.devDependencies?.["@rge/runtime"] !== undefined)) {
      return { dir, src: resolve(dir, pkg.rge?.src ?? "src"), generated: resolve(dir, pkg.rge?.generated ?? "generated") };
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Whether `file` is a component the compiler would compile: a `.tsx` under the game's source folder. */
export function isComponentFile(game: GameFolder, file: string): boolean {
  const from = relative(game.src, resolve(file));
  return file.endsWith(".tsx") && from !== "" && !from.startsWith("..") && !isAbsolute(from);
}

const toPosix = (path: string): string => path.split(sep).join("/");

export class GameProject {
  readonly game: GameFolder;
  readonly #read: ReadFile;
  readonly #compiler: Compiler;
  /** The `GameState.ts` text the compiler was last given, so it is read again only when it changes. */
  #gameStateText: string | null | undefined = undefined;
  /** What reading `GameState.ts` reported, shown on every component until it is fixed. */
  #gameStateDiagnostics: readonly CompilerDiagnostic[] = [];

  constructor(game: GameFolder, read: ReadFile = readFromDisk) {
    this.game = game;
    this.#read = read;
    this.#compiler = new Compiler({ cwd: game.dir });
    this.#compiler.setSourceFromOutput(toPosix(relative(game.generated, game.src)) || ".");
    // Custom hooks imported from a relative `.tsx` are read from beside the importing file, as the editor has them.
    this.#compiler.setHookResolver((specifier, fromFile) => {
      const path = resolve(dirname(resolve(game.dir, fromFile)), specifier);
      const text = read(path);
      return text === null ? null : { fileName: toPosix(relative(game.dir, path)), text };
    });
  }

  /** The game state, read again when `GameState.ts` changed. */
  #refreshGameState(): void {
    const path = join(this.game.src, "GameState.ts");
    const text = this.#read(path);
    if (text === this.#gameStateText) return;
    this.#gameStateText = text;
    if (text === null) {
      this.#compiler.setGameState(undefined);
      this.#gameStateDiagnostics = [];
      return;
    }
    const { schema, diagnostics } = this.#compiler.parseGameState(toPosix(relative(this.game.dir, path)), text);
    this.#gameStateDiagnostics = diagnostics.filter((d) => d.severity === "error");
    const fromOutput = toPosix(relative(this.game.generated, path));
    this.#compiler.setGameState(schema === null ? undefined : { ...schema, importFrom: fromOutput.startsWith(".") ? fromOutput : `./${fromOutput}` });
  }

  /**
   * The `RGE` diagnostics of a component as `text` has it. Each has a span in this file; one the compiler found in another file
   * (a custom hook it inlined, `GameState.ts`) is put at the start of this one, its message naming where it is.
   */
  diagnose(file: string, text: string): CompilerDiagnostic[] {
    this.#refreshGameState();
    const fileName = toPosix(relative(this.game.dir, resolve(file)));
    const result = this.#compiler.compile(fileName, text);
    const out: CompilerDiagnostic[] = [];
    for (const d of [...this.#gameStateDiagnostics, ...result.diagnostics]) {
      if (d.span !== null && d.span.fileName === fileName) {
        out.push(d);
        continue;
      }
      const where = d.span === null ? "" : `${d.span.fileName}:${d.span.line}:${d.span.column}: `;
      out.push({ ...d, message: `${where}${d.message}`, span: null });
    }
    return out;
  }

  close(): void {
    this.#compiler.close();
  }
}
