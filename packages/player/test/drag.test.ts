import assert from "node:assert/strict";
/** Dragging a pressable: `onDragStart`, `onDrag` and `onDragEnd` (see `PressableProps`). */
import { afterEach, describe, it } from "node:test";

import { Entity, Flex, Pointer, Text, getSoundSink, getInputDevice, type GameObject } from "@tsengine/runtime";

import { playGame } from "../src/harness.ts";
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

describe("onPressOutside", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  /** A row of two cards in a box that hears presses outside it, a button apart from them, and a box of its own with a handler. */
  function scene(heard: string[]) {
    const root = new Entity({});
    const row = new Flex({ direction: "row", gap: 10, onPressOutside: () => heard.push("row") });
    row.addChild(new Flex({ width: 40, height: 20, onPress: () => heard.push("card a") }));
    row.addChild(new Flex({ width: 40, height: 20, onPress: () => heard.push("card b") }));
    root.addChild(row);
    const button = new Pointer({
      width: 20,
      height: 20,
      onPress: () => heard.push("button"),
      onPressOutside: () => heard.push("button out"),
    });
    button.transform.x = 200;
    root.addChild(button);
    return { root, row };
  }

  it("is called for a press on nothing or on another pressable, after that one's own press, and not for a press inside", () => {
    const heard: string[] = [];
    const { p, step } = play(() => scene(heard).root);
    const tap = (x: number, y: number): string[] => {
      heard.length = 0;
      step({ mouse: { x, y } });
      step({ mouse: { x, y }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
      step({ mouse: { x, y } });
      return [...heard];
    };
    assert.deepEqual(tap(5, 5), ["card a", "button out"], "on a card: inside the row");
    assert.deepEqual(tap(60, 5), ["card b", "button out"]);
    assert.deepEqual(tap(45, 5), ["row", "button out"], "between the cards: on nothing, so outside both");
    assert.deepEqual(tap(205, 5), ["button", "row"], "on the button: its press first, then the row hears it was elsewhere");
    assert.deepEqual(tap(300, 200), ["row", "button out"], "on nothing at all");
    p.close();
  });

  it("is not called for one that is inert, or gone from the tree", () => {
    const heard: string[] = [];
    const made = scene(heard);
    const { p, step } = play(() => made.root);
    const tap = (): void => {
      step({ mouse: { x: 300, y: 200 } });
      step({ mouse: { x: 300, y: 200 }, pressed: ["MouseLeft"], down: ["MouseLeft"] });
      step({ mouse: { x: 300, y: 200 } });
    };
    made.row.inert = true;
    tap();
    assert.deepEqual(heard, ["button out"]);
    made.row.inert = false;
    made.root.removeChild(made.row);
    tap();
    assert.deepEqual(heard, ["button out", "button out"]);
    p.close();
  });
});

describe("playGame", () => {
  it("plays a game a piece at a time: a script, then steps until something is true", () => {
    let presses = 0;
    let ticks = 0;
    class Counter extends Entity {
      override onUpdate(): void {
        ticks++;
      }
    }
    const game = playGame({
      ...WINDOW,
      root: () => {
        const root = new Counter({});
        root.addChild(new Pointer({ width: 20, height: 20, onPress: () => presses++ }));
        return root;
      },
    });
    game.input("click@5,5, _");
    assert.equal(presses, 1);
    const before = ticks;
    assert.equal(
      game.stepUntil(() => ticks >= before + 10),
      10,
      "as many steps as it took"
    );
    assert.equal(game.steps, 12);
    assert.equal(
      game.stepUntil(() => true),
      0,
      "already true: no step"
    );
    assert.throws(() => game.stepUntil(() => false, { maxSteps: 5 }), /not done after 5 steps/);
    assert.equal(
      game.stepUntil(() => false, { maxSteps: 5, throws: false }),
      5
    );
    game.close();
  });
});

describe("an input script aims at what is on screen by its label", () => {
  /** Two buttons side by side, each a box with its label in it, and what was pressed. */
  function menu(pressed: string[]) {
    const button = (label: string, x: number): Flex => {
      const box = new Flex({ width: 60, height: 20, onPress: () => pressed.push(label) });
      box.transform.x = x;
      box.addChild(new Text({ text: label }));
      return box;
    };
    return () => {
      const root = new Entity({});
      root.addChild(button("Play", 20));
      root.addChild(button("New run", 200));
      return root;
    };
  }

  it("click@Label taps the middle of the thing that holds that text, wherever it is", () => {
    const pressed: string[] = [];
    const game = playGame({ ...WINDOW, root: menu(pressed) });
    game.input("_, click@Play, _*2");
    assert.deepEqual(pressed, ["Play"]);
    game.input("click@New run, _*2");
    assert.deepEqual(pressed, ["Play", "New run"], "a label may have a space in it");
    assert.deepEqual(game.player.pointOf("New run"), { x: 230, y: 10 }, "the middle of its box");
    assert.equal(game.player.pointOf("Quit"), null);
    game.close();
  });

  it("the mouse stays where a label put it, and a label that is not on screen is an error that names it", () => {
    const pressed: string[] = [];
    const game = playGame({ ...WINDOW, root: menu(pressed) });
    game.input("_, mouse@Play, _, MouseLeft, _*2");
    assert.deepEqual(pressed, ["Play"], "moved there by its label, pressed two frames on");
    game.stepUntil(() => true);
    assert.throws(
      () => game.input("click@Quit, _"),
      /aims at 'Quit', and nothing that can be pressed is labelled that now\. What can be pressed is labelled: New run, Play\./
    );
    game.close();
  });
});
