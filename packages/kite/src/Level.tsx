import { Entity, Tilemap } from "@tsengine/runtime/jsx";

import { useGame } from "./GameState.ts";
import { ROOM_LIST } from "./rules/rooms.ts";

/**
 * Every room where the world puts it (a room's exit meets the next room), each drawn from its Tiled map. Only the room the
 * character is in and its neighbours are in the world, so the camera's slide shows both rooms and the rest cost nothing.
 */
export function Level() {
  const room = useGame((s) => s.run.room);

  return (
    <Entity>
      {ROOM_LIST.filter((r) => Math.abs(r.index - room) <= 1).map((r) => (
        <Tilemap key={r.map} map={r.map} image="tiles.png" layer="Tiles" x={r.ox} y={r.oy} />
      ))}
    </Entity>
  );
}
