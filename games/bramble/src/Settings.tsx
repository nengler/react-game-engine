import { Entity, Text, useInput } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Menu } from "./Menu.tsx";

/** The settings: volumes, full screen, and a row for each key. Press confirm on a key's row, then the key to give it. */
export function Settings() {
  const moveCursor = useGame((s) => s.moveCursor);
  const adjust = useGame((s) => s.adjust);
  const activate = useGame((s) => s.activate);
  const capture = useGame((s) => s.capture);
  const capturing = useGame((s) => s.menu.capturing);
  useInput((input) => {
    // A row waiting for a key takes the first one pressed (and the press that chose the row was an earlier step).
    if (capturing !== null) {
      capture(input.lastPressed());
      return;
    }
    if (input.pressed("up")) moveCursor(-1);
    if (input.pressed("down")) moveCursor(1);
    if (input.pressed("left")) adjust(-1);
    if (input.pressed("right")) adjust(1);
    if (input.pressed("confirm")) activate();
  });
  return (
    <Entity name="Settings">
      <Text transform={{ x: 0, y: 6 }} width={320} align="center" size={10} color="#e8d9a8" text="SETTINGS" />
      <Menu top={22} />
    </Entity>
  );
}
