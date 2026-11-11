import { Flex } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Panel } from "./Panel.tsx";

/** What the panel shows for a pad with a tower: its numbers, an upgrade and a sale. */
export function UpgradePanel() {
  const { title, damage, range, upgrade: cost, refund } = useGame((s) => s.focus);
  const gold = useGame((s) => s.battle.gold);
  const upgrade = useGame((s) => s.upgrade);
  const sell = useGame((s) => s.sell);
  const canUpgrade = cost >= 0 && gold >= cost;

  return (
    <Flex direction="column" width="grow">
      <Panel title={title}>
        <Label text={`DMG ${damage}`} />
        <Label text={`RANGE ${range}`} />
        <MenuButton enabled={canUpgrade} onPress={() => upgrade()}>
          <Label text={cost < 0 ? "U MAXED" : `U UPGRADE ${cost}`} color={canUpgrade ? "#fff1d6" : "#8e9ac2"} />
        </MenuButton>
        <MenuButton onPress={() => sell()}>
          <Label text={`S SELL ${refund}`} />
        </MenuButton>
      </Panel>
    </Flex>
  );
}
