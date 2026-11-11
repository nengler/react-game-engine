import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeManifest, type RuntimeManifest } from "@rge/runtime";
import { LIBRARY_HOOKS } from "../src/hooks/library.ts";
import { AUTHORING_HOOKS, Compiler, formatDiagnostic, type ChildIR, type CompilerDiagnostic, type ElementIR, type IRModule } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** Inside the repo so generated code resolves `@rge/runtime` through the workspace. */
export const OUTPUT_ROOT = resolve(here, "../../../.test-output");
/** Test files run in parallel processes; each only touches its own directory. */
const PROCESS_DIR = join(OUTPUT_ROOT, String(process.pid));

let compiler: Compiler | null = null;
let counter = 0;

/** One TypeScript process shared by all tests in a file. */
export function getCompiler(): Compiler {
  compiler ??= new Compiler();
  return compiler;
}

export function closeCompiler(): void {
  compiler?.close();
  compiler = null;
}

export interface CompiledModule {
  readonly ir: IRModule;
  readonly code: string;
  readonly fileName: string;
}

/**
 * Component source must import the hooks, built-in elements and functions it
 * uses from the authoring module (`RGE1005` otherwise). Most test sources are
 * short snippets about something else, so the helpers below add the import
 * line for the names a source uses. It goes on the source's first line, so
 * line numbers are unchanged, and a source that already imports from the
 * authoring module is left alone. Tests about the import rules themselves
 * bypass this by calling the compiler directly.
 */
export function withAuthoringImports(source: string, manifest: RuntimeManifest = runtimeManifest): string {
  if (source.includes(`from "${manifest.authoringModule}"`)) return source;
  const exported = [...manifest.intrinsics, ...AUTHORING_HOOKS, ...Object.keys(manifest.functions), ...LIBRARY_HOOKS];
  const used = exported.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
  if (used.length === 0) return source;
  return `import { ${used.join(", ")} } from "${manifest.authoringModule}"; ${source}`;
}

/** Compile TSX source, throwing with formatted diagnostics if compilation fails. */
export function compile(source: string, name = "Test.tsx"): CompiledModule {
  const result = getCompiler().compile(name, withAuthoringImports(source));
  if (!result.ok) {
    throw new Error(`Compilation failed:\n${result.diagnostics.map(formatDiagnostic).join("\n")}`);
  }
  const fileName = join(PROCESS_DIR, String(++counter), name.replace(/\.tsx$/, ".ts"));
  return { ir: result.ir, code: result.code, fileName };
}

/** Diagnostics for source that is expected not to compile. */
export function compileErrors(source: string): readonly CompilerDiagnostic[] {
  const result = getCompiler().compile("Invalid.tsx", withAuthoringImports(source));
  if (result.ok) throw new Error(`Expected compilation to fail, got:\n${result.code}`);
  return result.diagnostics;
}

export function typeCheck(compiled: CompiledModule): readonly CompilerDiagnostic[] {
  return getCompiler().typeCheck([{ fileName: compiled.fileName, text: compiled.code }]);
}

/** Write generated code to disk and import it (Node strips the types). */
export async function load<T = Record<string, unknown>>(compiled: CompiledModule): Promise<T> {
  mkdirSync(dirname(compiled.fileName), { recursive: true });
  writeFileSync(compiled.fileName, compiled.code);
  return (await import(pathToFileURL(compiled.fileName).href)) as T;
}

export function cleanOutput(): void {
  rmSync(PROCESS_DIR, { recursive: true, force: true });
}

/** Drop source spans so IR can be compared structurally. */
export function stripSpans<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (key, v: unknown) => (key === "span" ? undefined : v)));
}

export type CompiledProject = Readonly<Record<string, CompiledModule>>;

/** Compile several TSX files that import each other; all outputs share one directory. */
export function compileProject(sources: Readonly<Record<string, string>>): CompiledProject {
  const dir = join(PROCESS_DIR, String(++counter));
  const out: Record<string, CompiledModule> = {};
  for (const [name, source] of Object.entries(sources)) {
    const result = getCompiler().compile(name, withAuthoringImports(source));
    if (!result.ok) {
      throw new Error(`Compilation of ${name} failed:\n${result.diagnostics.map(formatDiagnostic).join("\n")}`);
    }
    out[name] = { ir: result.ir, code: result.code, fileName: join(dir, name.replace(/\.tsx$/, ".ts")) };
  }
  return out;
}

export function typeCheckProject(project: CompiledProject): readonly CompilerDiagnostic[] {
  return getCompiler().typeCheck(Object.values(project).map((m) => ({ fileName: m.fileName, text: m.code })));
}

/** Write every module of a project to disk and import `main`. */
export async function loadProject<T = Record<string, unknown>>(project: CompiledProject, main: string): Promise<T> {
  for (const m of Object.values(project)) {
    mkdirSync(dirname(m.fileName), { recursive: true });
    writeFileSync(m.fileName, m.code);
  }
  return (await import(pathToFileURL(project[main]!.fileName).href)) as T;
}

/** Diagnostics for a project whose files are expected not to compile (files compiled in order, errors from the first failure). */
export function compileProjectErrors(sources: Readonly<Record<string, string>>): readonly CompilerDiagnostic[] {
  for (const [name, source] of Object.entries(sources)) {
    const result = getCompiler().compile(name, withAuthoringImports(source));
    if (!result.ok) return result.diagnostics;
  }
  throw new Error("Expected a compilation failure");
}

/** The element a child holds; a `{children}` slot holds none. */
export function elementOf(child: ChildIR): ElementIR {
  if (child.kind === "ChildrenSlot") throw new Error("expected a child with an element, found the {children} slot");
  return child.element;
}

/**
 * Same objects in the same order, by identity. `assert.deepEqual` cannot be used on
 * runtime objects: two fresh ones with equal fields are structurally identical, so it
 * accepts any permutation.
 */
export function sameOrder(actual: readonly unknown[], expected: readonly unknown[], message = ""): void {
  assert.equal(actual.length, expected.length, `${message} length`);
  actual.forEach((item, i) => assert.equal(item, expected[i], `${message} position ${i}`));
}
