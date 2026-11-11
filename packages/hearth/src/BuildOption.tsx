import { Flex } from "@rge/runtime/jsx";
import { Icon } from "./Icon.tsx";
import { Label } from "./Label.tsx";

interface BuildOptionProps {
  icon: number;
  text: string;
  enabled: boolean;
  onPress: () => void;
}

/** One row of the build menu. WORKAROUND(tier3-list-children): the list item is a component that draws its own button, where it would be `<MenuButton key …><Icon …/><Label …/></MenuButton>` once list items can have children. */
export function BuildOption({ icon, text, enabled, onPress }: BuildOptionProps) {
  return (
    <Flex direction="row" alignItems="center" gap={3} padding={3} width="grow" background={enabled ? "#3b4468" : "#262b40"} onPress={() => onPress()}>
      <Icon frame={icon} />
      <Label text={text} color={enabled ? "#fff1d6" : "#8e9ac2"} />
    </Flex>
  );
}
