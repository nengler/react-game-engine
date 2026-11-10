import { useInput, useRef, useSound, useState, useUpdate, AnimatedSprite, Collider, Entity, Particles } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/**
 * Keyboard and gamepad to the buttons the rules take, and one step of the rules for every fixed step. The first custom hook
 * of the game: the compiler writes its two handlers into the component that calls it. Arrows, WASD or the d-pad and left stick
 * move; Z, C, Space or A jump; X, Shift, B, X or the right bumper dash.
 */
function usePlatformerBody() {
  const step = useGame((s) => s.step);
  const buttons = useRef(0);

  useInput((input) => {
    buttons.current =
      (input.down("ArrowLeft") || input.down("A") || input.down("PadLeft") ? 1 : 0) +
      (input.down("ArrowRight") || input.down("D") || input.down("PadRight") ? 2 : 0) +
      (input.down("ArrowUp") || input.down("W") || input.down("PadUp") ? 4 : 0) +
      (input.down("ArrowDown") || input.down("S") || input.down("PadDown") ? 8 : 0) +
      (input.down("Z") || input.down("C") || input.down("Space") || input.down("PadA") ? 16 : 0) +
      (input.pressed("Z") || input.pressed("C") || input.pressed("Space") || input.pressed("PadA") ? 32 : 0) +
      (input.pressed("X") || input.pressed("Shift") || input.pressed("PadX") || input.pressed("PadB") || input.pressed("PadRB") ? 64 : 0);
  });

  useUpdate((dt) => {
    step(buttons.current, dt);
  });
}

/** Plays a sound each time a counter of the rules goes up (a jump, a landing): the rules count what happened, the sound answers. */
function useSoundOnCount(path: string, volume: number, count: number) {
  const play = useSound(path);
  const seen = useRef(0);
  useUpdate(() => {
    if (count !== seen.current) {
      seen.current = count;
      play(volume);
    }
  });
}

/** True for a moment each time a counter goes up: what mounts a burst of particles for a jump, a landing, a death. */
function useBurst(count: number) {
  const [on, setOn] = useState(false);
  const seen = useRef(0);
  const timer = useRef(0);
  useUpdate((dt) => {
    if (count !== seen.current) {
      seen.current = count;
      timer.current = 0.1;
      setOn(true);
    } else if (timer.current > 0) {
      timer.current -= dt;
      if (timer.current <= 0) {
        setOn(false);
      }
    }
  });
  return on;
}

/** The character: the rules' body drawn as an animated sprite, with its sounds, dust, dash trail and death burst. */
export function Player() {
  usePlatformerBody();
  const x = useGame((s) => s.player.x);
  const y = useGame((s) => s.player.y);
  const originX = useGame((s) => s.originX);
  const originY = useGame((s) => s.originY);
  const dead = useGame((s) => s.dead);
  const facing = useGame((s) => s.player.facing);
  const onGround = useGame((s) => s.player.onGround);
  const sliding = useGame((s) => s.player.sliding);
  const dashing = useGame((s) => s.player.dashing);
  const dashes = useGame((s) => s.player.dashes);
  const vx = useGame((s) => s.player.vx);
  const vy = useGame((s) => s.player.vy);
  const jumps = useGame((s) => s.player.jumps);
  const wallJumps = useGame((s) => s.player.wallJumps);
  const dashCount = useGame((s) => s.player.dashCount);
  const lands = useGame((s) => s.player.lands);
  const deathCount = useGame((s) => s.deathCount);
  const collect = useGame((s) => s.collect);

  useSoundOnCount("jump.wav", 0.6, jumps);
  useSoundOnCount("jump.wav", 0.4, wallJumps);
  useSoundOnCount("dash.wav", 0.7, dashCount);
  useSoundOnCount("land.wav", 0.5, lands);
  useSoundOnCount("death.wav", 0.8, deathCount);
  const landed = useBurst(lands);
  const jumped = useBurst(jumps + wallJumps);
  const died = useBurst(deathCount);

  const animation = dead ? "die" : dashing ? "dash" : sliding ? "wall" : !onGround ? (vy < 0 ? "jump" : "fall") : Math.abs(vx) > 12 ? "run" : "idle";

  return (
    <Entity name="Player" transform={{ x: originX + x, y: originY + y }}>
      {/* The hitbox is 8 × 11; the picture is 12 × 12 with its origin at the feet, so it sits centred on the hitbox's bottom. */}
      <AnimatedSprite
        sheet="hero.png"
        frameWidth={12}
        frameHeight={12}
        animations="idle:0-1@3, run:2-7@14, jump:8@1, fall:9@1, wall:10@1, dash:11@1, die:12-15@16~"
        animation={animation}
        flipX={facing < 0}
        originX={6}
        originY={12}
        tint={dashes > 0 || dead ? "#ffffff" : "#9db4ff"}
        transform={{ x: 4, y: 11 }}
      />
      <Collider
        width={8}
        height={11}
        tag="player"
        layer="player"
        onCollisionEnter={(other) => {
          if (other.tag === "gem") {
            collect();
          }
        }}
      />
      {/* A trail the dash leaves behind it in the world, not following the character. */}
      <Particles rate={120} lifetime={0.25} speed={6} spread={180} size={3} shrink fade color="#ff9a7a" space="world" emitting={dashing} transform={{ x: 4, y: 6 }} max={24} />
      {landed && <Particles burst={5} lifetime={0.25} speed={30} angle={270} spread={80} size={2} fade color="#c9c3b8" gravity={120} transform={{ x: 4, y: 11 }} />}
      {jumped && <Particles burst={4} lifetime={0.2} speed={25} angle={90} spread={70} size={2} fade color="#c9c3b8" transform={{ x: 4, y: 11 }} />}
      {died && <Particles burst={16} lifetime={0.55} speed={75} spread={180} size={3} shrink color="#fff1d6" endColor="#ff7a59" gravity={140} transform={{ x: 4, y: 6 }} />}
    </Entity>
  );
}
