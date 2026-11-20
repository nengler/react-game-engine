import type { ScreenFit } from "@tsengine/runtime";

import { KEY_INDEX } from "./protocol.ts";
import type { InputFrame } from "./recording.ts";
import { fitScreen } from "./screen.ts";

/** A frame of a script: an `InputFrame` with every key list filled in. */
export interface ScriptFrame extends InputFrame {
  readonly dt: number;
  readonly down: string[];
  readonly pressed: string[];
  readonly released: string[];
  /** The mouse in window pixels, once a script has used `click@` or `mouse@`; it stays where it was put, like a held key. */
  readonly mouse?: { readonly x: number; readonly y: number };
  /** The mouse is on what is labelled this, once a script has used `click@Label` or `mouse@Label` (see `InputFrame.aim`). */
  readonly aim?: { readonly label: string; readonly fresh: boolean };
}

/** What an action name in a script stands for: one key name or several (any of them held counts as the action). */
export type InputBindings = Readonly<Record<string, string | readonly string[]>>;

export interface ScriptOptions {
  /** Action names a script may use, such as `jump` or `right`. A name that is not here must be a key name (`ArrowRight`, `Z`). */
  readonly bindings?: InputBindings;
  /** Seconds each frame reports. Default 1/60. */
  readonly dt?: number;
  /**
   * How the game's canvas sits in the window, for `click@x,y` and `mouse@x,y`: those points are in the game's own pixels (the
   * `<Screen>`'s size) and are turned into window points through the same fit the player uses. Without it a game pixel is a
   * window pixel.
   */
  readonly screen?: {
    readonly width: number;
    readonly height: number;
    readonly windowWidth: number;
    readonly windowHeight: number;
    readonly fit?: ScreenFit;
  };
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
 * - `click@Play` taps what is labelled Play: the middle of the topmost thing that can be pressed and holds that text, wherever
 *   it is on screen when the frame comes up (`mouse@Play` only moves there). A label is its text as drawn; it takes no count.
 *   Looked up by `playGame`, `runScript` and `tse screenshot`; a run that cannot look it up says so.
 * - `mouse@120,64` moves the mouse to that point of the game's canvas (and leaves it there); `click@120,64` moves it and taps
 *   `MouseLeft` for one frame. Neither takes a count. See `ScriptOptions.screen` for the canvas-to-window mapping.
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
  const toWindow = (point: { x: number; y: number }): { x: number; y: number } => {
    const screen = options.screen;
    if (screen === undefined) return point;
    const at = fitScreen(screen.width, screen.height, screen.windowWidth, screen.windowHeight, screen.fit ?? "contain");
    return { x: at.left + point.x * at.scaleX, y: at.top + point.y * at.scaleY };
  };
  const mouseAt = new Map<number, { x: number; y: number }>();
  const aimAt = new Map<number, string>();
  const items = script
    .split(/\n|,(?![-\d])/) // a comma followed by a digit is inside a point: click@30,40
    .map((item) => item.trim())
    .filter((item) => item !== "");
  for (const item of items) {
    const terms = item.split("+").map((term) => parseTerm(term.trim(), item));
    const length = Math.max(1, ...terms.map((term) => term.count));
    for (let f = 0; f < length; f++) {
      const held = new Set<string>();
      for (const term of terms) {
        if (f >= term.count) continue;
        if (term.label !== undefined) {
          if (term.click) held.add("MouseLeft");
          if (f === 0) aimAt.set(perFrame.length, term.label);
        } else if (term.mouse !== undefined) {
          if (term.click) held.add("MouseLeft");
          if (f === 0) mouseAt.set(perFrame.length, toWindow(term.mouse));
        } else for (const key of keysOf(term.name, bindings, item)) held.add(key);
      }
      perFrame.push(held);
    }
  }
  const frames: ScriptFrame[] = [];
  let before: ReadonlySet<string> = new Set();
  let mouse: { x: number; y: number } | undefined;
  // The mouse stays where it was last put, by a point or by a label, whichever came later.
  let aim: string | undefined;
  perFrame.forEach((down, index) => {
    const pressed = [...down].filter((key) => !before.has(key));
    const released = [...before].filter((key) => !down.has(key));
    const label = aimAt.get(index);
    if (mouseAt.has(index)) {
      mouse = mouseAt.get(index);
      aim = undefined;
    }
    if (label !== undefined) aim = label;
    const keys = { dt, down: [...down], pressed, released };
    frames.push(
      aim !== undefined ? { ...keys, aim: { label: aim, fresh: label !== undefined } } : mouse === undefined ? keys : { ...keys, mouse }
    );
    before = down;
  });
  return frames;
}

/** How many frames a script runs for, without building them. */
export function scriptLength(script: string, options: ScriptOptions = {}): number {
  return parseInputScript(script, options).length;
}

interface Term {
  readonly name: string;
  readonly count: number;
  /** For `click@x,y` and `mouse@x,y`: the canvas point. */
  readonly mouse?: { readonly x: number; readonly y: number };
  /** For `click@Label` and `mouse@Label`: the text of what to aim at. */
  readonly label?: string;
  readonly click?: boolean;
}

function parseTerm(text: string, item: string): Term {
  const point = /^(click|mouse)@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(text);
  if (point !== null)
    return { name: point[1] as string, count: 1, mouse: { x: Number(point[2]), y: Number(point[3]) }, click: point[1] === "click" };
  if (/^(click|mouse)@/.test(text)) {
    // Not a point: a label, the text of what to aim at (`click@Play`, `click@New run`). A count or a number gone wrong is a mistake.
    const label = /^(click|mouse)@([^*\d\s-][^*]*)$/.exec(text);
    if (label !== null) return { name: label[1] as string, count: 1, label: (label[2] as string).trim(), click: label[1] === "click" };
    throw new Error(
      `Cannot read '${text}' in the input script item '${item}': ${text.includes("*") ? "click@ and mouse@ take no count; repeat the item instead" : "expected click@x,y, mouse@x,y, or a label (click@Play)"}.`
    );
  }
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
  throw new Error(
    `Unknown name '${name}' in the input script item '${item}': it is neither a key name nor an action${known.length > 0 ? ` (actions: ${known.join(", ")})` : ""}.`
  );
}
