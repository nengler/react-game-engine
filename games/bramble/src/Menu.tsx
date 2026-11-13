import { Entity, Shape, Text, useInput, useState } from "@rge/runtime/jsx";
import { type Row, wrap } from "./rules/menu.ts";

interface MenuProps {
  /** Where the first row sits, in screen pixels from the top. */
  top: number;
  rows: readonly Row[];
  /** The row the cursor starts on. */
  start?: number;
  /** Confirm on a row. */
  onChoose: (id: string) => void;
  /** Left or right on a row: -1 or 1. */
  onAdjust?: (id: string, direction: number) => void;
}

/** Rows of a menu, with a bar behind the one the cursor is on. Up and down move the cursor; the screen acts on what is chosen. */
export function Menu({ top, rows, start = 0, onChoose, onAdjust }: MenuProps) {
  const [cursor, setCursor] = useState(start);
  useInput((input) => {
    const id = rows[cursor]?.id ?? "";
    if (input.pressed("up")) setCursor((c) => wrap(c - 1, rows.length));
    if (input.pressed("down")) setCursor((c) => wrap(c + 1, rows.length));
    if (input.pressed("left")) onAdjust?.(id, -1);
    if (input.pressed("right")) onAdjust?.(id, 1);
    if (input.pressed("confirm")) onChoose(id);
  });
  return (
    <Entity>
      <Shape kind="rect" width={300} height={12} color="#2b3350" transform={{ x: 10, y: top + cursor * 13 }} />
      {rows.map((row, i) => (
        <Entity key={row.id} name={row.id} transform={{ x: 14, y: top + i * 13 }}>
          <Text size={10} color="#e8d9a8">{row.label}</Text>
          <Text transform={{ x: 170, y: 0 }} size={10} color="#a7b0c8">{row.value}</Text>
        </Entity>
      ))}
    </Entity>
  );
}
