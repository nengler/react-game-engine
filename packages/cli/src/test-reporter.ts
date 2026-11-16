/**
 * A reporter for `node --test` that writes one JSON object a line: each test that passed, failed or was skipped, with its file,
 * line and (for a failure) the error's message, and a summary last. `tse check --json` reads it, so a tool or a language model gets
 * the failures as data rather than as the spec reporter's text.
 *
 *     node --test --test-reporter=./test-reporter.ts --test-reporter-destination=results.jsonl
 */
interface TestEventData {
  readonly name?: string;
  readonly nesting?: number;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly skip?: boolean | string;
  readonly todo?: boolean | string;
  readonly details?: { readonly type?: string; readonly error?: unknown; readonly duration_ms?: number };
  readonly counts?: Record<string, number>;
}

interface TestEvent {
  readonly type: string;
  readonly data: TestEventData;
}

/** The message of a failure: an assertion's own words, not the wrapper `node:test` puts around it. */
function message(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export default async function* reporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  for await (const event of source) {
    const data = event.data;
    // A suite is reported as a test too; only tests that are not suites are listed.
    if (event.type === "test:pass" || event.type === "test:fail") {
      if (data.details?.type === "suite") continue;
      const status = event.type === "test:fail" ? "fail" : data.skip !== undefined && data.skip !== false ? "skip" : "pass";
      yield `${JSON.stringify({
        status,
        name: data.name,
        file: data.file,
        line: data.line,
        ...(status === "fail" ? { error: message(data.details?.error) } : {}),
      })}\n`;
    } else if (event.type === "test:summary" && data.file === undefined && data.counts !== undefined) {
      yield `${JSON.stringify({ summary: data.counts })}\n`;
    }
  }
}
