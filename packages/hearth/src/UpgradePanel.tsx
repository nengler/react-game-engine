import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Panel } from "./Panel.tsx";
import { focusOf } from "./rules/view.ts";
import { COLOR } from "./theme.ts";

/** What the panel shows for a pad with a tower: its numbers, an upgrade and a sale. */
export function UpgradePanel() {
  const focus = useGame((s) => focusOf(s.battle, s.cursor));
  const gold = useGame((s) => s.battle.gold);
  const { upgrade, sell } = useGame((s) => s);
  const cost = focus.upgrade;
  const canUpgrade = cost >= 0 && gold >= cost;

  return (
    <Panel title={focus.title}>
      <Label text={`DMG ${focus.damage}`} />
      <Label text={`RANGE ${focus.range}`} />
      <MenuButton enabled={canUpgrade} onPress={upgrade}>
        <Label text={cost < 0 ? "U MAXED" : `U UPGRADE ${cost}`} color={canUpgrade ? COLOR.text : COLOR.dim} />
      </MenuButton>
      <MenuButton onPress={sell}>
        <Label text={`S SELL ${focus.refund}`} />
      </MenuButton>
    </Panel>
  );
}
