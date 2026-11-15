import type { Controls, InputState, Point, ViewTransform } from "@rge/runtime";

import {
  KEYS,
  KEY_INDEX,
  RGE_IN_HEIGHT,
  RGE_IN_LEN,
  RGE_IN_MOUSE_X,
  RGE_IN_MOUSE_Y,
  RGE_IN_QUIT,
  RGE_IN_WIDTH,
  RGE_IN_DT,
  RGE_KEY_DOWN,
  RGE_KEY_PRESSED,
  RGE_KEY_RELEASED,
} from "./protocol.ts";
import { Warner } from "./warn.ts";

const IDENTITY_VIEW: ViewTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * The input buffers a backend fills each frame, seen as the `InputState` handlers poll.
 * `values` and `keys` are what `Backend.frame` writes into; `view` is the world → window map of the
 * frame that was last drawn, which is how the mouse is turned into a world position.
 */
export class PlayerInput implements InputState {
  readonly values = new Float64Array(RGE_IN_LEN);
  readonly keys = new Uint8Array(KEYS.length);
  /**
   * The key flags handlers read (`pressed`, `down`, `released`). The raw `keys` unless a fixed timestep is on, when the player
   * swaps in a per-step copy so an edge is seen by exactly one step (see `createPlayer`).
   */
  handlerKeys: Uint8Array = this.keys;
  /** Set by the player after each frame is built. */
  view: ViewTransform = IDENTITY_VIEW;
  /** What was typed for the step being run (`InputState.typed`): the frame's characters, seen by its first step only. */
  typed = "";
  /** What the backend reported typed in the frame just drawn, for the next frame's first step. */
  typedNext = "";
  /** The game's actions (`<Game controls>`): a name of one of them is answered for any of its keys. */
  controls: Controls | undefined = undefined;
  readonly #warner: Warner;

  constructor(warner: Warner) {
    this.#warner = warner;
  }

  pressed(key: string): boolean {
    return this.#flags(key, RGE_KEY_PRESSED);
  }

  lastPressed(): (typeof KEYS)[number] | undefined {
    for (let i = 0; i < KEYS.length; i++) if (((this.handlerKeys[i] as number) & RGE_KEY_PRESSED) !== 0) return KEYS[i];
    return undefined;
  }

  isAction(name: string): boolean {
    return this.controls?.keysOf(name) !== undefined;
  }

  down(key: string): boolean {
    return this.#flags(key, RGE_KEY_DOWN);
  }

  released(key: string): boolean {
    return this.#flags(key, RGE_KEY_RELEASED);
  }

  /** The mouse in world space: where it is on the screen, taken back through the camera. */
  get pointerX(): number {
    return this.worldPoint(this.values[RGE_IN_MOUSE_X] as number, this.values[RGE_IN_MOUSE_Y] as number).x;
  }

  get pointerY(): number {
    return this.worldPoint(this.values[RGE_IN_MOUSE_X] as number, this.values[RGE_IN_MOUSE_Y] as number).y;
  }

  /** Seconds since the previous frame, as the backend measured it. */
  get dt(): number {
    return this.values[RGE_IN_DT] as number;
  }

  get width(): number {
    return this.values[RGE_IN_WIDTH] as number;
  }

  get height(): number {
    return this.values[RGE_IN_HEIGHT] as number;
  }

  /** The mouse in window coordinates (origin top-left). */
  get screenX(): number {
    return this.values[RGE_IN_MOUSE_X] as number;
  }

  get screenY(): number {
    return this.values[RGE_IN_MOUSE_Y] as number;
  }

  /** The window was asked to close. */
  get quit(): boolean {
    return this.values[RGE_IN_QUIT] !== 0;
  }

  /** The world-space point under a window-space point: the inverse of the view last drawn. */
  worldPoint(x: number, y: number): Point {
    return pointThrough(this.view, x, y);
  }

  /** The point a window-space point is, in the coordinates of any layer drawn through `view` (the HUD's, say). */
  pointThrough(view: ViewTransform, x: number, y: number): Point {
    return pointThrough(view, x, y);
  }

  #flags(name: string, flag: number): boolean {
    const keys = this.controls?.keysOf(name);
    if (keys === undefined) return this.#keyFlags(name, flag);
    if (flag === RGE_KEY_RELEASED)
      return keys.some((k) => this.#keyFlags(k, RGE_KEY_RELEASED)) && !keys.some((k) => this.#keyFlags(k, RGE_KEY_DOWN));
    return keys.some((k) => this.#keyFlags(k, flag));
  }

  #keyFlags(key: string, flag: number): boolean {
    const index = KEY_INDEX.get(key);
    if (index === undefined) {
      const actions = this.controls ? Object.keys(this.controls.bindings) : [];
      this.#warner.once(
        `key:${key}`,
        `Unknown key '${key}': it is never pressed. ${actions.length > 0 ? `Actions: ${actions.join(", ")}. ` : ""}Known keys: ${KEYS.join(", ")}.`
      );
      return false;
    }
    return ((this.handlerKeys[index] as number) & flag) !== 0;
  }
}

/** The point whose image under `view` is (x, y): the inverse map. A view that cannot be inverted leaves the point as it is. */
function pointThrough(view: ViewTransform, x: number, y: number): Point {
  const { a, b, c, d, e, f } = view;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) return { x, y };
  const dx = x - e;
  const dy = y - f;
  return { x: (d * dx - c * dy) / det, y: (a * dy - b * dx) / det };
}
