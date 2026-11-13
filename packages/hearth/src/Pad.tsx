import { Entity, Pointer, Sprite, useState } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Tower } from "./Tower.tsx";
import type { Tower as TowerData } from "./rules/battle.ts";

interface PadProps {
  id: number;
  x: number;
  y: number;
  tower: TowerData | null;
}

/**
 * A place to build, and the tower on it if there is one. The pad takes the focus (the arrow keys move it between pads) and the
 * press (a click, or confirm while it has the focus), shows the cursor while it is the selected pad, and its tower's range while
 * selected or under the mouse.
 */
export function Pad({ id, x, y, tower }: PadProps) {
  const selected = useGame((s) => s.cursor === id);
  const { point, select } = useGame.actions();
  const [hovered, setHovered] = useState(false);

  return (
    <Entity transform={{ x, y }}>
      {tower !== null && <Tower kind={tower.kind} level={tower.level} angle={tower.angle} flash={tower.flash} ring={selected || hovered} />}
      <Pointer
        width={10}
        height={10}
        originX={5}
        originY={5}
        focusable
        autoFocus={selected}
        onFocus={() => point(id)}
        onPress={() => select(id)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      />
      {selected && <Sprite image="cursor.png" originX={7} originY={7} />}
    </Entity>
  );
}
