/** A game's folder and its settings: the `"rge"` field of its package.json, with defaults for what is left out. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readGameSettings } from "@rge/player-node";

export interface Game {
  /** Absolute path of the game's folder. */
  readonly dir: string;
  readonly name: string;
  /** The entry file, relative to `dir`. */
  readonly entry: string;
  readonly src: string;
  readonly generated: string;
  readonly tsconfig: string;
}

export class UsageError extends Error {}

/** Read the game in `folder` (default: the current directory). Throws a UsageError that says what is missing. */
export function loadGame(folder: string = "."): Game {
  const dir = resolve(folder);
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest))
    throw new UsageError(`${dir} has no package.json: run rge from a game's folder, or give the folder as an argument.`);
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
  const settings = readGameSettings(dir);
  const name = settings.name ?? (pkg.name ?? "game").replace(/^@[^/]+\//, "");
  const entry = settings.entry ?? "main.ts";
  if (!existsSync(join(dir, entry)))
    throw new UsageError(`${dir} has no ${entry} (the "rge" field's "entry" in package.json names the entry file).`);
  return { dir, name, entry, src: settings.src ?? "src", generated: settings.generated ?? "generated", tsconfig: "tsconfig.json" };
}
