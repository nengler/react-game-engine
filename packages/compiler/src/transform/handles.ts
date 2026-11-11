/**
 * Language-level allowlist for handler code. Runtime-specific tables (handle
 * types, runtime functions like `clamp`) come from the runtime manifest.
 */

/** Allowlisted `Math` functions → argument count (`-1`: one or more). */
export const MATH_FUNCTIONS: Readonly<Record<string, number>> = {
  "Math.abs": 1, "Math.floor": 1, "Math.ceil": 1, "Math.round": 1, "Math.sign": 1, "Math.sqrt": 1,
  "Math.sin": 1, "Math.cos": 1, "Math.min": -1, "Math.max": -1,
  "Math.tan": 1, "Math.atan": 1, "Math.atan2": 2, "Math.pow": 2, "Math.hypot": -1, "Math.trunc": 1,
};

/** `Math`'s constants, read as values: `Math.PI * 2`. */
export const MATH_CONSTANTS: ReadonlySet<string> = new Set(["Math.PI", "Math.E", "Math.SQRT2"]);
