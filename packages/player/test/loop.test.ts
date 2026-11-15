import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  Camera,
  Collider,
  Entity,
  Flex,
  Game,
  GameObject,
  Pointer,
  Screen,
  Shape,
  Sound,
  Text,
  createGameState,
  getSoundSink,
  type InputState,
} from "@tsengine/runtime";

import { Hero } from "../../example/generated/Hero.ts";
import { createPlayer, DEFAULT_WINDOW, MAX_DT, run, type PlayerConfig } from "../src/loop.ts";
import { RecordingBackend } from "../src/recording.ts";

const WINDOW = { width: 800, height: 600, title: "test" };

function player(
  root: () => GameObject,
  options: Partial<PlayerConfig> = {},
  backend = new RecordingBackend()
): { backend: RecordingBackend; warnings: string[]; player: ReturnType<typeof createPlayer> } {
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

  it("starts every game from the initial game state, whatever an earlier game left", () => {
    const useGame = createGameState({ coins: 0 }, {});
    useGame.setState({ coins: 1 });
    assert.equal(useGame.getState().coins, 1);
    const { player: p } = player(() => new Entity());
    assert.equal(useGame.getState().coins, 0, "a new player resets every game state to its initial values");
    p.close();
  });

  it("opens the window with the config it was given, and nothing else", () => {
    const { backend, player: p } = player(() => new Entity(), { resizable: false, smooth: true, background: "navy", assets: "art" });
    p.close();
    assert.deepEqual(backend.config, {
      width: 800,
      height: 600,
      title: "test",
      resizable: false,
      vsync: undefined,
      hidden: undefined,
      smooth: true,
      sharp: undefined,
    });
  });

  it("asks for sharp scaling when the <Game> or the config says upscale is sharp, and for nothing otherwise", () => {
    const a = player(() => new Game({ upscale: "sharp" }));
    a.player.close();
    assert.equal(a.backend.config?.sharp, true);
    const b = player(() => new Entity(), { upscale: "sharp" });
    b.player.close();
    assert.equal(b.backend.config?.sharp, true);
    const c = player(() => new Game({ upscale: "nearest" }));
    c.player.close();
    assert.equal(c.backend.config?.sharp, undefined);
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
    assert.deepEqual(log, ["input pointer=0,0", "update 0", "present", "press", "input pointer=10,10", "update 0.01", "present"]);
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
    assert.deepEqual(
      log.filter((l) => l.startsWith("update")),
      ["update 0", "update 0.016", `update ${MAX_DT}`, "update 0", "update 0"]
    );
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

  it("opens no window and unhooks sounds if building the root throws", () => {
    const backend = new RecordingBackend();
    assert.throws(
      () =>
        createPlayer(backend, {
          ...WINDOW,
          root: () => {
            throw new Error("boom");
          },
        }),
      /boom/
    );
    assert.equal(backend.opened, false, "the root is built before the window opens");
    assert.equal(getSoundSink(), null);
  });

  it("closes the window if mounting the root throws", () => {
    const backend = new RecordingBackend();
    class Bad extends Entity {
      override onMount(): void {
        throw new Error("mount");
      }
    }
    assert.throws(() => createPlayer(backend, { ...WINDOW, root: () => new Bad() }), /mount/);
    assert.equal(backend.closed, true);
    assert.equal(getSoundSink(), null);
  });

  describe("full screen", () => {
    const run = (root: () => GameObject, frames: Parameters<RecordingBackend["queueInput"]>[0][], config: Partial<PlayerConfig> = {}) => {
      const backend = new RecordingBackend();
      for (const frame of frames) backend.queueInput(frame);
      const p = createPlayer(backend, { root, warn: () => {}, ...config });
      for (let i = 0; i <= frames.length; i++) p.step();
      p.close();
      return backend.fullscreenCalls;
    };

    it("toggles on F11, and off on the next F11", () => {
      assert.deepEqual(
        run(() => new Entity(), [{ pressed: ["F11"] }, {}, { pressed: ["F11"] }]),
        [true, false]
      );
    });

    it("toggles on Alt + Enter, and not on Enter alone", () => {
      assert.deepEqual(
        run(() => new Entity(), [{ pressed: ["Enter"] }, { down: ["Alt"], pressed: ["Enter"] }]),
        [true]
      );
    });

    it("uses the <Game> key over the player's, and a false key turns the key off", () => {
      assert.deepEqual(
        run(() => new Game({ fullscreenKey: "F" }), [{ pressed: ["F11"] }, { pressed: ["F"] }]),
        [true]
      );
      assert.deepEqual(
        run(() => new Entity(), [{ pressed: ["F11"] }, { pressed: ["G"] }], { fullscreenKey: "G" }),
        [true]
      );
      assert.deepEqual(
        run(() => new Game({ fullscreenKey: false }), [{ pressed: ["F11"] }]),
        []
      );
    });

    it("warns once about a key it does not know, and Alt + Enter still works", () => {
      const warnings: string[] = [];
      assert.deepEqual(
        run(() => new Entity(), [{ pressed: ["F11"] }, { down: ["Alt"], pressed: ["Enter"] }], {
          fullscreenKey: "Nope",
          warn: (m) => warnings.push(m),
        }),
        [true]
      );
      assert.equal(warnings.length, 1);
      assert.match(warnings[0] as string, /fullscreenKey 'Nope'/);
    });

    it("does nothing with a backend that cannot", () => {
      class Plain extends RecordingBackend {
        override setFullscreen = undefined as never;
      }
      const backend = new Plain();
      backend.queueInput({ pressed: ["F11"] });
      const p = createPlayer(backend, { root: () => new Entity(), warn: () => {} });
      p.step();
      p.step();
      p.close();
      assert.deepEqual(backend.fullscreenCalls, []);
    });
  });

  describe("a <Game> root", () => {
    it("opens the window it asks for, over the player's config, over the defaults, each setting on its own", () => {
      const game = player(() => new Game({ title: "from game", width: 200, smooth: true }), {
        width: 999,
        height: 111,
        title: "from config",
        resizable: false,
        vsync: false,
        smooth: false,
      });
      assert.deepEqual(
        game.backend.config,
        { width: 200, height: 111, title: "from game", resizable: false, vsync: false, hidden: undefined, smooth: true, sharp: undefined },
        "width, title and smooth from <Game>; the rest from the player"
      );
      game.player.close();
      const backend = new RecordingBackend();
      const plain = createPlayer(backend, { root: () => new Entity(), warn: () => {} });
      assert.deepEqual(
        [backend.config?.width, backend.config?.height, backend.config?.title],
        [DEFAULT_WINDOW.width, DEFAULT_WINDOW.height, DEFAULT_WINDOW.title],
        "no <Game> and no config: the defaults"
      );
      plain.close();
    });

    it("opens at 3 × a root <Screen> when nothing sets the window's size, and at what is set otherwise", () => {
      const sized = (props: ConstructorParameters<typeof Game>[0]) => {
        class Level extends Game {
          constructor() {
            super(props);
            this.addChild(new Screen({ width: 320, height: 180 }));
          }
        }
        return Level;
      };
      const open = (Root: new () => Game, config: Partial<PlayerConfig> = {}) => {
        const backend = new RecordingBackend();
        createPlayer(backend, { root: () => new Root(), warn: () => {}, ...config }).close();
        return [backend.config?.width, backend.config?.height];
      };
      assert.deepEqual(open(sized({})), [960, 540], "a <Game> with a <Screen> and no size");
      assert.deepEqual(open(sized({ width: 640 })), [640, 540], "each setting on its own");
      assert.deepEqual(open(sized({}), { width: 800, height: 600 }), [800, 600], "the player's config beats the 3 ×");
      const backend = new RecordingBackend();
      createPlayer(backend, { root: () => new Screen({ width: 100, height: 50 }), warn: () => {} }).close();
      assert.deepEqual([backend.config?.width, backend.config?.height], [300, 150], "a bare <Screen> root too");
    });

    it("draws with the window's size and the game's background, and loads from the game's assets folder", () => {
      const backend = new RecordingBackend();
      class Level extends Game {
        readonly shape = new Shape({ kind: "rect", width: 1, height: 1 });
        readonly sound = new Sound("beep.wav");
        constructor() {
          super({ width: 320, height: 200, background: "red", assets: "art" });
          this.addChild(this.shape);
        }
      }
      const p = createPlayer(backend, { root: () => new Level() });
      p.step();
      assert.equal(backend.lastFrame.clearColor, "#ff0000ff");
      assert.deepEqual(
        backend.soundLoads,
        ["art/beep.wav"],
        "a sound made while the root is built is preloaded once the window is open, from the game's folder"
      );
      p.close();
    });

    it("finds a <Screen> that is its only child: the game's resolution is scaled into the window", () => {
      const backend = new RecordingBackend();
      const game = new Game({ title: "x", width: 960, height: 540 });
      game.addChild(new Screen({ width: 320, height: 180 }));
      const p = createPlayer(backend, { root: () => game });
      assert.deepEqual([backend.config?.width, backend.config?.height], [960, 540], "the window is the <Game>'s size");
      p.step();
      const canvas = backend.lastFrame.records[0];
      assert.ok(canvas?.op === "canvas");
      assert.equal(canvas.destW / canvas.width, 3, "a 320 x 180 screen in a 960 x 540 window (the <Game>'s) is drawn at 3x");
      p.close();
    });

    it("builds the root before the window opens, and still preloads its sounds once it is open", () => {
      const order: string[] = [];
      const backend = new RecordingBackend();
      const open = backend.open.bind(backend);
      backend.open = (config) => {
        order.push("open");
        open(config);
      };
      const { player: p } = player(
        () => {
          order.push("root");
          void new Sound("a.wav");
          return new Game({ title: "x" });
        },
        {},
        backend
      );
      assert.deepEqual(order, ["root", "open"]);
      assert.deepEqual(backend.soundLoads, ["assets/a.wav"]);
      p.close();
    });
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
    assert.throws(() => run(backend, { ...WINDOW, hidden: true, root: () => new Crasher() }), /game over/);
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

  function click(
    root: () => GameObject,
    mouse: { x: number; y: number },
    keys: { pressed?: string[]; down?: string[] } = { pressed: ["MouseLeft"] }
  ): void {
    const backend = new RecordingBackend();
    backend.queueInput({ mouse, ...keys });
    const { player: p } = player(root, {}, backend);
    p.step(); // draws the pointers and polls the click
    p.step(); // dispatches it
    p.close();
  }

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
    const { player: p } = player(
      () => {
        const entity = new Probe(log);
        entity.addChild(new Camera({ zoom: 2 }));
        return entity;
      },
      {},
      backend
    );
    p.step();
    p.step();
    p.close();
    assert.deepEqual(
      log.filter((l) => l.startsWith("input")),
      ["input pointer=0,0", "input pointer=30,40"]
    );
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

describe("pointer hover", () => {
  it("tells the topmost pressable under the mouse it is entered and left, a Flex too, and lets a press through a hover-only Flex", () => {
    const log: string[] = [];
    const root = (): GameObject => {
      const scene = new Entity();
      const low = new Pointer({
        width: 50,
        height: 50,
        onPress: () => log.push("press low"),
        onPointerEnter: () => log.push("enter low"),
        onPointerLeave: () => log.push("leave low"),
      });
      const box = new Flex({
        width: 20,
        height: 20,
        onPointerEnter: () => log.push("enter box"),
        onPointerLeave: () => log.push("leave box"),
      });
      box.transform.x = 60;
      scene.addChild(low);
      scene.addChild(box);
      const over = new Flex({ width: 10, height: 10, onPointerEnter: () => log.push("enter over") });
      over.transform.x = 5;
      over.transform.y = 5;
      scene.addChild(over);
      return scene;
    };
    const backend = new RecordingBackend();
    for (const input of [
      { mouse: { x: 30, y: 30 } }, // draws the pointers
      { mouse: { x: 30, y: 30 } }, // over the low pointer
      { mouse: { x: 31, y: 31 } }, // still over it: nothing new
      { mouse: { x: 65, y: 5 } }, // over the box
      { mouse: { x: 8, y: 8 } }, // over the hover-only flex drawn over the low pointer
      { mouse: { x: 8, y: 8 }, pressed: ["MouseLeft"] },
      { mouse: { x: 8, y: 8 } }, // the press goes through the hover-only flex to the pointer
      { mouse: { x: 500, y: 500 } }, // over nothing
    ])
      backend.queueInput(input);
    const { player: p } = player(root, {}, backend);
    for (let i = 0; i < 8; i++) p.step();
    p.close();
    assert.deepEqual(log, ["enter low", "leave low", "enter box", "leave box", "enter over", "press low"]);
  });
});

describe("<Game font>", () => {
  it("is the font of a <Text> without its own; a <Text font> still wins; without it, text uses the built-in font", () => {
    const scene = (font: string | undefined) => (): GameObject => {
      const game = new Game({ font });
      game.addChild(new Text({ text: "AB", size: 8 }));
      game.addChild(new Text({ text: "C", size: 8, font: "other.png" }));
      return game;
    };
    const draw = (font: string | undefined) => {
      const backend = new RecordingBackend({
        textureSizes: { "assets/font.png": { width: 80, height: 48 }, "assets/other.png": { width: 160, height: 96 } },
      });
      const { player: p } = player(scene(font), {}, backend);
      p.step();
      p.close();
      return backend.lastFrame.records
        .map((r) => (r.op === "spriteRegion" ? `sprite ${r.texture}` : r.op === "text" ? `text ${r.text}` : r.op))
        .filter((r) => r.startsWith("sprite") || r.startsWith("text"));
    };
    assert.deepEqual(draw("font.png"), ["sprite assets/font.png", "sprite assets/font.png", "sprite assets/other.png"]);
    assert.deepEqual(draw(undefined), ["text AB", "sprite assets/other.png"]);
  });
});
