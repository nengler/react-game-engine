import { type Child, Flex } from "@rge/runtime/jsx";
import { COLOR } from "./theme.ts";

interface MenuButtonProps {
  onPress: () => void;
  /** The action that presses it from the keyboard (`"wave"`): the button owns its shortcut. */
  pressKey?: string;
  /** A dimmed button still takes the press (the game says why it did nothing), but looks unavailable. */
  enabled?: boolean;
  children: Child;
}

/** A row in a menu: whatever it is given (an icon and a label, usually) on a background that takes a press. */
export function MenuButton({ onPress, pressKey, enabled = true, children }: MenuButtonProps) {
  return (
    <Flex direction="row" alignItems="center" gap={3} padding={3} width="grow" background={enabled ? COLOR.button : COLOR.buttonOff} onPress={onPress} pressKey={pressKey}>
      {children}
    </Flex>
  );
}
