import type { SourceSpan } from "../ir/types.ts";

/** Where a generated line came from: its 0-based position, and the 1-based line and column in the source. */
export interface LineOrigin {
  readonly line: number;
  readonly column: number;
  readonly source: Pick<SourceSpan, "line" | "column">;
}

/**
 * Minimal indenting line writer for generated source. While `at(span, …)` is in effect, each line it writes remembers that
 * span's position, for a source map from the generated code back to the component source.
 */
export class CodeWriter {
  readonly #lines: string[] = [];
  readonly #origins: LineOrigin[] = [];
  #origin: SourceSpan | null = null;
  #indent = 0;

  /** The indentation the next line gets, for code that builds a multi-line expression to embed in one. */
  get indentation(): string {
    return "  ".repeat(this.#indent);
  }

  /** Lines written so far, each with the source position it came from (lines written outside any `at` have none). */
  get origins(): readonly LineOrigin[] {
    return this.#origins;
  }

  line(text: string): void {
    if (text !== "" && this.#origin !== null) {
      this.#origins.push({
        line: this.#lines.length,
        column: this.#indent * 2,
        source: { line: this.#origin.line, column: this.#origin.column },
      });
    }
    this.#lines.push(text === "" ? "" : "  ".repeat(this.#indent) + text);
  }

  /** Write lines that come from `span` in the source; the origin before is back afterwards. */
  at<T>(span: SourceSpan, write: () => T): T {
    const outer = this.#origin;
    this.#origin = span;
    try {
      return write();
    } finally {
      this.#origin = outer;
    }
  }

  /** Separate sections with one blank line; never at the start of a block or twice in a row. */
  blank(): void {
    const last = this.#lines.at(-1);
    if (last !== undefined && last !== "" && !last.endsWith("{")) this.#lines.push("");
  }

  /** Write `header {`, indent. */
  open(header: string): void {
    this.line(header);
    this.#indent++;
  }

  /** Dedent; optionally write a closing line (pass null to only dedent). */
  close(footer: string | null = null): void {
    this.#indent--;
    if (footer !== null) this.line(footer);
  }

  block(header: string, body: () => void): void {
    this.open(header === "" ? "{" : `${header} {`);
    body();
    this.close("}");
  }

  /** Where the next line goes, to `insert` lines there later (a prologue worked out from what follows it). */
  mark(): { readonly at: number; readonly indent: number; readonly origin: SourceSpan | null } {
    return { at: this.#lines.length, indent: this.#indent, origin: this.#origin };
  }

  /** Put lines at a `mark`, with the indentation and origin it had; what was written after it moves down. */
  insert(mark: { readonly at: number; readonly indent: number; readonly origin: SourceSpan | null }, texts: readonly string[]): void {
    if (texts.length === 0) return;
    const pad = "  ".repeat(mark.indent);
    this.#lines.splice(mark.at, 0, ...texts.map((t) => (t === "" ? "" : pad + t)));
    let first = this.#origins.findIndex((o) => o.line >= mark.at);
    if (first === -1) first = this.#origins.length;
    for (let i = first; i < this.#origins.length; i++) {
      const o = this.#origins[i]!;
      this.#origins[i] = { ...o, line: o.line + texts.length };
    }
    if (mark.origin !== null) {
      const added = texts.flatMap((t, i) =>
        t === "" ? [] : [{ line: mark.at + i, column: mark.indent * 2, source: { line: mark.origin!.line, column: mark.origin!.column } }]
      );
      this.#origins.splice(first, 0, ...added);
    }
  }

  /** Take back everything written since a `mark`, to write it again another way. */
  truncate(mark: { readonly at: number; readonly indent: number }): void {
    this.#lines.length = mark.at;
    while (this.#origins.length > 0 && this.#origins[this.#origins.length - 1]!.line >= mark.at) this.#origins.pop();
    this.#indent = mark.indent;
  }

  toString(): string {
    return this.#lines.join("\n") + "\n";
  }
}

/**
 * A source map (version 3) from generated lines to their origins in one source file: each line that has an origin maps its
 * first column to the start of the construct it was written for (a component, a hook, an element).
 */
export function sourceMap(origins: readonly LineOrigin[], file: string, source: string, sourceContent: string | null): string {
  const lines: string[] = [];
  let previousLine = 0;
  let previousColumn = 0;
  for (const origin of origins) {
    while (lines.length < origin.line) lines.push("");
    const sourceLine = origin.source.line - 1;
    const sourceColumn = origin.source.column - 1;
    // Fields: generated column (reset each line), source index (always 0, relative), source line and column (relative to the last segment).
    lines.push(vlq(origin.column) + vlq(0) + vlq(sourceLine - previousLine) + vlq(sourceColumn - previousColumn));
    previousLine = sourceLine;
    previousColumn = sourceColumn;
  }
  return JSON.stringify({
    version: 3,
    file,
    sources: [source],
    ...(sourceContent !== null ? { sourcesContent: [sourceContent] } : {}),
    names: [],
    mappings: lines.join(";"),
  });
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** A number as a base64 VLQ, as source maps write them. */
function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}
