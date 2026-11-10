const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
const DIGITS = Array.from({ length: 10 }, (_, i) => String(i));
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);

/**
 * Key names, in the order of the keys buffer (the header's `RGE_KEYS`, which is append only): what
 * `input.pressed("Space")` accepts. Mouse buttons are keys too. `@rge/player` indexes its buffer by this list, and the
 * compiler checks key names written as literals against it.
 */
export const KEY_NAMES: readonly string[] = [
  "Space", "Enter", "Escape", "Tab", "Backspace", "Shift", "Control", "Alt",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ...LETTERS,
  ...DIGITS,
  ...FUNCTION_KEYS,
  "MouseLeft", "MouseRight", "MouseMiddle",
];

/** Polled input for one frame. The mock builds it from test-supplied data; a real backend would fill it from devices. */
export interface InputState {
  /** True only on the frame the key went down. */
  pressed(key: string): boolean;
  /** True while the key is held. */
  down(key: string): boolean;
  /** True only on the frame the key went up. */
  released(key: string): boolean;
  readonly pointerX: number;
  readonly pointerY: number;
}

export interface InputSnapshot {
  readonly pressed?: Iterable<string>;
  readonly down?: Iterable<string>;
  readonly released?: Iterable<string>;
  readonly pointer?: { readonly x: number; readonly y: number };
}

export function createInputState(snapshot: InputSnapshot = {}): InputState {
  const pressed = new Set(snapshot.pressed);
  const down = new Set(snapshot.down);
  const released = new Set(snapshot.released);
  return {
    pressed: (key) => pressed.has(key),
    down: (key) => down.has(key),
    released: (key) => released.has(key),
    pointerX: snapshot.pointer?.x ?? 0,
    pointerY: snapshot.pointer?.y ?? 0,
  };
}

/** Input with nothing pressed, used when a tick is given none. */
export const NO_INPUT: InputState = createInputState();
