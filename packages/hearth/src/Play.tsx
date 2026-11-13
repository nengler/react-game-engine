import { Entity, Hud, ParticleLayer, useInput, useUpdate } from "@rge/runtime/jsx";
import { Enemy } from "./Enemy.tsx";
import { fx } from "./effects.ts";
import { Field } from "./Field.tsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";
import { Shot } from "./Shot.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { Pad } from "./Pad.tsx";

/** The play screen: the field with its pads, towers, enemies and shots, and over it the side panel and, when paused, a menu. */
export function Play() {
  const { pads, enemies, shots } = useGame((s) => s.battle);
  const { paused, step, close, resume, toTitle } = useGame((s) => s);

  // The one place the battle is stepped. Keys are the buttons' (`pressKey`) and the pads' (the focus); `back` closes the panel.
  useUpdate((dt) => {
    step(dt);
  });
  useInput((input) => {
    if (input.pressed("back")) close();
  });

  return (
    <Entity>
      <Field />
      {pads.map((p) => (
        <Pad key={p.id} {...p} />
      ))}
      {enemies.map((e) => (
        <Enemy key={e.id} {...e} />
      ))}
      {shots.map((s) => s.live && <Shot key={s.id} {...s} />)}
      <ParticleLayer particles={fx} />
      <Hud>
        <SidePanel />
        {paused && (
          <Modal title="PAUSED">
            <MenuButton onPress={resume}>
              <Label text="RESUME" />
            </MenuButton>
            <MenuButton onPress={toTitle}>
              <Label text="QUIT TO TITLE" />
            </MenuButton>
          </Modal>
        )}
      </Hud>
    </Entity>
  );
}
