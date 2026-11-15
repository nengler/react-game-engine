import { Entity, Pointer, Sprite, useMutable } from "@rge/runtime/jsx";

import type { Built, Fired } from "./battle.ts";
import { useGame } from "./GameState.ts";
import { Tower } from "./Tower.tsx";

interface PadProps {
  id: number;
  x: number;
  y: number;
  /** What its towers' mortar shells scatter by. */
  seed: number;
  tower: Built | null;
  onFire: (shot: Fired) => void;
}

/**
 * A place to build, and the tower on it if there is one. The pad takes the focus (the arrow keys move it between pads) and the
 * press (a click, or confirm while it has the focus), shows the cursor while it is the selected pad, and its tower's range while
 * selected or under the mouse.
 */
export function Pad({ id, x, y, seed, tower, onFire }: PadProps) {
  const selected = useGame((s) => s.cursor === id);
  const { point, select } = useGame.actions();
  const st = useMutable({ hovered: false });

  return (
    <Entity x={x} y={y}>
      {tower !== null && (
        <Tower seed={seed} kind={tower.kind} level={tower.level} x={x} y={y} ring={selected || st.hovered} onFire={onFire} />
      )}
      <Pointer
        width={10}
        height={10}
        originX={5}
        originY={5}
        focusable
        autoFocus={selected}
        onFocus={() => point(id)}
        onPress={() => select(id)}
        onPointerEnter={() => {
          st.hovered = true;
        }}
        onPointerLeave={() => {
          st.hovered = false;
        }}
      />
      {selected && <Sprite image="cursor.png" originX={7} originY={7} />}
    </Entity>
  );
}
