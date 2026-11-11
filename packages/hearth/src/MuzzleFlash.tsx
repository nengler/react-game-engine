import { Sprite } from "@rge/runtime/jsx";

interface MuzzleFlashProps {
  on: boolean;
  angle: number;
}

/** A spark at the end of the barrel for a moment after a shot. */
export function MuzzleFlash({ on, angle }: MuzzleFlashProps) {
  return on ? <Sprite image="shots.png" frameWidth={8} frameHeight={8} frame={2} originX={4} originY={4} transform={{ x: Math.cos(angle) * 9, y: Math.sin(angle) * 9 }} /> : null;
}
