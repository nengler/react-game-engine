import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createControls, createInputState } from "../src/index.ts";

describe("Controls rebinding", () => {
  it("bind changes what an action means at once, for the next question", () => {
    const controls = createControls({ jump: ["Z"], dash: ["X"] });
    const before = createInputState({ pressed: ["Space"] }, controls);
    assert.equal(before.pressed("jump"), false);
    assert.equal(controls.bind("jump", ["Space", "PadA"]), true);
    const after = createInputState({ pressed: ["Space"] }, controls);
    assert.equal(after.pressed("jump"), true, "the same Controls, asked again");
    assert.equal(controls.label("jump"), "Space");
  });

  it("bind refuses an unknown action, no keys and a key that is not a KeyName, and changes nothing", () => {
    const controls = createControls({ jump: ["Z"] });
    assert.equal(controls.bind("fly" as "jump", ["Z"]), false);
    assert.equal(controls.bind("jump", []), false);
    assert.equal(controls.bind("jump", ["Z", "Banana"]), false);
    assert.deepEqual(controls.keysOf("jump"), ["Z"]);
  });

  it("reset, toJSON and load: plain data in and out, and an old file cannot break the controls", () => {
    const controls = createControls({ jump: ["Z"], dash: ["X"] });
    controls.bind("jump", ["Space"]);
    assert.deepEqual(controls.toJSON(), { jump: ["Space"], dash: ["X"] });
    controls.reset();
    assert.deepEqual(controls.toJSON(), { jump: ["Z"], dash: ["X"] });
    const count = controls.load({ jump: ["Enter"], dash: ["Nope"], removed: ["Q"], empty: [], odd: 5 });
    assert.equal(count, 1, "only jump was a real action with real keys");
    assert.deepEqual(controls.toJSON(), { jump: ["Enter"], dash: ["X"] });
    assert.equal(controls.load("junk"), 0);
    assert.equal(controls.load(null), 0);
  });

  it("tells a subscriber each change of keys, and nothing for a reset that changes nothing", () => {
    const controls = createControls({ jump: ["Z"], dash: ["X"] });
    const seen: string[] = [];
    const stop = controls.subscribe((bindings) => seen.push(bindings.jump.join("+")));
    controls.reset();
    controls.bind("jump", ["Space"]);
    controls.bind("jump", ["Nope"]);
    controls.load({ jump: ["Enter", "PadA"] });
    controls.reset();
    stop();
    controls.bind("jump", ["Q"]);
    assert.deepEqual(seen, ["Space", "Enter+PadA", "Z"]);
  });

  it("lastPressed names the first key pressed, for 'press a key for Jump'", () => {
    assert.equal(createInputState({}).lastPressed?.(), undefined);
    assert.equal(createInputState({ pressed: ["Q", "W"] }).lastPressed?.(), "Q");
    assert.equal(createInputState({ pressed: ["NotAKey"] }).lastPressed?.(), undefined);
  });
});
