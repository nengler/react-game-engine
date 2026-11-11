import { Flex } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { BuildOption } from "./BuildOption.tsx";
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
          <BuildOption key={d.kind} icon={iconOf(d.kind)} text={`${d.key} ${d.name} ${d.cost}`} enabled={gold >= d.cost} onPress={() => build(d.kind)} />
        ))}
      </Panel>
    </Flex>
  );
}
