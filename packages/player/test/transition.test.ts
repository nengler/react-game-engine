import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Flex, Shape, getSoundSink, type FlexProps, type FlexTransition } from "@rge/runtime";
import { createPlayer } from "../src/loop.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";
import { ease, mixThrough, stepTransition, type ShownColors } from "../src/transition.ts";

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;

describe("transition colours", () => {
  it("eases: slow at both ends, exactly 0, a half and 1 at the ends and the middle, never backwards", () => {
    assert.equal(ease(-1), 0);
    assert.equal(ease(0), 0);
    assert.equal(ease(0.5), 0.5);
    assert.equal(ease(1), 1);
    assert.equal(ease(2), 1);
    assert.ok(ease(0.1) < 0.1 && ease(0.9) > 0.9, "slower than linear at the ends");
    let last = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      assert.ok(ease(t) >= last);
      last = ease(t);
    }
  });

  it("mixes channel by channel, and treats a colour with no alpha as nothing, not black", () => {
    assert.equal(mixThrough(RED, BLUE, 0), RED);
    assert.equal(mixThrough(RED, BLUE, 1), BLUE);
    assert.equal(mixThrough(RED, BLUE, 0.5), 0x800080ff);
    assert.equal(mixThrough(0, RED, 0.5), 0xff000080, "from nothing: the target's red, half its alpha");
    assert.equal(mixThrough(RED, 0, 0.5), 0xff000080, "to nothing: the same going back");
    assert.equal(mixThrough(0, 0x00000000, 0.5), 0, "nothing to nothing");
  });

  const out = (): ShownColors => ({ fill: -1, edge: -1, alpha: -1 });

  it("shows the first colours at once, then fades to a new target by the clock, and stays there", () => {
    const shown = out();
    let state: FlexTransition | null = stepTransition(null, RED, 0, 1, 1, 10, shown);
    assert.deepEqual(shown, { fill: RED, edge: 0, alpha: 1 }, "the first frame is not a fade");
    state = stepTransition(state, BLUE, 0, 1, 1, 10, shown);
    assert.equal(shown.fill, RED, "a new target starts from what was shown");
    state = stepTransition(state, BLUE, 0, 1, 1, 10.5, shown);
    assert.equal(shown.fill, 0x800080ff, "half way at half the time");
    state = stepTransition(state, BLUE, 0, 1, 1, 11, shown);
    assert.equal(shown.fill, BLUE, "there at the end");
    stepTransition(state, BLUE, 0, 1, 1, 50, shown);
    assert.equal(shown.fill, BLUE, "and it stays");
  });

  it("shows the same thing when asked twice at one time, which the player does when it builds a frame twice", () => {
    const a = out();
    const b = out();
    let state: FlexTransition | null = stepTransition(null, RED, RED, 1, 1, 0, a);
    state = stepTransition(state, BLUE, BLUE, 1, 1, 0.3, a);
    const first = { ...a };
    stepTransition(state, BLUE, BLUE, 1, 1, 0.3, b);
    assert.deepEqual(b, first);
    stepTransition(state, BLUE, BLUE, 1, 1, 0.3, b);
    assert.deepEqual(b, first);
  });

  it("turns round from where it had got to, not from where it began", () => {
    const shown = out();
    let state: FlexTransition | null = stepTransition(null, RED, 0, 1, 1, 0, shown);
    state = stepTransition(state, BLUE, 0, 1, 1, 0, shown);
    state = stepTransition(state, BLUE, 0, 1, 1, 0.5, shown);
    const half = shown.fill;
    assert.equal(half, 0x800080ff);
    state = stepTransition(state, RED, 0, 1, 1, 0.5, shown);
    assert.equal(shown.fill, half, "turning round: still where it was");
    stepTransition(state, RED, 0, 1, 1, 1, shown);
    assert.equal(shown.fill, mixThrough(half, RED, ease(0.5)), "half way back from there");
  });

  it("fades the opacity with the colours, from what is shown, by the same ease", () => {
    const shown = out();
    let state: FlexTransition | null = stepTransition(null, RED, 0, 1, 2, 0, shown);
    assert.equal(shown.alpha, 1, "the first frame is not a fade");
    state = stepTransition(state, RED, 0, 0, 2, 0, shown);
    assert.equal(shown.alpha, 1, "a new target starts from what was shown");
    state = stepTransition(state, RED, 0, 0, 2, 1, shown);
    assert.equal(shown.alpha, 0.5, "half way at half the time");
    state = stepTransition(state, RED, 0, 1, 2, 1, shown);
    assert.equal(shown.alpha, 0.5, "turning round: still where it was");
    stepTransition(state, RED, 0, 1, 2, 2, shown);
    assert.equal(shown.alpha, 0.75, "and half way back from there, a second later");
    stepTransition(state, RED, 0, 1, 2, 9, shown);
    assert.equal(shown.alpha, 1, "arrived");
  });

  it("starts a fade for a change of opacity alone, and not for no change", () => {
    const shown = out();
    let state: FlexTransition | null = stepTransition(null, RED, 0, 1, 1, 0, shown);
    state = stepTransition(state, RED, 0, 1, 1, 5, shown);
    assert.equal(state.since, 0, "nothing changed, so nothing restarted");
    state = stepTransition(state, RED, 0, 0.5, 1, 5, shown);
    assert.equal(state.since, 5, "an opacity that changed did");
  });

  it("fades the border colour the same way, and a colour that goes away fades out", () => {
    const shown = out();
    let state: FlexTransition | null = stepTransition(null, RED, BLUE, 1, 2, 0, shown);
    state = stepTransition(state, RED, 0, 1, 2, 0, shown);
    stepTransition(state, RED, 0, 1, 2, 1, shown);
    assert.equal(shown.edge, 0x0000ff80, "the border fades out to half its alpha");
    assert.equal(shown.fill, RED, "the fill, which did not change, does not");
  });
});

