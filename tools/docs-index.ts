/**
 * Rebuilds the guide's search index: the `MANIFEST` array written into every page of `docs/`, one entry per `<section id>`
 * named in it, whose `text` is what the search box matches. Run it after changing a section of the guide:
 *
 *   node tools/docs-index.ts          # rewrite the index in every page
 *   node tools/docs-index.ts --check  # fail if any page's index is stale (a test runs this)
 *
 * There is one entry for each `<section id>` of the pages, in page order. Its text is the section's HTML with every tag replaced
 * by a space, entities decoded, in lower case (code included). A new section's title and group are its `data-title` and
 * `data-group`; an existing entry keeps the title and group it has (the navigation groups by them).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docs = resolve(import.meta.dirname, "../docs");
const PAGES = ["index.html", "language.html", "systems.html", "effects.html", "reference.html"];
const MANIFEST = /var MANIFEST = (\[.*?\]);\n/s;

interface Entry {
  readonly id: string;
  readonly title: string;
  readonly page: string;
  readonly group: string;
  readonly text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** The search text of one section: tags become spaces, entities are decoded, and it is lower-cased. */
export function sectionText(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<section id="${escaped}"[^>]*>.*?</section>`, "s").exec(html);
  if (!match) throw new Error(`No <section id="${id}">`);
  return decode(match[0].replace(/<[^>]+>/g, " ")).toLowerCase();
}

/** The index as it should be, from the pages as they are. */
export function buildIndex(): string {
  const html = new Map(PAGES.map((page) => [page, readFileSync(resolve(docs, page), "utf8")]));
  const current = MANIFEST.exec(html.get(PAGES[0]!)!);
  if (!current) throw new Error(`${PAGES[0]} has no MANIFEST`);
  const known = new Map((JSON.parse(current[1]!) as Entry[]).map((entry) => [entry.id, entry]));
  const entries: Entry[] = [];
  for (const [page, text] of html) {
    for (const section of text.matchAll(/<section id="([^"]+)"([^>]*)>/g)) {
      const id = section[1]!;
      const attribute = (name: string): string => decode(new RegExp(`${name}="([^"]*)"`).exec(section[2]!)?.[1] ?? id);
      const old = known.get(id);
      entries.push({ id, title: old?.title ?? attribute("data-title"), page, group: old?.group ?? attribute("data-group"), text: sectionText(text, id) });
    }
  }
  // Non-ASCII characters are escaped, as the pages have always held them.
  return JSON.stringify(entries).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Pages whose index differs from `buildIndex()`; with `write`, they are rewritten. */
export function updateIndex(write: boolean): string[] {
  const index = buildIndex();
  const stale: string[] = [];
  for (const page of PAGES) {
    const file = resolve(docs, page);
    const html = readFileSync(file, "utf8");
    const next = html.replace(MANIFEST, () => `var MANIFEST = ${index};\n`);
    if (next === html) continue;
    stale.push(page);
    if (write) writeFileSync(file, next);
  }
  return stale;
}

// Run as a script (not imported by the test): `import.meta.main` is newer than the Node this repository supports.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const stale = updateIndex(!check);
  if (check && stale.length > 0) {
    console.error(`The search index is stale in ${stale.join(", ")}: run node tools/docs-index.ts`);
    process.exit(1);
  }
  console.log(stale.length === 0 ? "The search index is up to date." : `Rewrote the search index in ${stale.join(", ")}.`);
}
