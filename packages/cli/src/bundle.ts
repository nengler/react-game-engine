/**
 * Bundle a game's entry file into one ES module for the Rust host (QuickJS-ng), which has no module resolver and no Node.
 * The output must not import anything from Node or a native package: that is checked here, so a stray `node:fs` fails the
 * build instead of the player.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const FORBIDDEN = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](?:node:|koffi["'/])/;

export async function bundleForHost(entry: string, out: string): Promise<{ readonly bytes: number }> {
  const outfile = resolve(out);
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    legalComments: "none",
    logLevel: "warning",
  });
  const text = readFileSync(outfile, "utf8");
  const found = FORBIDDEN.exec(text);
  if (found !== null) throw new Error(`${outfile} imports from Node or a native package (${found[0].trim()}): the host cannot load it.`);
  return { bytes: text.length };
}
