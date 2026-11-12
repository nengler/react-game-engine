import { Entity, Shape, Text } from "@rge/runtime/jsx";
import { type Row } from "./rules/menu.ts";

interface MenuProps {
  /** Where the first row sits, in screen pixels from the top. */
  top: number;
  rows: readonly Row[];
  /** The row the cursor is on. */
  cursor: number;
}

/** Rows of a menu, with a bar behind the one the cursor is on. The screen that shows it keeps the cursor and acts on the rows. */
export function Menu({ top, rows, cursor }: MenuProps) {
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
