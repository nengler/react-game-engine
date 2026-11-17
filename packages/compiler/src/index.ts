import { runtimeManifest, type RuntimeManifest } from "@tsengine/runtime";

import { analyzeSourceFile, type SourceAnalysis } from "./analyzer/analyzer.ts";
import { checkSoundStores, type AssetCheckOptions, type SourceText } from "./assets/assets.ts";
import { hasErrors, type CompilerDiagnostic } from "./diagnostics/diagnostics.ts";
import { parseGameState, type GameStateDefinition, type GameStateSchemaResult } from "./gamestate/schema.ts";
import { generateModuleWithMap, generateModuleWithOrigins, type GeneratorOptions } from "./generator/generator.ts";
import { type LineOrigin } from "./generator/writer.ts";
import { expandCustomHooks, type HookResolver } from "./hooks/inline.ts";
import type { IRModule } from "./ir/types.ts";
import { TsxParser } from "./parser/parser.ts";
import type { PrefabSchema } from "./prefabs/prefabs.ts";
import { validateScene } from "./scenes/validate.ts";
import { buildModuleIR } from "./transform/transform.ts";
import { typeCheckFiles, typeCheckSources, type VirtualFile } from "./typecheck/typecheck.ts";

export * from "./ir/types.ts";
export type { RuntimeManifest } from "@tsengine/runtime";
export * from "./diagnostics/diagnostics.ts";
export {
  analyzeSourceFile,
  AUTHORING_HOOKS,
  AUTHORING_TYPES,
  type PropsAnalysis,
  type TypeDeclarationAnalysis,
  type SourceAnalysis,
  type ComponentAnalysis,
  type ImportAnalysis,
  type HookCallAnalysis,
} from "./analyzer/analyzer.ts";
export { buildModuleIR, type TransformOptions, type TransformResult } from "./transform/transform.ts";
export { TIMER_FUNCTIONS, WORLD_FUNCTIONS } from "./transform/helpers.ts";
export {
  generateModule,
  generateModuleWithMap,
  generateModuleWithOrigins,
  type GeneratorOptions,
  type SourceMapOptions,
} from "./generator/generator.ts";
export { type LineOrigin } from "./generator/writer.ts";
export { mapToSource, type GeneratedFile } from "./diagnostics/source.ts";
export {
  parseGameState,
  type GameStateDefinition,
  type GameStateEntry,
  type GameStateLeaf,
  type GameStateNode,
  type GameStateValue,
  type GameStateSchemaResult,
} from "./gamestate/schema.ts";
export { TsxParser, spanOf, type ParsedSource } from "./parser/parser.ts";
export {
  constantValue,
  exportedComponents,
  moduleSchemas,
  prefabSchema,
  type JsonValue,
  type PrefabPropSchema,
  type PrefabSchema,
} from "./prefabs/prefabs.ts";
export { validateScene, SCENE_VERSION } from "./scenes/validate.ts";
export { ASSET_PROPS, checkAssets, checkSoundStores, type AssetCheckOptions, type SourceText } from "./assets/assets.ts";
export { importTiled, type TiledImport } from "./scenes/tiled.ts";
export {
  importTilemap,
  tilemapsSource,
  type TilemapImport,
  type TilemapImportOptions,
  type TilemapObjectOut,
  type TilemapOut,
  type TilesetOut,
} from "./scenes/tilemap.ts";
export { readTsx, type TilesetJson } from "./scenes/tsx.ts";
export { inlineCustomHooks, expandCustomHooks, type ExpandedSource, type HookResolver, type HookSource } from "./hooks/inline.ts";
export { EditMap } from "./hooks/edits.ts";
export { checkProject, prefabsIndexSource, prefabsJson, projectSchemas, type ProjectModule } from "./project.ts";
export {
  typeCheckFiles,
  typeCheckSources,
  generatedCodeCompilerOptions,
  sourceCompilerOptions,
  type VirtualFile,
} from "./typecheck/typecheck.ts";

export interface CompilerConfig {
  /** Module specifier generated code imports runtime classes from. Default: `@tsengine/runtime`. */
  readonly runtimeModule?: string;
  /** What the runtime provides (intrinsics, host class, reserved names, handle types, functions). Default: `@tsengine/runtime`'s manifest. */
  readonly manifest?: RuntimeManifest;
  /** Working directory for the TypeScript process. */
  readonly cwd?: string;
  /** The project's game state, from `GameState.ts` (see `Compiler.parseGameState`): what a selector on the imported store may name. Default: none. */
  readonly gameState?: GameStateDefinition;
  /** The path from the generated files to the source folder (`../src`): where a function imported from a relative `.ts` file is found. Default `..`. */
  readonly sourceFromOutput?: string;
}

