import assert from "node:assert/strict";
/** The development layout overlay (DESIGN.md, "Seeing inside a running game"): F1 under `rge dev` outlines boxes, colliders and pointers. */
import { describe, it } from "node:test";

import { Collider, Entity, Flex, Game, Pointer } from "@rge/runtime";

import { createPlayer } from "../src/loop.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

/** A small game: a padded box, a collider and a pointer, in a 200 × 100 window. */
function game(): Game {
  const root = new Game({ width: 200, height: 100 });
  const panel = new Flex({ width: 80, height: 40, padding: 5, background: "#222222" });
  root.addChild(panel);
  const thing = new Entity({});
  thing.transform.x = 120;
  thing.addChild(new Collider({ width: 10, height: 10, layer: "enemy" }));
  root.addChild(thing);
  const button = new Pointer({ width: 20, height: 20 });
  button.transform.x = 150;
  button.transform.y = 50;
  root.addChild(button);
  return root;
}

function run(devtools: boolean, frames: { pressed?: string[]; mouse?: { x: number; y: number } }[]): DecodedRecord[] {
  const backend = new RecordingBackend();
  for (const frame of frames) backend.queueInput({ dt: 1 / 60, ...frame });
  const player = createPlayer(backend, { root: game, devtools });
  for (let i = 0; i <= frames.length; i++) player.step();
  const records = [...backend.lastFrame.records];
  player.close();
  return records;
}

const outlines = (records: readonly DecodedRecord[]): string[] =>
  records.flatMap((r) =>
    r.op === "box" && r.fill === "#00000000"
      ? [`${r.borderColor} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`]
      : []
  );

describe("the layout overlay", () => {
  it("outlines every box and its padding, every collider and every pointer, once F1 is pressed under rge dev", () => {
    assert.deepEqual(outlines(run(true, [{}])), [], "off until pressed");
    const on = outlines(run(true, [{ pressed: ["F1"] }, {}]));
    assert.ok(on.includes("#4fc3f7ff 0,0 80x40"), on.join("\n"));
    assert.ok(on.includes("#4fc3f766 5,5 70x30"), "the padding inside it");
    assert.ok(
      on.some((o) => o.endsWith(" 120,0 10x10")),
      "the collider"
    );
    assert.ok(on.includes("#ffd54fff 150,50 20x20"), "the pointer");
  });

  it("labels the box under the mouse with its size and what sized it", () => {
    const records = run(true, [{ pressed: ["F1"] }, { mouse: { x: 10, y: 10 } }, {}]);
    const label = records.find((r) => r.op === "text" && /80×40/.test(r.text));
    assert.ok(label, JSON.stringify(records.filter((r) => r.op === "text")));
    assert.match(label.op === "text" ? label.text : "", /width 80, height 40/);
  });

  it("is not there without devtools (a packaged game), and goes off when pressed again", () => {
    assert.deepEqual(outlines(run(false, [{ pressed: ["F1"] }, {}])), []);
    assert.deepEqual(outlines(run(true, [{ pressed: ["F1"] }, {}, { pressed: ["F1"] }, {}])), []);
  });
});
