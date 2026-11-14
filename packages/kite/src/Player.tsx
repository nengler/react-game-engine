import { AnimatedSprite, Collider, Entity, Particles, useSquash, useMutable, useUpdate } from "@rge/runtime/jsx";
import { DashTrail } from "./DashTrail.tsx";
import { playEvents, squashFor } from "./effects.ts";
import { useGame } from "./GameState.ts";
import { animationOf, heightOf } from "./rules/body.ts";
import { readControls } from "./rules/controls.ts";
import { spawnIn, stepPlayer } from "./rules/player.ts";

interface PlayerProps {
  /** The character died this step: the screen shakes its camera. */
  onDie: () => void;
}

/**
 * The character. It keeps its own body and moves it each fixed step (`rules/player.ts`), answers what happened (sound, dust and
 * freeze from `effects.ts`; its own squash and stretch), and tells the run what it needs to know: a death, a respawn, the next
 * room, the end. It reads only which room it is in from the game state.
 */
export function Player({ onDie }: PlayerProps) {
  const { room, originX, originY, finished } = useGame((s) => s.run);
  const { died, respawned, enteredRoom, finished: reachedEnd, tick } = useGame.actions();
  const st = useMutable({
    // Every run starts at the first room's start: the play screen is made fresh for each run, and this with it.
    me: spawnIn(0),
  });
  const squash = useSquash(1.75);
  const body = st.me.body;
  const dead = st.me.deadFor > 0;
  const height = heightOf(body);

  useUpdate((dt, input) => {
    if (finished) return;
    const step = stepPlayer(st.me, room, readControls(input), dt);
    st.me = step.next;
    // The run's clock: every step the character plays, not the camera's slides between rooms.
    if (step.played) {
      tick(dt);
    }

    playEvents(step.events, originX, originY);
    const nextSquash = squashFor(step.events);
    if (nextSquash !== null) {
      squash.x = nextSquash.x;
      squash.y = nextSquash.y;
    }

    if (step.outcome === "died") {
      died();
      onDie();
    } else if (step.outcome === "respawned") {
      respawned();
    } else if (step.outcome === "entered") {
      enteredRoom();
    } else if (step.outcome === "finished") {
      reachedEnd();
    }
  });

  return (
    <Entity x={originX + body.x} y={originY + body.y}>
      {/* Copies of the character a dash leaves, drawn first so they are under it. */}
      <DashTrail dashing={body.state === "dash"} x={originX + body.x} y={originY + body.y} height={height} flipX={body.facing < 0} />
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
        x={4} y={height} scaleX={squash.x} scaleY={squash.y}
      />
      <Collider width={8} height={height} tag="player" layer="player" />
      {/* Sparks while dashing: state, not a moment, so it is an emitter that is on while the body dashes. */}
      <Particles rate={120} lifetime={0.25} speed={6} spread={180} size={3} shrink fade color="#ff9a7a" space="world" emitting={body.state === "dash"} x={4} y={6} max={24} />
    </Entity>
  );
}
