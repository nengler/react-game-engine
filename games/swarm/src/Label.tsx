import { Text, type TextChild } from "@tsengine/runtime/jsx";

import { COLOR } from "./theme.ts";

interface LabelProps {
  color?: string;
  children: TextChild | readonly TextChild[];
}

/** A line of text in the game's colour, at its font's own size: what every screen and the HUD write with. */
export function Label({ color = COLOR.text, children }: LabelProps) {
  return <Text color={color}>{children}</Text>;
}
