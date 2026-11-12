import { runtimeManifest, type RuntimeManifest } from "@rge/runtime";
import { analyzeSourceFile, type SourceAnalysis } from "./analyzer/analyzer.ts";
import { checkSoundStores, type AssetCheckOptions, type SourceText } from "./assets/assets.ts";
import { hasErrors, type CompilerDiagnostic } from "./diagnostics/diagnostics.ts";
import { generateModule } from "./generator/generator.ts";
import type { IRModule } from "./ir/types.ts";
import { TsxParser } from "./parser/parser.ts";
import type { PrefabSchema } from "./prefabs/prefabs.ts";
import { validateScene } from "./scenes/validate.ts";
import { buildModuleIR } from "./transform/transform.ts";
import { parseGameState, type GameStateDefinition, type GameStateSchemaResult } from "./gamestate/schema.ts";
import { expandCustomHooks, type HookResolver } from "./hooks/inline.ts";
import { typeCheckFiles, typeCheckSources, type VirtualFile } from "./typecheck/typecheck.ts";

export * from "./ir/types.ts";
export type { RuntimeManifest } from "@rge/runtime";
export * from "./diagnostics/diagnostics.ts";
export { analyzeSourceFile, AUTHORING_HOOKS, AUTHORING_TYPES, type PropsAnalysis, type TypeDeclarationAnalysis, type SourceAnalysis, type ComponentAnalysis, type ImportAnalysis, type HookCallAnalysis } from "./analyzer/analyzer.ts";
export { buildModuleIR, type TransformOptions, type TransformResult } from "./transform/transform.ts";
export { generateModule, type GeneratorOptions } from "./generator/generator.ts";
export { parseGameState, type GameStateDefinition, type GameStateEntry, type GameStateLeaf, type GameStateNode, type GameStateValue, type GameStateSchemaResult } from "./gamestate/schema.ts";
export { TsxParser, spanOf, type ParsedSource } from "./parser/parser.ts";
export { constantValue, exportedComponents, moduleSchemas, prefabSchema, type JsonValue, type PrefabPropSchema, type PrefabSchema } from "./prefabs/prefabs.ts";
export { validateScene, SCENE_VERSION } from "./scenes/validate.ts";
export { ASSET_PROPS, checkAssets, checkSoundStores, type AssetCheckOptions, type SourceText } from "./assets/assets.ts";
export { importTiled, type TiledImport } from "./scenes/tiled.ts";
export { importTilemap, tilemapsSource, type TilemapImport, type TilemapImportOptions, type TilemapObjectOut, type TilemapOut } from "./scenes/tilemap.ts";
export { inlineCustomHooks, expandCustomHooks, type ExpandedSource, type HookResolver, type HookSource } from "./hooks/inline.ts";
export { EditMap } from "./hooks/edits.ts";
export { checkProject, prefabsIndexSource, prefabsJson, projectSchemas, type ProjectModule } from "./project.ts";
export { typeCheckFiles, typeCheckSources, generatedCodeCompilerOptions, sourceCompilerOptions, type VirtualFile } from "./typecheck/typecheck.ts";

export interface CompilerConfig {
  /** Module specifier generated code imports runtime classes from. Default: `@rge/runtime`. */
  readonly runtimeModule?: string;
  /** What the runtime provides (intrinsics, host class, reserved names, handle types, functions). Default: `@rge/runtime`'s manifest. */
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
    this.#runtimeModule = config.runtimeModule ?? "@rge/runtime";
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

  compile(fileName: string, original: string): CompileResult {
    // Custom hooks are inlined first: from here on the file is a component with everything written out. Spans found in the
    // expanded text are moved back to the text as written (`map`), so diagnostics and the IR point at the author's code.
    const hookDiagnostics: CompilerDiagnostic[] = [];
    const expanded = expandCustomHooks(this.#parser, fileName, original, this.#hookResolver, hookDiagnostics, this.#manifest.authoringModule);
    if (hasErrors(hookDiagnostics)) {
      expanded.parsed?.dispose();
      return { ok: false, fileName, ir: null, diagnostics: hookDiagnostics };
    }
    const parsed = expanded.parsed ?? this.#parser.parse(fileName, expanded.text);
    try {
      const analysis = analyzeSourceFile(parsed.sourceFile, fileName, this.#manifest.authoringModule);
      const transformed = buildModuleIR(analysis, { manifest: this.#manifest, ...(this.#gameState ? { gameState: this.#gameState } : {}) });
      // The inliner's own diagnostics are already in the original text.
      const diagnostics = [...hookDiagnostics, ...expanded.map.spans([...analysis.diagnostics, ...transformed.diagnostics], fileName, original)];
      const ir = expanded.map.spans(transformed.module, fileName, original);
      if (hasErrors(diagnostics)) return { ok: false, fileName, ir, diagnostics };
      const code = generateModule(ir, {
        runtimeModule: this.#runtimeModule,
        runtimeFunctions: new Set(Object.keys(this.#manifest.functions)),
        sourceFromOutput: this.#sourceFromOutput,
        requiredHostProps: this.#manifest.intrinsicRequired,
        intrinsicHooks: this.#manifest.intrinsicHooks,
        ...(this.#gameState ? { gameState: { name: this.#gameState.name, importFrom: this.#gameState.importFrom } } : {}),
        ...(this.#tilemapsModule !== undefined ? { tilemapsModule: this.#tilemapsModule } : {}),
      });
      return { ok: true, fileName, ir, code, diagnostics };
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
