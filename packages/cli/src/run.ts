import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Ran {
  readonly ok: boolean;
  readonly stdout: string;
  readonly output: string;
}

/** Run a command to the end, collecting its output. */
export function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Ran {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env });
  return { ok: result.status === 0, stdout: result.stdout ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

export const node = (args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): Ran => run(process.execPath, args, cwd, env);

/**
 * This command line's own entry script, to run `tse` again in a process of its own: `cli.ts` beside this module in the
 * repository, `cli.js` in an installed pack (which ships `dist/*.js` and no source, so naming `cli.ts` there finds nothing).
 */
export function cliScript(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  return [join(dir, "cli.ts"), join(dir, "cli.js")].find((path) => existsSync(path)) ?? join(dir, "cli.js");
}
