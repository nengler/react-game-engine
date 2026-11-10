import { Tilemap } from "@rge/runtime/jsx";
import { Entity } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/**
 * Every room, side by side where the world puts them (a room's exit meets the next room), each drawn from its Tiled map. Only
 * the room the character is in and its neighbours are drawn, so the camera's slide shows both rooms and the rest cost nothing.
 */
export function Level() {
  const room = useGame((s) => s.room);
  const near1 = Math.abs(room - 0) <= 1;
  const near2 = Math.abs(room - 1) <= 1;
  const near3 = Math.abs(room - 2) <= 1;
  const near4 = Math.abs(room - 3) <= 1;
  const near5 = Math.abs(room - 4) <= 1;
  const near6 = Math.abs(room - 5) <= 1;
  const near7 = Math.abs(room - 6) <= 1;
  const near8 = Math.abs(room - 7) <= 1;

  return (
    <Entity name="Level">
      {near1 && <Tilemap map="room1" image="tiles.png" layer="Tiles" transform={{ x: 0, y: 0 }} />}
      {near2 && <Tilemap map="room2" image="tiles.png" layer="Tiles" transform={{ x: 320, y: 0 }} />}
      {near3 && <Tilemap map="room3" image="tiles.png" layer="Tiles" transform={{ x: 640, y: 0 }} />}
      {near4 && <Tilemap map="room4" image="tiles.png" layer="Tiles" transform={{ x: 960, y: 0 }} />}
      {near5 && <Tilemap map="room5" image="tiles.png" layer="Tiles" transform={{ x: 960, y: -180 }} />}
      {near6 && <Tilemap map="room6" image="tiles.png" layer="Tiles" transform={{ x: 960, y: -360 }} />}
      {near7 && <Tilemap map="room7" image="tiles.png" layer="Tiles" transform={{ x: 1280, y: -360 }} />}
      {near8 && <Tilemap map="room8" image="tiles.png" layer="Tiles" transform={{ x: 1600, y: -360 }} />}
    </Entity>
  );
}
