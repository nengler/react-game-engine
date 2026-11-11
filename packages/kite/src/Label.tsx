import { Text } from "@rge/runtime/jsx";

interface LabelProps {
  text: string;
  color?: string;
  size?: number;
}

/** A line of text in the game's bitmap font: what every screen and the HUD write with. */
export function Label({ text, color = "#fff1d6", size = 8 }: LabelProps) {
  return (
    <Text font="font.png" size={size} color={color}>
      {text}
    </Text>
  );
}
