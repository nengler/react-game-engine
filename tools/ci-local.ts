/**
 * Run the CI workflow's jobs on this machine, for when GitHub Actions cannot (no minutes left, an outage):
 *
 *   npm run ci:local                       every job, in this working tree (uncommitted changes included)
 *   npm run ci:local -- check host         only these jobs
 *   npm run ci:local -- --ref origin/main  in a fresh worktree of that ref: what CI would see, from a clean checkout
 *   npm run ci:local -- --list             the jobs and steps, without running them
 *
 * The steps come from `.github/workflows/ci.yml` itself, so this cannot drift from CI: each `run:` step runs under bash
 * (`-eo pipefail`, as Actions does) from the repository root, with the workflow's and the step's `env`, `GITHUB_WORKSPACE`
 * and `GITHUB_OUTPUT`. `uses:` steps (checkout, setup-node, caches) are skipped: the machine's own Node, compilers and
 * build folders stand in for them. A step that installs system packages is skipped too, with what it would install;
 * a job that needs them then fails until they are installed. A step already run by an earlier job in the same
 * invocation (`npm ci`, `npm run generate`) is not run again. A job stops at its first failed step; the others still
 * run, and the exit status is 1 if any failed.
 *
 * The reader understands only the YAML this workflow uses, and stops on anything else (an `if:`, a matrix, a
 * `working-directory`) rather than run something other than what CI runs: teach it the new key.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Step {
  readonly name: string;
  /** The shell script of a `run:` step; null for a `uses:` step. */
  readonly run: string | null;
  readonly uses: string | null;
  readonly env: Readonly<Record<string, string>>;
}

export interface Job {
  readonly name: string;
  readonly timeoutMinutes: number | null;
  readonly steps: readonly Step[];
}

export interface Workflow {
  readonly env: Readonly<Record<string, string>>;
  readonly jobs: readonly Job[];
}

const STEP_KEYS = new Set(["name", "id", "uses", "with", "run", "env"]);
const JOB_KEYS = new Set(["runs-on", "timeout-minutes", "steps"]);
const TOP_KEYS = new Set(["name", "on", "permissions", "env", "concurrency", "jobs"]);

/** `key: value` on one line, with the indent and whether it starts a list item. */
const KEY = /^( *)(- )?([A-Za-z0-9_-]+):(?: +(.*))?$/;

function scalar(raw: string, where: string): string {
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, expression: string) => {
    if (expression === "github.workspace") return "${GITHUB_WORKSPACE}";
    throw new Error(`${where}: ci-local does not know the expression \${{ ${expression} }}`);
  });
}

