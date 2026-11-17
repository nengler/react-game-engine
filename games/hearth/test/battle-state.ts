import { findComponent } from "@tsengine/testing";

import { Play } from "../generated/Play.ts";

/** The `Play` component in the running game's tree, or null (on the title and end screens). */
export function findPlay(): Play | null {
  return findComponent(Play);
}

/** The battle's numbers as `Play` keeps them, and how many enemies, towers and shots there are. */
export function battleOf(play: Play): {
  gold: number;
  lives: number;
  wave: number;
  active: boolean;
  enemies: number;
  towers: number;
  shots: number;
} {
  return {
    gold: play.s.gold,
    lives: play.s.lives,
    wave: play.s.wave,
    active: play.s.active,
    enemies: play.s.enemies.length,
    towers: play.s.towers.filter((t) => t !== null).length,
    shots: play.s.shots.length,
  };
}
