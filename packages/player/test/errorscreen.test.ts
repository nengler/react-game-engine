import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, getSoundSink } from "@rge/runtime";
import { describeError, wrapLines } from "../src/errorscreen.ts";
import { createPlayer, run } from "../src/loop.ts";
import { RGE_IN_QUIT } from "../src/protocol.ts";
import { RecordingBackend } from "../src/recording.ts";

class Boom extends Entity {
  override onUpdate(): void {
    throw new Error("kaboom in onUpdate");
  }
}

const texts = (backend: RecordingBackend): string[] => backend.lastFrame.records.flatMap((r) => (r.op === "text" ? [r.text] : []));

describe("the error screen", () => {
  afterEach(() => assert.equal(getSoundSink(), null));

  it("wraps at the column and keeps line breaks", () => {
    assert.deepEqual(wrapLines("abcdef\n\nxy", 4), ["abcd", "ef", "", "xy"]);
  });

  it("describes errors and non-errors", () => {
    assert.match(describeError(new Error("x")), /^Error: x/);
    assert.equal(describeError("oops"), "Uncaught oops");
  });

  it("showError draws the message, and reports the window closing", () => {
    const backend = new RecordingBackend();
    const player = createPlayer(backend, { root: () => new Boom(), hidden: true });
    assert.throws(() => player.step(), /kaboom/);
    assert.equal(player.showError(new Error("kaboom in onUpdate")), true);
    assert.ok(texts(backend).some((t) => t.includes("kaboom in onUpdate")), texts(backend).join("|"));
    assert.ok(texts(backend).some((t) => t.startsWith("The game stopped")));
    player.close();
  });

  it("run keeps a visible window open on the error, then throws it", () => {
    const backend = new RecordingBackend();
    let errorFrames = 0;
    const frame = backend.frame.bind(backend);
    backend.frame = (clear, records, length, texts, input, keys) => {
      frame(clear, records, length, texts, input, keys);
      if (texts.some((t) => t.startsWith("The game stopped")) && ++errorFrames === 3) input[RGE_IN_QUIT] = 1;
    };
    assert.throws(() => run(backend, { root: () => new Boom(), onError: "window" }), /kaboom/);
    assert.equal(errorFrames, 3, "the window stayed up until it asked to close");
  });

  it("run throws at once for a hidden window", () => {
    const backend = new RecordingBackend();
    assert.throws(() => run(backend, { root: () => new Boom(), hidden: true }), /kaboom/);
    assert.equal(backend.frames.length, 0);
  });
});
