import { AnimatedSprite, Collider, Entity, Particles } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/**
 * The character: the rules' body drawn as an animated sprite, with the trail a dash leaves. Its sounds, dust and death burst
 * are not here: the rules report them as events and the game state plays them (`effects.ts`), so they outlive this frame.
 */
export function Player() {
  const body = useGame((s) => s.run.player);
  const originX = useGame((s) => s.run.originX);
  const originY = useGame((s) => s.run.originY);
  const dead = useGame((s) => s.run.dead);

  const animation = dead ? "die" : body.dashing ? "dash" : body.sliding ? "wall" : !body.onGround ? (body.vy < 0 ? "jump" : "fall") : Math.abs(body.vx) > 12 ? "run" : "idle";

  return (
    <Entity name="Player" transform={{ x: originX + body.x, y: originY + body.y }}>
      {/* The hitbox is 8 × 11; the picture is 12 × 12 with its origin at the feet, so it sits centred on the hitbox's bottom. */}
      <AnimatedSprite
        sheet="hero.png"
        frameWidth={12}
        frameHeight={12}
        animations="idle:0-1@3, run:2-7@14, jump:8@1, fall:9@1, wall:10@1, dash:11@1, die:12-15@16~"
        animation={animation}
        flipX={body.facing < 0}
        originX={6}
        originY={12}
        tint={body.dashes > 0 || dead ? "#ffffff" : "#9db4ff"}
        transform={{ x: 4, y: 11 }}
      />
      <Collider width={8} height={11} tag="player" layer="player" />
      {/* A trail while dashing: state, not a moment, so it is an emitter that is on while `dashing` is. */}
      <Particles rate={120} lifetime={0.25} speed={6} spread={180} size={3} shrink fade color="#ff9a7a" space="world" emitting={body.dashing} transform={{ x: 4, y: 6 }} max={24} />
    </Entity>
  );
}
