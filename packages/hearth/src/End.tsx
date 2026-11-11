import { Flex, Hud, useInput } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";

interface EndProps {
  won: boolean;
}

/** The end of a run: a modal over the field saying how it went, and a way back to the title. */
export function End({ won }: EndProps) {
  const toTitle = useGame((s) => s.toTitle);
  const lives = useGame((s) => s.battle.lives);
  const wave = useGame((s) => s.battle.wave);

  useInput((input) => {
    if (input.pressed("confirm")) {
      toTitle();
    }
  });

  return (
    <Hud>
      <Flex direction="column" alignItems="center" justifyContent="center" width="grow" height="grow">
        <Modal title={won ? "THE HEARTH HOLDS" : "THE HEARTH FELL"}>
          <Label text={won ? `LIVES LEFT ${lives}` : `REACHED WAVE ${wave}`} color={won ? "#7de37a" : "#e04a5a"} />
          <MenuButton onPress={() => toTitle()}>
            <Label text="Z TITLE" />
          </MenuButton>
        </Modal>
      </Flex>
    </Hud>
  );
}
