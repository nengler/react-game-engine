import { Entity, Shape, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

interface MenuProps {
  /** Where the first row sits, in screen pixels from the top. */
  top: number;
}

/** The rows of the menu on screen, with a bar behind the one the cursor is on. */
export function Menu({ top }: MenuProps) {
  const { cursor, rows } = useGame((s) => s.menu);
  return (
    <Entity name="Menu">
      <Shape kind="rect" width={300} height={12} color="#2b3350" transform={{ x: 10, y: top + cursor * 13 }} />
      {rows.map((row, i) => (
        <Entity key={row.id} name={row.id} transform={{ x: 14, y: top + i * 13 }}>
          <Text size={10} color="#e8d9a8" text={row.label} />
          <Text transform={{ x: 170, y: 0 }} size={10} color="#a7b0c8" text={row.value} />
        </Entity>
      ))}
    </Entity>
  );
}
