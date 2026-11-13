/**
 * Whether two values hold the same data: equal primitives, or arrays and plain objects whose items and keys hold the same data,
 * compared all the way down. Functions are equal only to themselves. This is how the game state decides a `set` changed
 * nothing; `keepIfEqual` uses it so a value read again from a store renders only when it differs.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, i) => sameData(item, other[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]));
}

/**
 * `previous` when `next` holds the same data, else `next`: an updater that renders only on a real change,
 * `setView((previous) => keepIfEqual(previous, readView()))`. A setter renders when it gets a different object, and a read
 * from a store usually builds a new one each time.
 */
export function keepIfEqual<T>(previous: T, next: T): T {
  return sameData(previous, next) ? previous : next;
}
