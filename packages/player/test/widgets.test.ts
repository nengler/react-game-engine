import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Entity, Flex, Hud, Slider, Toggle, getSoundSink, type GameObject, type SliderProps, type ToggleProps } from "@tsengine/runtime";

import { createPlayer } from "../src/loop.ts";
import { RecordingBackend, type DecodedRecord, type InputFrame } from "../src/recording.ts";

type Box = Extract<DecodedRecord, { op: "box" }>;

const WINDOW = { width: 400, height: 300, title: "t" };

function play(root: () => GameObject) {
  const backend = new RecordingBackend();
  const p = createPlayer(backend, { ...WINDOW, root, warn: () => {} });
  /** What a step is given, the player acts on at the start of the next: so an input is followed by one that adds nothing. */
  const act = (input: InputFrame): void => {
    backend.queueInput(input);
    p.step();
    backend.queueInput({ mouse: input.mouse });
    p.step();
  };
  const step = (input: InputFrame): void => {
    backend.queueInput(input);
    p.step();
  };
  const boxes = (): Box[] => backend.lastFrame.records.filter((r): r is Box => r.op === "box");
  return { p, act, step, backend, boxes };
}

const slider = (props: SliderProps = {}): Slider => new Slider({ width: 100, height: 14, ...props });
const toggle = (props: ToggleProps = {}): Toggle => new Toggle(props);
const near = (actual: number, expected: number, message?: string): void =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} ${actual} is not ${expected}`);

describe("<Slider> drawing", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  it("draws the track as the box's background, the fill up to the thumb's middle, and the thumb", () => {
    const { p, step, backend, boxes } = play(() => slider({ value: 0.5 }));
    step({});
    const rects = backend.lastFrame.records.filter((r) => r.op === "rect");
    assert.deepEqual(
      rects.map((r) => r.op === "rect" && [r.width, r.height, r.color]),
      [[100, 14, "#3a3f4bff"]]
    );
    // 8 wide thumb on a 100 wide track: 92 of travel, half of it is 46; the fill runs to the thumb's middle, 46 + 4
    assert.deepEqual(
      boxes().map((b) => [b.x, b.y, b.width, b.height, b.fill, b.borderWidth, b.radius]),
      [
        [0, 0, 50, 14, "#5b9bd5ff", 0, 0],
        [46, 0, 8, 14, "#ffffffff", 0, 0],
      ]
    );
    p.close();
  });

  it("puts the thumb at either end for the smallest and the largest value, and at the start for a value that is not a number", () => {
    const at = (props: SliderProps): number => {
      const { p, step, boxes } = play(() => slider(props));
      step({});
      const thumb = boxes().at(-1) as Box;
      p.close();
      return thumb.x;
    };
    assert.equal(at({ value: 0 }), 0);
    assert.equal(at({ value: 1 }), 92);
    assert.equal(at({ value: 5, min: 0, max: 10 }), 46);
    assert.equal(at({ value: 99 }), 92, "past the end is the end");
    assert.equal(at({ value: -3 }), 0);
    assert.equal(at({ value: Number.NaN }), 0);
    assert.equal(at({ value: 3, min: 2, max: 2 }), 0, "a range with no width");
  });

  it("is inside the border, and rounded as the track is, less the border", () => {
    const { p, step, boxes } = play(() => slider({ value: 1, borderWidth: 2, borderColor: "white", borderRadius: 6 }));
    step({});
    const [fill, thumb] = boxes().filter((b) => b.fill !== "#00000000" && b.borderWidth === 0);
    // inside the 2 pixel border: 96 × 10, the thumb's travel 88, so the thumb is at 2 + 88 and the fill runs to its middle
    assert.deepEqual([fill?.x, fill?.y, fill?.width, fill?.height, fill?.radius], [2, 2, 92, 10, 4]);
    assert.deepEqual([thumb?.x, thumb?.y, thumb?.width, thumb?.height, thumb?.radius], [90, 2, 8, 10, 4]);
    p.close();
  });

  it("takes its own colours and thumb width, and no fill when it is transparent", () => {
    const { p, step, boxes } = play(() => slider({ value: 0.5, fillColor: "red", thumbColor: "yellow", thumbWidth: 20 }));
    step({});
    // a 20 wide thumb leaves 80 of travel: the thumb is at 40, and the fill runs to its middle, 50
    assert.deepEqual(
      boxes().map((b) => [b.width, b.fill]),
      [
        [50, "#ff0000ff"],
        [20, "#ffff00ff"],
      ]
    );
    p.close();
    const transparent = play(() => slider({ value: 0.5, fillColor: "" }));
    transparent.step({});
    assert.deepEqual(
      transparent.boxes().map((b) => b.fill),
      ["#ffffffff"],
      "only the thumb"
    );
    transparent.p.close();
  });

  it("moves its thumb when its value is set, and fades with the box it is in", () => {
    const s = slider({ value: 0 });
    const faded = new Flex({ opacity: 0.5 });
    faded.addChild(s);
    const { p, step, boxes } = play(() => faded);
    step({});
    assert.equal(boxes().at(-1)!.x, 0);
    assert.equal(boxes().at(-1)!.fill, "#ffffff80", "half its alpha");
    s.value = 1;
    step({});
    assert.equal(boxes().at(-1)!.x, 92);
    p.close();
  });
});

describe("<Slider> and the mouse", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  it("puts the thumb under the mouse for a press, keeps it on the track, and says so once for each different value", () => {
    const changes: number[] = [];
    const s = slider({ onChange: (v) => changes.push(v) });
    const { p, act } = play(() => s);
    act({ mouse: { x: 50, y: 5 } });
    act({ mouse: { x: 50, y: 5 }, pressed: ["MouseLeft"] });
    assert.equal(s.value, 0.5);
    act({ mouse: { x: 50, y: 5 } });
    act({ mouse: { x: 50, y: 5 }, pressed: ["MouseLeft"] });
    assert.deepEqual(changes, [0.5], "the same value is not a change");
    act({ mouse: { x: 1, y: 5 }, pressed: ["MouseLeft"] });
    act({ mouse: { x: 99, y: 5 }, pressed: ["MouseLeft"] });
    assert.deepEqual(changes, [0.5, 0, 1], "the ends of the track");
    p.close();
  });

  it("follows the mouse while the button is held, out of the box and back, and stops when it is let go", () => {
    const changes: number[] = [];
    const s = slider({ min: 0, max: 100, onChange: (v) => changes.push(Math.round(v)) });
    const { p, step } = play(() => s);
    step({ mouse: { x: 4, y: 5 } });
    step({ mouse: { x: 4, y: 5 }, pressed: ["MouseLeft"] });
    step({ mouse: { x: 50, y: 5 }, down: ["MouseLeft"] });
    step({ mouse: { x: 96, y: 200 }, down: ["MouseLeft"] }); // far below the box
    step({ mouse: { x: 300, y: 5 }, down: ["MouseLeft"] }); // far to the right: the end
    step({ mouse: { x: -80, y: 5 }, down: ["MouseLeft"] }); // far to the left: the start
    step({ mouse: { x: 50, y: 5 }, down: ["MouseLeft"] });
    step({ mouse: { x: 50, y: 5 } }); // let go
    step({ mouse: { x: 80, y: 5 } });
    step({ mouse: { x: 20, y: 5 } });
    step({ mouse: { x: 20, y: 5 } });
    assert.deepEqual(
      changes,
      [50, 100, 0, 50],
      "a press at the start is not a change; then the middle, the end, the start (the mouse far off to the left) and the middle again"
    );
    assert.equal(Math.round(s.value), 50, "and it stayed where the button was let go");
    p.close();
  });

  it("snaps to a step from the minimum, with no rounding errors, and holds the value between the ends", () => {
    const stepped = slider({ min: 0, max: 10, step: 2 });
    const { p, act } = play(() => stepped);
    act({ mouse: { x: 52.76, y: 5 }, pressed: ["MouseLeft"] }); // 5.3 of 10
    assert.equal(stepped.value, 6);
    act({ mouse: { x: 49.08, y: 5 }, pressed: ["MouseLeft"] }); // 4.9
    assert.equal(stepped.value, 4);
    p.close();
    const tenths = slider({ min: 0, max: 1, step: 0.1 });
    const second = play(() => tenths);
    second.act({ mouse: { x: 31.6, y: 5 }, pressed: ["MouseLeft"] }); // 0.3
    assert.equal(tenths.value, 0.3, "not 0.30000000000000004");
    second.p.close();
    const odd = slider({ min: 0, max: 10, step: 3 });
    const third = play(() => odd);
    third.act({ mouse: { x: 99, y: 5 }, pressed: ["MouseLeft"] });
    assert.equal(odd.value, 9, "the last step at or before the end, as an HTML range has it");
    third.p.close();
  });

  it("follows a box that is moved, scaled and turned", () => {
    const place = (setup: (s: Slider) => void, mouse: { x: number; y: number }): number => {
      const s = slider();
      setup(s);
      const { p, act } = play(() => s);
      act({ mouse });
      act({ mouse, pressed: ["MouseLeft"] });
      p.close();
      return s.value;
    };
    near(
      place(
        (s) => {
          s.transform.x = 100;
          s.transform.y = 40;
        },
        { x: 150, y: 45 }
      ),
      0.5,
      "moved"
    );
    near(
      place(
        (s) => {
          s.transform.scaleX = 2;
        },
        { x: 100, y: 5 }
      ),
      0.5,
      "doubled in width"
    );
    near(
      place(
        (s) => {
          s.transform.x = 50;
          s.transform.rotation = Math.PI / 2;
        },
        { x: 50, y: 50 }
      ),
      0.5,
      "turned a quarter, so the track runs down"
    );
  });

  it("is pressed in a Hud, where the mouse is in the HUD's own coordinates", () => {
    const s = slider();
    s.transform.x = 30;
    const hud = new Hud();
    hud.addChild(s);
    const { p, act } = play(() => hud);
    act({ mouse: { x: 80, y: 5 } });
    act({ mouse: { x: 80, y: 5 }, pressed: ["MouseLeft"] });
    near(s.value, 0.5);
    p.close();
  });

  it("is not moved where something clips it, and is where it shows", () => {
    const s = slider();
    const clip = new Flex({ width: 40, height: 14, overflow: "hidden" });
    clip.addChild(s);
    const { p, act } = play(() => clip);
    act({ mouse: { x: 70, y: 5 }, pressed: ["MouseLeft"] });
    assert.equal(s.value, 0, "past the clip");
    act({ mouse: { x: 30, y: 5 }, pressed: ["MouseLeft"] });
    near(s.value, 26 / 92);
    p.close();
  });

  it("takes the press, so a button under it does not get it", () => {
    const log: string[] = [];
    const root = new Entity();
    root.addChild(new Flex({ width: 100, height: 14, onPress: () => log.push("under") }));
    root.addChild(slider());
    const { p, act } = play(() => root);
    act({ mouse: { x: 50, y: 5 } });
    act({ mouse: { x: 50, y: 5 }, pressed: ["MouseLeft"] });
    assert.deepEqual(log, []);
    p.close();
  });

  it("does nothing when it is disabled, and still takes the press", () => {
    const changes: number[] = [];
    const s = slider({ disabled: true, onChange: (v) => changes.push(v) });
    const { p, act, step } = play(() => s);
    act({ mouse: { x: 50, y: 5 }, pressed: ["MouseLeft"] });
    step({ mouse: { x: 80, y: 5 }, down: ["MouseLeft"] });
    step({ mouse: { x: 80, y: 5 } });
    assert.deepEqual(changes, []);
    assert.equal(s.value, 0);
    p.close();
  });
});

describe("<Slider> and the keys", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  it("moves a twentieth of the range with the left and right keys when it has the focus, and a step when it has one", () => {
    const changes: number[] = [];
    const free = slider({ value: 0.5, onChange: (v) => changes.push(v) });
    const { p, act } = play(() => free);
    act({ mouse: { x: 300, y: 250 } });
    p.world.focus(free);
    act({ pressed: ["ArrowRight"] });
    act({ pressed: ["ArrowRight"] });
    act({ pressed: ["ArrowLeft"] });
    assert.deepEqual(changes, [0.55, 0.6, 0.55]);
    p.close();
    const stepped = slider({ min: 0, max: 10, step: 2, value: 4 });
    const second = play(() => stepped);
    second.p.world.focus(stepped);
    second.act({ pressed: ["ArrowRight"] });
    assert.equal(stepped.value, 6);
    second.p.close();
  });

  it("stops at the ends without saying so, and keeps the focus there rather than handing it to the next one along", () => {
    const changes: number[] = [];
    const root = new Entity();
    const s = slider({ value: 1, onChange: (v) => changes.push(v) });
    const next = new Flex({ width: 20, height: 14, focusable: true });
    next.transform.x = 120;
    root.addChild(s);
    root.addChild(next);
    const { p, act } = play(() => root);
    p.world.focus(s);
    act({ pressed: ["ArrowRight"] });
    assert.deepEqual(changes, []);
    assert.equal(p.world.focused, s, "right is the slider's, even at its end");
    p.close();
  });

  it("gives up and down to the focus, which moves to the next thing in that direction", () => {
    const root = new Entity();
    const top = slider();
    const bottom = slider();
    bottom.transform.y = 40;
    root.addChild(top);
    root.addChild(bottom);
    const { p, act } = play(() => root);
    p.world.focus(top);
    act({ pressed: ["ArrowDown"] });
    assert.equal(p.world.focused, bottom);
    act({ pressed: ["ArrowUp"] });
    assert.equal(p.world.focused, top);
    assert.equal(top.value, 0, "and neither moved a thumb");
    p.close();
  });

  it("takes the focus when it is clicked, so the keys then move it", () => {
    const s = slider({ value: 0.5 });
    const { p, act } = play(() => s);
    act({ mouse: { x: 50, y: 5 }, pressed: ["MouseLeft"] });
    assert.equal(p.world.focused, s);
    act({ pressed: ["ArrowRight"] });
    near(s.value, 0.55);
    p.close();
  });

  it("is not moved by the keys when it is disabled, and does not take the focus", () => {
    const s = slider({ value: 0.5, disabled: true });
    const { p, act } = play(() => s);
    p.world.focus(s);
    assert.equal(p.world.focused, null);
    act({ pressed: ["ArrowRight"] });
    assert.equal(s.value, 0.5);
    p.close();
  });
});

describe("<Toggle>", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  it("draws a pill track in its colour for the state, and a knob at the left end when off and the right when on", () => {
    const off = play(() => toggle());
    off.step({});
    // 36 × 18: the track is the whole box, round; the knob is 14, 2 in from each side, a circle
    assert.deepEqual(
      off.boxes().map((b) => [b.x, b.y, b.width, b.height, b.fill, b.radius]),
      [
        [0, 0, 36, 18, "#555a66ff", 9],
        [2, 2, 14, 14, "#ffffffff", 7],
      ]
    );
    off.p.close();
    const on = play(() => toggle({ checked: true }));
    on.step({});
    assert.deepEqual(
      on.boxes().map((b) => [b.x, b.width, b.fill]),
      [
        [0, 36, "#4caf50ff"],
        [20, 14, "#ffffffff"],
      ]
    );
    on.p.close();
  });

  it("takes its own colours and size, and follows its checked as it is set", () => {
    const t = toggle({ width: 50, height: 20, onColor: "blue", offColor: "gray", thumbColor: "yellow" });
    const { p, step, boxes } = play(() => t);
    step({});
    assert.deepEqual(
      boxes().map((b) => [b.width, b.fill]),
      [
        [50, "#808080ff"],
        [16, "#ffff00ff"],
      ]
    );
    t.checked = true;
    step({});
    assert.deepEqual(
      boxes().map((b) => [b.width, b.fill]),
      [
        [50, "#0000ffff"],
        [16, "#ffff00ff"],
      ]
    );
    p.close();
  });

  it("flips for a press and says the new state, and again for the next press", () => {
    const changes: boolean[] = [];
    const t = toggle({ onChange: (on) => changes.push(on) });
    const { p, act } = play(() => t);
    act({ mouse: { x: 10, y: 5 } });
    act({ mouse: { x: 10, y: 5 }, pressed: ["MouseLeft"] });
    assert.equal(t.checked, true);
    act({ mouse: { x: 10, y: 5 }, pressed: ["MouseLeft"] });
    assert.equal(t.checked, false);
    assert.deepEqual(changes, [true, false]);
    p.close();
  });

  it("flips for the confirm key when it has the focus, and for its pressKey", () => {
    const t = toggle({ pressKey: "M" });
    const { p, act } = play(() => t);
    p.world.focus(t);
    act({ pressed: ["Enter"] });
    assert.equal(t.checked, true);
    act({ pressed: ["M"] });
    assert.equal(t.checked, false);
    p.close();
  });

  it("does nothing when it is disabled, and takes the press", () => {
    const changes: boolean[] = [];
    const t = toggle({ disabled: true, onChange: (on) => changes.push(on) });
    const { p, act } = play(() => t);
    act({ mouse: { x: 10, y: 5 }, pressed: ["MouseLeft"] });
    assert.deepEqual(changes, []);
    assert.equal(t.checked, false);
    p.close();
  });

  it("takes the arrow keys as focus movement, since it has no use for them", () => {
    const root = new Entity();
    const a = toggle();
    const b = toggle();
    b.transform.x = 60;
    root.addChild(a);
    root.addChild(b);
    const { p, act } = play(() => root);
    p.world.focus(a);
    act({ pressed: ["ArrowRight"] });
    assert.equal(p.world.focused, b);
    p.close();
  });

  it("shows a focus ring when it has a border for one", () => {
    const t = toggle({ borderWidth: 2, focusBorderColor: "gold" });
    const { p, act, backend } = play(() => t);
    act({ mouse: { x: 300, y: 200 } });
    const ring = (): string | undefined =>
      backend.lastFrame.records.find((r): r is Box => r.op === "box" && r.borderWidth === 2)?.borderColor;
    assert.equal(ring(), undefined, "no ring until it has the focus");
    p.world.focus(t);
    act({ mouse: { x: 300, y: 200 } });
    assert.equal(ring(), "#ffd700ff");
    p.close();
  });
});
