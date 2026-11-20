import assert from "node:assert/strict";
/** Dragging a pressable: `onDragStart`, `onDrag` and `onDragEnd` (see `PressableProps`). */
import { afterEach, describe, it } from "node:test";

import { Entity, Flex, Pointer, getSoundSink, getInputDevice, type GameObject } from "@tsengine/runtime";

import { createPlayer } from "../src/loop.ts";
import { RecordingBackend, type InputFrame } from "../src/recording.ts";

const WINDOW = { width: 400, height: 300, title: "t" };

function play(root: () => GameObject) {
  const backend = new RecordingBackend();
  const p = createPlayer(backend, { ...WINDOW, root, warn: () => {} });
  const step = (input: InputFrame): void => {
    backend.queueInput(input);
    p.step();
  };
  return { p, step };
}

/** A box that writes down what it hears of a drag. */
function recorder(heard: string[], more: { onPress?: () => void } = {}): Flex {
  return new Flex({
    width: 100,
    height: 20,
    ...more,
    onDragStart: (x, y) => heard.push(`start ${x},${y}`),
    onDrag: (x, y) => heard.push(`move ${x},${y}`),
    onDragEnd: (x, y) => heard.push(`end ${x},${y}`),
  });
}

describe("dragging a pressable", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  it("hears where the press landed, each move while it is held (off the box too), and where it was let go", () => {
    const heard: string[] = [];
    const { p, step } = play(() => recorder(heard));
    step({ mouse: { x: 10, y: 5 } });
    step({ mouse: { x: 10, y: 5 }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
    step({ mouse: { x: 10, y: 5 }, down: ["MouseLeft"] }); // held still: nothing to say
    step({ mouse: { x: 40, y: 5 }, down: ["MouseLeft"] });
    step({ mouse: { x: 40, y: 5 }, down: ["MouseLeft"] });
    step({ mouse: { x: 300, y: 200 }, down: ["MouseLeft"] }); // far off the box
    step({ mouse: { x: 310, y: 200 } }); // let go
    step({ mouse: { x: 50, y: 5 } }); // and moved with nothing held
    assert.deepEqual(heard, ["start 10,5", "move 40,5", "move 300,200", "end 310,200"]);
    p.close();
  });

  it("a press let go where it began is a tap: a start and an end, and `onPress` before them", () => {
    const heard: string[] = [];
    const { p, step } = play(() => recorder(heard, { onPress: () => heard.push("press") }));
    step({ mouse: { x: 10, y: 5 } });
    step({ mouse: { x: 10, y: 5 }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
    step({ mouse: { x: 10, y: 5 } });
    step({ mouse: { x: 10, y: 5 } });
    assert.deepEqual(heard, ["press", "start 10,5", "end 10,5"]);
    p.close();
  });

  it("a box with only drag handlers takes the press, so what is under it does not", () => {
    const heard: string[] = [];
    let under = 0;
    const { p, step } = play(() => {
      const root = new Entity({});
      root.addChild(new Pointer({ width: 100, height: 20, onPress: () => under++ }));
      root.addChild(new Flex({ width: 100, height: 20, onDragStart: (x) => heard.push(`start ${x}`) }));
      return root;
    });
    step({ mouse: { x: 10, y: 5 } });
    step({ mouse: { x: 10, y: 5 }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
    step({ mouse: { x: 10, y: 5 } });
    assert.deepEqual(heard, ["start 10"]);
    assert.equal(under, 0);
    p.close();
  });

  it("a press that misses it starts no drag, and a `<Pointer>` drags as a box does", () => {
    const heard: string[] = [];
    const { p, step } = play(
      () =>
        new Pointer({
          width: 20,
          height: 20,
          onDrag: (x, y) => heard.push(`move ${x},${y}`),
          onDragEnd: (x, y) => heard.push(`end ${x},${y}`),
        })
    );
    step({ mouse: { x: 200, y: 200 } });
    step({ mouse: { x: 200, y: 200 }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
    step({ mouse: { x: 5, y: 5 }, down: ["MouseLeft"] }); // dragged onto it: not its press
    step({ mouse: { x: 5, y: 5 } });
    assert.deepEqual(heard, []);
    step({ mouse: { x: 5, y: 5 }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
    step({ mouse: { x: 9, y: 30 }, down: ["MouseLeft"] });
    step({ mouse: { x: 9, y: 30 } });
    step({ mouse: { x: 9, y: 30 } });
    assert.deepEqual(heard, ["move 9,30", "end 9,30"]);
    p.close();
  });

  it("one taken out of the tree while it is held hears no more of the drag", () => {
    const heard: string[] = [];
    const box = recorder(heard);
    const root = new Entity({});
    root.addChild(box);
    const { p, step } = play(() => root);
    step({ mouse: { x: 10, y: 5 } });
    step({ mouse: { x: 10, y: 5 }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
    step({ mouse: { x: 10, y: 5 }, down: ["MouseLeft"] });
    root.removeChild(box);
    step({ mouse: { x: 40, y: 5 }, down: ["MouseLeft"] });
    step({ mouse: { x: 40, y: 5 } });
    step({ mouse: { x: 40, y: 5 } });
    assert.deepEqual(heard, ["start 10,5"]);
    p.close();
  });
});

describe("the device in use", () => {
  it("is the pointer until something is pressed, then whatever the last press came from", () => {
    const { p, step } = play(() => new Entity({}));
    assert.equal(getInputDevice(), "pointer");
    step({ pressed: ["Enter"] });
    step({});
    assert.equal(getInputDevice(), "keyboard");
    step({});
    assert.equal(getInputDevice(), "keyboard", "it stays with nothing pressed");
    step({ pressed: ["PadA"] });
    step({});
    assert.equal(getInputDevice(), "gamepad");
    step({ mouse: { x: 5, y: 5 }, pressed: ["MouseLeft"] });
    step({});
    assert.equal(getInputDevice(), "pointer");
    step({ pressed: ["Z"] });
    step({});
    p.close();
    const again = play(() => new Entity({}));
    assert.equal(getInputDevice(), "pointer", "a new game starts with nothing pressed");
    again.p.close();
  });
});
