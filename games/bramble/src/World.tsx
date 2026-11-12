import { Entity, Sprite, Tilemap } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/** The map the character is on: its ground from the Tiled map, and over it the things the rules know about, each a frame of `things.png`. */
export function World() {
  const map = useGame((s) => s.run.map);
  const { bushes, doors, gates, shrines, pickups, npcs, beetles, wisps, swings } = useGame((s) => s.view);
  return (
    <Entity name="World">
      <Tilemap map={map} image="tiles.png" layer="Ground" />
      {doors.map((d) => (
        <Sprite key={d.id} image="things.png" frameWidth={16} frameHeight={16} frame={d.frame} transform={{ x: d.x, y: d.y }} />
      ))}
      {gates.map((g) => (
        <Sprite key={g.id} image="things.png" frameWidth={16} frameHeight={16} frame={g.frame} transform={{ x: g.x, y: g.y }} />
      ))}
      {shrines.map((s) => (
        <Sprite key={s.id} image="things.png" frameWidth={16} frameHeight={16} frame={s.frame} transform={{ x: s.x, y: s.y }} />
      ))}
      {pickups.map((p) => (
        <Sprite key={p.id} image="things.png" frameWidth={16} frameHeight={16} frame={p.frame} transform={{ x: p.x, y: p.y }} />
      ))}
      {npcs.map((n) => (
        <Sprite key={n.id} image="things.png" frameWidth={16} frameHeight={16} frame={n.frame} transform={{ x: n.x, y: n.y }} />
      ))}
      {beetles.map((b) => (
        <Sprite key={b.id} image="things.png" frameWidth={16} frameHeight={16} frame={b.frame} transform={{ x: b.x, y: b.y }} />
      ))}
      {wisps.map((w) => (
        <Sprite key={w.id} image="things.png" frameWidth={16} frameHeight={16} frame={w.frame} transform={{ x: w.x, y: w.y }} />
      ))}
      {bushes.map((b) => (
        <Sprite key={b.id} image="things.png" frameWidth={16} frameHeight={16} frame={b.frame} transform={{ x: b.x, y: b.y }} />
      ))}
      {swings.map((w) => (
        <Sprite key={w.id} image="things.png" frameWidth={16} frameHeight={16} frame={w.frame} transform={{ x: w.x, y: w.y }} />
      ))}
    </Entity>
  );
}
