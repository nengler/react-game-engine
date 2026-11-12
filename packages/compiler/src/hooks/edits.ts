/**
 * Text edits that remember what they replaced, so a position in the edited text can be traced back to the text the author
 * wrote. The hook inliner rewrites a file before the rest of the compiler sees it; with this, a diagnostic (or an IR span) that
 * points into the rewritten file is moved back to the same code in the original, or, inside an expansion, to the call it came from.
 */
import type { SourceSpan } from "../ir/types.ts";

export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Apply non-overlapping edits to `text` (in any order). */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/** One pass of edits, by start in the text they were applied to: where each was, and how long its replacement is. */
type Pass = readonly { readonly start: number; readonly end: number; readonly length: number }[];

export class EditMap {
  readonly #passes: Pass[] = [];

  /** How many passes have been applied: a position in the text after `n` passes maps back with `toOriginal(pos, n)`. */
  get passes(): number {
    return this.#passes.length;
  }

  /** Apply one pass of edits and remember it. */
  apply(text: string, edits: readonly Edit[]): string {
    if (edits.length === 0) return text;
    this.#passes.push([...edits].sort((a, b) => a.start - b.start).map((e) => ({ start: e.start, end: e.end, length: e.text.length })));
    return applyEdits(text, edits);
  }

  /**
   * Where a position of the text after the first `passes` passes was in the original. A position inside a replacement maps
   * to the start of what it replaced (`bias: "end"`: to its end), so a span inside an inlined hook covers the call.
   */
  toOriginal(position: number, passes = this.#passes.length, bias: "start" | "end" = "start"): number {
    let pos = position;
    for (let i = passes - 1; i >= 0; i--) {
      let delta = 0;
      let mapped: number | null = null;
      for (const edit of this.#passes[i]!) {
        const newStart = edit.start + delta;
        if (pos < newStart) break;
        if (pos < newStart + edit.length || (edit.length === 0 && pos === newStart)) {
          mapped = bias === "start" ? edit.start : edit.end;
          break;
        }
        delta += edit.length - (edit.end - edit.start);
      }
      pos = mapped ?? pos - delta;
    }
    return pos;
  }

  /** A span in `fileName` after `passes` passes, moved back to the original `text`. Spans in other files are kept. */
  span(span: SourceSpan, fileName: string, original: string, passes = this.#passes.length): SourceSpan {
    if (span.fileName !== fileName || passes === 0) return span;
    const start = this.toOriginal(span.start, passes, "start");
    const end = Math.max(start, this.toOriginal(span.end, passes, "end"));
    const before = original.slice(0, start);
    const lineStart = before.lastIndexOf("\n") + 1;
    return { fileName: span.fileName, start, end, line: before.split("\n").length, column: start - lineStart + 1 };
  }

  /** A copy of IR (or any JSON data) with every `span` in `fileName` moved back to the original text. */
  spans<T>(value: T, fileName: string, original: string): T {
    if (this.#passes.length === 0) return value;
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk);
      if (v === null || typeof v !== "object") return v;
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(v)) {
        out[key] = key === "span" && inner !== null && typeof inner === "object" ? this.span(inner as SourceSpan, fileName, original) : walk(inner);
      }
      return out;
    };
    return walk(value) as T;
  }
}
