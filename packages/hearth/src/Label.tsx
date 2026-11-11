import { Text } from "@rge/runtime/jsx";
import { COLOR } from "./theme.ts";

interface LabelProps {
  text: string;
  color?: string;
  size?: number;
}

/** A line of text in the game's bitmap font: what every screen and the HUD write with. */
export function Label({ text, color = COLOR.text, size = 8 }: LabelProps) {
  return (
    <Text font="font.png" size={size} color={color}>
      {text}
    </Text>
  );
}
