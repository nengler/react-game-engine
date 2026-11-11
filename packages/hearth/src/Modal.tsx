import { type Child, Flex } from "@rge/runtime/jsx";
import { Label } from "./Label.tsx";

interface ModalProps {
  title: string;
  children: Child;
}

/** A panel in the middle of the screen, over everything: paused, won, lost. It passes what it is given on to the panel. */
export function Modal({ title, children }: ModalProps) {
  return (
    <Flex float anchor="center" to="center" width={140} background="#000000aa" padding={6}>
      {/* WORKAROUND(tier3-forward-children): this is <Panel title={title}>{children}</Panel> once `{children}` can be forwarded to a component. */}
      <Flex direction="column" gap={3} padding={4} width="grow" background="#1c2033">
        <Label text={title} color="#ffb15e" />
        <Flex direction="column" gap={3} width="grow">
          {children}
        </Flex>
      </Flex>
    </Flex>
  );
}
