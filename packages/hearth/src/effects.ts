import { createParticles, createSounds } from "@rge/runtime";

/**
 * The game's one-off effects, kept like a toast library's store and called from the components' handlers (`fx.burst("die", x, y)`,
 * `sfx.play("death")`): `Play.tsx` mounts what draws the particles (`<ParticleLayer particles={fx} />`).
 */
export const fx = createParticles({
  /** A small spark where a shot hits. */
  hit: { burst: 4, lifetime: 0.25, speed: 40, spread: 180, size: 2, fade: true, color: "#ffdd7a", max: 64 },
  /** A puff and bits where an enemy dies. */
  die: {
    burst: 9,
    lifetime: 0.45,
    speed: 45,
    spread: 180,
    size: 3,
    shrink: true,
    color: "#fff1d6",
    endColor: "#7a3e8a",
    gravity: 90,
    max: 96,
  },
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
  deny: { src: "deny.wav", volume: 0.6, once: true },
  // `once`: at most once a step, so twenty towers firing together make one sound, not a roar.
  bolt: { src: "bolt.wav", volume: 0.5, once: true },
  mortar: { src: "mortar.wav", volume: 0.7, once: true },
  frost: { src: "frost.wav", volume: 0.6, once: true },
  hit: { src: "hit.wav", volume: 0.4, once: true },
  boom: { src: "boom.wav", volume: 0.7, once: true },
  death: { src: "death.wav", volume: 0.5, once: true },
  leak: { src: "leak.wav", once: true },
  wave: "wave.wav",
  win: "win.wav",
  lose: "lose.wav",
  click: { src: "click.wav", volume: 0.6 },
});
