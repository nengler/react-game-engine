import type { InputFrame } from "./recording.ts";
import { KEY_INDEX } from "./protocol.ts";

/** A frame of a script: an `InputFrame` with every key list filled in. */
export interface ScriptFrame extends InputFrame {
  readonly dt: number;
  readonly down: string[];
  readonly pressed: string[];
  readonly released: string[];
}

/** What an action name in a script stands for: one key name or several (any of them held counts as the action). */
export type InputBindings = Readonly<Record<string, string | readonly string[]>>;

export interface ScriptOptions {
  /** Action names a script may use, such as `jump` or `right`. A name that is not here must be a key name (`ArrowRight`, `Z`). */
  readonly bindings?: InputBindings;
  /** Seconds each frame reports. Default 1/60. */
  readonly dt?: number;
}

/** The empty frame names: no key at all for that long, as in `_*10`. */
const IDLE_NAMES: ReadonlySet<string> = new Set(["_", "wait", "idle"]);

/**
 * Turn a short script into input frames, one per fixed step. This is the format of every scripted run: the headless
 * harness, the screenshot tool, and the replays that test that a room can be finished.
 *
 *     right*30, jump, right*20+dash
 *
 * - Items are separated by commas (or new lines) and run one after another.
 * - An item is terms joined by `+`, which start together. A term is a name, or `name*N`: held for N frames. A name with
 *   no count is a tap: down for one frame. An item lasts as long as its longest term (at least one frame).
 * - `_`, `wait` or `idle` is nothing held: `_*10` waits ten frames.
 * - A name is an action from `bindings` (`jump`) or a key name (`ArrowRight`, `Z`, `PadA`).
 *
 * So `right*20+dash` holds right for 20 frames and taps dash on the first of them.
 *
 * Presses and releases are worked out from what is held, frame by frame: a key held in two items in a row is one long
 * hold, and two taps in a row (`jump, jump`) are one hold of two frames, so put a `_` between taps. A key still held
 * at the end is not released until a frame follows, so a run that must see a release ends with a `_`.
 */
export function parseInputScript(script: string, options: ScriptOptions = {}): ScriptFrame[] {
  const dt = options.dt ?? 1 / 60;
  const bindings = options.bindings ?? {};
  const perFrame: Set<string>[] = [];
  const items = script
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
  for (const item of items) {
    const terms = item.split("+").map((term) => parseTerm(term.trim(), item));
    const length = Math.max(1, ...terms.map((term) => term.count));
    for (let f = 0; f < length; f++) {
      const held = new Set<string>();
      for (const term of terms) if (f < term.count) for (const key of keysOf(term.name, bindings, item)) held.add(key);
      perFrame.push(held);
    }
  }
  const frames: ScriptFrame[] = [];
  let before: ReadonlySet<string> = new Set();
  for (const down of perFrame) {
    const pressed = [...down].filter((key) => !before.has(key));
    const released = [...before].filter((key) => !down.has(key));
    frames.push({ dt, down: [...down], pressed, released });
    before = down;
  }
  return frames;
}

/** How many frames a script runs for, without building them. */
export function scriptLength(script: string, options: ScriptOptions = {}): number {
  return parseInputScript(script, options).length;
}

interface Term {
  readonly name: string;
  readonly count: number;
}

function parseTerm(text: string, item: string): Term {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\*(\d+))?$/.exec(text);
  if (match === null) throw new Error(`Cannot read '${text}' in the input script item '${item}': expected a name or name*count.`);
  const count = match[2] === undefined ? 1 : Number(match[2]);
  return { name: match[1] as string, count };
}

function keysOf(name: string, bindings: InputBindings, item: string): readonly string[] {
  if (IDLE_NAMES.has(name)) return [];
  const bound = bindings[name];
  if (bound !== undefined) return typeof bound === "string" ? [bound] : bound;
  if (KEY_INDEX.has(name)) return [name];
  const known = Object.keys(bindings);
  throw new Error(`Unknown name '${name}' in the input script item '${item}': it is neither a key name nor an action${known.length > 0 ? ` (actions: ${known.join(", ")})` : ""}.`);
}
