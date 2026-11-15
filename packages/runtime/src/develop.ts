/**
 * Development warnings: mistakes the engine can see at run time but that do not stop the game, such as a write through a
 * `useMutable`'s object after its component has left the world. Each is reported once per key, so one in a per-frame path does
 * not flood the console. On by default (tests, `tse dev`, `tse check`); a game or tool turns them off, or catches them, with
 * `setDevelopmentWarnings`.
 */

let sink: ((message: string) => void) | null = (message) => globalThis.console?.warn?.(message);
const seen = new Set<string>();

/** Where development warnings go, or `null` for none. Forgets which have been reported, so each may be reported again. */
export function setDevelopmentWarnings(next: ((message: string) => void) | null): void {
  sink = next;
  seen.clear();
}

/** Report `message` once per `key`, if development warnings are on. */
export function developmentWarning(key: string, message: string): void {
  if (sink === null || seen.has(key)) return;
  seen.add(key);
  sink(message);
}
