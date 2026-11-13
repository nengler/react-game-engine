/**
 * Quick fixes for the `RGE` diagnostics whose message already says what to write instead. Each is a list of text edits on the
 * component as the editor has it, found from the diagnostic's span with a small scanner (brackets, strings and comments), not a
 * parse: a fix that cannot be made with confidence is simply not offered.
 */
import type { CompilerDiagnostic } from "@rge/compiler";

export const AUTHORING_MODULE = "@rge/runtime/jsx";

/** Replace `[start, end)` of the text with `text`. Offsets are UTF-16, as JavaScript strings and the LSP count them. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface Fix {
  readonly title: string;
  readonly edits: readonly Edit[];
  /** The fix to apply when the editor applies "the" fix for the diagnostic. */
  readonly preferred?: boolean;
}

/** The fixes for one diagnostic in `source`. */
export function fixesFor(source: string, diagnostic: CompilerDiagnostic): Fix[] {
  const span = diagnostic.span;
  if (span === null) return [];
  switch (diagnostic.code) {
    case "RGE1005": {
      const name = /^'([A-Za-z_$][\w$]*)' is not imported/.exec(diagnostic.message)?.[1];
      if (name === undefined) return [];
      return [{ title: `Import '${name}' from "${AUTHORING_MODULE}"`, edits: addImport(source, name), preferred: true }];
    }
    case "RGE1001":
      return fromReact(source, span.start, span.end);
    case "RGE1004": {
      const name = /^'([A-Za-z_$][\w$]*)' is not exported by/.exec(diagnostic.message)?.[1];
      if (name === undefined) return [];
      const edits = removeImport(source, name);
      return edits.length === 0 ? [] : [{ title: `Remove '${name}' from the import`, edits }];
    }
    case "RGE1203":
      return /^Write the text as the children of <Text>/.test(diagnostic.message) ? textToChildren(source, span.start, span.end) : [];
    case "RGE1108":
      return /^Take actions with/.test(diagnostic.message) ? wholeStateToActions(source, span.start, span.end) : [];
    case "RGE1102":
      return replaceReactHook(source, span.start, span.end);
    default:
      return [];
  }
}

// -- scanning -------------------------------------------------------------------------------------------------------------

/** The index just past the string, template or comment starting at `i`, or `i` when none starts there. */
function skipLiteral(source: string, i: number): number {
  const c = source[i];
  if (c === "/" && source[i + 1] === "/") {
    const end = source.indexOf("\n", i);
    return end === -1 ? source.length : end;
  }
  if (c === "/" && source[i + 1] === "*") {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (c === '"' || c === "'" || c === "`") {
    for (let j = i + 1; j < source.length; j++) {
      if (source[j] === "\\") j++;
      else if (source[j] === c) return j + 1;
      // A template's `${…}` may hold strings of its own; a closing backtick inside one is rare enough to ignore here.
    }
    return source.length;
  }
  return i;
}

/**
 * A call's arguments, from the `(` at `open`: each argument's range (trimmed), and the index of the closing `)`. Null when the
 * brackets do not close.
 */
export function callArguments(source: string, open: number): { readonly args: { start: number; end: number }[]; readonly close: number } | null {
  if (source[open] !== "(") return null;
  const args: { start: number; end: number }[] = [];
  let depth = 0;
  let from = open + 1;
  const push = (to: number): void => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(source[start] as string)) start++;
    while (end > start && /\s/.test(source[end - 1] as string)) end--;
    if (end > start) args.push({ start, end });
  };
  for (let i = open; i < source.length; i++) {
    const skipped = skipLiteral(source, i);
    if (skipped !== i) {
      i = skipped - 1;
      continue;
    }
    const c = source[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        push(i);
        return { args, close: i };
      }
    } else if (c === "," && depth === 1) {
      push(i);
      from = i + 1;
    }
  }
  return null;
}

// -- imports --------------------------------------------------------------------------------------------------------------

interface NamedImport {
  /** The whole declaration, up to and including its `;` when it has one. */
  readonly start: number;
  readonly end: number;
  /** Inside the braces. */
  readonly listStart: number;
  readonly listEnd: number;
  readonly names: string[];
  readonly hasDefault: boolean;
}

