import { Entity, Shape, Sprite, useTime } from "@tsengine/runtime/jsx";

import { COLOR } from "./theme.ts";

interface PlayerProps {
  hp: number;
  maxHp: number;
  /** Seconds left of not being hurt again: it blinks. */
  invuln: number;
  facingLeft: boolean;
  moving: boolean;
}

/** The player: a two-frame walk while moving, blinking after a hit, with a health bar under them. Drawn about their middle. */
export function Player({ hp, maxHp, invuln, facingLeft, moving }: PlayerProps) {
  const time = useTime();
  const frame = moving && time % 0.3 < 0.15 ? 1 : 0;
  return (
    <Entity>
      <Sprite
        image="sprites.png"
        frameWidth={16}
        frameHeight={16}
        frame={frame}
        originX={8}
        originY={8}
        flipX={facingLeft}
        opacity={invuln > 0 && time % 0.1 < 0.05 ? 0.4 : 1}
      />
      <Entity x={-8} y={10}>
        <Shape kind="rect" width={16} height={2} color={COLOR.hpBack} />
        <Shape kind="rect" width={(16 * Math.max(0, hp)) / maxHp} height={2} color={COLOR.hp} />
      </Entity>
    </Entity>
  );
}
