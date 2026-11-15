import { Game, Screen, Text } from "@rge/runtime/jsx";

import { Block } from "./Block.tsx";
import { useGame } from "./GameState.ts";
import { Hero } from "./Hero.tsx";
import { BLOCKS, START } from "./level.ts";

/** The root: the level's blocks, the hero, and a count of jumps. Arrow keys run, Z or Space jumps. */
export default function Main() {
  const jumps = useGame((s) => s.jumps);
  return (
    <Game title="__NAME__" width={320} height={180} background="#10131c" assets="assets" font="font.png" textSize={8}>
      <Screen width={320} height={180} fit="integer">
        {BLOCKS.map((b) => (
          <Block key={b.id} x={b.x} y={b.y} width={b.width} height={b.height} />
        ))}
        <Hero startX={START.x} startY={START.y} />
        <Text x={8} y={8} color="white">{`jumps: ${jumps}`}</Text>
      </Screen>
    </Game>
  );
}
