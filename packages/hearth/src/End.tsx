import { Hud, useInput } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";
import { COLOR } from "./theme.ts";

interface EndProps {
  won: boolean;
}

/** The end of a run: a modal over the field saying how it went, and a way back to the title. */
export function End({ won }: EndProps) {
  const toTitle = useGame((s) => s.toTitle);
  const { lives, wave } = useGame((s) => s.battle);

  useInput((input) => {
    if (input.pressed("confirm")) {
      toTitle();
    }
  });

  return (
    <Hud>
      <Modal title={won ? "THE HEARTH HOLDS" : "THE HEARTH FELL"}>
        <Label text={won ? `LIVES LEFT ${lives}` : `REACHED WAVE ${wave}`} color={won ? COLOR.good : COLOR.lives} />
        <MenuButton onPress={toTitle}>
          <Label text="Z TITLE" />
        </MenuButton>
      </Modal>
    </Hud>
  );
}
