import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Camera, Collider, Entity, GameObject, Pointer, Shape, Sound, World, getSoundSink, type InputState } from "@rge/runtime";
import { Hero } from "../../example/generated/Hero.ts";
import { createPlayer, MAX_DT, run, type PlayerConfig } from "../src/loop.ts";
import { RecordingBackend } from "../src/recording.ts";

const WINDOW = { width: 800, height: 600, title: "test" };

function player(root: () => GameObject, options: Partial<PlayerConfig> = {}, backend = new RecordingBackend()): { backend: RecordingBackend; warnings: string[]; player: ReturnType<typeof createPlayer> } {
  const warnings: string[] = [];
  return { backend, warnings, player: createPlayer(backend, { ...WINDOW, root, warn: (m) => warnings.push(m), ...options }) };
}

/** An object whose hooks write to a shared log. */
class Probe extends Entity {
  readonly log: string[];
  constructor(log: string[]) {
    super();
    this.log = log;
  }
  override onInput(input: InputState): void {
    this.log.push(`input pointer=${input.pointerX},${input.pointerY}`);
  }
  override onUpdate(dt: number): void {
    this.log.push(`update ${dt}`);
  }
}

describe("createPlayer", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  it("opens the window with the config it was given, and nothing else", () => {
    const { backend, player: p } = player(() => new Entity(), { resizable: false, smooth: true, background: "navy", assets: "art" });
    p.close();
    assert.deepEqual(backend.config, { width: 800, height: 600, title: "test", resizable: false, vsync: undefined, hidden: undefined, smooth: true });
  });

  it("clears the screen with the background colour", () => {
    const { backend, player: p } = player(() => new Entity(), { background: "navy" });
    p.step();
    p.close();
    assert.equal(backend.lastFrame.clearColor, "#000080ff");
  });

  it("defaults the background to black, and uses magenta, warning, for one it cannot read", () => {
    const a = player(() => new Entity());
    a.player.step();
    a.player.close();
    assert.equal(a.backend.lastFrame.clearColor, "#000000ff");
    const b = player(() => new Entity(), { background: "not a colour" });
    b.player.step();
    b.player.close();
    assert.equal(b.backend.lastFrame.clearColor, "#ff00ffff");
    assert.equal(b.warnings.length, 1);
  });

  it("runs a frame in the order: press, input, update, present", () => {
    const log: string[] = [];
    const root = (): GameObject => {
      const probe = new Probe(log);
      const pointer = new Pointer({ width: 50, height: 50, onPress: () => log.push("press") });
      probe.addChild(pointer);
      return probe;
    };
    const backend = new RecordingBackend();
    const originalFrame = backend.frame.bind(backend);
    backend.frame = (...args) => {
      log.push("present");
      originalFrame(...args);
    };
    backend.queueInput({ dt: 0.01, mouse: { x: 10, y: 10 }, pressed: ["MouseLeft"] });
    const { player: p } = player(root, {}, backend);
    p.step();
    p.step();
    p.close();
    assert.deepEqual(log, [
      "input pointer=0,0", "update 0", "present",
      "press", "input pointer=10,10", "update 0.01", "present",
    ]);
  });

  it("gives the first frame a dt of zero, then the backend's, clamped to [0, MAX_DT]", () => {
    const log: string[] = [];
    const backend = new RecordingBackend();
    backend.queueInput({ dt: 0.016 });
    backend.queueInput({ dt: 5 });
    backend.queueInput({ dt: -1 });
    backend.queueInput({ dt: Number.NaN });
    const { player: p } = player(() => new Probe(log), {}, backend);
    for (let i = 0; i < 5; i++) p.step();
    p.close();
    assert.equal(MAX_DT, 0.1);
    assert.deepEqual(log.filter((l) => l.startsWith("update")), ["update 0", "update 0.016", `update ${MAX_DT}`, "update 0", "update 0"]);
  });

  it("returns false from the frame in which the window asked to close, and still draws it", () => {
    const backend = new RecordingBackend();
    backend.queueInput({});
    backend.queueInput({ quit: true });
    const { player: p } = player(() => new Shape({ kind: "rect", width: 1, height: 1 }), {}, backend);
    assert.equal(p.step(), true);
    assert.equal(p.step(), false);
    assert.equal(backend.frames.length, 2);
    assert.equal(backend.lastFrame.records.length, 2, "the view and the rect");
    p.close();
  });

  it("closes the backend once, and refuses to step afterwards", () => {
    const backend = new RecordingBackend();
    let closes = 0;
    backend.close = () => void closes++;
    const { player: p } = player(() => new Entity(), {}, backend);
    p.close();
    p.close();
    assert.equal(closes, 1);
    assert.throws(() => p.step(), /closed/);
  });

  it("closes the window and unhooks sounds if building the root throws", () => {
    const backend = new RecordingBackend();
    assert.throws(() => createPlayer(backend, { ...WINDOW, root: () => { throw new Error("boom"); } }), /boom/);
    assert.equal(backend.closed, true);
    assert.equal(getSoundSink(), null);
  });

  it("exposes the world it mounted the root in", () => {
    const root = new Entity();
    const { player: p } = player(() => root);
    assert.ok(p.world instanceof World);
    assert.equal(root.world, p.world);
    p.close();
  });
});

