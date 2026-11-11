import { Text } from "@rge/runtime/jsx";
import { COLOR } from "./theme.ts";

interface LabelProps {
  text: string;
  color?: string;
}

/** A line of text in the game's colour, at its font's own size (`<Game font>`): what every screen and the HUD write with. */
export function Label({ text, color = COLOR.text }: LabelProps) {
  return (
    <Text color={color}>
      {text}
    </Text>
  );
}
