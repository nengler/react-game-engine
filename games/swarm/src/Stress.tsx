import { Game, Screen } from "@tsengine/runtime/jsx";

import { Play } from "./Play.tsx";
import { controls } from "./rules/controls.ts";

interface StressProps {
  /** How many enemies to keep alive. */
  count: number;
  /** Which weapons the player carries (the default: the wand only). */
  armed?: boolean;
}

/**
 * The stress scene: a run that fills to `count` enemies at once and keeps them there, with a player who is never hurt and never
 * levels up. What `tools/frame-time.ts --count` times, and what a person plays to see a crowd that size (`tse dev` with
 * `stress.ts`).
 */
export default function Stress({ count, armed = false }: StressProps) {
  return (
    <Game
      vsync={false}
      controls={controls}
      upscale="sharp"
      title="Swarm stress"
      width={960}
      height={540}
      background="#16131f"
      assets="assets"
      font="tse:small"
      fixedStep={60}
    >
      <Screen width={480} height={270} fit="contain">
        <Play stress cap={count} startTime={3600} armed={armed} />
      </Screen>
    </Game>
  );
}
