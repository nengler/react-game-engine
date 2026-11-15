import { Entity, Sprite, useBody, useMutable, useUpdate } from "@rge/runtime/jsx";

import { useGame } from "./GameState.ts";

interface HeroProps {
  /** Where it starts. */
  startX: number;
  startY: number;
  /** Pixels a second, running. */
  speed?: number;
}

/** Pixels a second added to the fall each second. */
const GRAVITY = 900;
/** The speed a jump starts with, upward. */
const JUMP = 330;
/** The fastest fall. */
const MAX_FALL = 400;

/**
 * The hero runs with the arrow keys and jumps with Z or Space while standing. `useBody` holds where it is and moves it against the
 * level's solid colliders, a pixel at a time, and says which sides it hit, in the same step: landing stops the fall, and a ceiling
 * stops the jump. Its speed is its own state (`useMutable`).
 */
export function Hero({ startX, startY, speed = 110 }: HeroProps) {
  const { x, y, move, blocked } = useBody({ x: startX, y: startY, width: 12, height: 16 });
  const s = useMutable({ vy: 0 });
  const { jumped } = useGame.actions();

  useUpdate((dt, input) => {
    const run = (input.down("ArrowRight") ? 1 : 0) - (input.down("ArrowLeft") ? 1 : 0);
    const standing = s.vy >= 0 && blocked(0, 1);
    if (standing && (input.pressed("Z") || input.pressed("Space"))) {
      s.vy = -JUMP;
      jumped();
    } else s.vy = Math.min(MAX_FALL, s.vy + GRAVITY * dt);
    const hit = move(run * speed * dt, s.vy * dt);
    if (hit.down || hit.up) s.vy = 0;
  });

  return (
    <Entity x={x} y={y}>
      <Sprite image="hero.png" originX={2} />
    </Entity>
  );
}
