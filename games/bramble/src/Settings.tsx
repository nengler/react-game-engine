import { Entity, Text, useMutable, useStore } from "@tsengine/runtime/jsx";

import { Choices } from "./Choices.tsx";
import { useGame } from "./GameState.ts";
import { KeyPrompt } from "./KeyPrompt.tsx";
import { settingsRows } from "./rules/menu.ts";
import { bindingsView, settings, settingsView } from "./settings.ts";

/** The settings: volumes, full screen, and a row for each key. Press confirm on a key's row, then the key to give it. */
export function Settings() {
  // The settings live in `settings`, outside the game state: the screen reads them, and follows them while it is shown.
  const values = useStore(settings, settingsView);
  const bindings = useStore(settings, bindingsView);
  const { adjust, bindKey, resetSettings, closeSettings } = useGame.actions();
  const s = useMutable({
    /** The action whose row waits for a key, if any. */
    capturing: null as string | null,
  });
  // A const, so a callback under `capturing !== null` keeps that narrowing (TypeScript does not keep it for `s.capturing`).
  const capturing = s.capturing;
  return (
    <Entity>
      <Text x={0} y={6} width={320} align="center">
        SETTINGS
      </Text>
      <Choices
        top={22}
        rows={settingsRows(values, bindings, s.capturing)}
        onAdjust={adjust}
        onChoose={(id) => {
          if (id.startsWith("bind:")) s.capturing = id.slice(5);
          else if (id === "back") closeSettings();
          else if (id === "reset") resetSettings();
          else adjust(id, 1);
        }}
      />
      {/* A row waiting for a key: the prompt takes the next key, and the menu hears nothing meanwhile. */}
      {capturing !== null && (
        <KeyPrompt
          onKey={(key) => {
            bindKey(capturing, key);
            s.capturing = null;
          }}
          onCancel={() => {
            s.capturing = null;
          }}
        />
      )}
    </Entity>
  );
}
