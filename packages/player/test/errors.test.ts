import assert from "node:assert/strict";
/**
 * Errors in the window and hot reload: a game that throws keeps its window open and shows the error there, and `reload`
 * swaps in a new build of the root with the old tree's state.
 */
import { afterEach, describe, it } from "node:test";

import { Entity, Text, getSoundSink, type GameObject } from "@rge/runtime";

import { estimateTextWidth } from "../src/draw.ts";
import { HOST_RUN_KEY } from "../src/host.ts";
import { createPlayer, describeError, layoutError, run, type PlayerConfig } from "../src/loop.ts";
import { RecordingBackend, type RecordedFrame } from "../src/recording.ts";

const WINDOW = { width: 800, height: 600, title: "test" };

function texts(frame: RecordedFrame | undefined): string[] {
  return (frame?.records ?? []).flatMap((r) => (r.op === "text" ? [r.text] : []));
}

/** Throws in its update once `armed` is set. */
class Crasher extends Entity {
  static armed = false;
  updates = 0;
  override onUpdate(): void {
    this.updates++;
    if (Crasher.armed) throw new Error("game over");
  }
}

/** A component with state to keep across a reload, written the way generated code is. */
class Scored extends Entity {
  score = 0;
  readonly version: number;
  constructor(version: number) {
    super();
    this.version = version;
  }
  override saveHotState(): Record<string, unknown> {
    return { score: this.score };
  }
  override loadHotState(saved: Record<string, unknown>): void {
    if (this.hotFits(saved["score"], this.score)) this.score = saved["score"] as number;
  }
}

class Holder extends Entity {
  readonly scored: Scored;
  constructor(version: number) {
    super();
    this.scored = new Scored(version);
    this.addChild(this.scored);
  }
}

afterEach(() => {
  Crasher.armed = false;
  assert.equal(getSoundSink(), null, "every test closes its player");
});

describe("errors in the window", () => {
  it("shows a thrown error until the window closes, stops stepping the game, then throws it from run", () => {
    const backend = new RecordingBackend();
    let crasher: Crasher | null = null;
    backend.queueInput({});
    backend.queueInput({});
    backend.queueInput({});
    backend.queueInput({ quit: true });
    const config: PlayerConfig = {
      ...WINDOW,
      root: () => {
        crasher = new Crasher();
        return crasher;
      },
    };
    Crasher.armed = true;
    assert.throws(() => run(backend, config), /game over/);
    assert.equal(backend.closed, true);
    assert.equal(backend.frames.length, 4, "the window stayed open until it was closed");
    const shown = texts(backend.frames[0]);
    assert.ok(shown.includes("Error: game over"), shown.join("\n"));
    assert.ok(
      shown.some((line) => line.includes("onUpdate")),
      "the stack is shown"
    );
    assert.ok(shown.includes("Close the window to quit."));
    assert.equal(backend.frames[0]?.clearColor, backend.frames[3]?.clearColor);
    assert.equal((crasher as Crasher | null)?.updates, 1, "the game is not stepped again after the error");
  });

  it("still throws at once from a hidden window, or with showErrors off", () => {
    Crasher.armed = true;
    assert.throws(() => run(new RecordingBackend(), { ...WINDOW, hidden: true, root: () => new Crasher() }), /game over/);
    const player = createPlayer(new RecordingBackend(), { ...WINDOW, root: () => new Crasher() });
    assert.throws(() => player.step(), /game over/);
    player.close();
  });

  it("opens a window to show an error from building the root", () => {
    const backend = new RecordingBackend();
    const player = createPlayer(backend, {
      ...WINDOW,
      showErrors: true,
      root: () => {
        throw new TypeError("no root");
      },
    });
    assert.equal(player.step(), true);
    assert.ok(texts(backend.frames[0]).includes("TypeError: no root"));
    assert.ok(player.failure?.error instanceof TypeError);
    player.close();
  });

  it("shows an error a host reports, with its own note", () => {
    const backend = new RecordingBackend();
    const player = createPlayer(backend, { ...WINDOW, root: () => new Entity() });
    player.showError("src/Main.tsx(3,1): error RGE1001: something\nsecond line", "Save a file to try again.");
    player.step();
    const shown = texts(backend.frames[0]);
    assert.deepEqual(shown.slice(1, 3), ["src/Main.tsx(3,1): error RGE1001: something", "second line"]);
    assert.equal(shown.at(-1), "Save a file to try again.");
    player.close();
  });

  it("wraps long lines to the window and cuts what does not fit", () => {
    const measure = (text: string, size: number): number => estimateTextWidth(text, size);
    const long = new Error(`${"word ".repeat(80)}end`);
    const lines = layoutError(long, "note", 300, 200, measure);
    for (const line of lines) assert.ok(line.x + measure(line.text, line.size) <= 300, `'${line.text}' is wider than the window`);
    assert.ok(lines.some((line) => line.text === "(the rest does not fit)"));
    assert.equal(lines.at(-1)?.text, "note");
    for (const line of lines.slice(0, -2)) assert.ok(line.y + line.size <= 200 - 10);
  });

  it("describes errors that are not Error objects", () => {
    assert.deepEqual(describeError("plain\nmore"), { title: "plain", details: ["more"] });
    assert.equal(describeError(new RangeError("bad")).title, "RangeError: bad");
  });
});

