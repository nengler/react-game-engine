import { AnimatedSprite } from "@tsengine/runtime/jsx";

/** Cycles three frames at 4 fps. "beacon-gone.png" does not exist: that frame shows the magenta placeholder. */
export function Beacon() {
  return <AnimatedSprite frames={["beacon-1.png", "beacon-2.png", "beacon-gone.png"]} fps={4} />;
}
