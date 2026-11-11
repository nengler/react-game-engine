import { Text } from "@rge/runtime/jsx";
import { COLOR } from "./theme.ts";

interface LabelProps {
  text: string;
  color?: string;
  size?: number;
}

/** A line of text at the game's size and colour (the font is `<Game font>`'s): what every screen and the HUD write with. */
export function Label({ text, color = COLOR.text, size = 8 }: LabelProps) {
  return (
    <Text size={size} color={color}>
      {text}
    </Text>
  );
}