describe("reload", () => {
  it("drops pending timers, which call code of the tree it replaces, and says how many", () => {
    const warnings: string[] = [];
    const player = createPlayer(new RecordingBackend(), { ...WINDOW, root: () => new Holder(1), warn: (m) => warnings.push(m) });
    const old = player.world.root.children[0] as Holder;
    let fired = 0;
    old.after(1, () => fired++);
    old.every(0.5, () => fired++);
    assert.equal(player.reload({ root: () => new Holder(2) }), true);
    assert.ok(
      warnings.some((m) => /dropped 2 pending timers/.test(m)),
      JSON.stringify(warnings)
    );
    assert.equal(old.pendingTimers, 0);
    for (let i = 0; i < 3; i++) player.world.tick(1);
    assert.equal(fired, 0, "nothing calls back into the old tree");
    player.close();
  });

  it("replaces the root in the same window and gives the new tree the old one's state", () => {
    let opens = 0;
    const backend = new (class extends RecordingBackend {
      override open(config: Parameters<RecordingBackend["open"]>[0]): void {
        opens++;
        super.open(config);
      }
    })();
    const player = createPlayer(backend, { ...WINDOW, root: () => new Holder(1) });
    const old = player.world.root.children[0] as Holder;
    old.scored.score = 42;
    assert.equal(player.reload({ root: () => new Holder(2) }), true);
    const fresh = player.world.root.children[0] as Holder;
    assert.equal(player.world.root.children.length, 1);
    assert.equal(fresh.scored.version, 2);
    assert.equal(fresh.scored.score, 42);
    assert.equal(old.world, null, "the old tree left the world");
    player.step();
    assert.equal(opens, 1, "the window was not opened again");
    player.close();
  });

  it("shows an error from a new build, keeps the last good state, and clears the error on the next good reload", () => {
    const backend = new RecordingBackend();
    const player = createPlayer(backend, { ...WINDOW, root: () => new Holder(1) });
    (player.world.root.children[0] as Holder).scored.score = 9;
    assert.equal(
      player.reload({
        root: (): GameObject => {
          throw new Error("broken edit");
        },
      }),
      false
    );
    assert.ok(player.failure);
    player.step();
    assert.ok(texts(backend.frames[0]).includes("Error: broken edit"));
    assert.equal(player.reload({ root: () => new Holder(3) }), true);
    assert.equal(player.failure, null);
    assert.equal((player.world.root.children[0] as Holder).scored.score, 9);
    player.step();
    assert.equal(texts(backend.frames[1]).length, 0, "the game draws again");
    player.close();
  });

  it("recovers from an error in a step: the fixed build takes the state the error left", () => {
    const backend = new RecordingBackend();
    const player = createPlayer(backend, { ...WINDOW, showErrors: true, root: () => new Holder(1) });
    const holder = player.world.root.children[0] as Holder;
    holder.scored.score = 5;
    holder.addChild(new Crasher());
    Crasher.armed = true;
    player.step();
    assert.ok(player.failure);
    Crasher.armed = false;
    assert.equal(player.reload({ root: () => new Holder(2) }), true);
    assert.equal((player.world.root.children[0] as Holder).scored.score, 5);
    player.step();
    player.close();
  });

  it("lets a host drive the loop: run hands it the backend and config", () => {
    const calls: PlayerConfig[] = [];
    const global = globalThis as Record<string, unknown>;
    global[HOST_RUN_KEY] = (_backend: unknown, config: PlayerConfig) => calls.push(config);
    try {
      const config: PlayerConfig = { root: () => new Text({ text: "hi" }) };
      run(new RecordingBackend(), config);
      assert.deepEqual(calls, [config]);
    } finally {
      delete global[HOST_RUN_KEY];
    }
  });
});