export type CompileResult =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly ir: IRModule;
      readonly code: string;
      /** The source map for `code`, when `compile` was asked for one. */
      readonly sourceMap?: string;
      /** For each line of `code` written for a construct of the source, where that construct is (see `mapToSource`). */
      readonly origins: readonly LineOrigin[];
      readonly diagnostics: readonly CompilerDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly fileName: string;
      readonly ir: IRModule | null;
      readonly diagnostics: readonly CompilerDiagnostic[];
    };

/**
 * Runs the full pipeline: parse → analyze → IR → generate. Owns one
 * TypeScript 7 API process; call `close()` when done.
 */
export class Compiler {
  readonly #parser: TsxParser;
  readonly #runtimeModule: string;
  readonly #manifest: RuntimeManifest;
  #gameState: GameStateDefinition | undefined;
  #tilemapsModule: string | undefined;
  #hookResolver: HookResolver | null = null;
  #sourceFromOutput: string;

  constructor(config: CompilerConfig = {}) {
    this.#parser = new TsxParser({ cwd: config.cwd ?? process.cwd() });
    this.#runtimeModule = config.runtimeModule ?? "@tsengine/runtime";
    this.#manifest = config.manifest ?? runtimeManifest;
    this.#gameState = config.gameState;
    this.#sourceFromOutput = config.sourceFromOutput ?? "..";
  }

  /** See `CompilerConfig.sourceFromOutput`: the CLI knows where it writes relative to where it reads. */
  setSourceFromOutput(path: string): void {
    this.#sourceFromOutput = path;
  }

