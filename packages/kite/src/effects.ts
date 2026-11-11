import { createParticles, createSounds, freeze, type Vector2 } from "@rge/runtime";
import type { GameEvent } from "./rules/events.ts";
import { freezeFor } from "./rules/freeze.ts";

/**
 * The game's one-off effects, kept like a toast library's store: the looks and sounds are named here once, `Main.tsx` mounts
 * what draws them (`<ParticleLayer particles={fx} />` next to the camera), and anything calls them.
 * The character calls `playEvents` with what each step reports; what belongs to it alone (its squash) it sets itself.
 */
export const fx = createParticles({
  /** Dust thrown up where the character lands. */
  dust: { burst: 9, lifetime: 0.4, speed: 55, angle: 270, spread: 75, size: 3, fade: true, shrink: true, color: "#e6e0d2", gravity: 160, max: 48 },
  /** A puff at the feet as a jump leaves the ground (or a wall). */
  kick: { burst: 6, lifetime: 0.3, speed: 40, angle: 90, spread: 60, size: 2, fade: true, color: "#e6e0d2", max: 32 },
  /** Sparks where the character died. */
  death: { burst: 18, lifetime: 0.6, speed: 85, spread: 180, size: 3, shrink: true, color: "#fff1d6", endColor: "#ff7a59", gravity: 140, max: 36 },
});

export const sfx = createSounds({
  jump: { src: "jump.wav", volume: 0.6 },
  wallJump: { src: "jump.wav", volume: 0.4 },
  dash: { src: "dash.wav", volume: 0.7 },
  land: { src: "land.wav", volume: 0.5 },
  death: { src: "death.wav", volume: 0.8 },
  start: "start.wav",
});


/**
 * Answer what the rules say happened in a step: a sound, a burst at the place it happened, a freeze (the camera's shake is the
 * `Play` screen's own state). The events are in
 * the room's pixels; the room's top left in the world is (`originX`, `originY`).
 */
export function playEvents(events: readonly GameEvent[], originX: number, originY: number): void {
  for (const e of events) {
    const x = originX + e.x;
    const y = originY + e.y;
    switch (e.type) {
      case "jump":
        sfx.play("jump");
        fx.burst("kick", x, y);
        break;
      case "wallJump":
        sfx.play("wallJump");
        // Off the wall, away from it.
        fx.burst("kick", x, y - 4, { angle: e.wall < 0 ? 0 : 180 });
        break;
      case "dash":
        sfx.play("dash");
        break;
      case "land":
        if (e.speed > 60) {
          sfx.play("land");
          fx.burst("dust", x, y);
        }
        break;
      case "duck":
      case "stand":
        break;
      case "death":
        sfx.play("death");
        fx.burst("death", x, y);
        break;
      case "room":
        break;
    }
  }
  const frozen = freezeFor(events);
  if (frozen > 0) freeze(frozen);
}

/**
 * The squash and stretch a step's events call for, Celeste's: thin and tall leaving the ground, wide and flat landing hard (all
 * the way at 240 pixels a second), wide ducking, tall standing up. Null when nothing in the step changes it.
 */
export function squashFor(events: readonly GameEvent[]): Vector2 | null {
  let squash: Vector2 | null = null;
  for (const e of events) {
    if (e.type === "jump" || e.type === "wallJump") squash = { x: 0.6, y: 1.4 };
    else if (e.type === "land") {
      const k = Math.min(e.speed / 240, 1);
      squash = { x: 1 + 0.6 * k, y: 1 - 0.6 * k };
    } else if (e.type === "duck") squash = { x: 1.4, y: 0.6 };
    else if (e.type === "stand") squash = { x: 0.8, y: 1.2 };
  }
  return squash;
}
