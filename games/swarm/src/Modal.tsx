import { type Child, Flex, Text } from "@tsengine/runtime/jsx";

import { COLOR } from "./theme.ts";

interface ModalProps {
  title: string;
  width?: number;
  children: Child;
}

/** A panel in the middle of the screen, over everything: paused, a level gained. */
export function Modal({ title, width = 180, children }: ModalProps) {
  return (
    <Flex
      float
      anchor="center"
      to="center"
      width={width}
      direction="column"
      gap={4}
      padding={6}
      background={COLOR.panel}
      borderWidth={1}
      borderColor={COLOR.dim}
    >
      <Text color={COLOR.title}>{title}</Text>
      {children}
    </Flex>
  );
}
