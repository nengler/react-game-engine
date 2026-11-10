import type { InputState } from "@rge/runtime";
import type { Controls } from "./body.ts";

/**
 * Which keys and gamepad buttons are which control. Plain TypeScript, so it can use arrays and loops: the game state's `step`
 * action receives the polled input itself and reads the controls here, which is where rebinding would go.
 */
const LEFT = ["ArrowLeft", "A", "PadLeft"];
const RIGHT = ["ArrowRight", "D", "PadRight"];
const UP = ["ArrowUp", "W", "PadUp"];
const DOWN = ["ArrowDown", "S", "PadDown"];
const JUMP = ["Z", "C", "Space", "PadA"];
const DASH = ["X", "Shift", "PadX", "PadB", "PadRB"];

const anyDown = (input: InputState, keys: readonly string[]): boolean => keys.some((key) => input.down(key));
const anyPressed = (input: InputState, keys: readonly string[]): boolean => keys.some((key) => input.pressed(key));

/** The controls this step's input asks for. */
export function readControls(input: InputState): Controls {
  return {
    left: anyDown(input, LEFT),
    right: anyDown(input, RIGHT),
    up: anyDown(input, UP),
    down: anyDown(input, DOWN),
    jumpHeld: anyDown(input, JUMP),
    jumpPressed: anyPressed(input, JUMP),
    dashPressed: anyPressed(input, DASH),
  };
}
