import { Entity, Shape, Tilemap } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { TILE } from "./rules/constants.ts";

/** The map the character is on: its ground from the Tiled map, and over it the things the rules know about, drawn as plain shapes until the art exists. */
export function World() {
  const map = useGame((s) => s.run.map);
  const { bushes, doors, gates, shrines, pickups, npcs } = useGame((s) => s.view);
  return (
    <Entity name="World">
      <Tilemap map={map} image="tiles.png" layer="Ground" />
      {bushes.map((b) => (
        <Shape key={b.id} kind="rect" width={TILE} height={TILE} color="#2f7a3a" transform={{ x: b.x, y: b.y }} />
      ))}
      {doors.map((d) => (
        <Shape key={d.id} kind="rect" width={TILE} height={TILE} color="#6b4a2b" transform={{ x: d.x, y: d.y }} />
      ))}
      {gates.map((g) => (
        <Shape key={g.id} kind="rect" width={TILE} height={TILE} color="#d9b64a" transform={{ x: g.x, y: g.y }} />
      ))}
      {shrines.map((s) => (
        <Shape key={s.id} kind="circle" width={12} height={12} color="#6fd6d0" transform={{ x: s.x, y: s.y }} />
      ))}
      {pickups.map((p) => (
        <Shape key={p.id} kind="circle" width={8} height={8} color="#f2e05a" transform={{ x: p.x, y: p.y }} />
      ))}
      {npcs.map((n) => (
        <Shape key={n.id} kind="rect" width={12} height={14} color="#6a8be0" transform={{ x: n.x, y: n.y }} />
      ))}
    </Entity>
  );
}
