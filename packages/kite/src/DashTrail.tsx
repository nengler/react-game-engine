import { Entity, Sprite, useMutable, useUpdate } from "@tsengine/runtime/jsx";

/** One copy of the character: where its feet were in the world, which way it faced, and how old it is. */
interface Ghost {
  id: number;
  x: number;
  y: number;
  flipX: boolean;
  age: number;
}

interface DashTrailProps {
  /** The character is dashing: leave copies. */
  dashing: boolean;
  /** Where the character is in the world (its hitbox's top left), which is where this trail is drawn from. */
  x: number;
  y: number;
  /** The hitbox's height, to find the feet. */
  height: number;
  flipX: boolean;
}

/**
 * Copies of the character left behind while it dashes, each where it was and fading, as Celeste draws its dash: a list in state
 * (a copy every 0.08 s of the dash, each gone after 0.3 s), drawn as sprites of the dash frame. A child of the character, so
 * each copy is placed back from where the character is now to where it was.
 */
export function DashTrail({ dashing, x, y, height, flipX }: DashTrailProps) {
  const s = useMutable({ ghosts: [] as Ghost[], wait: 0, made: 0 });

  useUpdate((dt) => {
    s.wait -= dt;
    const aged = s.ghosts.map((g) => ({ ...g, age: g.age + dt })).filter((g) => g.age < 0.3);
    if (dashing && s.wait <= 0) {
      s.wait = 0.08;
      s.made += 1;
      s.ghosts = [...aged, { id: s.made, x: x + 4, y: y + height, flipX, age: 0 }];
    } else if (s.ghosts.length > 0) {
      s.ghosts = aged;
    }
  });

  return (
    <Entity>
      {s.ghosts.map((g) => (
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
          x={g.x - x}
          y={g.y - y}
        />
      ))}
    </Entity>
  );
}
