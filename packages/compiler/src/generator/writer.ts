/** Minimal indenting line writer for generated source. */
export class CodeWriter {
  readonly #lines: string[] = [];
  #indent = 0;

  line(text: string): void {
    this.#lines.push(text === "" ? "" : "  ".repeat(this.#indent) + text);
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
    this.open(`${header} {`);
    body();
    this.close("}");
  }

  toString(): string {
    return this.#lines.join("\n") + "\n";
  }
}
