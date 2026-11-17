import { Sprite, useMutable, useUpdate } from "@tsengine/runtime/jsx";

import { PICKUP } from "./rules/constants.ts";

interface GemProps {
  id: number;
  x: number;
  y: number;
  value: number;
  /** Where the player is, and how near it pulls gems in. */
  px: number;
  py: number;
  magnet: number;
  onTaken: (id: number, value: number) => void;
}

/** Experience on the ground. Once the player comes within the magnet's reach it flies to them, faster as it goes, and is taken. */
export function Gem({ id, x, y, value, px, py, magnet, onTaken }: GemProps) {
  const s = useMutable({ x: x, y: y, pulled: false, speed: 40 });

  useUpdate((dt) => {
    const dx = px - s.x;
    const dy = py - s.y;
    const d = Math.hypot(dx, dy);
    if (d <= PICKUP) {
      onTaken(id, value);
      return;
    }
    if (!s.pulled) {
      if (d <= magnet) s.pulled = true;
      return;
    }
    s.speed += 400 * dt;
    const step = Math.min(d, s.speed * dt);
    s.x += (dx / d) * step;
    s.y += (dy / d) * step;
  });

  return <Sprite image="sprites.png" frameWidth={16} frameHeight={16} frame={value >= 5 ? 9 : 8} originX={8} originY={8} x={s.x} y={s.y} />;
}
