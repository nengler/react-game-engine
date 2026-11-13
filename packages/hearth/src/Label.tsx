import { Text, type TextChild } from "@rge/runtime/jsx";
import { COLOR } from "./theme.ts";

interface LabelProps {
  color?: string;
  children: TextChild | readonly TextChild[];
}

/**
 * A line of text in the game's colour, at its font's own size (`<Game font>`): what every screen and the HUD write with, as
 * `<Label>GOLD {gold}</Label>`. It takes its words as children, as `<Text>` does, and passes them on.
 */
export function Label({ color = COLOR.text, children }: LabelProps) {
  return <Text color={color}>{children}</Text>;
}
