import { spawnSync } from "node:child_process";

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
