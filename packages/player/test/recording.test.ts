import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DrawList } from "../src/draw.ts";
import {
  KEY_INDEX,
  KEYS,
  TSE_IN_DT,
  TSE_IN_HEIGHT,
  TSE_IN_LEN,
  TSE_IN_MOUSE_X,
  TSE_IN_MOUSE_Y,
  TSE_IN_QUIT,
  TSE_IN_WHEEL,
  TSE_IN_WIDTH,
  TSE_KEY_DOWN,
  TSE_KEY_PRESSED,
  TSE_KEY_RELEASED,
} from "../src/protocol.ts";
import { TSE_OP_CANVAS, TSE_OP_CANVAS_LEN, TSE_OP_RECT, TSE_OP_SCISSOR, TSE_OP_SCISSOR_END, TSE_OP_VIEW } from "../src/protocol.ts";
import { RecordingBackend } from "../src/recording.ts";

function present(backend: RecordingBackend, list = new DrawList()): { input: Float64Array; keys: Uint8Array } {
  const input = new Float64Array(TSE_IN_LEN);
  const keys = new Uint8Array(KEYS.length);
  backend.frame(0, list.records, list.length, list.texts, input, keys);
  return { input, keys };
}

describe("RecordingBackend", () => {
  it("decodes ABI v2's records: a second view, a scissor, and a canvas first in the frame", () => {
    const backend = new RecordingBackend();
    backend.open({ width: 10, height: 10, title: "t" });
    const view = [TSE_OP_VIEW, 1, 0, 0, 1, 5, 6];
    const records = new Float64Array([
      TSE_OP_CANVAS,
      32,
      18,
      0,
      6,
      128,
      72,
      0x000000ff,
      ...view,
      TSE_OP_SCISSOR,
      1,
      2,
      3,
      4,
      TSE_OP_RECT,
      0,
      0,
      0,
      1,
      1,
      2,
      2,
      0xff0000ff,
      TSE_OP_SCISSOR_END,
      ...view,
    ]);
    backend.frame(0, records, records.length, [], new Float64Array(TSE_IN_LEN), new Uint8Array(KEYS.length));
    assert.deepEqual(
      backend.lastFrame.records.map((record) => record.op),
      ["canvas", "view", "scissor", "rect", "scissorEnd", "view"]
    );
    assert.deepEqual(backend.lastFrame.records[0], {
      op: "canvas",
      width: 32,
      height: 18,
      destX: 0,
      destY: 6,
      destW: 128,
      destH: 72,
      borderColor: "#000000ff",
    });
    assert.deepEqual(backend.lastFrame.records[2], { op: "scissor", x: 1, y: 2, width: 3, height: 4 });
  });

  it("refuses a canvas that is not the first record, as libtse does", () => {
    const backend = new RecordingBackend();
    backend.open({ width: 10, height: 10, title: "t" });
    const records = new Float64Array([TSE_OP_VIEW, 1, 0, 0, 1, 0, 0, TSE_OP_CANVAS, 32, 18, 0, 0, 32, 18, 0]);
    assert.throws(
      () => backend.frame(0, records, records.length, [], new Float64Array(TSE_IN_LEN), new Uint8Array(KEYS.length)),
      /first record/
    );
    assert.equal(TSE_OP_CANVAS_LEN, 8);
  });

  it("records the window it was opened with and when it was closed", () => {
    const backend = new RecordingBackend();
    backend.open({ width: 320, height: 200, title: "t" });
    assert.equal(backend.config?.title, "t");
    assert.equal(backend.opened, true);
    backend.close();
    assert.equal(backend.closed, true);
  });

  it("gives an idle frame when no input is queued: dt 1/60, the window's size, nothing pressed", () => {
    const backend = new RecordingBackend();
    backend.open({ width: 320, height: 200, title: "t" });
    const { input, keys } = present(backend);
    assert.equal(input[TSE_IN_DT], 1 / 60);
    assert.equal(input[TSE_IN_WIDTH], 320);
    assert.equal(input[TSE_IN_HEIGHT], 200);
    assert.equal(input[TSE_IN_QUIT], 0);
    assert.ok(keys.every((flags) => flags === 0));
  });

  it("plays queued input back one frame at a time, then goes idle", () => {
    const backend = new RecordingBackend();
    backend.open({ width: 10, height: 10, title: "t" });
    backend.queueInput({ dt: 0.5, mouse: { x: 3, y: 4 }, wheel: -1, pressed: ["Space"], down: ["A"], released: ["MouseLeft"] });
    backend.queueInput({ quit: true });
    const first = present(backend);
    assert.deepEqual(
      [first.input[TSE_IN_DT], first.input[TSE_IN_MOUSE_X], first.input[TSE_IN_MOUSE_Y], first.input[TSE_IN_WHEEL]],
      [0.5, 3, 4, -1]
    );
    assert.equal(first.keys[KEY_INDEX.get("Space")!], TSE_KEY_DOWN | TSE_KEY_PRESSED, "a pressed key is also down");
    assert.equal(first.keys[KEY_INDEX.get("A")!], TSE_KEY_DOWN);
    assert.equal(first.keys[KEY_INDEX.get("MouseLeft")!], TSE_KEY_RELEASED);
    assert.equal(present(backend).input[TSE_IN_QUIT], 1);
    const third = present(backend);
    assert.equal(third.input[TSE_IN_QUIT], 0);
    assert.ok(
      third.keys.every((flags) => flags === 0),
      "keys do not carry over"
    );
  });

  it("rejects a key name it does not know, listing the valid ones", () => {
    const backend = new RecordingBackend();
    backend.queueInput({ pressed: ["Spcae"] });
    assert.throws(() => present(backend), /Unknown key 'Spcae'.*Space/);
  });

  it("rejects buffers that are too small", () => {
    const backend = new RecordingBackend();
    assert.throws(() => backend.frame(0, new Float64Array(0), 0, [], new Float64Array(2), new Uint8Array(KEYS.length)), /input buffer/);
    assert.throws(() => backend.frame(0, new Float64Array(0), 0, [], new Float64Array(TSE_IN_LEN), new Uint8Array(2)), /keys buffer/);
  });

  it("hands out one handle per path and records plays by path", () => {
    const backend = new RecordingBackend({ missingTextures: ["gone.png"] });
    const a = backend.loadSound("a.wav");
    const b = backend.loadSound("b.wav");
    assert.equal(backend.loadSound("a.wav"), a);
    assert.notEqual(a, b);
    backend.playSound(b);
    backend.playSound(a);
    assert.deepEqual(backend.plays, ["b.wav", "a.wav"]);
    assert.equal(backend.loadTexture("gone.png"), -1);
    assert.throws(() => backend.playSound(99), /no sound/);
  });

  it("refuses to decode a malformed buffer rather than guess", () => {
    const backend = new RecordingBackend();
    const input = new Float64Array(TSE_IN_LEN);
    const keys = new Uint8Array(KEYS.length);
    assert.throws(() => backend.frame(0, new Float64Array([99]), 1, [], input, keys), /Unknown draw op 99/);
    assert.throws(() => backend.frame(0, new Float64Array([3, 0, 0]), 3, [], input, keys), /past the end/);
    assert.throws(() => backend.frame(0, new Float64Array([2, 0, 0, 0, 1, 1, 7]), 7, [], input, keys), /never loaded/);
  });
});