describe("run", () => {
  it("steps until the window closes, then closes the backend", () => {
    const backend = new RecordingBackend();
    backend.queueInput({});
    backend.queueInput({});
    backend.queueInput({ quit: true });
    run(backend, { ...WINDOW, root: () => new Entity() });
    assert.equal(backend.frames.length, 3);
    assert.equal(backend.closed, true);
  });

  it("closes the backend when the game throws", () => {
    const backend = new RecordingBackend();
    class Crasher extends Entity {
      override onUpdate(): void {
        throw new Error("game over");
      }
    }
    assert.throws(() => run(backend, { ...WINDOW, root: () => new Crasher() }), /game over/);
    assert.equal(backend.closed, true);
    assert.equal(getSoundSink(), null);
  });
});

describe("pointer presses", () => {
  /** A pointer at a world position that logs its name. */
  function pointerAt(name: string, x: number, y: number, size: number, log: string[]): Pointer {
    const pointer = new Pointer({ width: size, height: size, onPress: () => log.push(name) });
    pointer.transform.x = x;
    pointer.transform.y = y;
    return pointer;
  }

  function click(root: () => GameObject, mouse: { x: number; y: number }, keys: { pressed?: string[]; down?: string[] } = { pressed: ["MouseLeft"] }): void {
    const backend = new RecordingBackend();
    backend.queueInput({ mouse, ...keys });
    const { player: p } = player(root, {}, backend);
    p.step(); // draws the pointers and polls the click
    p.step(); // dispatches it
    p.close();
  }

  it("calls onPress of a pointer under the mouse", () => {
    const log: string[] = [];
    click(() => pointerAt("a", 100, 100, 50, log), { x: 120, y: 120 });
    assert.deepEqual(log, ["a"]);
  });

  it("gives a press to the pointer with the higher z, wherever it is in the tree", () => {
    const log: string[] = [];
    const root = (): GameObject => {
      const entity = new Entity();
      const raised = pointerAt("raised", 0, 0, 100, log);
      raised.transform.z = 1;
      entity.addChild(raised);
      entity.addChild(pointerAt("later", 50, 50, 100, log));
      return entity;
    };
    click(root, { x: 75, y: 75 });
    assert.deepEqual(log, ["raised"], "drawn on top, so pressed first, though it comes first in the tree");
    log.length = 0;
    click(root, { x: 120, y: 120 });
    assert.deepEqual(log, ["later"], "outside the raised one, the other still gets it");
  });

  it("calls nothing for a press outside every pointer", () => {
    const log: string[] = [];
    click(() => pointerAt("a", 100, 100, 50, log), { x: 10, y: 10 });
    assert.deepEqual(log, []);
  });

  it("gives an overlapping press to the topmost pointer only", () => {
    const log: string[] = [];
    const root = (): GameObject => {
      const entity = new Entity();
      entity.addChild(pointerAt("bottom", 0, 0, 100, log));
      entity.addChild(pointerAt("top", 50, 50, 100, log));
      return entity;
    };
    click(root, { x: 75, y: 75 });
    assert.deepEqual(log, ["top"]);
    log.length = 0;
    click(root, { x: 10, y: 10 });
    assert.deepEqual(log, ["bottom"], "outside the top one, the one below still gets it");
  });

  it("ignores a held button and the other buttons: only a new left press counts", () => {
    const log: string[] = [];
    click(() => pointerAt("a", 0, 0, 100, log), { x: 5, y: 5 }, { down: ["MouseLeft"] });
    click(() => pointerAt("a", 0, 0, 100, log), { x: 5, y: 5 }, { pressed: ["MouseRight"] });
    assert.deepEqual(log, []);
  });

  it("hits what is drawn when the view is a zoomed camera", () => {
    const log: string[] = [];
    const root = (): GameObject => {
      const entity = new Entity();
      entity.addChild(new Camera({ zoom: 2 }));
      entity.addChild(pointerAt("a", 100, 100, 20, log));
      return entity;
    };
    // The camera is at the origin, so world (0, 0) is the window's centre (400, 300) and each world pixel is two.
    click(root, { x: 400 + 2 * 110, y: 300 + 2 * 110 });
    assert.deepEqual(log, ["a"]);
    log.length = 0;
    click(root, { x: 110, y: 110 }, { pressed: ["MouseLeft"] });
    assert.deepEqual(log, [], "the same numbers as window coordinates are somewhere else on screen");
  });

  it("lets a handler read the mouse in world space", () => {
    const log: string[] = [];
    const backend = new RecordingBackend();
    backend.queueInput({ mouse: { x: 400 + 2 * 30, y: 300 + 2 * 40 } });
    const { player: p } = player(() => {
      const entity = new Probe(log);
      entity.addChild(new Camera({ zoom: 2 }));
      return entity;
    }, {}, backend);
    p.step();
    p.step();
    p.close();
    assert.deepEqual(log.filter((l) => l.startsWith("input")), ["input pointer=0,0", "input pointer=30,40"]);
  });
});

