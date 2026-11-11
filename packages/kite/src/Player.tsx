import { AnimatedSprite, Collider, Entity, Particles, useSquash, useUpdate } from "@rge/runtime/jsx";
import { playEvents, squashFor } from "./effects.ts";
import { useGame } from "./GameState.ts";
import { animationOf, heightOf } from "./rules/body.ts";

/**
 * The character: it runs the game's step with each fixed step's input, answers what happened (sound, dust, shake and freeze,
 * from `effects.ts`; its own squash and stretch), and draws the rules' body as an animated sprite with the trail a dash leaves.
 */
interface PlayerProps {
  /** The character died this step: the screen shakes its camera. */
  onDie: () => void;
}

export function Player({ onDie }: PlayerProps) {
  const { player: body, originX, originY, dead } = useGame((s) => s.run);
  const step = useGame((s) => s.step);
  const [squash, setSquash] = useSquash(1.75);
  const height = heightOf(body);

  useUpdate((dt, input) => {
    const events = step(input, dt);
    playEvents(events, originX, originY);
    const next = squashFor(events);
    if (next !== null) {
      setSquash(next);
    }
    if (events.some((e) => e.type === "death")) {
      onDie();
    }
  });

  return (
    <Entity name="Player" transform={{ x: originX + body.x, y: originY + body.y }}>
      {/* The hitbox is 8 × 11 (8 × 6 ducking); the picture is 12 × 12 with its origin at the feet, so it sits centred on the hitbox's bottom. */}
      <AnimatedSprite
        sheet="hero.png"
        frameWidth={12}
        frameHeight={12}
        animations={{
          idle: { frames: "0-1", fps: 3 },
          run: { frames: "2-7", fps: 14 },
          jump: { frames: 8 },
          fall: { frames: 9 },
          wall: { frames: 10 },
          dash: { frames: 11 },
          die: { frames: "12-15", fps: 16, once: true },
        }}
        animation={animationOf(body, dead)}
        flipX={body.facing < 0}
        originX={6}
        originY={12}
        tint={body.dashes > 0 || dead ? "#ffffff" : "#9db4ff"}
        transform={{ x: 4, y: height, scaleX: squash.scaleX, scaleY: squash.scaleY }}
      />
      <Collider width={8} height={height} tag="player" layer="player" />
      {/* A trail while dashing: state, not a moment, so it is an emitter that is on while `dashing` is. */}
      <Particles rate={120} lifetime={0.25} speed={6} spread={180} size={3} shrink fade color="#ff9a7a" space="world" emitting={body.dashing} transform={{ x: 4, y: 6 }} max={24} />
    </Entity>
  );
}
