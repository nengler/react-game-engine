import { Camera, Game, Screen } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Level } from "./Level.tsx";
import { Player } from "./Player.tsx";

/** The game's root: a 320 × 180 screen showing one room at a time. */
export default function Main() {
  const originX = useGame((s) => s.originX);
  const originY = useGame((s) => s.originY);

  return (
    <Game name="Main" state={useGame} title="Kite" width={960} height={540} background="#12151f" assets="assets">
      <Screen width={320} height={180} fit="integer">
        <Level />
        <Player />
        <Camera transform={{ x: originX + 160, y: originY + 90 }} />
      </Screen>
    </Game>
  );
}
