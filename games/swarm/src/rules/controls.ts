import { createControls } from "@tsengine/runtime";

/** The game's actions and the keys and gamepad buttons for each: the one place to rebind. */
export const controls = createControls({
  left: ["ArrowLeft", "A", "PadLeft"],
  right: ["ArrowRight", "D", "PadRight"],
  up: ["ArrowUp", "W", "PadUp"],
  down: ["ArrowDown", "S", "PadDown"],
  confirm: ["Enter", "Space", "PadA"],
  one: ["1"],
  two: ["2"],
  three: ["3"],
  pause: ["Escape", "P", "PadStart"],
});

/** What the screen calls an action's key, in upper case: `keyLabel("one")` is `"1"`. */
export function keyLabel(action: string): string {
  return controls.label(action).toUpperCase();
}
