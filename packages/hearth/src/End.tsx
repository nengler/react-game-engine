import { Hud } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";
import { keyLabel } from "./rules/controls.ts";
import { COLOR } from "./theme.ts";

interface EndProps {
  won: boolean;
}

/** The end of a run: a modal over the field saying how it went, and a way back to the title. */
export function End({ won }: EndProps) {
  const { toTitle } = useGame.actions();
  const lives = useGame((s) => s.endLives);
  const wave = useGame((s) => s.endWave);

  return (
    <Hud>
      <Modal title={won ? "THE HEARTH HOLDS" : "THE HEARTH FELL"}>
        <Label text={won ? `LIVES LEFT ${lives}` : `REACHED WAVE ${wave}`} color={won ? COLOR.good : COLOR.lives} />
        <MenuButton pressKey="confirm" onPress={toTitle}>
          <Label text={`${keyLabel("confirm")} TITLE`} />
        </MenuButton>
      </Modal>
    </Hud>
  );
}
