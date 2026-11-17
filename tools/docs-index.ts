/**
 * Rebuilds the guide's search index: the `MANIFEST` array in `docs/search-index.js`, which every page of `docs/` loads before
 * `docs/guide.js`, one entry per `<section id>` of the pages, whose `text` is what the search box matches. Run it after changing a
 * section of the guide:
 *
 *   node tools/docs-index.ts          # rewrite docs/search-index.js
 *   node tools/docs-index.ts --check  # fail if it is stale (a test runs this)
 *
 * There is one entry for each `<section id>` of the pages, in page order. Its text is the section's HTML with every tag replaced
 * by a space, entities decoded, in lower case (code included). A new section's title is its `data-title`, and its group is the
 * one its `data-group` already has in the index (or the `data-group` itself); an existing entry keeps its title and group.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docs = resolve(import.meta.dirname, "../docs");
const PAGES = ["index.html", "language.html", "systems.html", "effects.html", "reference.html"];
const INDEX = resolve(docs, "search-index.js");
const MANIFEST = /var MANIFEST = (\[.*?\]);\n/s;
const HEADER = "/* The guide's search index, written by tools/docs-index.ts from the <section>s of the pages: do not edit it by hand. */\n";

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
  const current = MANIFEST.exec(readFileSync(INDEX, "utf8"));
  if (!current) throw new Error("docs/search-index.js has no MANIFEST");
  const known = new Map((JSON.parse(current[1]!) as Entry[]).map((entry) => [entry.id, entry]));
  const sections = [...html].flatMap(([page, text]) =>
    [...text.matchAll(/<section id="([^"]+)"([^>]*)>/g)].map((section) => {
      const id = section[1]!;
      const attribute = (name: string): string => decode(new RegExp(`${name}="([^"]*)"`).exec(section[2]!)?.[1] ?? id);
      return { id, page, text, title: attribute("data-title"), dataGroup: attribute("data-group") };
    })
  );
  // A new section joins the navigation group its `data-group` already maps to ("Start here" is shown as "Start").
  const groupOf = new Map<string, string>();
  for (const s of sections) {
    const old = known.get(s.id);
    if (old && !groupOf.has(s.dataGroup)) groupOf.set(s.dataGroup, old.group);
  }
  const entries: Entry[] = sections.map((s) => {
    const old = known.get(s.id);
    return {
      id: s.id,
      title: old?.title ?? s.title,
      page: s.page,
      group: old?.group ?? groupOf.get(s.dataGroup) ?? s.dataGroup,
      text: sectionText(s.text, s.id),
    };
  });
  // Non-ASCII characters are escaped, as the pages have always held them.
  return JSON.stringify(entries).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Whether docs/search-index.js differs from `buildIndex()`; with `write`, it is rewritten. */
export function updateIndex(write: boolean): boolean {
  const next = `${HEADER}var MANIFEST = ${buildIndex()};\n`;
  if (readFileSync(INDEX, "utf8") === next) return false;
  if (write) writeFileSync(INDEX, next);
  return true;
}

// Run as a script (not imported by the test): `import.meta.main` is newer than the Node this repository supports.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const stale = updateIndex(!check);
  if (check && stale) {
    console.error("docs/search-index.js is stale: run node tools/docs-index.ts");
    process.exit(1);
  }
  console.log(stale ? "Rewrote docs/search-index.js." : "The search index is up to date.");
}
