import { Entity, Text, useInput, useState } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Menu } from "./Menu.tsx";
import { bindingOf, settingsRows, wrap } from "./rules/menu.ts";

/** The settings: volumes, full screen, and a row for each key. Press confirm on a key's row, then the key to give it. */
export function Settings() {
  const values = useGame((s) => s.settings);
  const bindings = useGame((s) => s.bindings);
  const adjust = useGame((s) => s.adjust);
  const bindKey = useGame((s) => s.bindKey);
  const resetSettings = useGame((s) => s.resetSettings);
  const closeSettings = useGame((s) => s.closeSettings);
  const [cursor, setCursor] = useState(0);
  /** The action whose row waits for a key, if any. */
  const [capturing, setCapturing] = useState<string | null>(null);
  const rows = settingsRows(values, bindings, capturing);
  useInput((input) => {
    // A row waiting for a key takes the first one pressed (the press that chose the row was an earlier step); Escape cancels.
    if (capturing !== null) {
      const key = input.lastPressed();
      if (key === undefined) return;
      if (key !== "Escape") bindKey(capturing, key);
      setCapturing(null);
      return;
    }
    const id = rows[cursor]?.id ?? "";
    if (input.pressed("up")) setCursor((c) => wrap(c - 1, rows.length));
    if (input.pressed("down")) setCursor((c) => wrap(c + 1, rows.length));
    if (input.pressed("left")) adjust(id, -1);
    if (input.pressed("right")) adjust(id, 1);
    if (input.pressed("confirm")) {
      const action = bindingOf(id);
      if (action !== null) setCapturing(action);
      else if (id === "back") closeSettings();
      else if (id === "reset") resetSettings();
      else adjust(id, 1);
    }
  });
  return (
    <Entity name="Settings">
      <Text transform={{ x: 0, y: 6 }} width={320} align="center" size={10} color="#e8d9a8" text="SETTINGS" />
      <Menu top={22} rows={rows} cursor={cursor} />
    </Entity>
  );
}
