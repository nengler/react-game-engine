/** Reports a problem once per key, so a typo in a per-frame path does not flood the console 60 times a second. */
export class Warner {
  readonly #seen = new Set<string>();
  readonly #sink: (message: string) => void;

  constructor(sink: (message: string) => void = (message) => console.warn(message)) {
    this.#sink = sink;
  }

  once(key: string, message: string): void {
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#sink(message);
  }
}