describe("<Flex transition> in the loop", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  const IN = { x: 10, y: 10 };
  const OUT = { x: 150, y: 80 };
  const WINDOW = { width: 200, height: 100, title: "test" };
  const fill = (frame: readonly DecodedRecord[]): string => {
    const own = frame.find((r) => (r.op === "rect" && r.width === 40) || (r.op === "box" && r.width === 40));
    if (own?.op === "rect") return own.color;
    if (own?.op === "box") return own.fill;
    return "none";
  };

  /** The fill of a 40 × 20 button after each step; `dt` seconds pass in each. */
  function run(props: FlexProps, mice: readonly { x: number; y: number }[], dt = 0.1): string[] {
    const backend = new RecordingBackend();
    const root = new Entity();
    const f = new Flex({ width: 40, height: 20, ...props });
    f.addChild(new Shape({ kind: "rect", width: 4, height: 4 }));
    root.addChild(f);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    const fills: string[] = [];
    for (const mouse of mice) {
      backend.queueInput({ mouse, dt });
      p.step();
      fills.push(fill(backend.lastFrame.records));
    }
    p.close();
    return fills;
  }

  const FADE: FlexProps = { background: "#000000", hoverBackground: "#ffffff", transition: 0.4 };

  it("fades through the colours in between and arrives, instead of snapping", () => {
    const fills = run(FADE, [OUT, OUT, IN, IN, IN, IN, IN, IN, IN]);
    assert.equal(fills[0], "#000000ff");
    const start = fills.findIndex((f) => f !== "#000000ff");
    assert.ok(start > 0, "it started to change");
    const end = fills.indexOf("#ffffffff");
    assert.ok(end > start + 1, `it took more than one frame to get there: ${fills.join(" ")}`);
    const between = fills.slice(start, end);
    assert.ok(between.length >= 2 && between.every((f) => f !== "#000000ff" && f !== "#ffffffff"), "in between colours");
    const greys = between.map((f) => parseInt(f.slice(1, 3), 16));
    assert.deepEqual([...greys].sort((a, b) => a - b), greys, "getting lighter, never backwards");
    assert.equal(fills.at(-1), "#ffffffff");
  });

  it("takes the time it is given: twice the duration, about twice the frames", () => {
    const frames = (transition: number): number => {
      const fills = run({ ...FADE, transition }, [OUT, ...Array(30).fill(IN)]);
      return fills.indexOf("#ffffffff") - fills.findIndex((f, i) => i > 0 && f !== "#000000ff");
    };
    const short = frames(0.2);
    const long = frames(0.4);
    assert.ok(long > short, `${long} frames for 0.4 s, ${short} for 0.2 s`);
  });

  it("fades back out when the mouse leaves, and turns round part way through", () => {
    const fills = run(FADE, [OUT, OUT, IN, IN, IN, OUT, OUT, OUT, OUT, OUT, OUT, OUT]);
    assert.equal(fills.at(-1), "#000000ff", "back to plain");
    const light = Math.max(...fills.map((f) => parseInt(f.slice(1, 3), 16)));
    assert.ok(light > 0 && light < 255, "left before it got all the way, so it only got part way");
  });

  it("snaps with no transition, as it always did", () => {
    const fills = run({ background: "#000000", hoverBackground: "#ffffff" }, [OUT, IN, IN, IN]);
    assert.deepEqual(new Set(fills), new Set(["#000000ff", "#ffffffff"]), "only the two colours");
  });

  it("fades a background in from nothing, and the border's colour with it", () => {
    const backend = new RecordingBackend();
    const root = new Entity();
    root.addChild(new Flex({ width: 40, height: 20, borderWidth: 2, borderColor: "#00000000", hoverBorderColor: "#ff0000", transition: 0.4 }));
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    const edges: string[] = [];
    for (const mouse of [OUT, OUT, IN, IN, IN, IN, IN, IN, IN]) {
      backend.queueInput({ mouse, dt: 0.1 });
      p.step();
      const b = backend.lastFrame.records.find((r) => r.op === "box");
      edges.push(b?.op === "box" ? b.borderColor : "none");
    }
    p.close();
    assert.ok(edges.some((e) => /^#ff0000[0-9a-f]{2}$/.test(e) && e !== "#ff0000ff" && e !== "#ff000000"), `an in-between alpha of red: ${edges.join(" ")}`);
    assert.equal(edges.at(-1), "#ff0000ff");
  });

  it("is not mistaken for something that changed without reporting it, when every frame is also built again to check", () => {
    const backend = new RecordingBackend();
    const root = new Entity();
    root.addChild(new Flex({ width: 40, height: 20, ...FADE }));
    // `retain: "check"` rebuilds each frame from scratch at the same animation time and throws on a difference.
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {}, retain: "check" });
    for (const mouse of [OUT, IN, IN, IN, OUT, OUT, OUT]) {
      backend.queueInput({ mouse, dt: 0.1 });
      p.step();
    }
    p.close();
  });
});

