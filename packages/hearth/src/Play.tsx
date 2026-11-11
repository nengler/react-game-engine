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
  const towers = useGame((s) => s.towers);
  const empty = useGame((s) => s.empty);
  const enemies = useGame((s) => s.battle.enemies);
  const shots = useGame((s) => s.battle.shots);
  const paused = useGame((s) => s.paused);
  const act = useGame((s) => s.act);
  const resume = useGame((s) => s.resume);
  const toTitle = useGame((s) => s.toTitle);

  // The one place the battle is stepped: what the keys ask for, run through the rules.
  useUpdate((dt, input) => {
    act(readIntent(input), dt);
  });

  return (
    <Entity name="Play">
      <Field />
      {/* WORKAROUND(tier3-spread): the props are named one by one; `<Tower key={t.id} {...t} />` once spread props work on components. */}
      {/* WORKAROUND(tier3-cond-map): one list of empty pads and one of towers; it is one list, `pads.map((p) => (p.tower ? <Tower …/> : <EmptyPad …/>))`, once a list's map may choose. */}
      {empty.map((p) => (
        <EmptyPad key={p.id} id={p.id} x={p.x} y={p.y} />
      ))}
      {towers.map((t) => (
        <Tower key={t.id} id={t.id} x={t.x} y={t.y} kind={t.kind} level={t.level} angle={t.angle} firedAt={t.firedAt} />
      ))}
      {enemies.map((e) => (
        <Enemy key={e.id} kind={e.kind} x={e.x} y={e.y} left={e.left} hp={e.hp} maxHp={e.maxHp} slow={e.slow} flash={e.flash} />
      ))}
      {/* WORKAROUND(tier3-cond-map): `shots.map((s) => s.live && <Shot …/>)` */}
      {shots
        .filter((s) => s.live)
        .map((s) => (
          <Shot key={s.id} kind={s.kind} x={s.x} y={s.y} tx={s.tx} ty={s.ty} t={s.t} flight={s.flight} radius={s.radius} />
        ))}
      <ParticleLayer particles={fx} />
      <Hud>
        <SidePanel />
        {paused && (
          <Modal title="PAUSED">
            <MenuButton onPress={() => resume()}>
              <Label text="RESUME" />
            </MenuButton>
            <MenuButton onPress={() => toTitle()}>
              <Label text="QUIT TO TITLE" />
            </MenuButton>
          </Modal>
        )}
      </Hud>
    </Entity>
  );
}
