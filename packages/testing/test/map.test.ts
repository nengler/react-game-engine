import assert from "node:assert/strict";
/** `sceneMap`: the tilemaps of a tree as text, with things marked. */
import { describe, it } from "node:test";

import { Camera, Collider, Entity, Hud, Sprite, Tilemap, sceneMap, type TilemapData } from "@tsengine/runtime";

import { render } from "../src/index.ts";

// A 6 × 4 room of 10-pixel tiles: tile 1 is solid, 2 is grass, 3 is road; row by row.
const room: TilemapData = {
  width: 6,
  height: 4,
  tileWidth: 10,
  tileHeight: 10,
  firstGid: 1,
  solid: [1],
  layers: [
    { name: "Tiles", visible: true, data: [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 1, 1, 3, 3, 3, 3, 0, 1, 1, 1, 1, 1, 1] },
    { name: "Markers", visible: false, data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
};

/** A component as the compiler writes one, shown by a sprite and a collider. */
class Hero extends Entity {
  static readonly managed = true;
  constructor() {
    super({ name: "Hero" });
    this.transform.x = 12;
    this.transform.y = 12;
    this.addChild(new Sprite({ image: "hero.png" }));
    this.addChild(new Collider({ width: 6, height: 6, tag: "hero" }));
  }
}

class Coin extends Entity {
  static readonly managed = true;
  constructor(x: number) {
    super({ name: "Coin" });
    this.transform.x = x;
    this.transform.y = 25;
    this.addChild(new Sprite({ image: "coin.png" }));
  }
}

/** A component that only holds others: not marked itself. */
class Level extends Entity {
  static readonly managed = true;
  constructor() {
    super({ name: "Level" });
    this.addChild(new Tilemap({ map: "room" }));
    const camera = new Camera({});
    camera.addChild(new Hero());
    this.addChild(camera);
    this.addChild(new Coin(45));
    this.addChild(new Coin(500));
    const hud = new Hud({});
    hud.addChild(new Coin(5));
    this.addChild(hud);
  }
}

describe("sceneMap", () => {
  it("draws solid tiles as #, other tiles by how common they are, and marks things by letter", () => {
    const t = render(Level, {}, { tilemaps: { room } });
    assert.equal(
      sceneMap(t.root),
      [
        "region @(0,0) 60×40, a character is 10×10 px, y grows downward",
        "######",
        "#A::.#",
        "#...B ",
        "######",
        "# solid (tile 1)  . tile 3  : tile 2  (space) no tile",
        "A Hero @(15,15)",
        "B Coin @(45,25)",
        "off this map: Coin @(500,25)",
      ].join("\n"),
      "the hidden layer is not drawn, a hud's things are not on the map, and a thing off the region is listed"
    );
  });

  it("draws a region given in pixels, several tiles a character when it is wide (solid when most are), and says when it finds nothing", () => {
    const t = render(Level, {}, { tilemaps: { room } });
    assert.match(
      sceneMap(t.root, { region: { x: 0, y: 0, width: 60, height: 40 }, maxColumns: 3, things: false }),
      /^region .* 20×20 px.*\n#:#\n#\.\.\n# solid/
    );
    assert.match(sceneMap(t.root, { around: "Nobody" }), /no map: nothing called 'Nobody'/);
    assert.match(sceneMap(render(Hero).root), /no map: there is no tilemap/);
  });
});
