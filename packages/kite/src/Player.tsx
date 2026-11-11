import { AfterimageLayer, AnimatedSprite, Collider, Entity, EventListener, Particles, createAfterimages, createSquash, useState } from "@rge/runtime/jsx";
import { gameEvents } from "./effects.ts";
import { useGame } from "./GameState.ts";
import { animationOf, heightOf } from "./rules/body.ts";

/**
 * The character: the rules' body drawn as an animated sprite, with what a dash leaves (afterimages, a trail) and its own squash and stretch,
 * which it answers from the game's events (Celeste's numbers: thin and tall leaving the ground, wide and flat landing hard).
 * The sounds, dust and death burst belong to the game, not to this component (`effects.ts`).
 */
export function Player() {
  const body = useGame((s) => s.run.player);
  const originX = useGame((s) => s.run.originX);
  const originY = useGame((s) => s.run.originY);
  const dead = useGame((s) => s.run.dead);

  const [squash] = useState(() => createSquash({ recover: 1.75 }));
  const [trail] = useState(() => createAfterimages({ lifetime: 0.3, color: "#ff9a7aa0" }));
  const height = heightOf(body);

  return (
    <Entity name="Player" transform={{ x: originX + body.x, y: originY + body.y }}>
      {/* Copies of the character left behind while dashing, drawn where each was taken (so it can sit here), under the character. */}
      <AfterimageLayer afterimages={trail} emitting={body.dashing} interval={0.08} />
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
        transform={{ x: 4, y: height }}
        squash={squash}
        afterimages={trail}
      />
      <Collider width={8} height={height} tag="player" layer="player" />
      <EventListener
        events={gameEvents}
        onEvent={(e) => {
          if (e.type === "jump" || e.type === "wallJump") {
            squash.start(0.6, 1.4);
          } else if (e.type === "land") {
            // The harder the landing, the flatter: all the way at 240 pixels a second.
            squash.start(1 + 0.6 * Math.min(e.speed / 240, 1), 1 - 0.6 * Math.min(e.speed / 240, 1));
          } else if (e.type === "duck") {
            squash.start(1.4, 0.6);
          } else if (e.type === "stand") {
            squash.start(0.8, 1.2);
          }
        }}
      />
      {/* A trail while dashing: state, not a moment, so it is an emitter that is on while `dashing` is. */}
      <Particles rate={120} lifetime={0.25} speed={6} spread={180} size={3} shrink fade color="#ff9a7a" space="world" emitting={body.dashing} transform={{ x: 4, y: 6 }} max={24} />
    </Entity>
  );
}
