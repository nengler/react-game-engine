import { Flex } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Icon } from "./Icon.tsx";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Panel } from "./Panel.tsx";
import { TOWER_LIST } from "./rules/towers.ts";
import { iconOf } from "./rules/view.ts";

/** What the panel shows for an empty pad: the three towers, each a button with its price. */
export function BuildMenu() {
  const gold = useGame((s) => s.battle.gold);
  const build = useGame((s) => s.build);

  return (
    <Flex direction="column" width="grow">
      <Panel title="BUILD">
        {TOWER_LIST.map((d) => (
          <MenuButton key={d.kind} enabled={gold >= d.cost} onPress={() => build(d.kind)}>
            <Icon frame={iconOf(d.kind)} />
            <Label text={`${d.key} ${d.name} ${d.cost}`} color={gold >= d.cost ? "#fff1d6" : "#8e9ac2"} />
          </MenuButton>
        ))}
      </Panel>
    </Flex>
  );
}
