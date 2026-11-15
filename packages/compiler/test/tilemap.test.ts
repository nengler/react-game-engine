import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
/** Tiled tile layers → `<Tilemap>` data, and the Tiled importer (`importTiled`): object layers → a scene, and its `visible` handling. */
import { describe, it, after, before } from "node:test";
import { deflateSync, gzipSync } from "node:zlib";

import { importTiled, importTilemap, readTsx, tilemapsSource, DiagnosticCode, projectSchemas, type ProjectModule } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, getCompiler, type CompiledModule } from "./helpers.ts";
import { WORLD } from "./scene-fixture.ts";

const H = 0x80000000;
const V = 0x40000000;
const D = 0x20000000;

const map = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "map",
    width: 3,
    height: 2,
    tilewidth: 10,
    tileheight: 10,
    tilesets: [
      {
        firstgid: 1,
        tiles: [
          { id: 1, properties: [{ name: "solid", type: "bool", value: true }] },
          { id: 2, properties: [{ name: "other", type: "bool", value: true }] },
        ],
      },
    ],
    layers: [
      { type: "tilelayer", name: "Tiles", width: 3, height: 2, data: [1, 2, 0, 3, 2 + H, 2 + (V | D)] },
      { type: "tilelayer", name: "Hidden", visible: false, width: 3, height: 2, data: [1, 1, 1, 1, 1, 1] },
      {
        type: "group",
        name: "Deco",
        visible: false,
        layers: [{ type: "tilelayer", name: "InGroup", width: 3, height: 2, data: [0, 0, 0, 0, 0, 1] }],
      },
    ],
    ...overrides,
  });

