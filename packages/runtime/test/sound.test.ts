import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Sound, getSoundSink, setSoundSink, type SoundSink } from "../src/index.ts";

function recorder(): SoundSink & { log: string[] } {
  const log: string[] = [];
  return { log, load: (path) => log.push(`load ${path}`), play: (path) => log.push(`play ${path}`) };
}

describe("Sound", () => {
  afterEach(() => setSoundSink(null));

  it("only counts plays when no sink is installed", () => {
    const sound = new Sound("hit.wav");
    sound.play();
    sound.play();
    assert.equal(sound.plays, 2);
    assert.equal(getSoundSink(), null);
  });

  it("tells the sink when it is created and each time it plays, after counting the play", () => {
    const sink = recorder();
    setSoundSink(sink);
    const sound = new Sound("hit.wav");
    assert.deepEqual(sink.log, ["load hit.wav"]);
    sound.play();
    sound.play();
    assert.deepEqual(sink.log, ["load hit.wav", "play hit.wav", "play hit.wav"]);
    assert.equal(sound.plays, 2);
  });

  it("plays through a sink installed after the sound was created", () => {
    const sound = new Sound("late.wav");
    const sink = recorder();
    setSoundSink(sink);
    sound.play();
    assert.deepEqual(sink.log, ["play late.wav"], "no load was reported: the sink loads on demand");
  });

  it("stops reporting once the sink is removed", () => {
    const sink = recorder();
    setSoundSink(sink);
    const sound = new Sound("a.wav");
    setSoundSink(null);
    sound.play();
    assert.deepEqual(sink.log, ["load a.wav"]);
    assert.equal(sound.plays, 1);
  });
});
