import {
  TSE_IN_MOUSE_X,
  TSE_IN_MOUSE_Y,
  TSE_IN_QUIT,
  TSE_IN_WHEEL,
  TSE_KEY_DOWN,
  TSE_KEY_PRESSED,
  TSE_KEY_RELEASED,
} from "@tsengine/player";
/**
 * The browser's input as libtse reports it after a frame: the key table's flags (down, pressed, released) in `KEY_NAMES` order, the
 * pointer in the canvas's pixels, the wheel, and what was typed. A touch is the left mouse button where the finger is, so a game made
 * for a mouse plays with a finger. Events are gathered between frames; a press and release inside one frame still reads as a press.
 */
import { KEY_NAMES } from "@tsengine/runtime";

/** A KeyboardEvent's `code` as a name in the key table. */
export function keyName(code: string): string | null {
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad") && code.length === 7 && code[6]! >= "0" && code[6]! <= "9") return code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  switch (code) {
    case "ShiftLeft":
    case "ShiftRight":
      return "Shift";
    case "ControlLeft":
    case "ControlRight":
      return "Control";
    case "AltLeft":
    case "AltRight":
      return "Alt";
    case "NumpadEnter":
      return "Enter";
    default:
      return code;
  }
}

/** The standard gamepad mapping's buttons, as the key table names them. */
const PAD_BUTTONS: Readonly<Record<string, number>> = { PadA: 0, PadB: 1, PadX: 2, PadY: 3, PadLB: 4, PadRB: 5, PadBack: 8, PadStart: 9 };
const PAD_DPAD: Readonly<Record<string, number>> = { PadUp: 12, PadDown: 13, PadLeft: 14, PadRight: 15 };

export class WebInput {
  readonly #index = new Map<string, number>(KEY_NAMES.map((name, i) => [name, i]));
  readonly #down = new Uint8Array(KEY_NAMES.length);
  readonly #pressed = new Uint8Array(KEY_NAMES.length);
  readonly #released = new Uint8Array(KEY_NAMES.length);
  #x = 0;
  #y = 0;
  #wheel = 0;
  #typed = "";
  #lastTyped = "";
  deadzone = 0.35;
  readonly #canvas: HTMLCanvasElement;
  /** Called on the first press of any kind: the browser lets audio start only after one. */
  onGesture: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    const target = canvas.ownerDocument.defaultView ?? window;
    target.addEventListener("keydown", (e) => this.#key(e, true));
    target.addEventListener("keyup", (e) => this.#key(e, false));
    target.addEventListener("blur", () => {
      for (let i = 0; i < this.#down.length; i++) if (this.#down[i]) this.#set(i, false);
    });
    // Pointer events cover a mouse, a pen and a finger alike. The canvas captures the pointer, so a drag that leaves it still ends.
    canvas.addEventListener("pointerdown", (e) => {
      this.#move(e);
      canvas.setPointerCapture(e.pointerId);
      this.#button(e.pointerType === "mouse" ? e.button : 0, true);
      this.onGesture?.();
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => this.#move(e));
    canvas.addEventListener("pointerup", (e) => {
      this.#move(e);
      this.#button(e.pointerType === "mouse" ? e.button : 0, false);
    });
    canvas.addEventListener("pointercancel", (e) => this.#button(e.pointerType === "mouse" ? e.button : 0, false));
    canvas.addEventListener(
      "wheel",
      (e) => {
        // raylib counts a wheel turned away from the player (scrolling up) as positive.
        this.#wheel += e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
        e.preventDefault();
      },
      { passive: false }
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  #set(i: number, down: boolean): void {
    if (down && !this.#down[i]) this.#pressed[i] = 1;
    if (!down && this.#down[i]) this.#released[i] = 1;
    this.#down[i] = down ? 1 : 0;
  }

  #key(e: KeyboardEvent, down: boolean): void {
    const name = keyName(e.code);
    const i = name === null ? undefined : this.#index.get(name);
    if (down) {
      this.onGesture?.();
      if (e.key === "Backspace") this.#typed += "\b";
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.#typed += e.key;
    }
    if (i === undefined) return;
    if (!e.repeat) this.#set(i, down);
    // Keys the game reads are the game's: no scrolling with Space or the arrows, no going back with Backspace.
    if (!e.ctrlKey && !e.metaKey) e.preventDefault();
  }

  #button(button: number, down: boolean): void {
    const name = button === 0 ? "MouseLeft" : button === 2 ? "MouseRight" : button === 1 ? "MouseMiddle" : null;
    const i = name === null ? undefined : this.#index.get(name);
    if (i !== undefined) this.#set(i, down);
  }

  /** The pointer in the canvas's drawing-buffer pixels: the units the window size is reported in. */
  #move(e: PointerEvent): void {
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.#x = ((e.clientX - rect.left) * this.#canvas.width) / rect.width;
    this.#y = ((e.clientY - rect.top) * this.#canvas.height) / rect.height;
  }

  #pollGamepad(): void {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p !== null && p.connected) ?? null;
    const held = (name: string): boolean => {
      if (pad === null) return false;
      const b = PAD_BUTTONS[name] ?? PAD_DPAD[name];
      if (b !== undefined && pad.buttons[b]?.pressed) return true;
      const x = pad.axes[0] ?? 0,
        y = pad.axes[1] ?? 0;
      if (name === "PadLeft") return x < -this.deadzone;
      if (name === "PadRight") return x > this.deadzone;
      if (name === "PadUp") return y < -this.deadzone;
      if (name === "PadDown") return y > this.deadzone;
      return false;
    };
    for (const name of [...Object.keys(PAD_BUTTONS), ...Object.keys(PAD_DPAD)]) {
      const i = this.#index.get(name);
      if (i !== undefined && held(name) !== (this.#down[i] === 1)) this.#set(i, held(name));
    }
  }

  /** Write the frame's input (the pointer, the wheel) and key flags, and start gathering the next frame's. */
  collect(input: Float64Array, keys: Uint8Array): void {
    this.#pollGamepad();
    input[TSE_IN_MOUSE_X] = this.#x;
    input[TSE_IN_MOUSE_Y] = this.#y;
    input[TSE_IN_WHEEL] = this.#wheel;
    input[TSE_IN_QUIT] = 0;
    const n = Math.min(keys.length, this.#down.length);
    for (let i = 0; i < n; i++) {
      keys[i] = (this.#down[i] ? TSE_KEY_DOWN : 0) | (this.#pressed[i] ? TSE_KEY_PRESSED : 0) | (this.#released[i] ? TSE_KEY_RELEASED : 0);
    }
    this.#pressed.fill(0);
    this.#released.fill(0);
    this.#wheel = 0;
    this.#lastTyped = this.#typed;
    this.#typed = "";
  }

  /** What was typed before the last frame's input was collected. */
  typed(): string {
    return this.#lastTyped;
  }
}
