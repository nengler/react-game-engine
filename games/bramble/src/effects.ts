import { createParticles, createSounds } from "@rge/runtime";
import type { GameEvent } from "./rules/run.ts";

/** One-off effects: where a thing happened, as small bursts. `Play.tsx` mounts what draws them (`<ParticleLayer particles={fx} />`). */
export const fx = createParticles({
  spark: { burst: 6, lifetime: 0.3, speed: 40, spread: 180, size: 2, fade: true, color: "#ffe9a0", max: 64 },
  puff: { burst: 10, lifetime: 0.5, speed: 35, spread: 180, size: 3, shrink: true, color: "#e6e0d2", endColor: "#7a7e8c", max: 96 },
  leaf: { burst: 8, lifetime: 0.5, speed: 30, spread: 180, size: 2, fade: true, color: "#3f9a4a", gravity: 60, max: 48 },
});

export const sfx = createSounds({
  pickup: "pickup.wav",
  talk: { src: "talk.wav", volume: 0.5 },
  swing: { src: "swing.wav", volume: 0.5 },
  hit: "hit.wav",
  hurt: "hurt.wav",
  shrine: "shrine.wav",
  door: "door.wav",
  deny: { src: "deny.wav", volume: 0.6 },
  cut: "cut.wav",
  win: "win.wav",
});

/** What each event sounds like and looks like. `at` is where the character is, for the bursts that have no place of their own. */
export function answer(events: readonly GameEvent[], at: { readonly x: number; readonly y: number }): void {
  for (const e of events) {
    switch (e.type) {
      case "pickup": sfx.play("pickup"); fx.burst("spark", at.x, at.y); break;
      case "talk": sfx.play("talk"); break;
      case "door": sfx.play("door"); break;
      case "locked":
      case "gate-locked": sfx.play("deny"); break;
      case "cut": sfx.play("cut"); fx.burst("leaf", at.x, at.y); break;
      case "swing": sfx.play("swing"); break;
      case "enemy-hit": sfx.play("hit"); fx.burst("spark", at.x, at.y); break;
      case "enemy-defeated": fx.burst("puff", at.x, at.y); break;
      case "shrine": sfx.play("shrine"); fx.burst("spark", at.x, at.y); break;
      case "hurt": case "died": sfx.play("hurt"); break;
      case "win": sfx.play("win"); break;
      default: break;
    }
  }
}
