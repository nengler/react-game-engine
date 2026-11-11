import { Entity, Sprite, useRef, useState, useUpdate } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { heightOf } from "./rules/body.ts";

/** One copy of the character: where it was (its feet, in the world), which way it faced, and how old it is. */
interface Ghost {
  id: number;
  x: number;
  y: number;
  flipX: boolean;
  age: number;
}

/**
 * Copies of the character left behind while it dashes, each where it was and fading, as Celeste draws its dash: a list in state
 * (a copy every 0.08 s of the dash, each gone after 0.3 s), drawn as sprites of the dash frame. In the world, next to the camera.
 */
export function DashTrail() {
  const { player: body, originX, originY } = useGame((s) => s.run);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const wait = useRef(0);
  const made = useRef(0);

  useUpdate((dt) => {
    wait.current -= dt;
    const aged = ghosts.map((g) => ({ ...g, age: g.age + dt })).filter((g) => g.age < 0.3);
    if (body.dashing && wait.current <= 0) {
      wait.current = 0.08;
      made.current += 1;
      setGhosts([...aged, { id: made.current, x: originX + body.x + 4, y: originY + body.y + heightOf(body), flipX: body.facing < 0, age: 0 }]);
    } else if (ghosts.length > 0) {
      setGhosts(aged);
    }
  });

  return (
    <Entity name="DashTrail">
      {ghosts.map((g) => (
        <Sprite
          key={g.id}
          image="hero.png"
          frameWidth={12}
          frameHeight={12}
          frame={11}
          flipX={g.flipX}
          originX={6}
          originY={12}
          tint="#ff9a7a"
          opacity={0.6 * (1 - g.age / 0.3)}
          transform={{ x: g.x, y: g.y }}
        />
      ))}
    </Entity>
  );
}
