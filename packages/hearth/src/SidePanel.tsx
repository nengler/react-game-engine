import { Flex } from "@rge/runtime/jsx";
import type { Built } from "./battle.ts";
import { BuildMenu } from "./BuildMenu.tsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { SlideIn } from "./SlideIn.tsx";
import { StatRow } from "./StatRow.tsx";
import { UpgradePanel } from "./UpgradePanel.tsx";
import { keyLabel } from "./rules/controls.ts";
import type { TowerKind } from "./rules/towers.ts";
import { WAVE_COUNT } from "./rules/waves.ts";
import { COLOR, ICON } from "./theme.ts";

interface SidePanelProps {
  gold: number;
  lives: number;
  wave: number;
  /** A wave is on. */
  active: boolean;
  /** The tower on the cursor's pad, if there is one. */
  tower: Built | null;
  onStartWave: () => void;
  onBuild: (kind: TowerKind) => void;
  onUpgrade: () => void;
  onSell: () => void;
}

/** The right 80 pixels: the battle's numbers, what the cursor is on, and the buttons that start a wave and change the speed. */
export function SidePanel({ gold, lives, wave, active, tower, onStartWave, onBuild, onUpgrade, onSell }: SidePanelProps) {
  const open = useGame((s) => s.open);
  const speed = useGame((s) => s.speed);
  const { toggleSpeed, togglePause } = useGame.actions();

  return (
    <Flex float anchor="top-right" to="top-right" direction="column" justifyContent="space-between" width={80} height={180} padding={4} gap={4} background={COLOR.background}>
      <Flex direction="column" gap={4} width="grow">
        <StatRow icon={ICON.gold} color={COLOR.gold}>{gold}</StatRow>
        <StatRow icon={ICON.lives} color={COLOR.lives}>{lives}</StatRow>
        <StatRow icon={ICON.wave} color={COLOR.wave}>{wave}/{WAVE_COUNT}</StatRow>
        {open && tower === null && (
          <SlideIn>
            <BuildMenu gold={gold} onBuild={onBuild} />
          </SlideIn>
        )}
        {open && tower !== null && (
          <SlideIn>
            <UpgradePanel tower={tower} gold={gold} onUpgrade={onUpgrade} onSell={onSell} />
          </SlideIn>
        )}
        {!open && <Label color={COLOR.dim}>CLICK A PAD</Label>}
      </Flex>
      <Flex direction="column" gap={3} width="grow">
        <MenuButton enabled={!active} pressKey="wave" onPress={onStartWave}>
          <Label>{active ? "WAVE ON" : `${keyLabel("wave")} WAVE`}</Label>
        </MenuButton>
        <MenuButton pressKey="fast" onPress={toggleSpeed}>
          <Label>{keyLabel("fast")} SPEED X{speed}</Label>
        </MenuButton>
        <MenuButton pressKey="pause" onPress={togglePause}>
          <Label>{keyLabel("pause")} PAUSE</Label>
        </MenuButton>
      </Flex>
    </Flex>
  );
}
