import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compiler, formatDiagnostic, type CompilerDiagnostic, type IRModule } from "../src/index.ts";

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

/** Compile TSX source, throwing with formatted diagnostics if compilation fails. */
export function compile(source: string, name = "Test.tsx"): CompiledModule {
  const result = getCompiler().compile(name, source);
  if (!result.ok) {
    throw new Error(`Compilation failed:\n${result.diagnostics.map(formatDiagnostic).join("\n")}`);
  }
  const fileName = join(PROCESS_DIR, String(++counter), name.replace(/\.tsx$/, ".ts"));
  return { ir: result.ir, code: result.code, fileName };
}

/** Diagnostics for source that is expected not to compile. */
export function compileErrors(source: string): readonly CompilerDiagnostic[] {
  const result = getCompiler().compile("Invalid.tsx", source);
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
