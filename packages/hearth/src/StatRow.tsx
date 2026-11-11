import { Flex } from "@rge/runtime/jsx";
import { Icon } from "./Icon.tsx";
import { Label } from "./Label.tsx";

interface StatRowProps {
  icon: number;
  text: string;
  color?: string;
}

/** An icon and a number or two words: gold, lives, the wave. */
export function StatRow({ icon, text, color = "#fff1d6" }: StatRowProps) {
  return (
    <Flex direction="row" alignItems="center" gap={4}>
      <Icon frame={icon} />
      <Label text={text} color={color} />
    </Flex>
  );
}
