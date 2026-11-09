import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlayer, RecordingBackend, type DecodedRecord, type InputFrame, type Player } from "@rge/player";
import { createNodeBackend, findNativeLibrary, type Pixels } from "@rge/player-node";
import { gameConfig } from "../game.ts";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
const WINDOW = { width: gameConfig.width, height: gameConfig.height };

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
      case "text": return ["text", r.text, r.x, r.y, r.size, r.color];
    }
  });
}

function close(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} ≈ ${expected}`);
}

const player = (run: Run): Rect => run.backend.lastFrame.records.filter((r): r is Rect => r.op === "rect" && r.color === "#ffd700ff").at(-1) as Rect;
const button = (run: Run): Rect => run.backend.lastFrame.records.find((r): r is Rect => r.op === "rect" && r.width === 96) as Rect;
const texts = (run: Run): string[] => run.backend.lastFrame.records.flatMap((r) => (r.op === "text" ? [r.text] : []));

/** Where a world point is on the screen in the last frame. */
function onScreen(run: Run, x: number, y: number): { x: number; y: number } {
  const v = run.backend.lastFrame.records[0];
  assert.ok(v?.op === "view");
  return { x: v.a * x + v.c * y + v.e, y: v.b * x + v.d * y + v.f };
}

const MOVE_RIGHT: InputFrame = { dt: 0.1, down: ["ArrowRight"] };
const IDLE: InputFrame = { dt: 0.1 };

describe("demo: the first frame", () => {
  it("draws the ground, the beacon, the button, its label and the player, in tree order, with the player in the middle", () => {
    const run = play([], 1);
    assert.deepEqual(summary(run.backend.lastFrame.records), [
      ["view", 320, 180],
      ["rect", -240, 40, 48, 48, "#2b3550ff"],
      ["rect", 200, 90, 64, 32, "#2b3550ff"],
      ["ellipse", -40, -140, 56, 56, "#3a2b50ff"],
      ["ellipse", 260, -70, 28, 28, "#3a2b50ff"],
      ["sprite", "assets/beacon-2.png", 140, 120],
      ["sprite", "assets/beacon-1.png", -120, -60],
      ["rect", 80, -40, 96, 32, "#708090ff"],
      ["text", "Clicks: 0", 92, -32, 16, "#ffffffff"],
      ["rect", 0, 0, 24, 24, "#ffd700ff"],
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
    const buttonAt = onScreen(run, 80, -40);
    close(buttonAt.x, 80 + 320 - 70, "the rest of the world slides the other way");
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
    // The button is at world (80, -40), 96×32; with the player in the middle of a 640×360 window it is at screen (400, 140).
    const run = play([press(410, 150), IDLE, press(450, 160), IDLE, press(490, 170)], 6);
    assert.deepEqual(texts(run), ["Clicks: 3"]);
    assert.deepEqual(run.backend.plays, ["assets/click.wav", "assets/click.wav", "assets/click.wav"]);
    assert.equal(button(run).color, "#2e8b57ff", "seagreen from the third click");
  });

  it("is still grey after two clicks", () => {
    const run = play([press(410, 150), IDLE, press(450, 160)], 4);
    assert.deepEqual(texts(run), ["Clicks: 2"]);
    assert.equal(button(run).color, "#708090ff");
  });

  it("ignores a click beside the button, a held button, and the right button", () => {
    const run = play([press(100, 100), { dt: 0.1, mouse: { x: 410, y: 150 }, down: ["MouseLeft"] }, { dt: 0.1, mouse: { x: 410, y: 150 }, pressed: ["MouseRight"] }], 4);
    assert.deepEqual(texts(run), ["Clicks: 0"]);
    assert.deepEqual(run.backend.plays, []);
  });

  it("is clicked where it is drawn after the camera has followed the player away", () => {
    const stopped = Array.from({ length: 10 }, () => MOVE_RIGHT);
    // Walk right for a second, stop, then click where the button used to be (misses), then where it is now (hits).
    const walked = play([...stopped, IDLE, IDLE], 13);
    const now = onScreen(walked, 80 + 48, -40 + 16); // the middle of the button
    close(now.x, 400 + 48 - player(walked).x, "the button moved left on the screen");
    const run = play([...stopped, IDLE, IDLE, press(410, 150), IDLE, press(now.x, now.y), IDLE], 17);
    assert.deepEqual(texts(run), ["Clicks: 1"], "only the click on the drawn button counts");
    assert.deepEqual(run.backend.plays, ["assets/click.wav"]);
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
    for (const frame of run.backend.frames) assert.equal(frame.records.length, 10);
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
    const p = createPlayer(backend, { ...gameConfig, assets: ASSETS, hidden: true, vsync: false, warn: (m) => warnings.push(m) });
    let frame: Pixels | null;
    try {
      for (let i = 0; i < 60; i++) p.step();
      frame = backend.readPixels();
    } finally {
      p.close();
    }
    assert.ok(frame !== null);
    assert.equal(frame.width, WINDOW.width);
    assert.equal(frame.height, WINDOW.height);
    assert.equal(pixel(frame, 5, 5), "10131cff", "background");
    assert.equal(pixel(frame, 100, 240), "2b3550ff", "a ground rect");
    assert.equal(pixel(frame, 308, 68), "3a2b50ff", "a ground circle");
    assert.equal(pixel(frame, 440, 170), "708090ff", "the button, below its label");
    assert.equal(pixel(frame, 332, 192), "ffd700ff", "the player, in the middle of the window");
    assert.equal(pixel(frame, 468, 308), "00aaaaff", "the plain sprite (teal) in the lower right");
    // The beacon is orange, teal or (on its missing frame) magenta, depending on how long 60 frames took.
    assert.ok(["ff8c00ff", "00aaaaff", "ff00ffff"].includes(pixel(frame, 208, 128)), `beacon pixel ${pixel(frame, 208, 128)}`);
    let white = 0;
    for (let y = 148; y < 164; y++) for (let x = 412; x < 496; x++) if (pixel(frame, x, y) === "ffffffff") white++;
    assert.ok(white > 10, `the label drew ${white} white pixels`);
    assert.ok(warnings.every((w) => /beacon-gone/.test(w)), `unexpected warnings: ${warnings.join("; ")}`);
  });
});
