import { type Child, Flex } from "@rge/runtime/jsx";
import { Panel } from "./Panel.tsx";

interface ModalProps {
  title: string;
  children: Child;
}

/** A panel in the middle of the screen, over everything: paused, won, lost. It passes what it is given on to the panel, which passes it on to its column. */
export function Modal({ title, children }: ModalProps) {
  return (
    <Flex float anchor="center" to="center" width={140} background="#000000aa" padding={6}>
      <Panel title={title}>{children}</Panel>
    </Flex>
  );
}
