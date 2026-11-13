import { Flex, Text, useInput, useState } from "@rge/runtime/jsx";
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

/**
 * Rows of a menu, laid out as a column: the row the cursor is on has a bar behind it. Up and down move the cursor; the screen acts
 * on what is chosen. Each row is a label and, from 170 pixels in, its value (a volume, the keys).
 */
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
    <Flex direction="column" gap={1} x={10} y={top}>
      {rows.map((row, i) => (
        <Flex key={row.id} direction="row" width={300} height={12} paddingLeft={4} background={i === cursor ? "#2b3350" : undefined}>
          <Text width={166}>{row.label}</Text>
          <Text color="#a7b0c8">{row.value}</Text>
        </Flex>
      ))}
    </Flex>
  );
}
