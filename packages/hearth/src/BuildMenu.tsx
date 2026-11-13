import { useGame } from "./GameState.ts";
import { Icon } from "./Icon.tsx";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Panel } from "./Panel.tsx";
import { keyLabel } from "./rules/controls.ts";
import { TOWER_LIST } from "./rules/towers.ts";
import { COLOR, ICON } from "./theme.ts";

/** What the panel shows for an empty pad: the three towers, each a button with its price. */
export function BuildMenu() {
  const gold = useGame((s) => s.battle.gold);
  const { build } = useGame.actions();

  return (
    <Panel title="BUILD">
      {TOWER_LIST.map((d) => (
        <MenuButton key={d.kind} enabled={gold >= d.cost} pressKey={d.action} onPress={() => build(d.kind)}>
          <Icon frame={ICON[d.kind]} />
          <Label text={`${keyLabel(d.action)} ${d.name} ${d.cost}`} color={gold >= d.cost ? COLOR.text : COLOR.dim} />
        </MenuButton>
      ))}
    </Panel>
  );
}
