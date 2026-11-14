import { getGameTree, type GameObject } from "@rge/runtime";
import { Play } from "../generated/Play.ts";

/** The `Play` component in the running game's tree, or null (on the title and end screens). */
export function findPlay(): Play | null {
  const tree = getGameTree();
  if (tree === null) return null;
  const visit = (o: GameObject): Play | null => {
    if (o instanceof Play) return o;
    for (const child of o.children) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(tree.root);
}

/** The battle's numbers as `Play` keeps them, and how many enemies, towers and shots there are. */
export function battleOf(play: Play): { gold: number; lives: number; wave: number; active: boolean; enemies: number; towers: number; shots: number } {
  return { gold: play.s.gold, lives: play.s.lives, wave: play.s.wave, active: play.s.active, enemies: play.s.enemies.length, towers: play.s.towers.filter((t) => t !== null).length, shots: play.s.shots.length };
}
