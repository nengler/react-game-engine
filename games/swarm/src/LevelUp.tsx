import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";
import { keyLabel } from "./rules/controls.ts";
import { UPGRADES, type Build, type UpgradeId } from "./rules/upgrades.ts";
import { COLOR } from "./theme.ts";

const KEYS = ["one", "two", "three"] as const;

interface LevelUpProps {
  offers: readonly UpgradeId[];
  build: Build;
  onPick: (id: UpgradeId) => void;
}

/** The choice at a level-up: up to three upgrades, each a button with its number key, what it does and the level it goes to. */
export function LevelUp({ offers, build, onPick }: LevelUpProps) {
  const rows = offers.map((id, i) => ({ id, key: KEYS[i] ?? "one", level: build[id] }));
  return (
    <Modal title="LEVEL UP" width={200}>
      {rows.map((row) => (
        <MenuButton key={row.id} pressKey={row.key} onPress={() => onPick(row.id)}>
          <Label>
            {keyLabel(row.key)} {UPGRADES[row.id].name} {row.level === 0 ? "NEW" : `LV ${row.level + 1}`}
          </Label>
          <Label color={COLOR.dim}>{UPGRADES[row.id].text}</Label>
        </MenuButton>
      ))}
    </Modal>
  );
}