/** The first named import from `module`, or the first that holds `containing`. */
function namedImport(source: string, module: string, containing?: string): NamedImport | null {
  const quoted = module.replace(/[/.]/g, (c) => `\\${c}`);
  const re = new RegExp(`import\\s+(?:([A-Za-z_$][\\w$]*)\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*(["'])${quoted}\\3\\s*;?`, "g");
  for (let match = re.exec(source); match !== null; match = re.exec(source)) {
    const listStart = source.indexOf("{", match.index) + 1;
    const listEnd = listStart + (match[2] as string).length;
    const names = (match[2] as string)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (containing !== undefined && !names.some((n) => n.replace(/^type\s+/, "") === containing)) continue;
    return { start: match.index, end: match.index + match[0].length, listStart, listEnd, names, hasDefault: match[1] !== undefined };
  }
  return null;
}

/** `type Child` and `Child` sort as `Child`. */
const sortKey = (name: string): string => name.replace(/^type\s+/, "").toLowerCase();
const isSorted = (names: readonly string[]): boolean => names.every((name, i) => i === 0 || sortKey(names[i - 1] as string) <= sortKey(name));

function withNames(names: readonly string[], add: readonly string[], remove: readonly string[] = []): string[] {
  const kept = names.filter((name) => !remove.includes(name.replace(/^type\s+/, "")));
  const missing = add.filter((name) => !kept.some((n) => n.replace(/^type\s+/, "") === name));
  const sorted = isSorted(names);
  const out = [...kept, ...missing];
  return sorted ? out.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)) : out;
}

/** Edits that add `name` to the import from the authoring module, or add that import before the first line. */
export function addImport(source: string, name: string): Edit[] {
  const found = namedImport(source, AUTHORING_MODULE);
  if (found === null) return [{ start: 0, end: 0, text: `import { ${name} } from "${AUTHORING_MODULE}";\n` }];
  if (found.names.some((n) => n.replace(/^type\s+/, "") === name)) return [];
  return [{ start: found.listStart, end: found.listEnd, text: ` ${withNames(found.names, [name]).join(", ")} ` }];
}

/** Edits that take `name` out of the import from the authoring module (the whole import when it was the only name). */
export function removeImport(source: string, name: string, add: readonly string[] = []): Edit[] {
  const found = namedImport(source, AUTHORING_MODULE, name);
  if (found === null) return add.flatMap((n) => addImport(source, n));
  const names = withNames(found.names, add, [name]);
  if (names.length === 0 && !found.hasDefault) {
    const end = source[found.end] === "\n" ? found.end + 1 : found.end;
    return [{ start: found.start, end, text: "" }];
  }
  return [{ start: found.listStart, end: found.listEnd, text: ` ${names.join(", ")} ` }];
}

/** `import { useState } from "react"`: the same names from the authoring module. */
function fromReact(source: string, start: number, end: number): Fix[] {
  const declaration = source.slice(start, end);
  const match = /^import\s*\{([^}]*)\}\s*from\s*(["'])react\2\s*;?$/.exec(declaration.trim());
  if (match === null) return [];
  const names = (match[1] as string)
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "");
  const existing = namedImport(source, AUTHORING_MODULE);
  const lineEnd = source[end] === "\n" ? end + 1 : end;
  if (existing === null) {
    return [{ title: `Import from "${AUTHORING_MODULE}" instead of "react"`, edits: [{ start, end, text: `import { ${names.join(", ")} } from "${AUTHORING_MODULE}";` }], preferred: true }];
  }
  return [
    {
      title: `Import from "${AUTHORING_MODULE}" instead of "react"`,
      edits: [
        { start, end: lineEnd, text: "" },
        { start: existing.listStart, end: existing.listEnd, text: ` ${withNames(existing.names, names).join(", ")} ` },
      ].sort((a, b) => a.start - b.start),
      preferred: true,
    },
  ];
}

// -- JSX and selectors ----------------------------------------------------------------------------------------------------

