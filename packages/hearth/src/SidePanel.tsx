import { Flex } from "@rge/runtime/jsx";
import { BuildMenu } from "./BuildMenu.tsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { StatRow } from "./StatRow.tsx";
import { UpgradePanel } from "./UpgradePanel.tsx";
import { keyLabel } from "./rules/controls.ts";
import { WAVE_COUNT } from "./rules/waves.ts";
import { COLOR, ICON } from "./theme.ts";

/** The right 80 pixels: the numbers, what the cursor is on, and the buttons that start a wave and change the speed. */
export function SidePanel() {
  const { gold, lives, wave, active } = useGame((s) => s.battle);
  const { open, speed, startWave, toggleSpeed, togglePause } = useGame((s) => s);
  const occupied = useGame((s) => s.battle.pads[s.cursor]?.tower != null);

  return (
    <Flex float anchor="top-right" to="top-right" direction="column" justifyContent="space-between" width={80} height={180} padding={4} gap={4} background={COLOR.background}>
      <Flex direction="column" gap={4} width="grow">
        <StatRow icon={ICON.gold} text={`${gold}`} color={COLOR.gold} />
        <StatRow icon={ICON.lives} text={`${lives}`} color={COLOR.lives} />
        <StatRow icon={ICON.wave} text={`${wave}/${WAVE_COUNT}`} color={COLOR.wave} />
        {open && !occupied && <BuildMenu />}
        {open && occupied && <UpgradePanel />}
        {!open && <Label text="CLICK A PAD" color={COLOR.dim} />}
      </Flex>
      <Flex direction="column" gap={3} width="grow">
        <MenuButton enabled={!active} pressKey="wave" onPress={startWave}>
          <Label text={active ? "WAVE ON" : `${keyLabel("wave")} WAVE`} />
        </MenuButton>
        <MenuButton pressKey="fast" onPress={toggleSpeed}>
          <Label text={`${keyLabel("fast")} SPEED X${speed}`} />
        </MenuButton>
        <MenuButton pressKey="pause" onPress={togglePause}>
          <Label text={`${keyLabel("pause")} PAUSE`} />
        </MenuButton>
      </Flex>
    </Flex>
  );
}
