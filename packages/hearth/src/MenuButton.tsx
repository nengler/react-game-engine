import { type Child, Flex } from "@rge/runtime/jsx";

interface MenuButtonProps {
  onPress: () => void;
  /** A dimmed button still takes the press (the game says why it did nothing), but looks unavailable. */
  enabled?: boolean;
  children: Child;
}

/** A row in a menu: whatever it is given (an icon and a label, usually) on a background that takes a press. */
export function MenuButton({ onPress, enabled = true, children }: MenuButtonProps) {
  return (
    <Flex direction="row" alignItems="center" gap={3} padding={3} width="grow" background={enabled ? "#3b4468" : "#262b40"} onPress={() => onPress()}>
      {children}
    </Flex>
  );
}
