import { Icon } from "./Icon.tsx";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Panel } from "./Panel.tsx";
import { keyLabel } from "./rules/controls.ts";
import { TOWER_LIST, type TowerKind } from "./rules/towers.ts";
import { COLOR, ICON } from "./theme.ts";

interface BuildMenuProps {
  gold: number;
  onBuild: (kind: TowerKind) => void;
}

/** What the panel shows for an empty pad: the three towers, each a button with its price. */
export function BuildMenu({ gold, onBuild }: BuildMenuProps) {
  return (
    <Panel title="BUILD">
      {TOWER_LIST.map((d) => (
        <MenuButton key={d.kind} enabled={gold >= d.cost} pressKey={d.action} onPress={() => onBuild(d.kind)}>
          <Icon frame={ICON[d.kind]} />
          <Label text={`${keyLabel(d.action)} ${d.name} ${d.cost}`} color={gold >= d.cost ? COLOR.text : COLOR.dim} />
        </MenuButton>
      ))}
    </Panel>
  );
}
