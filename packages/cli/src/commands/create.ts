/**
 * `rge create <folder> [--name <name>] [--packs <dir>]`: a new game from the template in `template/`.
 *
 * `--packs` points the `@rge/*` dependencies at the tarballs `npm run pack` wrote, as `file:` dependencies: how a game is
 * tried before anything is published.
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "../config.ts";

/** `template/` is one level below the package root, beside `src/` and `dist/`. */
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "../../template");

function option(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export function createCommand(args: readonly string[]): number {
  const flagValues = new Set(["--name", "--packs"].map((flag) => args.indexOf(flag) + 1).filter((i) => i > 0));
  const folder = args.find((arg, i) => !arg.startsWith("--") && !flagValues.has(i));
  if (folder === undefined) throw new UsageError("usage: rge create <folder> [--name <name>] [--packs <dir>]");
  const target = resolve(folder);
  if (existsSync(target) && readdirSync(target).length > 0) throw new UsageError(`${target} exists and is not empty`);
  const name = option(args, "--name") ?? basename(target);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new UsageError(`"${name}" is not a package name: lowercase letters, digits, - . _`);

  cpSync(TEMPLATE, target, { recursive: true });
  renameSync(join(target, "gitignore"), join(target, ".gitignore")); // npm leaves a packed .gitignore out
  for (const file of ["package.json", "src/Main.tsx"]) {
    const path = join(target, file);
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("__NAME__", name));
  }

  const packs = option(args, "--packs");
  if (packs !== undefined) {
    const dir = resolve(packs);
    const tarballs = readdirSync(dir).filter((file) => /^rge-.+-\d.*\.tgz$/.test(file));
    if (tarballs.length === 0) throw new UsageError(`${dir} has no rge-*.tgz packs: run \`npm run pack\``);
    const manifest = join(target, "package.json");
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, Record<string, string> | undefined>;
    const dependencies = pkg["dependencies"] ?? {};
    const devDependencies = pkg["devDependencies"] ?? {};
    for (const file of tarballs) {
      const pack = /^rge-(.+?)-\d/.exec(file)?.[1] as string;
      const spec = `file:${join(dir, file)}`;
      // The command line and the testing library are for making the game, not for running it.
      if (pack === "cli" || pack === "testing") devDependencies[`@rge/${pack}`] = spec;
      else dependencies[`@rge/${pack}`] = spec;
    }
    pkg["dependencies"] = dependencies;
    pkg["devDependencies"] = devDependencies;
    writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  console.log(`created ${name} in ${target}\n  cd ${folder} && npm install && npm run check`);
  return 0;
}