/** Read the subset of YAML `.github/workflows/ci.yml` is written in. */
export function parseWorkflow(text: string): Workflow {
  const lines = text.split("\n");
  const env: Record<string, string> = {};
  const jobs: Job[] = [];
  let i = 0;
  const indentOf = (line: string): number => line.length - line.trimStart().length;
  const skippable = (line: string): boolean => line.trim() === "" || line.trimStart().startsWith("#");

  /** The `key: value` lines indented deeper than `parent`, as a map (an `env:` block). */
  const readMap = (parent: number, where: string): Record<string, string> => {
    const map: Record<string, string> = {};
    while (i < lines.length && (skippable(lines[i]!) || indentOf(lines[i]!) > parent)) {
      const line = lines[i++]!;
      if (skippable(line)) continue;
      const match = KEY.exec(line);
      if (!match || match[2] !== undefined || match[4] === undefined)
        throw new Error(`${where}: ci-local cannot read line ${i}: ${line.trim()}`);
      map[match[3]!] = scalar(match[4], `${where}, line ${i}`);
    }
    return map;
  };
  /** Skip the lines indented deeper than `parent` (a block ci-local does not need, like `with:`). */
  const skipBlock = (parent: number): void => {
    while (i < lines.length && (skippable(lines[i]!) || indentOf(lines[i]!) > parent)) i++;
  };
  /** A `|` block scalar: the lines indented deeper than `parent`, less the first line's indent. */
  const readBlock = (parent: number): string => {
    const body: string[] = [];
    let indent: number | null = null;
    while (i < lines.length && (lines[i]!.trim() === "" || indentOf(lines[i]!) > parent)) {
      const line = lines[i++]!;
      if (line.trim() === "") {
        body.push("");
        continue;
      }
      indent ??= indentOf(line);
      body.push(line.slice(indent));
    }
    return body.join("\n").trimEnd();
  };

  while (i < lines.length) {
    const line = lines[i++]!;
    if (skippable(line)) continue;
    const top = KEY.exec(line);
    if (!top || top[1] !== "") continue;
    const key = top[3]!;
    if (!TOP_KEYS.has(key)) throw new Error(`ci.yml: ci-local does not know the top-level key '${key}'`);
    if (key === "env") Object.assign(env, readMap(0, "env"));
    else if (key !== "jobs") skipBlock(0);
    else {
      while (i < lines.length && (skippable(lines[i]!) || indentOf(lines[i]!) > 0)) {
        const jobLine = lines[i++]!;
        if (skippable(jobLine)) continue;
        const jobMatch = KEY.exec(jobLine);
        if (!jobMatch || jobMatch[4] !== undefined) throw new Error(`jobs: ci-local cannot read line ${i}: ${jobLine.trim()}`);
        const jobIndent = jobMatch[1]!.length;
        const job = { name: jobMatch[3]!, timeoutMinutes: null as number | null, steps: [] as Step[] };
        while (i < lines.length && (skippable(lines[i]!) || indentOf(lines[i]!) > jobIndent)) {
          const keyLine = lines[i++]!;
          if (skippable(keyLine)) continue;
          const keyMatch = KEY.exec(keyLine);
          const jobKey = keyMatch?.[3];
          if (!keyMatch || jobKey === undefined || !JOB_KEYS.has(jobKey))
            throw new Error(`job ${job.name}: ci-local does not know '${keyLine.trim()}'`);
          if (jobKey === "timeout-minutes") job.timeoutMinutes = Number(keyMatch[4]);
          if (jobKey !== "steps") continue;
          const keyIndent = keyMatch[1]!.length;
          while (i < lines.length && (skippable(lines[i]!) || indentOf(lines[i]!) > keyIndent)) {
            const stepLine = lines[i]!;
            if (skippable(stepLine)) {
              i++;
              continue;
            }
            const first = KEY.exec(stepLine);
            if (!first || first[2] === undefined)
              throw new Error(`job ${job.name}: ci-local cannot read line ${i + 1}: ${stepLine.trim()}`);
            const fieldIndent = first[1]!.length + 2;
            const step = { name: "", run: null as string | null, uses: null as string | null, env: {} as Record<string, string>, id: "" };
            let firstField = true;
            while (i < lines.length) {
              const fieldLine = lines[i]!;
              if (skippable(fieldLine)) {
                i++;
                continue;
              }
              const field = KEY.exec(fieldLine);
              const atField =
                field !== null && (firstField ? field[2] !== undefined : field[2] === undefined && field[1]!.length === fieldIndent);
              if (!atField) {
                if (indentOf(fieldLine) >= fieldIndent || field === null)
                  throw new Error(`job ${job.name}: ci-local cannot read line ${i + 1}: ${fieldLine.trim()}`);
                break;
              }
              i++;
              firstField = false;
              const name = field[3]!;
              const where = `job ${job.name}, line ${i}`;
              if (!STEP_KEYS.has(name))
                throw new Error(`${where}: ci-local does not know the step key '${name}'; teach tools/ci-local.ts what CI does with it`);
              const value = field[4];
              if (name === "with") skipBlock(fieldIndent);
              else if (name === "env") step.env = readMap(fieldIndent, where);
              else if (name === "run") step.run = value === "|" ? readBlock(fieldIndent) : scalar(value ?? "", where);
              else if (value === undefined) throw new Error(`${where}: '${name}' needs a value`);
              else if (name === "uses") step.uses = scalar(value, where);
              else if (name === "name") step.name = scalar(value, where);
            }
            if ((step.run === null) === (step.uses === null)) throw new Error(`job ${job.name}: a step needs exactly one of run and uses`);
            job.steps.push({
              name: step.name || (step.run ?? `uses ${step.uses}`).split("\n")[0]!,
              run: step.run,
              uses: step.uses,
              env: step.env,
            });
          }
        }
        jobs.push(job);
      }
    }
  }
  return { env, jobs };
}

/** A step that installs system packages: not something to run on someone's machine unasked. */
export function installsSystemPackages(script: string): boolean {
  return /\bapt(-get)?\s+(update|install)\b/.test(script);
}

