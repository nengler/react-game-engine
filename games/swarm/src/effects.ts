import { createParticles, createSounds } from "@tsengine/runtime";

/** One-off effects, called from handlers: `Play.tsx` mounts what draws the particles. */
export const fx = createParticles({
  /** Bits where an enemy dies. */
  die: { burst: 5, lifetime: 0.35, speed: 40, spread: 180, size: 2, shrink: true, color: "#ffe8f0", endColor: "#7a3e8a", max: 400 },
  /** A level gained. */
  level: { burst: 24, lifetime: 0.6, speed: 90, spread: 180, size: 3, fade: true, color: "#5ad1ff", max: 48 },
  /** The player hurt. */
  hurt: { burst: 8, lifetime: 0.3, speed: 60, spread: 180, size: 2, fade: true, color: "#e8475f", max: 32 },
});

export const sfx = createSounds({
  // `once`: at most once a step, so forty enemies dying together make one sound, not a roar.
  shoot: { src: "shoot.wav", volume: 0.35, once: true },
  hit: { src: "hit.wav", volume: 0.3, once: true },
  die: { src: "die.wav", volume: 0.4, once: true },
  gem: { src: "gem.wav", volume: 0.3, once: true },
  hurt: { src: "hurt.wav", volume: 0.6, once: true },
  level: "level.wav",
  pick: "pick.wav",
  start: "start.wav",
  over: "over.wav",
});
