import { createControls, type InputState } from "@rge/runtime";
import { NO_INTENT, type Intent } from "./ui.ts";

/**
 * The game's actions and the keys and gamepad buttons that do each: the one place to rebind. `Main.tsx` hands it to
 * `<Game controls={controls}>`, so anywhere in the game `input.pressed("confirm")` means any of the confirm keys.
 */
export const controls = createControls({
  left: ["ArrowLeft", "PadLeft"],
  right: ["ArrowRight", "PadRight"],
  up: ["ArrowUp", "PadUp"],
  down: ["ArrowDown", "PadDown"],
  confirm: ["Z", "Enter", "PadA"],
  back: ["X", "Backspace", "PadB"],
  one: ["1"],
  two: ["2"],
  three: ["3"],
  upgrade: ["U", "PadX"],
  sell: ["S"],
  wave: ["Space", "PadY"],
  fast: ["F", "PadRB"],
  pause: ["Escape", "PadStart"],
});

/** What this step's input asks for. A direction is a press, not a hold: the cursor moves one pad each time. */
export function readIntent(input: InputState): Intent {
  return {
    ...NO_INTENT,
    dx: (input.pressed("right") ? 1 : 0) - (input.pressed("left") ? 1 : 0),
    dy: (input.pressed("down") ? 1 : 0) - (input.pressed("up") ? 1 : 0),
    confirm: input.pressed("confirm"),
    back: input.pressed("back"),
    buy: input.pressed("one") ? "bolt" : input.pressed("two") ? "mortar" : input.pressed("three") ? "frost" : null,
    upgrade: input.pressed("upgrade"),
    sell: input.pressed("sell"),
    wave: input.pressed("wave"),
    fast: input.pressed("fast"),
    pause: input.pressed("pause"),
  };
}