/** `<Text text="hi" />` → `<Text>hi</Text>`; `<Text text={label} size={8} />` → `<Text size={8}>{label}</Text>`. */
function textToChildren(source: string, start: number, end: number): Fix[] {
  const attribute = source.slice(start, end);
  const match = /^text\s*=\s*([\s\S]+)$/.exec(attribute);
  if (match === null) return [];
  const value = (match[1] as string).trim();
  let content: string;
  if (/^"[^"{}<>]*"$|^'[^'{}<>]*'$/.test(value)) content = value.slice(1, -1);
  else if (value.startsWith("{") && value.endsWith("}")) content = value;
  else return [];
  // The element's own end: the `/>` after the attribute, with nothing but attributes between. Only a self-closing <Text> is fixed.
  let i = end;
  let depth = 0;
  for (; i < source.length; i++) {
    const skipped = skipLiteral(source, i);
    if (skipped !== i) {
      i = skipped - 1;
      continue;
    }
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && (c === ">" || (c === "/" && source[i + 1] === ">"))) break;
  }
  if (source[i] !== "/" || source[i + 1] !== ">") return [];
  // Take the attribute out with the space before it.
  let from = start;
  while (from > 0 && /[ \t]/.test(source[from - 1] as string)) from--;
  let before = i;
  while (before > end && /\s/.test(source[before - 1] as string)) before--;
  return [
    {
      title: "Move the text into the children of <Text>",
      edits: [
        { start: from, end, text: "" },
        { start: before, end: i + 2, text: `>${content}</Text>` },
      ],
      preferred: true,
    },
  ];
}

/** `const { begin } = useGame((s) => s)` → `const { begin } = useGame.actions()`. */
function wholeStateToActions(source: string, start: number, end: number): Fix[] {
  const text = source.slice(start, end);
  const match = /([A-Za-z_$][\w$]*)\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\2\s*\)/.exec(text);
  if (match === null) return [];
  const at = start + match.index;
  return [{ title: `Use ${match[1]}.actions()`, edits: [{ start: at, end: at + match[0].length, text: `${match[1]}.actions()` }], preferred: true }];
}

// -- React's hooks --------------------------------------------------------------------------------------------------------

/** `useEffect(fn, [])` → `useMount(fn)`; `useMemo(() => value, deps)` → `value`; `useCallback(fn, deps)` → `fn`. */
function replaceReactHook(source: string, start: number, end: number): Fix[] {
  const call = /^(useEffect|useLayoutEffect|useMemo|useCallback)\s*\(/.exec(source.slice(start, end));
  if (call === null) return [];
  const hook = call[1] as string;
  const open = start + call[0].length - 1;
  const parsed = callArguments(source, open);
  if (parsed === null) return [];
  const [fn, deps] = parsed.args;
  if (fn === undefined) return [];
  const fnText = source.slice(fn.start, fn.end);
  const callEnd = parsed.close + 1;
  if (hook === "useEffect" || hook === "useLayoutEffect") {
    // Only an effect that runs once: with `[]` it is exactly a mount, and a function it returns is the cleanup, as with `useMount`.
    if (deps === undefined || source.slice(deps.start, deps.end).replace(/\s/g, "") !== "[]") return [];
    return [
      {
        title: `Use useMount (an effect with [] runs once, when the component comes)`,
        edits: [...removeImport(source, hook, ["useMount"]), { start, end: callEnd, text: `useMount(${fnText})` }].sort((a, b) => a.start - b.start),
        preferred: true,
      },
    ];
  }
  if (hook === "useCallback") {
    return [{ title: "Use the function itself (a component's functions need no useCallback)", edits: [...removeImport(source, hook), { start, end: callEnd, text: fnText }].sort((a, b) => a.start - b.start), preferred: true }];
  }
  // useMemo: an arrow with an expression body becomes that expression, a derived `const`, worked out when what it reads changes.
  const arrow = /^\(\s*\)\s*=>\s*/.exec(fnText);
  if (arrow === null) return [];
  let body = fnText.slice(arrow[0].length).trim();
  if (body.startsWith("{")) return [];
  if (body.startsWith("(") && callArguments(body, 0)?.close === body.length - 1) body = body.slice(1, -1).trim();
  return [{ title: "Use the value itself (a derived const needs no useMemo)", edits: [...removeImport(source, hook), { start, end: callEnd, text: body }].sort((a, b) => a.start - b.start), preferred: true }];
}

/** Apply edits (none overlapping) to a text: what the editor will do, for tests. */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let out = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}
