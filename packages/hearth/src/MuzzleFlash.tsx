import { Sprite } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

interface MuzzleFlashProps {
  firedAt: number;
  angle: number;
}

/** A spark at the end of the barrel for a moment after a shot. */
export function MuzzleFlash({ firedAt, angle }: MuzzleFlashProps) {
  const time = useGame((s) => s.battle.time);
  const on = time - firedAt < 0.08;
  return (
    <>
      {on && <Sprite image="shots.png" frameWidth={8} frameHeight={8} frame={2} originX={4} originY={4} transform={{ x: Math.cos(angle) * 9, y: Math.sin(angle) * 9 }} />}
    </>
  );
}