  /** Parse and analyze only. The callback receives the analysis while its AST is alive. */
  analyze<T>(fileName: string, text: string, use: (analysis: SourceAnalysis) => T): T {
    const parsed = this.#parser.parse(fileName, text);
    try {
      return use(analyzeSourceFile(parsed.sourceFile, fileName, this.#manifest.authoringModule));
    } finally {
      parsed.dispose();
    }
  }

  /**
   * Say where custom hooks imported from a relative `.tsx` file are read from (`import { useThing } from "./hooks.tsx"`). The
   * CLI reads them from the source directory. Hooks in the same file as the component need no resolver.
   */
  setHookResolver(resolver: HookResolver | null): void {
    this.#hookResolver = resolver;
  }

  /**
   * `sourceMap`: write a source map from the generated code to `original` (`file` is the generated file's name, `source` the
   * source's path from it); the code then ends with a `//# sourceMappingURL=` comment.
   */
  compile(fileName: string, original: string, sourceMap?: { readonly file: string; readonly source: string }): CompileResult {
    // Custom hooks are inlined first: from here on the file is a component with everything written out. Spans found in the
    // expanded text are moved back to the text as written (`map`), so diagnostics and the IR point at the author's code.
    const hookDiagnostics: CompilerDiagnostic[] = [];
    const expanded = expandCustomHooks(
      this.#parser,
      fileName,
      original,
      this.#hookResolver,
      hookDiagnostics,
      this.#manifest.authoringModule
    );
    if (hasErrors(hookDiagnostics)) {
      expanded.parsed?.dispose();
      return { ok: false, fileName, ir: null, diagnostics: hookDiagnostics };
    }
    const parsed = expanded.parsed ?? this.#parser.parse(fileName, expanded.text);
    try {
      const analysis = analyzeSourceFile(parsed.sourceFile, fileName, this.#manifest.authoringModule);
      const transformed = buildModuleIR(analysis, { manifest: this.#manifest, ...(this.#gameState ? { gameState: this.#gameState } : {}) });
      // The inliner's own diagnostics are already in the original text.
      const diagnostics = oneErrorPerHookCall(
        [...hookDiagnostics, ...expanded.map.spans([...analysis.diagnostics, ...transformed.diagnostics], fileName, original)],
        expanded.calls
      );
      const ir = expanded.map.spans(transformed.module, fileName, original);
      if (hasErrors(diagnostics)) return { ok: false, fileName, ir, diagnostics };
      const options: GeneratorOptions = {
        runtimeModule: this.#runtimeModule,
        runtimeFunctions: new Set(Object.keys(this.#manifest.functions)),
        sourceFromOutput: this.#sourceFromOutput,
        requiredHostProps: this.#manifest.intrinsicRequired,
        intrinsicHooks: this.#manifest.intrinsicHooks,
        ...(this.#gameState ? { gameState: { name: this.#gameState.name, importFrom: this.#gameState.importFrom } } : {}),
        ...(this.#tilemapsModule !== undefined ? { tilemapsModule: this.#tilemapsModule } : {}),
      };
      if (sourceMap) {
        const generated = generateModuleWithMap(ir, options, { ...sourceMap, sourceContent: original });
        return { ok: true, fileName, ir, code: generated.code, sourceMap: generated.map, origins: generated.origins, diagnostics };
      }
      const generated = generateModuleWithOrigins(ir, options);
      return { ok: true, fileName, ir, code: generated.code, origins: generated.origins, diagnostics };
    } finally {
      parsed.dispose();
    }
  }

  /** Type-check generated (or any) TypeScript files with the TypeScript 7.1 checker. */
  typeCheck(files: readonly VirtualFile[]): CompilerDiagnostic[] {
    return typeCheckFiles(this.#parser.api, files);
  }

  /**
   * Type-check authored `.tsx` files (absolute paths) against the authoring
   * module's declarations: wrong props, undefined names, bad hook arguments.
   */
  typeCheckSources(files: readonly VirtualFile[]): CompilerDiagnostic[] {
    return typeCheckSources(this.#parser.api, files);
  }

  /** Validate a scene file's text against the project's prefabs; diagnostics point at the offending JSON value. */
  validateScene(fileName: string, text: string, prefabs: ReadonlyMap<string, PrefabSchema>): CompilerDiagnostic[] {
    return validateScene(this.#parser, fileName, text, prefabs);
  }

  /**
   * Read a project's `GameState.ts` (see `parseGameState`). `importFrom` is how generated code should import it: the
   * module's path relative to the generated file, such as `../src/GameState.ts`. Pass the result's `schema` and that
   * to `setGameState`, or build the compiler with `gameState`.
   */
  parseGameState(fileName: string, text: string): GameStateSchemaResult {
    return parseGameState(this.#parser, fileName, text);
  }

  /** Check the sound files that `createSounds({ … })` names in `sources` (plain `.ts` modules too) against the assets folder. */
  checkSoundStores(sources: readonly SourceText[], options: AssetCheckOptions): CompilerDiagnostic[] {
    return checkSoundStores(this.#parser, sources, options);
  }

  /** Set the project's game state after construction: the CLI reads `GameState.ts` with this compiler's own parser first. */
  setGameState(definition: GameStateDefinition | undefined): void {
    this.#gameState = definition;
  }

  /**
   * The generated `tilemaps.ts` (registering every map as it loads), as generated code imports it (`./tilemaps.ts`): a component
   * that draws a `<Tilemap>` then imports it, so the maps are registered before the game starts without a `registerTilemaps` call.
   */
  setTilemapsModule(importFrom: string | undefined): void {
    this.#tilemapsModule = importFrom;
  }

  close(): void {
    this.#parser.close();
  }
}

/** `Player.tsx` → `Player.ts` */
export function generatedFileName(sourceFileName: string): string {
  return sourceFileName.replace(/\.tsx$/, ".ts");
}

/**
 * One mistake, one error, through an inlined hook: an error found inside a hook's expansion maps to exactly the call's range, and
 * the first is the author's (a bad argument, `useBody({ x: nowhere })`); what follows is the hook's own body failing for it
 * (`'move' is not a method`, about names the author never wrote). Only the first error on each call is kept; warnings are kept.
 */
function oneErrorPerHookCall(
  diagnostics: readonly CompilerDiagnostic[],
  calls: readonly { readonly start: number; readonly end: number }[]
): CompilerDiagnostic[] {
  if (calls.length === 0) return [...diagnostics];
  const seen = new Set<number>();
  return diagnostics.filter((d) => {
    if (d.severity !== "error" || d.span === null || d.span === undefined) return true;
    const call = calls.findIndex((c) => c.start === d.span!.start && c.end === d.span!.end);
    if (call < 0) return true;
    if (seen.has(call)) return false;
    seen.add(call);
    return true;
  });
}
