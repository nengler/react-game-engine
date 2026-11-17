import type { Built } from "./battle.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Panel } from "./Panel.tsx";
import { keyLabel } from "./rules/controls.ts";
import { refundOf, statsOf, TOWERS, upgradeCost } from "./rules/towers.ts";
import { COLOR } from "./theme.ts";

interface UpgradePanelProps {
  tower: Built;
  gold: number;
  onUpgrade: () => void;
  onSell: () => void;
}

/** What the panel shows for a pad with a tower: its numbers, an upgrade and a sale. */
export function UpgradePanel({ tower, gold, onUpgrade, onSell }: UpgradePanelProps) {
  const stats = statsOf(tower.kind, tower.level);
  // -1 at the top level (not null: a derived value is read again where it is used, so `cost !== null` would not narrow it there).
  const cost = upgradeCost(tower.kind, tower.level) ?? -1;
  const canUpgrade = cost >= 0 && gold >= cost;

  return (
    <Panel title={`${TOWERS[tower.kind].name} L${tower.level + 1}`}>
      <Label>DMG {Math.round(stats.damage * 10) / 10}</Label>
      <Label>RANGE {Math.round(stats.range)}</Label>
      <MenuButton enabled={canUpgrade} pressKey="upgrade" onPress={onUpgrade}>
        <Label color={canUpgrade ? COLOR.text : COLOR.dim}>{cost < 0 ? "MAXED" : `${keyLabel("upgrade")} UPGRADE ${cost}`}</Label>
      </MenuButton>
      <MenuButton pressKey="sell" onPress={onSell}>
        <Label>
          {keyLabel("sell")} SELL {refundOf(tower.spent)}
        </Label>
      </MenuButton>
    </Panel>
  );
}