interface Outcome {
  readonly job: string;
  readonly ok: boolean;
  readonly seconds: number;
  readonly failedStep: string | null;
  readonly skipped: readonly string[];
}

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function main(argv: string[]): number {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const refAt = argv.indexOf("--ref");
  const ref = refAt >= 0 ? argv[refAt + 1] : undefined;
  if (refAt >= 0 && (ref === undefined || ref.startsWith("--")))
    throw new Error("--ref needs a git ref, such as origin/main or a PR branch");
  const list = argv.includes("--list");
  const keep = argv.includes("--keep");
  const wanted = argv.filter((arg, at) => !arg.startsWith("--") && !(refAt >= 0 && at === refAt + 1));

  let root = repo;
  let worktree: string | null = null;
  if (ref !== undefined && !list) {
    worktree = mkdtempSync(join(tmpdir(), "rge-ci-local-"));
    git(["worktree", "add", "--detach", worktree, ref], repo);
    root = worktree;
  }
  try {
    const workflow = parseWorkflow(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
    const unknown = wanted.filter((name) => !workflow.jobs.some((job) => job.name === name));
    if (unknown.length > 0)
      throw new Error(`No job named ${unknown.join(", ")} (jobs: ${workflow.jobs.map((job) => job.name).join(", ")})`);
    const jobs = wanted.length === 0 ? workflow.jobs : workflow.jobs.filter((job) => wanted.includes(job.name));

    if (list) {
      for (const job of jobs) {
        console.log(`${job.name}${job.timeoutMinutes === null ? "" : ` (${job.timeoutMinutes} min)`}`);
        for (const step of job.steps)
          console.log(`  ${step.run === null ? "skip" : installsSystemPackages(step.run) ? "skip" : "run "}  ${step.name}`);
      }
      return 0;
    }

    const commit = git(["log", "-1", "--format=%h %s"], root);
    const dirty = worktree === null && git(["status", "--porcelain"], root) !== "";
    console.log(
      `ci-local: ${jobs.map((job) => job.name).join(", ")} at ${commit}${dirty ? " (with uncommitted changes)" : ""}, Node ${process.version}`
    );

    const outputs = mkdtempSync(join(tmpdir(), "rge-ci-output-"));
    const done = new Set<string>();
    const outcomes: Outcome[] = [];
    for (const job of jobs) {
      const started = Date.now();
      const deadline = job.timeoutMinutes === null ? Infinity : started + job.timeoutMinutes * 60_000;
      const skipped: string[] = [];
      let failedStep: string | null = null;
      console.log(`\n=== ${job.name}`);
      for (const [index, step] of job.steps.entries()) {
        if (step.run === null) continue;
        if (installsSystemPackages(step.run)) {
          skipped.push(step.name);
          console.log(`--- ${step.name}: skipped (installs system packages; install them yourself if the job needs them):\n${step.run}`);
          continue;
        }
        const env = { ...workflow.env, ...step.env };
        const key = JSON.stringify([step.run, env]);
        if (done.has(key)) {
          console.log(`--- ${step.name}: already ran in an earlier job`);
          continue;
        }
        console.log(`--- ${step.name}`);
        const output = join(outputs, `${job.name}-${index}`);
        writeFileSync(output, "");
        const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
          cwd: root,
          stdio: "inherit",
          timeout: deadline === Infinity ? undefined : Math.max(1, deadline - Date.now()),
          env: {
            ...process.env,
            CI: "true",
            GITHUB_WORKSPACE: root,
            GITHUB_OUTPUT: output,
            ...Object.fromEntries(Object.entries(env).map(([name, value]) => [name, value.replaceAll("${GITHUB_WORKSPACE}", root)])),
          },
        });
        if (result.status !== 0) {
          failedStep =
            result.error !== undefined && Date.now() >= deadline
              ? `${step.name} (the job's ${job.timeoutMinutes} minutes ran out)`
              : step.name;
          break;
        }
        done.add(key);
      }
      outcomes.push({ job: job.name, ok: failedStep === null, seconds: (Date.now() - started) / 1000, failedStep, skipped });
    }
    rmSync(outputs, { recursive: true, force: true });

    console.log(`\nci-local at ${commit}${dirty ? " (with uncommitted changes)" : ""}:`);
    for (const outcome of outcomes) {
      const note = outcome.ok
        ? outcome.skipped.length > 0
          ? `  (skipped: ${outcome.skipped.join("; ")})`
          : ""
        : `  failed at: ${outcome.failedStep}`;
      console.log(`  ${outcome.ok ? "pass" : "FAIL"}  ${outcome.job.padEnd(16)} ${outcome.seconds.toFixed(0).padStart(5)}s${note}`);
    }
    return outcomes.every((outcome) => outcome.ok) ? 0 : 1;
  } finally {
    if (worktree !== null) {
      if (keep) console.log(`\nThe worktree is kept at ${worktree} (remove it with: git worktree remove --force ${worktree})`);
      else git(["worktree", "remove", "--force", worktree], repo);
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
