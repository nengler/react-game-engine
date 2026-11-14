/**
 * Moves component code from `useState` to `useMutable`, file by file (the conversion is `convertToMutable` in
 * packages/compiler/src/codemod/mutable.ts, which says what it does and where it stops):
 *
 *   node tools/codemod-mutable.ts <file or folder>…    .tsx files, and the TSX inside template literals of .ts test files
 *   --check                                           say what would change, write nothing
 *
 * Run the tests afterwards: a handler now reads its own writes.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Node } from "typescript/ast";
import { isNoSubstitutionTemplateLiteral, isTemplateExpression } from "typescript/ast/is";
import { TsxParser } from "../packages/compiler/src/parser/parser.ts";
import { applyEdits, type Edit } from "../packages/compiler/src/hooks/edits.ts";
import { convertToMutable, type Converted } from "../packages/compiler/src/codemod/mutable.ts";

/** Each child of `node`, in order. */
function children(node: Node): Node[] {
  const out: Node[] = [];
  node.forEachChild((child) => {
    out.push(child);
    return undefined;
  });
  return out;
}

/**
 * A template literal's raw text as the TSX it holds: its escapes undone (`\\``, `\\${`, `\\\\`; `\\n` as U+2028, a line break that
 * comes back as `\\n`), and each `${…}` hole a name (`$hole0$`), so the snippet parses. `uncook` reverses it.
 */
function cook(raw: string): { code: string; holes: string[] } {
  const holes: string[] = [];
  let code = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1]!;
      code += next === "n" ? "\u2028" : next === "`" || next === "$" || next === "\\" ? next : `\\${next}`;
      i++;
    } else if (c === "$" && raw[i + 1] === "{") {
      let depth = 0;
      let j = i + 1;
      for (; j < raw.length; j++) {
        if (raw[j] === "{") depth++;
        else if (raw[j] === "}" && --depth === 0) break;
      }
      code += `$hole${holes.push(raw.slice(i, j + 1)) - 1}$`;
      i = j;
    } else code += c;
  }
  return { code, holes };
}

function uncook(code: string, holes: readonly string[]): string {
  let raw = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === "\\") raw += "\\\\";
    else if (c === "`") raw += "\\`";
    else if (c === "$" && code[i + 1] === "{") raw += "\\$";
    else if (c === "\u2028") raw += "\\n";
    else raw += c;
  }
  return raw.replace(/\$hole(\d+)\$/g, (_, n: string) => holes[Number(n)]!);
}

/** The TSX in a test file's template literals (and string literals) that declares state, converted in place. */
export function convertTestFile(parser: TsxParser, fileName: string, text: string): Converted {
  const parsed = parser.parse(fileName.replace(/\.ts$/, ".tsx.ts"), text);
  const edits: Edit[] = [];
  const problems: string[] = [];
  try {
    const sf = parsed.sourceFile;
    const visit = (node: Node): void => {
      const template = isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node);
      if (template && text.slice(node.getStart(sf), node.getEnd()).includes("useState")) {
        const start = node.getStart(sf) + 1;
        const end = node.getEnd() - 1;
        const { code, holes } = cook(text.slice(start, end));
        const line = text.slice(0, start).split("\n").length - 1;
        const result = convertToMutable(parser, "snippet.tsx", code, line);
        problems.push(...result.problems);
        if (result.changed) edits.push({ start, end, text: uncook(result.text, holes) });
        return;
      }
      for (const c of children(node)) visit(c);
    };
    visit(sf);
  } finally {
    parsed.dispose();
  }
  return { text: applyEdits(text, edits), changed: edits.length > 0, problems };
}

function filesUnder(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => (name === "node_modules" || name === "generated" || name.startsWith(".") ? [] : filesUnder(join(path, name))));
}

if (process.argv[1]?.endsWith("codemod-mutable.ts")) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const parser = new TsxParser();
  let changed = 0;
  let problems = 0;
  try {
    for (const file of args.filter((a) => !a.startsWith("--")).flatMap(filesUnder)) {
      const text = readFileSync(file, "utf8");
      const result = file.endsWith(".tsx") ? convertToMutable(parser, file, text) : file.endsWith(".ts") && text.includes("useState") ? convertTestFile(parser, file, text) : null;
      if (result === null) continue;
      for (const p of result.problems) console.log(`${file}:${p}`);
      problems += result.problems.length;
      if (!result.changed) continue;
      changed++;
      if (!check) writeFileSync(file, result.text);
      console.log(`${check ? "would change" : "changed"} ${file}`);
    }
  } finally {
    parser.close();
  }
  console.log(`${changed} file(s) ${check ? "to change" : "changed"}, ${problems} place(s) to finish by hand.`);
}
