import { createControls, type InputState } from "@tsengine/runtime";

import type { Controls } from "./body.ts";

/**
 * The game's actions and the keys and gamepad buttons that do each: the one place to rebind. `Main.tsx` hands it to
 * `<Game controls={controls}>`, so anywhere in the game `input.down("left")` means any of the left keys.
 */
export const controls = createControls({
  left: ["ArrowLeft", "A", "PadLeft"],
  right: ["ArrowRight", "D", "PadRight"],
  up: ["ArrowUp", "W", "PadUp"],
  down: ["ArrowDown", "S", "PadDown"],
  jump: ["Z", "Space", "PadA"],
  dash: ["X", "PadX", "PadB"],
  /** Held to hold onto a wall and climb it. */
  grab: ["C", "Shift", "V", "PadRB", "PadLB", "PadY"],
  /** Start, and back to the title. */
  confirm: ["Enter", "Z", "C", "Space", "PadA", "PadStart"],
});

/** What the rules need from this step's input. */
export function readControls(input: InputState): Controls {
  return {
    left: input.down("left"),
    right: input.down("right"),
    up: input.down("up"),
    down: input.down("down"),
    jumpHeld: input.down("jump"),
    jumpPressed: input.pressed("jump"),
    dashPressed: input.pressed("dash"),
    grab: input.down("grab"),
  };
}
