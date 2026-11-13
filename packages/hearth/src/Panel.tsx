import { type Child, Flex } from "@rge/runtime/jsx";
import { Label } from "./Label.tsx";
import { COLOR } from "./theme.ts";

interface PanelProps {
  title: string;
  children: Child;
}

/** A titled box on the HUD: a column that holds whatever it is given. */
export function Panel({ title, children }: PanelProps) {
  return (
    <Flex direction="column" gap={3} padding={4} width="grow" background={COLOR.panel}>
      <Label color={COLOR.title}>{title}</Label>
      <Flex direction="column" gap={3} width="grow">
        {children}
      </Flex>
    </Flex>
  );
}
