import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlayer, RecordingBackend, type DecodedRecord, type InputFrame, type Player } from "@rge/player";
import { createNodeBackend, findNativeLibrary, type Pixels } from "@rge/player-node";
import { gameConfig } from "../game.ts";
import { Main } from "../generated/Main.ts";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
/** The window the root asks for with `<Game width height>`. */
const WINDOW = { width: new Main().width as number, height: new Main().height as number };

type Rect = Extract<DecodedRecord, { op: "rect" }>;

interface Run {
  readonly backend: RecordingBackend;
  readonly player: Player;
  readonly warnings: string[];
}

/** Run the demo against a recording backend: scripted input, no window. `steps` frames are stepped. */
function play(inputs: readonly InputFrame[], steps: number): Run {
  const backend = new RecordingBackend({ missingTextures: ["assets/beacon-gone.png"] });
  const warnings: string[] = [];
  for (const input of inputs) backend.queueInput(input);
  const player = createPlayer(backend, { ...gameConfig, warn: (m) => warnings.push(m) });
  for (let i = 0; i < steps; i++) player.step();
  player.close();
  return { backend, player, warnings };
}

/** A decoded frame as short comparable tuples. */
function summary(records: readonly DecodedRecord[]): unknown[] {
  return records.map((r) => {
    switch (r.op) {
      case "view": return ["view", r.e, r.f];
      case "sprite": return ["sprite", r.texture, r.x, r.y];
      case "rect": return ["rect", r.x, r.y, r.width, r.height, r.color];
      case "ellipse": return ["ellipse", r.x, r.y, r.width, r.height, r.color];
      case "text": return ["text", r.text, Math.round(r.x * 1e6) / 1e6, Math.round(r.y * 1e6) / 1e6, r.size, r.color]; // layout adds halves: ignore the last bits
    }
  });
}

