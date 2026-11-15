import { Entity, Shape, Text, useInput } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Inventory } from "./Inventory.tsx";
import { Choices } from "./Choices.tsx";
import { pauseRows } from "./rules/menu.ts";

/**
 * The pause screen, over the world: the inventory, then Resume and Save and quit. It is `modal`, so while it is shown it takes
 * the keys and the world hears none; Escape closes it here, since the play screen no longer hears it.
 */
export function Pause() {
  const { togglePause, choosePaused } = useGame.actions();
  useInput((input) => {
    if (input.pressed("back")) togglePause();
  });
  return (
    <Entity modal>
      <Shape kind="rect" width={320} height={180} color="#10131cd9" />
      <Text x={12} y={8}>PAUSED</Text>
      <Inventory />
      <Choices top={120} rows={pauseRows()} onChoose={choosePaused} />
    </Entity>
  );
}
