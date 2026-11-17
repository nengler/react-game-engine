import { type Child, Flex } from "@tsengine/runtime/jsx";

import { COLOR } from "./theme.ts";

interface MenuButtonProps {
  onPress: () => void;
  /** The action that presses it from the keyboard (`"one"`): the button owns its shortcut. */
  pressKey?: string;
  children: Child;
}

/** A row in a menu: whatever it is given on a background that takes a press. */
export function MenuButton({ onPress, pressKey, children }: MenuButtonProps) {
  return (
    <Flex
      direction="column"
      gap={2}
      padding={4}
      width="grow"
      background={COLOR.button}
      focusBorderColor={COLOR.prompt}
      borderWidth={1}
      borderColor={COLOR.button}
      onPress={onPress}
      pressKey={pressKey}
    >
      {children}
    </Flex>
  );
}
