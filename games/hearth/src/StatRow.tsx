import { Flex, type TextChild } from "@tsengine/runtime/jsx";

import { Icon } from "./Icon.tsx";
import { Label } from "./Label.tsx";
import { COLOR } from "./theme.ts";

interface StatRowProps {
  icon: number;
  color?: string;
  children: TextChild | readonly TextChild[];
}

/** An icon and a number or two words: gold, lives, the wave. */
export function StatRow({ icon, color = COLOR.text, children }: StatRowProps) {
  return (
    <Flex direction="row" alignItems="center" gap={4}>
      <Icon frame={icon} />
      <Label color={color}>{children}</Label>
    </Flex>
  );
}
