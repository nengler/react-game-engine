import { Flex, Menu, Text } from "@tsengine/runtime/jsx";

import { type Row } from "./rules/menu.ts";

interface ChoicesProps {
  /** Where the first row sits, in screen pixels from the top. */
  top: number;
  rows: readonly Row[];
  /** The row that has the focus first. */
  start?: number;
  /** Confirm on a row. */
  onChoose: (id: string) => void;
  /** Left or right on a row: -1 or 1. */
  onAdjust?: (id: string, direction: number) => void;
}

/**
 * Rows of a menu, laid out as a column: the row with the focus has a bar behind it. The built-in `<Menu>` moves the focus up and down
 * (round at the ends) and confirm presses the row; left and right on a row go to `onAdjust`. Each row is a label and, from 170 pixels
 * in, its value (a volume, the keys).
 */
export function Choices({ top, rows, start = 0, onChoose, onAdjust }: ChoicesProps) {
  return (
    <Menu gap={1} x={10} y={top}>
      {rows.map((row, i) => (
        <Flex
          key={row.id}
          direction="row"
          width={300}
          height={12}
          paddingLeft={4}
          focusable
          autoFocus={i === start}
          focusBackground="#2b3350"
          onPress={() => onChoose(row.id)}
          onAdjust={(direction) => onAdjust?.(row.id, direction)}
        >
          <Text width={166}>{row.label}</Text>
          <Text color="#a7b0c8">{row.value}</Text>
        </Flex>
      ))}
    </Menu>
  );
}
