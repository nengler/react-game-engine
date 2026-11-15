import { createControls } from "@tsengine/runtime";

/**
 * The game's actions and the keys and gamepad buttons that do each: the one place to rebind. `Main.tsx` hands it to
 * `<Game controls={controls}>`, so anywhere in the game `input.pressed("confirm")` means any of the confirm keys. Buttons take their
 * action as `pressKey`; `left` `right` `up` `down` move the focus between the pads and `confirm` presses the focused one (the engine's).
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

/** What the screen calls an action's key, in the font's one case: `keyLabel("wave")` is `"SPACE"`. */
export function keyLabel(action: string): string {
  return controls.label(action).toUpperCase();
}
