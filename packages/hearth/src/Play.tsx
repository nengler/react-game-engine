import { Entity, Hud, ParticleLayer, useUpdate } from "@rge/runtime/jsx";
import { Enemy } from "./Enemy.tsx";
import { EmptyPad } from "./EmptyPad.tsx";
import { fx } from "./effects.ts";
import { Field } from "./Field.tsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";
import { Shot } from "./Shot.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { Tower } from "./Tower.tsx";
import { readIntent } from "./rules/controls.ts";

/** The play screen: the field with its pads, towers, enemies and shots, and over it the side panel and, when paused, a menu. */
export function Play() {
  const { pads, enemies, shots } = useGame((s) => s.battle);
  const { paused, act, resume, toTitle } = useGame((s) => s);

  // The one place the battle is stepped: what the keys ask for, run through the rules.
  useUpdate((dt, input) => {
    act(readIntent(input), dt);
  });

  return (
    <Entity name="Play">
      <Field />
      {pads.map((p) =>
        p.tower ? (
          <Tower key={p.id} id={p.id} x={p.x} y={p.y} kind={p.tower.kind} level={p.tower.level} angle={p.tower.angle} flash={p.tower.flash} />
        ) : (
          <EmptyPad key={p.id} id={p.id} x={p.x} y={p.y} />
        ),
      )}
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
