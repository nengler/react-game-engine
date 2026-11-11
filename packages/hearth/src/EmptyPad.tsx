import { Entity, Pointer, Sprite } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

interface EmptyPadProps {
  id: number;
  x: number;
  y: number;
}

/** A place to build: the map draws its stone plate; this takes the click and shows the cursor. */
export function EmptyPad({ id, x, y }: EmptyPadProps) {
  const selected = useGame((s) => s.cursor === id);
  const select = useGame((s) => s.select);

  return (
    <Entity name="EmptyPad" transform={{ x, y }}>
      <Pointer width={10} height={10} transform={{ x: -5, y: -5 }} onPress={() => select(id)} />
      {selected && <Sprite image="cursor.png" originX={7} originY={7} />}
    </Entity>
  );
}
