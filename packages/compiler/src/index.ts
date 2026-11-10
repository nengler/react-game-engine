import { runtimeManifest, type RuntimeManifest } from "@rge/runtime";
import { analyzeSourceFile, type SourceAnalysis } from "./analyzer/analyzer.ts";
import { hasErrors, type CompilerDiagnostic } from "./diagnostics/diagnostics.ts";
import { generateModule } from "./generator/generator.ts";
import type { IRModule } from "./ir/types.ts";
import { TsxParser } from "./parser/parser.ts";
import type { PrefabSchema } from "./prefabs/prefabs.ts";
import { validateScene } from "./scenes/validate.ts";
import { buildModuleIR } from "./transform/transform.ts";
import { parseGameState, type GameStateDefinition, type GameStateSchemaResult } from "./gamestate/schema.ts";
import { inlineCustomHooks, type HookResolver } from "./hooks/inline.ts";
import { typeCheckFiles, typeCheckSources, type VirtualFile } from "./typecheck/typecheck.ts";

export * from "./ir/types.ts";
export type { RuntimeManifest } from "@rge/runtime";
export * from "./diagnostics/diagnostics.ts";
export { analyzeSourceFile, AUTHORING_HOOKS, AUTHORING_TYPES, type PropsAnalysis, type TypeDeclarationAnalysis, type SourceAnalysis, type ComponentAnalysis, type ImportAnalysis, type HookCallAnalysis } from "./analyzer/analyzer.ts";
export { buildModuleIR, type TransformOptions, type TransformResult } from "./transform/transform.ts";
export { generateModule, type GeneratorOptions } from "./generator/generator.ts";
export { parseGameState, type GameStateDefinition, type GameStateLeaf, type GameStateNode, type GameStateSchemaResult } from "./gamestate/schema.ts";
export { TsxParser, spanOf, type ParsedSource } from "./parser/parser.ts";
export { constantValue, exportedComponents, moduleSchemas, prefabSchema, type JsonValue, type PrefabPropSchema, type PrefabSchema } from "./prefabs/prefabs.ts";
export { validateScene, SCENE_VERSION } from "./scenes/validate.ts";
export { ASSET_PROPS, checkAssets, type AssetCheckOptions } from "./assets/assets.ts";
export { importTiled, type TiledImport } from "./scenes/tiled.ts";
export { importTilemap, tilemapsSource, type TilemapImport, type TilemapOut } from "./scenes/tilemap.ts";
export { inlineCustomHooks, type HookResolver, type HookSource } from "./hooks/inline.ts";
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
  #hookResolver: HookResolver | null = null;

  constructor(config: CompilerConfig = {}) {
    this.#parser = new TsxParser({ cwd: config.cwd ?? process.cwd() });
    this.#runtimeModule = config.runtimeModule ?? "@rge/runtime";
    this.#manifest = config.manifest ?? runtimeManifest;
    this.#gameState = config.gameState;
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
    // Custom hooks are inlined first: from here on the file is a component with everything written out.
    const hookDiagnostics: CompilerDiagnostic[] = [];
    const text = inlineCustomHooks(this.#parser, fileName, original, this.#hookResolver, hookDiagnostics);
    if (hasErrors(hookDiagnostics)) return { ok: false, fileName, ir: null, diagnostics: hookDiagnostics };
    return this.analyze(fileName, text, (analysis) => {
      const transformed = buildModuleIR(analysis, { manifest: this.#manifest, ...(this.#gameState ? { gameState: this.#gameState } : {}) });
      const diagnostics = [...analysis.diagnostics, ...transformed.diagnostics];
      if (hasErrors(diagnostics)) return { ok: false, fileName, ir: transformed.module, diagnostics };
      const code = generateModule(transformed.module, {
        runtimeModule: this.#runtimeModule,
        runtimeFunctions: new Set(Object.keys(this.#manifest.functions)),
        requiredHostProps: this.#manifest.intrinsicRequired,
        intrinsicHooks: this.#manifest.intrinsicHooks,
        ...(this.#gameState ? { gameState: { name: this.#gameState.name, importFrom: this.#gameState.importFrom } } : {}),
      });
      return { ok: true, fileName, ir: transformed.module, code, diagnostics };
    });
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

  /** Set the project's game state after construction: the CLI reads `GameState.ts` with this compiler's own parser first. */
  setGameState(definition: GameStateDefinition | undefined): void {
    this.#gameState = definition;
  }

  close(): void {
    this.#parser.close();
  }
}

/** `Player.tsx` → `Player.ts` */
export function generatedFileName(sourceFileName: string): string {
  return sourceFileName.replace(/\.tsx$/, ".ts");
}
