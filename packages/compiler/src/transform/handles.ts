/**
 * What handler code may touch besides state: typed runtime handles and a fixed
 * call allowlist. Grows only when a milestone needs it. (M0's runtime manifest
 * will eventually supply these tables.)
 */

export interface HandleType {
  /** Method name → exact argument count. */
  readonly methods: Readonly<Record<string, number>>;
  readonly properties: readonly string[];
}

export const HANDLE_TYPES: Readonly<Record<string, HandleType>> = {
  InputState: {
    methods: { pressed: 1, down: 1, released: 1 },
    properties: ["pointerX", "pointerY"],
  },
  GameObject: { methods: {}, properties: [] },
};

/** Allowlisted functions → argument count (`-1`: one or more). `clamp` is imported from the runtime. */
export const ALLOWED_FUNCTIONS: Readonly<Record<string, number>> = {
  "Math.abs": 1, "Math.floor": 1, "Math.ceil": 1, "Math.round": 1, "Math.sign": 1, "Math.sqrt": 1,
  "Math.sin": 1, "Math.cos": 1, "Math.min": -1, "Math.max": -1, "clamp": 3,
};

/** Allowlisted functions that must be imported from the runtime module. */
export const RUNTIME_FUNCTIONS: ReadonlySet<string> = new Set(["clamp"]);
