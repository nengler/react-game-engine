import { Flex } from "@rge/runtime/jsx";
import { BuildMenu } from "./BuildMenu.tsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { StatRow } from "./StatRow.tsx";
import { UpgradePanel } from "./UpgradePanel.tsx";
import { WAVE_COUNT } from "./rules/waves.ts";

/** The right 80 pixels: the numbers, what the cursor is on, and the buttons that start a wave and change the speed. */
export function SidePanel() {
  const gold = useGame((s) => s.battle.gold);
  const lives = useGame((s) => s.battle.lives);
  const wave = useGame((s) => s.battle.wave);
  const active = useGame((s) => s.battle.active);
  const open = useGame((s) => s.open);
  const occupied = useGame((s) => s.focus.occupied);
  const speed = useGame((s) => s.speed);
  const startWave = useGame((s) => s.startWave);
  const toggleSpeed = useGame((s) => s.toggleSpeed);
  const pause = useGame((s) => s.pause);

  return (
    <Flex float anchor="top-right" to="top-right" direction="column" justifyContent="space-between" width={80} height={180} padding={4} gap={4} background="#12151f">
      <Flex direction="column" gap={4} width="grow">
        <StatRow icon={3} text={`${gold}`} color="#f2c83c" />
        <StatRow icon={4} text={`${lives}`} color="#e04a5a" />
        <StatRow icon={5} text={`${wave}/${WAVE_COUNT}`} color="#5ac8e8" />
        {open && !occupied && <BuildMenu />}
        {open && occupied && <UpgradePanel />}
        {!open && <Label text="CLICK A PAD" color="#8e9ac2" />}
      </Flex>
      <Flex direction="column" gap={3} width="grow">
        <MenuButton enabled={!active} onPress={() => startWave()}>
          <Label text={active ? "WAVE ON" : "SPACE WAVE"} />
        </MenuButton>
        <MenuButton onPress={() => toggleSpeed()}>
          <Label text={`F SPEED X${speed}`} />
        </MenuButton>
        <MenuButton onPress={() => pause()}>
          <Label text="ESC PAUSE" />
        </MenuButton>
      </Flex>
    </Flex>
  );
}