describe("importTilemap", () => {
  it("reads the tile layers: ids with the flip bits split off, visibility, and the solid tiles of the tileset", () => {
    const { tilemap, diagnostics } = importTilemap("room.tmj", map());
    assert.deepEqual(diagnostics, []);
    assert.ok(tilemap);
    assert.deepEqual([tilemap.width, tilemap.height, tilemap.tileWidth, tilemap.tileHeight, tilemap.firstGid], [3, 2, 10, 10, 1]);
    assert.deepEqual(tilemap.solid, [2], "tile id 1 of the tileset with firstgid 1 is global tile 2; `other` is not `solid`");
    assert.deepEqual(
      tilemap.layers.map((l) => [l.name, l.visible]),
      [
        ["Tiles", true],
        ["Hidden", false],
        ["InGroup", false],
      ],
      "a layer in a hidden group is hidden"
    );
    const tiles = tilemap.layers[0]!;
    assert.deepEqual(tiles.data, [1, 2, 0, 3, 2, 2]);
    assert.deepEqual(tiles.flips, [0, 0, 0, 0, 1, 6], "horizontal is 1, vertical 2, diagonal 4");
    assert.equal(tilemap.layers[1]!.flips, undefined, "no flips, no array");
  });

  it("is null for a map with no tile data, as an objects-only map has", () => {
    const empty = importTilemap(
      "o.tmj",
      JSON.stringify({
        width: 4,
        height: 4,
        tilewidth: 8,
        tileheight: 8,
        layers: [
          { type: "tilelayer", name: "Ground", data: [] },
          { type: "objectgroup", name: "Things", objects: [] },
        ],
      })
    );
    assert.equal(empty.tilemap, null);
    assert.deepEqual(empty.diagnostics, []);
  });

  it("says plainly what it cannot read, instead of drawing garbage", () => {
    const base64 = importTilemap("a.tmj", map({ layers: [{ type: "tilelayer", name: "T", encoding: "base64", data: "AAAA" }] }));
    assert.equal(base64.tilemap, null);
    assert.match(base64.diagnostics[0]!.message, /holds 3 bytes, not 24 \(6 cells\)/);
    const zstd = importTilemap(
      "a.tmj",
      map({ layers: [{ type: "tilelayer", name: "T", encoding: "base64", compression: "zstd", data: "AAAA" }] })
    );
    assert.match(zstd.diagnostics[0]!.message, /compression 'zstd' is not supported/);
    const broken = importTilemap(
      "a.tmj",
      map({ layers: [{ type: "tilelayer", name: "T", encoding: "base64", compression: "zlib", data: "AAAA" }] })
    );
    assert.match(broken.diagnostics[0]!.message, /does not decompress/);
    const wrongSize = importTilemap("a.tmj", map({ layers: [{ type: "tilelayer", name: "T", data: [1, 2, 3] }] }));
    assert.match(wrongSize.diagnostics[0]!.message, /has 3 cells, but the map is 3 × 2 = 6/);
    const infinite = importTilemap("a.tmj", map({ infinite: true }));
    assert.match(infinite.diagnostics[0]!.message, /infinite/);
    const other = importTilemap("a.tmj", map({ tilesets: [{ firstgid: 1, source: "tiles.xml" }] }));
    assert.match(other.diagnostics[0]!.message, /neither JSON \(\.tsj\) nor XML \(\.tsx\)/);
    const collection = importTilemap("a.tmj", map({ tilesets: [{ firstgid: 1, tiles: [{ id: 0, image: "a.png" }] }] }));
    assert.match(collection.diagnostics[0]!.message, /collection of images/);
    const missing = importTilemap("a.tmj", map({ tilesets: [{ firstgid: 1, source: "gone.tsj" }] }), { readFile: () => null });
    assert.match(missing.diagnostics[0]!.message, /cannot be read/);
    assert.equal(importTilemap("a.tmj", "{").tilemap, null, "bad JSON is the scene importer's to report");
  });

  it("writes tilemaps.ts as a table of data, and the CLI writes it next to the generated components", () => {
    const { tilemap } = importTilemap("room.tmj", map());
    const source = tilemapsSource(new Map([["room", tilemap!]]), "scenes");
    assert.match(source, /export const tilemaps: Record<string, TilemapData> = \{\n  "room": \{/);
    assert.match(source, /flips: \[0,0,0,0,1,6\]/);
    const dir = mkdtempSync(join(tmpdir(), "tse-tilemap-"));
    try {
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "scenes"));
      writeFileSync(
        join(dir, "src/A.tsx"),
        `import { Entity } from "@tsengine/runtime/jsx";\nexport function A() { return <Entity name="A" />; }\n`
      );
      writeFileSync(join(dir, "scenes/room.tmj"), map());
      const repo = resolve(import.meta.dirname, "../../..");
      execFileSync(
        process.execPath,
        [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out"), "--scenes", join(dir, "scenes"), "--no-check"],
        { cwd: repo, stdio: "pipe" }
      );
      assert.match(readFileSync(join(dir, "out/tilemaps.ts"), "utf8"), /"room": \{/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("importTiled: hidden layers and objects", () => {
  const objects = (extra: Record<string, unknown>[]): string =>
    JSON.stringify({ layers: [{ type: "objectgroup", name: "Things", objects: extra }] });

  it("skips an object that is hidden in Tiled, and everything in a hidden layer or group", () => {
    const shown = { id: 1, class: "Coin", x: 1, y: 2, visible: true };
    const hidden = { id: 2, class: "Coin", x: 3, y: 4, visible: false };
    const result = importTiled("m.tmj", objects([shown, hidden]));
    assert.deepEqual(
      result.scene.entities.map((e) => e.id),
      ["Things/1"]
    );
    const layer = importTiled(
      "m.tmj",
      JSON.stringify({ layers: [{ type: "objectgroup", name: "Off", visible: false, objects: [shown] }] })
    );
    assert.deepEqual(layer.scene.entities, []);
    const group = importTiled(
      "m.tmj",
      JSON.stringify({
        layers: [{ type: "group", name: "G", visible: false, layers: [{ type: "objectgroup", name: "In", objects: [shown] }] }],
      })
    );
    assert.deepEqual(group.scene.entities, []);
  });

  it("treats a tile object with flip bits in its gid like any other: the flags do not move its anchor", () => {
    const plain = importTiled("m.tmj", objects([{ id: 1, class: "Coin", gid: 5, x: 10, y: 20, height: 16, width: 16 }]));
    const flipped = importTiled("m.tmj", objects([{ id: 1, class: "Coin", gid: 5 + H + D, x: 10, y: 20, height: 16, width: 16 }]));
    assert.deepEqual(flipped.scene.entities[0]!.transform, plain.scene.entities[0]!.transform);
  });
});

describe("importTilemap: encoded layers and external tilesets", () => {
  const cells = [1, 2, 0, 3, 2 + H, 2 + (V | D)];
  const bytes = Buffer.alloc(cells.length * 4);
  cells.forEach((c, i) => bytes.writeUInt32LE(c >>> 0, i * 4));
  const layerOf = (data: string, compression?: string) => ({
    type: "tilelayer",
    name: "Tiles",
    width: 3,
    height: 2,
    encoding: "base64",
    ...(compression === undefined ? {} : { compression }),
    data,
  });

  it("reads base64 layers: uncompressed, zlib and gzip, with the same cells and flips as CSV", () => {
    const csv = importTilemap("a.tmj", map({ layers: [{ type: "tilelayer", name: "Tiles", width: 3, height: 2, data: cells }] })).tilemap!;
    for (const [data, compression] of [
      [bytes.toString("base64"), undefined],
      [deflateSync(bytes).toString("base64"), "zlib"],
      [gzipSync(bytes).toString("base64"), "gzip"],
    ] as const) {
      const { tilemap, diagnostics } = importTilemap("a.tmj", map({ layers: [layerOf(data, compression)] }));
      assert.deepEqual(diagnostics, [], String(compression));
      assert.deepEqual(tilemap!.layers[0], csv.layers[0], `${String(compression)} gives the CSV layer`);
    }
  });

  it("reads an external .tsj tileset through readFile, and the solid tiles of every tileset", () => {
    const tsj = JSON.stringify({ tiles: [{ id: 0, properties: [{ name: "solid", type: "bool", value: true }] }] });
    const asked: string[] = [];
    const { tilemap, diagnostics } = importTilemap(
      "a.tmj",
      map({
        tilesets: [
          { firstgid: 1, source: "../tilesets/ground.tsj" },
          { firstgid: 100, tiles: [{ id: 3, properties: [{ name: "solid", value: true }] }] },
        ],
      }),
      {
        readFile: (path) => (asked.push(path), tsj),
      }
    );
    assert.deepEqual(asked, ["../tilesets/ground.tsj"]);
    assert.deepEqual(tilemap!.solid, [1, 103], "tile 0 of the first (firstgid 1) and tile 3 of the second (firstgid 100)");
    assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  });
});

describe("importTilemap: objects", () => {
  const withObjects = (layers: unknown[]) =>
    map({ layers: [{ type: "tilelayer", name: "Tiles", width: 3, height: 2, data: [1, 1, 1, 1, 1, 1] }, ...layers] });

  it("reads the objects of visible object layers with their custom properties, and writes them into tilemaps.ts", () => {
    const { tilemap, diagnostics } = importTilemap(
      "a.tmj",
      withObjects([
        {
          type: "objectgroup",
          name: "Doors",
          objects: [
            {
              id: 3,
              name: "cave",
              type: "door",
              x: 32,
              y: 48,
              width: 16,
              height: 16,
              properties: [
                { name: "to", type: "string", value: "cave-exit" },
                { name: "needs", type: "string", value: "lantern" },
                { name: "locked", type: "bool", value: true },
                { name: "bad", type: "object", value: { x: 1 } },
              ],
            },
          ],
        },
        { type: "objectgroup", name: "Hidden", visible: false, objects: [{ id: 9, name: "nope", type: "door", x: 0, y: 0 }] },
        {
          type: "group",
          name: "G",
          layers: [
            {
              type: "objectgroup",
              name: "People",
              objects: [
                { id: 4, name: "wren", class: "npc", x: 1, y: 2, properties: [{ name: "page", value: 2 }] },
                { id: 5, name: "hidden one", visible: false },
              ],
            },
          ],
        },
      ])
    );
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(
      tilemap!.objects.map((o) => [o.id, o.name, o.type]),
      [
        [3, "cave", "door"],
        [4, "wren", "npc"],
      ]
    );
    assert.deepEqual(
      tilemap!.objects[0]!.properties,
      { to: "cave-exit", needs: "lantern", locked: true },
      "only strings, numbers and booleans"
    );
    assert.deepEqual([tilemap!.objects[0]!.x, tilemap!.objects[0]!.y, tilemap!.objects[0]!.width], [32, 48, 16]);
    const source = tilemapsSource(new Map([["room", tilemap!]]), "scenes");
    assert.match(source, /objects: \[\{"id":3,"name":"cave","type":"door"/);
  });

  it("places objects where Tiled shows them: a layer's offset, and its groups', moves them", () => {
    const { tilemap } = importTilemap(
      "a.tmj",
      withObjects([
        {
          type: "group",
          name: "G",
          offsetx: 100,
          offsety: 10,
          layers: [{ type: "objectgroup", name: "O", offsetx: 5, offsety: 1, objects: [{ id: 1, name: "a", type: "spot", x: 1, y: 2 }] }],
        },
      ])
    );
    assert.deepEqual([tilemap!.objects[0]!.x, tilemap!.objects[0]!.y], [106, 13]);
  });

  it("a layer marked `data` is data for the rules: its objects are read here, and the scene importer makes no entities of them", () => {
    const text = withObjects([
      {
        type: "objectgroup",
        name: "Things",
        properties: [{ name: "data", type: "bool", value: true }],
        objects: [{ id: 1, name: "cave", type: "door", x: 0, y: 0 }],
      },
      { type: "objectgroup", name: "Prefabs", objects: [{ id: 2, type: "Coin", x: 5, y: 5 }] },
    ]);
    assert.deepEqual(
      importTilemap("a.tmj", text).tilemap!.objects.map((o) => o.name),
      ["cave", ""]
    );
    assert.deepEqual(
      importTiled("a.tmj", text).scene.entities.map((e) => e.id),
      ["Prefabs/2"]
    );
  });

  it("writes no objects line for a map without any", () => {
    const { tilemap } = importTilemap("a.tmj", map());
    assert.deepEqual(tilemap!.objects, []);
    assert.doesNotMatch(tilemapsSource(new Map([["room", tilemap!]]), "scenes"), /objects:/);
  });
});

describe("importTilemap: tilesets as sheets", () => {
  const TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.10.2" name="props &amp; things" tilewidth="16" tileheight="32" spacing="1" margin="2" tilecount="6" columns="3">
 <!-- a comment, with <tags> in it -->
 <image source="../art/props.png" width="53" height="69"/>
 <tile id="1">
  <properties>
   <property name="solid" type="bool" value="true"/>
   <property name="weight" type="int" value="3"/>
   <property name="note">a multi-line
string</property>
  </properties>
 </tile>
 <tile id="4">
  <animation><frame tileid="4" duration="100"/></animation>
 </tile>
 <wangsets><wangset name="w" type="corner" tile="-1"><wangcolor name="" color="#ff0000" tile="-1" probability="1"/></wangset></wangsets>
</tileset>
`;

  it("reads an XML tileset (.tsx): its sheet, size, margin and spacing, and its tiles' properties", () => {
    const set = readTsx(TSX);
    assert.deepEqual(
      [set.name, set.tilewidth, set.tileheight, set.columns, set.margin, set.spacing, set.image, set.imagewidth],
      ["props & things", 16, 32, 3, 2, 1, "../art/props.png", 53]
    );
    assert.deepEqual(set.tiles, [
      {
        id: 1,
        properties: [
          { name: "solid", type: "bool", value: true },
          { name: "weight", type: "int", value: 3 },
          { name: "note", type: "string", value: "" },
        ],
      },
      { id: 4 },
    ]);
    assert.throws(() => readTsx("<map/>"), /not a Tiled tileset/);
    assert.throws(() => readTsx("<tileset><image source='a.png'"), /not closed/);
  });

  it("gives each tileset its sheet, as an asset name, with the image relative to the tileset's own file", () => {
    const asked: string[] = [];
    const { tilemap, diagnostics } = importTilemap(
      "a.tmj",
      map({
        properties: [
          { name: "name", type: "string", value: "The valley" },
          { name: "dark", type: "bool", value: true },
        ],
        tilesets: [
          {
            firstgid: 1,
            name: "ground",
            image: "../assets/tiles.png",
            imagewidth: 30,
            imageheight: 20,
            tilewidth: 10,
            tileheight: 10,
            columns: 3,
          },
          { firstgid: 100, source: "../tilesets/props.tsx" },
          { firstgid: 50, source: "sets/more.tsj" },
        ],
      }),
      {
        readFile: (path) =>
          path.endsWith(".tsx")
            ? TSX
            : JSON.stringify({ image: "more.png", imagewidth: 45, tilewidth: 10, tileheight: 10, margin: 1, spacing: 1 }),
        resolveImage: (path) => (asked.push(path), path.startsWith("../assets/") ? path.slice("../assets/".length) : null),
      }
    );
    assert.deepEqual(
      asked,
      ["../assets/tiles.png", "../art/props.png", "sets/more.png"],
      "paths from the map's folder: a .tsx in ../tilesets names ../art/props.png from there"
    );
    assert.ok(tilemap);
    assert.deepEqual(
      tilemap.tilesets.map((t) => [t.firstGid, t.image, t.columns, t.tileWidth, t.tileHeight, t.margin, t.spacing]),
      [
        [1, "tiles.png", 3, 10, 10, 0, 0],
        [50, "", 4, 10, 10, 1, 1],
        [100, "", 3, 16, 32, 2, 1],
      ],
      "sorted by first id; columns worked out from the image's width when the tileset does not say; sheets outside the assets folder have no image"
    );
    assert.deepEqual(tilemap.solid, [101], "the .tsx's tile 1");
    assert.deepEqual(tilemap.properties, { name: "The valley", dark: true });
    assert.equal(diagnostics.length, 2, "one warning for each sheet that is not in the assets folder");
    assert.match(diagnostics[0]!.message, /'\.\.\/art\/props\.png' \(from the map's folder\) is not in the assets folder/);
    const source = tilemapsSource(new Map([["room", tilemap]]), "scenes");
    assert.match(source, /tilesets: \[\{"firstGid":1,"image":"tiles.png","columns":3/);
    assert.match(source, /properties: \{"name":"The valley","dark":true\}/);
  });

  it("says why an XML tileset it cannot read is skipped", () => {
    const { diagnostics } = importTilemap("a.tmj", map({ tilesets: [{ firstgid: 1, source: "bad.tsx" }] }), {
      readFile: () => "<tileset><tile></tileset>",
    });
    assert.match(diagnostics[0]!.message, /cannot be read: a <tile> has no id/);
  });

  it("the CLI names each sheet by its place in the assets folder, and warns for one that is not there", () => {
    const dir = mkdtempSync(join(tmpdir(), "tse-tilesets-"));
    try {
      for (const sub of ["src", "scenes", "assets/art"]) mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(
        join(dir, "src/A.tsx"),
        `import { Entity } from "@tsengine/runtime/jsx";\nexport function A() { return <Entity name="A" />; }\n`
      );
      writeFileSync(join(dir, "assets/art/tiles.png"), "");
      writeFileSync(
        join(dir, "scenes/props.tsx"),
        `<tileset name="p" tilewidth="10" tileheight="10" columns="2"><image source="../assets/gone.png" width="20" height="10"/></tileset>`
      );
      writeFileSync(
        join(dir, "scenes/room.tmj"),
        map({
          tilesets: [
            { firstgid: 1, image: "../assets/art/tiles.png", tilewidth: 10, tileheight: 10, columns: 3 },
            { firstgid: 10, source: "props.tsx" },
          ],
        })
      );
      const repo = resolve(import.meta.dirname, "../../..");
      const out = execFileSync(
        process.execPath,
        [
          resolve(repo, "packages/compiler/src/cli.ts"),
          join(dir, "src"),
          join(dir, "out"),
          "--scenes",
          join(dir, "scenes"),
          "--assets",
          join(dir, "assets"),
          "--no-check",
        ],
        { cwd: repo, stdio: "pipe", encoding: "utf8" }
      );
      assert.match(out, /wrote tilemaps.ts/);
      const generated = readFileSync(join(dir, "out/tilemaps.ts"), "utf8");
      assert.match(generated, /\{"firstGid":1,"image":"art\/tiles.png"/);
      assert.match(generated, /\{"firstGid":10,"image":"","columns":2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

after(() => {
  closeCompiler();
  cleanOutput();
});

/** The prefabs a Tiled map's objects are validated against. */
let compiled: CompiledModule;
before(() => {
  compiled = compile(WORLD, "World.tsx");
});
const project = (): ProjectModule[] => [{ ir: compiled.ir, generatedName: "World.ts" }];

describe("the Tiled importer", () => {
  const map = (layers: unknown[]): string => JSON.stringify({ type: "map", layers });
  const objects = (...list: Record<string, unknown>[]) => ({ type: "objectgroup", name: "Things", objects: list });

  it("turns object layers into entities: class or type, ids, position, properties of each type", () => {
    const { scene, diagnostics } = importTiled(
      "m.tmj",
      map([
        { type: "tilelayer", name: "Ground", data: [] },
        objects(
          {
            id: 7,
            class: "Enemy",
            x: 32,
            y: 48,
            properties: [
              { name: "speed", type: "float", value: 1.5 },
              { name: "n", type: "int", value: 2 },
              { name: "ok", type: "bool", value: false },
              { name: "tint", type: "string", value: "blue" },
              { name: "sprite", type: "file", value: "a.png" },
              { name: "c", type: "color", value: "#ff0000" },
            ],
          },
          { id: 8, type: "Marker", x: 1, y: 2 }
        ),
      ])
    );
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(scene, {
      version: 1,
      entities: [
        {
          id: "Things/7",
          prefab: "Enemy",
          props: { speed: 1.5, n: 2, ok: false, tint: "blue", sprite: "a.png", c: "#ff0000" },
          transform: { x: 32, y: 48 },
        },
        { id: "Things/8", prefab: "Marker", transform: { x: 1, y: 2 } },
      ],
    });
  });

  it("converts rotation to radians, and flattens groups", () => {
    const { scene } = importTiled(
      "m.tmj",
      map([
        {
          type: "group",
          name: "G",
          layers: [{ type: "group", name: "Inner", layers: [objects({ id: 1, class: "Marker", x: 0, y: 0, rotation: 180 })] }],
        },
      ])
    );
    assert.deepEqual(
      scene.entities.map((e) => [e.id, e.transform.rotation]),
      [["Things/1", Math.PI]].map(([id, r]) => [id, Math.round((r as number) * 1e6) / 1e6])
    );
  });

  it("moves a tile object from its bottom-left anchor to its top-left, along its rotated up axis", () => {
    const flat = importTiled("m.tmj", map([objects({ id: 1, class: "Marker", gid: 5, x: 100, y: 100, height: 16, rotation: 0 })])).scene
      .entities[0]!;
    assert.deepEqual(flat.transform, { x: 100, y: 84 });
    const turned = importTiled("m.tmj", map([objects({ id: 1, class: "Marker", gid: 5, x: 100, y: 100, height: 16, rotation: 90 })])).scene
      .entities[0]!;
    assert.deepEqual([turned.transform.x, turned.transform.y], [116, 100]);
  });

  it("shifts objects by their layer's offset, and by every enclosing group's", () => {
    const { scene } = importTiled(
      "m.tmj",
      map([
        {
          type: "group",
          name: "Outer",
          offsetx: 100,
          offsety: 10,
          layers: [
            {
              type: "group",
              name: "Inner",
              offsetx: 20,
              layers: [{ type: "objectgroup", name: "Deep", offsetx: 3, offsety: 4, objects: [{ id: 1, class: "Marker", x: 1, y: 2 }] }],
            },
            { type: "objectgroup", name: "Sibling", objects: [{ id: 2, class: "Marker", x: 1, y: 2 }] },
          ],
        },
        { type: "objectgroup", name: "Plain", objects: [{ id: 3, class: "Marker", x: 1, y: 2 }] },
      ])
    );
    const at = (id: string) => scene.entities.find((e) => e.id === id)!.transform;
    assert.deepEqual(at("Deep/1"), { x: 1 + 100 + 20 + 3, y: 2 + 10 + 0 + 4 });
    assert.deepEqual(at("Sibling/2"), { x: 1 + 100, y: 2 + 10 }, "the group's offset, not its sibling's");
    assert.deepEqual(at("Plain/3"), { x: 1, y: 2 }, "nothing outside the group is shifted");
  });

  it("applies an offset to a tile object's anchor too", () => {
    const { scene } = importTiled(
      "m.tmj",
      map([
        {
          type: "objectgroup",
          name: "T",
          offsetx: 50,
          offsety: 50,
          objects: [{ id: 1, class: "Marker", gid: 5, x: 100, y: 100, height: 16 }],
        },
      ])
    );
    assert.deepEqual(scene.entities[0]!.transform, { x: 150, y: 134 });
  });

  it("skips an object with no class, with a warning, and reports property types it cannot hold", () => {
    const { scene, diagnostics } = importTiled(
      "m.tmj",
      map([
        objects(
          { id: 1, name: "spawn", x: 0, y: 0 },
          {
            id: 2,
            class: "Enemy",
            x: 0,
            y: 0,
            properties: [
              { name: "target", type: "object", value: 3 },
              { name: "speed", type: "float", value: "fast" },
            ],
          }
        ),
      ])
    );
    assert.deepEqual(
      scene.entities.map((e) => e.id),
      ["Things/2"],
      "the skipped object is not an entity"
    );
    assert.deepEqual(
      diagnostics.map((d) => [d.code, d.severity]),
      [
        [DiagnosticCode.TiledImport, "warning"],
        [DiagnosticCode.TiledImport, "error"],
        [DiagnosticCode.TiledImport, "error"],
      ]
    );
    assert.match(diagnostics[0]!.message, /m\.tmj: layer 'Things', object 1 \('spawn'\) has no type/);
    assert.match(diagnostics[1]!.message, /property 'target' has the type 'object'/);
    assert.match(diagnostics[2]!.message, /property 'speed' is not a number/);
  });

  it("rejects what is not a Tiled map", () => {
    assert.match(importTiled("m.tmj", "{").diagnostics[0]!.message, /not valid JSON/);
    assert.match(importTiled("m.tmj", "{}").diagnostics[0]!.message, /not a Tiled map/);
    assert.deepEqual(importTiled("m.tmj", "{}").scene.entities, []);
  });

  it("produces a scene that validates against the prefabs", () => {
    const { scene } = importTiled(
      "m.tmj",
      map([
        objects(
          { id: 1, class: "Enemy", x: 4, y: 5, properties: [{ name: "speed", type: "int", value: 2 }] },
          { id: 2, class: "Enemy", x: 4, y: 5 }
        ),
      ])
    );
    const diagnostics = getCompiler().validateScene("m.scene.json", JSON.stringify(scene, null, 2), projectSchemas(project()));
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      [DiagnosticCode.MissingPrefabProp],
      "the second object forgot its required speed"
    );
  });
});
