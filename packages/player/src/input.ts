import type { InputState, Point, ViewTransform } from "@rge/runtime";
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
  /** Set by the player after each frame is built. */
  view: ViewTransform = IDENTITY_VIEW;
  readonly #warner: Warner;

  constructor(warner: Warner) {
    this.#warner = warner;
  }

  pressed(key: string): boolean {
    return this.#flags(key, RGE_KEY_PRESSED);
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
    const { a, b, c, d, e, f } = this.view;
    const det = a * d - b * c;
    if (det === 0 || !Number.isFinite(det)) return { x, y };
    const dx = x - e;
    const dy = y - f;
    return { x: (d * dx - c * dy) / det, y: (a * dy - b * dx) / det };
  }

  #flags(key: string, flag: number): boolean {
    const index = KEY_INDEX.get(key);
    if (index === undefined) {
      this.#warner.once(`key:${key}`, `Unknown key '${key}': it is never pressed. Known keys: ${KEYS.join(", ")}.`);
      return false;
    }
    return ((this.keys[index] as number) & flag) !== 0;
  }
}
