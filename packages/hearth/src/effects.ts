import { createParticles, createSounds } from "@rge/runtime";
import type { BattleEvent } from "./rules/battle.ts";

/** The game's one-off effects, kept like a toast library's store: `Play.tsx` mounts what draws them (`<ParticleLayer particles={fx} />`). */
export const fx = createParticles({
  /** A small spark where a shot hits. */
  hit: { burst: 4, lifetime: 0.25, speed: 40, spread: 180, size: 2, fade: true, color: "#ffdd7a", max: 64 },
  /** A puff and bits where an enemy dies. */
  die: { burst: 9, lifetime: 0.45, speed: 45, spread: 180, size: 3, shrink: true, color: "#fff1d6", endColor: "#7a3e8a", gravity: 90, max: 96 },
  /** The mortar's blast. */
  boom: { burst: 14, lifetime: 0.4, speed: 60, spread: 180, size: 3, shrink: true, color: "#f2937a", endColor: "#9a3a2c", max: 64 },
  /** A tower going up, upgraded or sold. */
  dust: { burst: 8, lifetime: 0.4, speed: 30, spread: 180, size: 2, fade: true, color: "#e6e0d2", max: 48 },
  /** Something got through. */
  leak: { burst: 10, lifetime: 0.5, speed: 50, spread: 180, size: 3, fade: true, color: "#e04a5a", max: 32 },
});

export const sfx = createSounds({
  build: "build.wav",
  upgrade: "upgrade.wav",
  sell: "sell.wav",
  deny: { src: "deny.wav", volume: 0.6 },
  bolt: { src: "bolt.wav", volume: 0.5 },
  mortar: { src: "mortar.wav", volume: 0.7 },
  frost: { src: "frost.wav", volume: 0.6 },
  hit: { src: "hit.wav", volume: 0.4 },
  boom: { src: "boom.wav", volume: 0.7 },
  death: { src: "death.wav", volume: 0.5 },
  leak: "leak.wav",
  wave: "wave.wav",
  win: "win.wav",
  lose: "lose.wav",
  click: { src: "click.wav", volume: 0.6 },
});

/** Answer what the rules say happened in a step: a sound, a burst where it happened. */
export function playEvents(events: readonly BattleEvent[]): void {
  // Many shots in one step make one sound each, not a roar: the loudest ones first and each kind once per step.
  const sounded = new Set<string>();
  const once = (name: Parameters<typeof sfx.play>[0]): void => {
    if (sounded.has(name)) return;
    sounded.add(name);
    sfx.play(name);
  };
  for (const e of events) {
    switch (e.type) {
      case "shot":
        once(e.kind);
        break;
      case "hit":
        if (e.kind === "mortar") {
          once("boom");
          fx.burst("boom", e.x, e.y);
        } else if (e.kind === "bolt") {
          fx.burst("hit", e.x, e.y);
        }
        break;
      case "killed":
        once("death");
        fx.burst("die", e.x, e.y);
        break;
      case "leaked":
        once("leak");
        break;
      case "built":
        sfx.play("build");
        fx.burst("dust", e.x, e.y);
        break;
      case "upgraded":
        sfx.play("upgrade");
        fx.burst("dust", e.x, e.y);
        break;
      case "sold":
        sfx.play("sell");
        fx.burst("dust", e.x, e.y);
        break;
      case "denied":
        once("deny");
        break;
      case "waveStarted":
        sfx.play("wave");
        break;
      case "won":
        sfx.play("win");
        break;
      case "lost":
        sfx.play("lose");
        break;
      case "waveCleared":
        break;
    }
  }
}
