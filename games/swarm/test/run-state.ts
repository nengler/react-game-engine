import { findComponent } from "@tsengine/testing";

import { Play } from "../generated/Play.ts";

/** The `Play` component in the running game's tree, or null (on the title and end screens). */
export function findPlay(): Play | null {
  return findComponent(Play);
}

/** The run's numbers as `Play` keeps them. */
export function runOf(play: Play): {
  time: number;
  hp: number;
  level: number;
  kills: number;
  enemies: number;
  bolts: number;
  gems: number;
  build: Record<string, number>;
} {
  const s = play.s;
  return {
    time: s.time,
    hp: s.hp,
    level: s.level,
    kills: s.kills,
    enemies: s.enemies.length,
    bolts: s.bolts.length,
    gems: s.gems.length,
    build: { ...s.build },
  };
}
