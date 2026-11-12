import { Entity, Text, useInput, useState } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Menu } from "./Menu.tsx";
import { settingsRows } from "./rules/menu.ts";

/** The settings: volumes, full screen, and a row for each key. Press confirm on a key's row, then the key to give it. */
export function Settings() {
  const values = useGame((s) => s.settings);
  const bindings = useGame((s) => s.bindings);
  const { adjust, bindKey, resetSettings, closeSettings } = useGame((s) => s);
  /** The action whose row waits for a key, if any. */
  const [capturing, setCapturing] = useState<string | null>(null);
  useInput((input) => {
    // A row waiting for a key takes the first one pressed (the press that chose the row was an earlier step); Escape cancels.
    if (capturing === null) return;
    const key = input.lastPressed();
    if (key === undefined) return;
    if (key !== "Escape") bindKey(capturing, key);
    setCapturing(null);
  });
  return (
    <Entity name="Settings">
      <Text transform={{ x: 0, y: 6 }} width={320} align="center" size={10} color="#e8d9a8" text="SETTINGS" />
      <Menu
        top={22}
        rows={settingsRows(values, bindings, capturing)}
        disabled={capturing !== null}
        onAdjust={adjust}
        onChoose={(id) => {
          if (id.startsWith("bind:")) setCapturing(id.slice(5));
          else if (id === "back") closeSettings();
          else if (id === "reset") resetSettings();
          else adjust(id, 1);
        }}
      />
    </Entity>
  );
}