describe("sounds", () => {
  it("preloads a component's sounds when it is created and plays them through the backend", () => {
    const { backend, player: p } = player(() => new Hero());
    assert.deepEqual(backend.soundLoads, ["assets/hurt.wav"], "loaded while the root was built, before any frame");
    const hero = p.world.root.children[0] as Hero;
    const collider = hero.children.find((child) => child instanceof Collider) as Collider;
    p.world.reportCollision(collider, new Collider({ width: 1, height: 1 }));
    assert.deepEqual(backend.plays, ["assets/hurt.wav"]);
    assert.deepEqual(backend.soundLoads, ["assets/hurt.wav"], "playing does not load again");
    p.close();
  });

  it("loads a sound created before the player on first play", () => {
    const early = new Sound("early.wav");
    const { backend, player: p } = player(() => new Entity());
    early.play();
    assert.deepEqual(backend.soundLoads, ["assets/early.wav"]);
    assert.deepEqual(backend.plays, ["assets/early.wav"]);
    p.close();
  });

  it("warns once and plays nothing for a sound that cannot be loaded", () => {
    const backend = new RecordingBackend({ missingSounds: ["assets/gone.wav"] });
    const { warnings, player: p } = player(() => new Entity(), {}, backend);
    const sound = new Sound("gone.wav");
    sound.play();
    sound.play();
    assert.equal(sound.plays, 2, "the runtime still counts them");
    assert.deepEqual(backend.plays, []);
    assert.equal(warnings.length, 1);
    assert.deepEqual(backend.soundLoads, ["assets/gone.wav"], "a failed load is not retried");
    p.close();
  });

  it("uses the assets option for the folder", () => {
    const { backend, player: p } = player(() => new Entity(), { assets: "audio" });
    new Sound("a.wav").play();
    assert.deepEqual(backend.plays, ["audio/a.wav"]);
    p.close();
  });

  it("stops playing through the backend once the player is closed", () => {
    const { backend, player: p } = player(() => new Entity());
    const sound = new Sound("a.wav");
    p.close();
    sound.play();
    assert.deepEqual(backend.plays, []);
    assert.equal(sound.plays, 1);
  });
});
