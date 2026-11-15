import assert from "node:assert/strict";
/** Sequences for cutscenes: steps run in order on the time they are given, deterministically, with a position a save can keep. */
import { describe, it } from "node:test";

import { call, easeOut, parallel, sequence, tween, wait, waitFor } from "../src/sequence.ts";

describe("sequence", () => {
  it("runs its steps in order on the game's time, and says when it is done", () => {
    const log: string[] = [];
    const s = sequence([call(() => log.push("a")), wait(0.5), call(() => log.push("b")), wait(0.25), call(() => log.push("c"))]);
    assert.equal(s.step(0.1), true);
    assert.deepEqual(log, ["a"]);
    for (let i = 0; i < 4; i++) s.step(0.1); // 0.5 s in
    assert.deepEqual(log, ["a", "b"]);
    assert.equal(s.step(0.25), false, "done at 0.75 s");
    assert.deepEqual(log, ["a", "b", "c"]);
    assert.equal(s.done, true);
    assert.equal(s.step(1), false);
    assert.deepEqual(log, ["a", "b", "c"], "nothing runs again");
  });

  it("hands the time left over at the end of a step to the next, so the whole takes what its steps add up to", () => {
    const log: number[] = [];
    let now = 0;
    const s = sequence([wait(0.25), call(() => log.push(now)), wait(0.25), call(() => log.push(now))]);
    for (const dt of [0.2, 0.2, 0.2]) {
      now += dt;
      s.step(dt);
    }
    // Both waits end inside a step: the first at 0.25 (in the second step), the second at 0.5 (in the third).
    assert.deepEqual(log, [0.4, 0.6000000000000001]);
    assert.equal(s.done, true, "0.5 s of waits fit in 0.6 s of steps");
  });

  it("tweens from 0 to exactly 1, shaped by an ease", () => {
    const seen: number[] = [];
    const s = sequence([tween(1, (t) => seen.push(Math.round(t * 100) / 100), easeOut)]);
    for (let i = 0; i < 4; i++) s.step(0.25);
    assert.deepEqual(seen, [0.44, 0.75, 0.94, 1]);
    assert.equal(s.done, true);
  });

  it("waits for a condition, and runs parallel steps until the last is done", () => {
    let open = true;
    const log: string[] = [];
    const s = sequence([
      waitFor(() => !open),
      parallel([sequence([wait(0.2), call(() => log.push("short"))]), sequence([wait(0.5), call(() => log.push("long"))])]),
      call(() => log.push("after")),
    ]);
    s.step(1);
    s.step(1);
    assert.deepEqual(log, [], "the dialogue is open: it waits");
    open = false;
    s.step(0.3);
    assert.deepEqual(log, ["short"]);
    s.step(0.3);
    assert.deepEqual(log, ["short", "long", "after"]);
    assert.equal(s.done, true);
  });

  it("keeps where it is as plain data, and carries on from it, a call already made not made again", () => {
    const make = (log: string[]) => sequence([call(() => log.push("start")), wait(1), call(() => log.push("end"))]);
    const first: string[] = [];
    const a = make(first);
    a.step(0.4);
    const saved = JSON.parse(JSON.stringify(a.position));
    assert.deepEqual(saved, { index: 1, step: 0.4 });
    const second: string[] = [];
    const b = make(second);
    b.restore(saved);
    b.step(0.5);
    assert.deepEqual(second, [], "0.9 s of the wait");
    b.step(0.2);
    assert.deepEqual(second, ["end"], "not 'start' again");
  });

  it("starts over with reset", () => {
    const log: string[] = [];
    const s = sequence([call(() => log.push("x")), wait(0.1)]);
    s.step(1);
    s.reset();
    s.step(1);
    assert.deepEqual(log, ["x", "x"]);
  });
});
