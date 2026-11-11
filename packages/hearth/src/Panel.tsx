import { type Child, Flex } from "@rge/runtime/jsx";
import { Label } from "./Label.tsx";

interface PanelProps {
  title: string;
  children: Child;
}

/** A titled box on the HUD: a column that holds whatever it is given. */
export function Panel({ title, children }: PanelProps) {
  return (
    <Flex direction="column" gap={3} padding={4} width="grow" background="#1c2033">
      <Label text={title} color="#ffb15e" />
      <Flex direction="column" gap={3} width="grow">
        {children}
      </Flex>
    </Flex>
  );
}
