import { createControls, type InputState } from "@rge/runtime";

import type { Input } from "./run.ts";

/** The game's actions and the keys that do each: the one place to rebind. `Main.tsx` hands it to `<Game controls={controls}>`. */
export const controls = createControls({
  left: ["ArrowLeft", "A", "PadLeft"],
  right: ["ArrowRight", "D", "PadRight"],
  up: ["ArrowUp", "W", "PadUp"],
  down: ["ArrowDown", "S", "PadDown"],
  /** Talk, use, swing: whatever is in front of the character. */
  action: ["Z", "Space", "PadA"],
  confirm: ["Enter", "Z", "Space", "PadA", "PadStart"],
  back: ["Escape", "X", "PadB"],
});

/** What the rules need from this step's input. `action` is a press, so it is read once per step it is handed in. */
export function readInput(input: InputState): Input {
  return {
    dx: (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0),
    dy: (input.down("down") ? 1 : 0) - (input.down("up") ? 1 : 0),
    action: input.pressed("action"),
  };
}
