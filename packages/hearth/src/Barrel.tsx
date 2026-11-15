import { Sprite } from "@tsengine/runtime/jsx";

interface BarrelProps {
  /** The picture: kind × 3 + level in `barrels.png`. */
  frame: number;
  /** Radians. */
  angle: number;
}

/** The part of a tower that turns toward its target, around the middle of its pad. */
export function Barrel({ frame, angle }: BarrelProps) {
  return <Sprite image="barrels.png" frameWidth={12} frameHeight={12} frame={frame} originX={6} originY={6} rotation={angle} />;
}