function close(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} ≈ ${expected}`);
}

const player = (run: Run): Rect => run.backend.lastFrame.records.filter((r): r is Rect => r.op === "rect" && (r.color === "#ffd700ff" || r.color === "#ff6347ff")).at(-1) as Rect;
const button = (run: Run): Rect => run.backend.lastFrame.records.find((r): r is Rect => r.op === "rect" && r.width === 96) as Rect;
const texts = (run: Run): string[] => run.backend.lastFrame.records.flatMap((r) => (r.op === "text" && r.text.startsWith("Clicks") ? [r.text] : []));
const coinsText = (run: Run): string[] => run.backend.lastFrame.records.flatMap((r) => (r.op === "text" && r.text.startsWith("Coins") ? [r.text] : []));
const coin = (run: Run): DecodedRecord | undefined => run.backend.lastFrame.records.find((r) => r.op === "ellipse" && r.width === 16);

/** Where a world point is on the screen in the last frame. */
function onScreen(run: Run, x: number, y: number): { x: number; y: number } {
  const v = run.backend.lastFrame.records[0];
  assert.ok(v?.op === "view");
  return { x: v.a * x + v.c * y + v.e, y: v.b * x + v.d * y + v.f };
}

const MOVE_RIGHT: InputFrame = { dt: 0.1, down: ["ArrowRight"] };
const IDLE: InputFrame = { dt: 0.1 };

describe("demo: the first frame", () => {
  it("draws the world (ground, beacon, spikes, coin, player), then the HUD (coin count, button, its label) through a view of its own", () => {
    const run = play([], 1);
    assert.deepEqual(summary(run.backend.lastFrame.records), [
      ["view", 320, 180],
      ["rect", -240, 40, 48, 48, "#2b3550ff"],
      ["rect", 200, 90, 64, 32, "#2b3550ff"],
      ["ellipse", -40, -140, 56, 56, "#3a2b50ff"],
      ["ellipse", 260, -70, 28, 28, "#3a2b50ff"],
      ["sprite", "assets/beacon-2.png", 140, 120],
      ["sprite", "assets/beacon-1.png", -120, -60],
      ["rect", 84, 10, 24, 24, "#8b1e2dff"],
      ["ellipse", 60, 8, 16, 16, "#e8a317ff"],
      ["rect", 0, 0, 24, 24, "#ffd700ff"],
      ["view", 0, 0],
      ["text", "Coins: 0", 16, 16, 16, "#ffd700ff"],
      ["rect", 16, 40, 96, 32, "#708090ff"],
      // The label is centred in the button by layout: 9 characters at 16 are 86.4 wide (the recorder's estimate) and 16 high.
      ["text", "Clicks: 0", 20.8, 40 + (32 - 16) / 2, 16, "#ffffffff"],
    ]);
    assert.deepEqual(run.warnings, []);
    assert.equal(run.backend.lastFrame.clearColor, "#10131cff");
    assert.deepEqual(run.backend.soundLoads, ["assets/click.wav"], "the click sound is loaded while the game is built");
  });
});

describe("demo: moving", () => {
  it("moves the square with the arrow keys and keeps the camera on it", () => {
    const run = play(Array.from({ length: 5 }, () => MOVE_RIGHT), 6);
    close(player(run).x, 70, "player x (5 frames of 0.1s at 140 px/s)");
    assert.equal(player(run).y, 0);
    const at = onScreen(run, player(run).x, player(run).y);
    close(at.x, 320, "the player stays at the middle of the screen");
    close(at.y, 180, "...vertically too");
    const spikesAt = onScreen(run, 84, 10);
    close(spikesAt.x, 84 + 320 - 70, "the rest of the world slides the other way");
    assert.deepEqual([button(run).x, button(run).y], [16, 40], "the HUD's button stays where it is put");
  });

  it("moves with WASD and diagonally, and stops when the keys are released", () => {
    const run = play([{ dt: 0.1, down: ["D", "S"] }, { dt: 0.1, down: ["D", "S"] }, IDLE, IDLE], 5);
    close(player(run).x, 28, "x");
    close(player(run).y, 28, "y");
    const left = play([{ dt: 0.1, down: ["A", "W"] }], 2);
    close(player(left).x, -14, "left");
    close(player(left).y, -14, "up");
  });

  it("does not move while nothing is held, however long it runs", () => {
    const run = play([], 60);
    assert.equal(player(run).x, 0);
    assert.equal(player(run).y, 0);
  });
});

describe("demo: the button", () => {
  const press = (x: number, y: number): InputFrame => ({ dt: 0.1, mouse: { x, y }, pressed: ["MouseLeft"] });

  it("counts clicks, plays the sound each time, and turns green at three", () => {
    // The button is in the HUD at (16, 40) in window pixels, 96×32: below the coin count (16 high) and a gap of 8.
    const run = play([press(30, 50), IDLE, press(60, 60), IDLE, press(100, 70)], 6);
    assert.deepEqual(texts(run), ["Clicks: 3"]);
    assert.deepEqual(run.backend.plays, ["assets/click.wav", "assets/click.wav", "assets/click.wav"]);
    assert.equal(button(run).color, "#2e8b57ff", "seagreen from the third click");
  });

  it("is still grey after two clicks", () => {
    const run = play([press(30, 50), IDLE, press(60, 60)], 4);
    assert.deepEqual(texts(run), ["Clicks: 2"]);
    assert.equal(button(run).color, "#708090ff");
  });

  it("ignores a click beside the button, a held button, and the right button", () => {
    const run = play([press(100, 100), { dt: 0.1, mouse: { x: 30, y: 50 }, down: ["MouseLeft"] }, { dt: 0.1, mouse: { x: 30, y: 50 }, pressed: ["MouseRight"] }], 4);
    assert.deepEqual(texts(run), ["Clicks: 0"]);
    assert.deepEqual(run.backend.plays, []);
  });

  it("stays where it is drawn while the camera follows the player away", () => {
    const stopped = Array.from({ length: 10 }, () => MOVE_RIGHT);
    // Walk right for a second, stop, then click where the button would be in the world (misses), then on the HUD (hits).
    const walked = play([...stopped, IDLE, IDLE], 13);
    assert.deepEqual([button(walked).x, button(walked).y], [16, 40], "the button did not move on the screen");
    assert.ok(player(walked).x > 100, "the player walked");
    const run = play([...stopped, IDLE, IDLE, press(410, 150), IDLE, press(30, 50), IDLE], 17);
    assert.deepEqual(texts(run), ["Clicks: 1"], "only the click on the drawn button counts");
    assert.deepEqual(run.backend.plays, ["assets/click.wav"]);
  });
});

describe("demo: collisions", () => {
  const LEFT: InputFrame = { dt: 0.1, down: ["ArrowLeft"] };
  // Each MOVE_RIGHT frame moves the player 14 px, starting with the first step. The coin is at x 60 and the spikes
  // at x 84 (the player is 24 wide), so the player touches the coin from x 42 and the spikes from x 70.

  it("picks up the coin on touching it, and only once", () => {
    const before = play([MOVE_RIGHT, MOVE_RIGHT], 3); // x = 28: short of the coin
    assert.ok(coin(before), "the coin is there");
    assert.deepEqual(coinsText(before), ["Coins: 0"]);
    const run = play([MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, IDLE, IDLE], 5); // x = 42 touches it
    assert.equal(coin(run), undefined, "the coin vanished");
    assert.deepEqual(coinsText(run), ["Coins: 1"]);
    close(player(run).x, 42, "the player stopped at the coin");
    assert.equal(player(run).color, "#ffd700ff", "and is not hurt by it");
  });

  it("turns the player red while it overlaps the spikes, and back when it leaves", () => {
    const onto = play([MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, IDLE, IDLE], 7); // x = 70: over the spikes
    assert.equal(player(onto).color, "#ff6347ff", "tomato");
    const off = play([MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, LEFT, LEFT, LEFT, LEFT, LEFT, IDLE], 11); // back to x = 0
    close(player(off).x, 0, "walked back");
    assert.equal(player(off).color, "#ffd700ff", "gold again, once the exit event fired");
    assert.deepEqual(coinsText(off), ["Coins: 1"], "the coin was collected on the way, and not again on the way back");
  });
});

describe("demo: the beacon", () => {
  it("cycles its frames and shows the magenta placeholder for the missing one, warning once", () => {
    // 4 fps is a frame every 0.25s; the player gives each step 0.1s (a longer step is clamped, see MAX_DT), so a
    // frame lasts 2.5 steps: the first step has dt 0, the second 0.1, and so on.
    const backend = new RecordingBackend({ missingTextures: ["assets/beacon-gone.png"] });
    const warnings: string[] = [];
    for (let i = 0; i < 9; i++) backend.queueInput({ dt: 0.1 });
    const p = createPlayer(backend, { ...gameConfig, warn: (m) => warnings.push(m) });
    const shown: unknown[] = [];
    for (let i = 0; i < 9; i++) {
      p.step();
      const r = backend.lastFrame.records[6] as DecodedRecord;
      shown.push(r.op === "sprite" ? r.texture : r.op === "rect" ? `${r.color} ${r.width}x${r.height} at ${r.x},${r.y}` : r.op);
    }
    p.close();
    const gone = "#ff00ffff 16x16 at -120,-60";
    assert.deepEqual(shown, ["assets/beacon-1.png", "assets/beacon-1.png", "assets/beacon-1.png", "assets/beacon-2.png", "assets/beacon-2.png", gone, gone, gone, "assets/beacon-1.png"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /beacon-gone\.png/);
  });
});

describe("demo: a minute of play", () => {
  it("runs 60 idle frames, keeping every element drawn and warning only about the missing frame", () => {
    const run = play([], 60);
    assert.equal(run.backend.frames.length, 60);
    for (const frame of run.backend.frames) assert.equal(frame.records.length, 14);
    assert.equal(run.warnings.length, 1);
    assert.match(run.warnings[0] as string, /beacon-gone/);
  });
});

/**
 * The same game through the real library, on whatever build is available (the software renderer when
 * it is the headless one): 60 frames, then colours at known pixels. Skipped when `librge` is not built,
 * unless RGE_REQUIRE_NATIVE=1 (CI).
 */
const library = findNativeLibrary("headless");
const skip = library === null && process.env["RGE_REQUIRE_NATIVE"] !== "1" ? "librge is not built (npm run native:build:headless)" : false;

function pixel(frame: Pixels, x: number, y: number): string {
  const at = (y * frame.width + x) * 4;
  return [...frame.rgba.subarray(at, at + 4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

describe("demo: pixels from the real library", { skip }, () => {
  it("shows the ground, the button, the player and the beacon where the draw list says, after 60 frames", () => {
    const backend = createNodeBackend(library);
    const warnings: string[] = [];
    // The root's `<Game assets="assets">` is relative to the working directory, as it is when the game is run.
    const here = process.cwd();
    process.chdir(dirname(ASSETS));
    let frame: Pixels | null;
    try {
      const p = createPlayer(backend, { ...gameConfig, hidden: true, vsync: false, warn: (m) => warnings.push(m) });
      try {
        for (let i = 0; i < 60; i++) p.step();
        frame = backend.readPixels();
      } finally {
        p.close();
      }
    } finally {
      process.chdir(here);
    }
    assert.ok(frame !== null);
    assert.equal(frame.width, WINDOW.width);
    assert.equal(frame.height, WINDOW.height);
    assert.equal(pixel(frame, 5, 5), "10131cff", "background");
    assert.equal(pixel(frame, 100, 240), "2b3550ff", "a ground rect");
    assert.equal(pixel(frame, 308, 68), "3a2b50ff", "a ground circle");
    assert.equal(pixel(frame, 100, 68), "708090ff", "the button, below its label");
    assert.equal(pixel(frame, 332, 192), "ffd700ff", "the player, in the middle of the window");
    assert.equal(pixel(frame, 468, 308), "00aaaaff", "the plain sprite (teal) in the lower right");
    // The beacon is orange, teal or (on its missing frame) magenta, depending on how long 60 frames took.
    assert.ok(["ff8c00ff", "00aaaaff", "ff00ffff"].includes(pixel(frame, 208, 128)), `beacon pixel ${pixel(frame, 208, 128)}`);
    let white = 0;
    for (let y = 44; y < 68; y++) for (let x = 18; x < 112; x++) if (pixel(frame, x, y) === "ffffffff") white++;
    assert.ok(white > 10, `the label drew ${white} white pixels`);
    assert.ok(warnings.every((w) => /beacon-gone/.test(w)), `unexpected warnings: ${warnings.join("; ")}`);
  });
});
