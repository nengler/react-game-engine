/**
 * Finds a replay that finishes a room: a search over the rules' own `stepRun`, in short bursts of held buttons, from the
 * room's start to its exit. The replays in `test/replays.ts` came from this and are checked by the tests; run it again
 * after changing a room or the movement constants.
 *
 *   node packages/kite/tools/solve.ts 3        (room number, 1-based)
 *   node packages/kite/tools/solve.ts all
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInputScript } from "@rge/player";
import { NO_CONTROLS, type Controls } from "../src/rules/body.ts";
import { newRun } from "../src/rules/level.ts";
import { playFrame, startPlayback, type Playback } from "../src/rules/playback.ts";
import { TRANSITION_TIME } from "../src/rules/constants.ts";
import { overlapsRect, ROOM_LIST } from "../src/rules/rooms.ts";

/** Rooms that teach running and jumping: found without the dash, so the replay shows the intended way. */
const NO_DASH = new Set([1, 2]);
const DT = 1 / 60;
/** Fixed steps the world waits after a room exit: the transition time, rounded up, and one more. */
const WAIT = Math.ceil(TRANSITION_TIME / DT) + 1;
const BURST = 4;

interface Burst {
  readonly h: -1 | 0 | 1;
  readonly v: -1 | 0 | 1;
  readonly jump: boolean;
  readonly dash: boolean;
}

const BURSTS: Burst[] = [];
for (const h of [0, 1, -1] as const) for (const jump of [false, true]) {
  BURSTS.push({ h, v: 0, jump, dash: false });
  for (const v of [0, -1, 1] as const) BURSTS.push({ h, v, jump, dash: true });
}

interface Node {
  readonly run: Playback;
  readonly held: { jump: boolean };
  readonly parent: Node | null;
  readonly burst: Burst | null;
  readonly g: number;
}

function controlsFor(burst: Burst, frame: number, jumpWasHeld: boolean): Controls {
  return {
    ...NO_CONTROLS,
    left: burst.h < 0,
    right: burst.h > 0,
    up: burst.v < 0,
    down: burst.v > 0,
    jumpHeld: burst.jump,
    jumpPressed: burst.jump && frame === 0 && !jumpWasHeld,
    dashPressed: burst.dash && frame === 0,
  };
}

function key(play: Playback): string {
  const run = play.run;
  const b = run.player;
  return [Math.round(b.x / 2), Math.round(b.y / 2), Math.round(b.vx / 30), Math.round(b.vy / 30), b.onGround ? 1 : 0, b.dashes, b.varJump > 0 ? 1 : 0, b.dashing ? 1 : 0, b.forceMoveTime > 0 ? 1 : 0, b.coyote > 0 ? 1 : 0, b.ducking ? 1 : 0, b.autoJump ? 1 : 0, Math.round(b.wallSlideTimer * 2), b.dashCooldown > 0 ? 1 : 0, play.frozen].join(",");
}

/** Distance to the nearest exit tile: how promising a state looks. */
function heuristic(play: Playback, targets: [number, number][]): number {
  const b = play.run.player;
  let best = Infinity;
  for (const [c, r] of targets) best = Math.min(best, Math.abs(b.x - c * 10) + Math.abs(b.y - r * 10));
  return best;
}

/** What the search may use: `dash: false` finds a way through with running, jumping and walls alone. */
export interface Allowed {
  readonly dash: boolean;
}

class Heap<T> {
  readonly #items: T[] = [];
  readonly #score: (item: T) => number;
  constructor(score: (item: T) => number) {
    this.#score = score;
  }
  get size(): number {
    return this.#items.length;
  }
  push(item: T): void {
    const a = this.#items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#score(a[parent]!) <= this.#score(a[i]!)) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.#score(a[l]!) < this.#score(a[m]!)) m = l;
        if (r < a.length && this.#score(a[r]!) < this.#score(a[m]!)) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function solve(roomIndex: number, allow: Allowed = { dash: true }, limit = 600_000, from: Playback | null = null, goal: { x: number; y: number; w: number; h: number } | null = null): { script: string; end: Playback } | null {
  const allowed = allow.dash ? BURSTS : BURSTS.filter((b) => !b.dash);
  const room = ROOM_LIST[roomIndex]!;
  const targets: [number, number][] = [];
  if (goal !== null) targets.push([(goal.x + goal.w / 2) / 10, (goal.y + goal.h / 2) / 10]);
  else room.rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "E" && targets.push([c, r])));
  const start: Playback = from ?? startPlayback({ ...newRun(), room: roomIndex, originX: room.ox, originY: room.oy, player: { ...newRun().player, x: room.spawnX, y: room.spawnY } });
  const open: Node[] = [{ run: start, held: { jump: false }, parent: null, burst: null, g: 0 }];
  const seen = new Set<string>([key(start)]);
  const scoreOf = (n: Node): number => n.g * 1.0 + heuristic(n.run, targets) * 2;
  const heap = new Heap<Node>(scoreOf);
  heap.push(open[0]!);
  let expanded = 0;
  while (heap.size > 0 && expanded < limit) {
    const node = heap.pop()!;
    expanded++;
    for (const burst of allowed) {
      let run = node.run;
      let ok = true;
      for (let f = 0; f < BURST; f++) {
        run = playFrame(run, controlsFor(burst, f, node.held.jump), DT);
        if (run.run.dead) { ok = false; break; }
        if (goal !== null && overlapsRect(run.run.player.x, run.run.player.y, goal)) return finish({ run, held: { jump: burst.jump }, parent: node, burst, g: node.g + BURST }, start);
        if (goal === null && (run.run.room !== roomIndex || run.run.finished)) break;
      }
      if (!ok) continue;
      const child: Node = { run, held: { jump: burst.jump }, parent: node, burst, g: node.g + BURST };
      if (goal === null && (run.run.room !== roomIndex || run.run.finished)) return finish(child, start);
      const k = key(run);
      if (seen.has(k)) continue;
      seen.add(k);
      heap.push(child);
    }
  }
  return null;
}

/** The script for `node`, and the run it ends in once the room change's wait is over (where the next room's search starts). */
function finish(node: Node, start: Playback): { script: string; end: Playback } {
  const text = script(node);
  let run = start;
  for (const frame of parseInputScript(text, { bindings: BINDINGS })) run = playFrame(run, controlsOf(frame.down), DT);
  return { script: text, end: run };
}

const BINDINGS = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", jump: "Z", dash: "X" };

/** The buttons a replay frame holds, with the presses worked out from what was held the frame before. */
let previousDown: readonly string[] = [];
function controlsOf(down: readonly string[]): Controls {
  const was = (k: string): boolean => previousDown.includes(k);
  const has = (k: string): boolean => down.includes(k);
  const c: Controls = { left: has("ArrowLeft"), right: has("ArrowRight"), up: has("ArrowUp"), down: has("ArrowDown"), jumpHeld: has("Z"), jumpPressed: has("Z") && !was("Z"), dashPressed: has("X") && !was("X"), grab: has("C") };
  previousDown = down;
  return c;
}

/** The bursts from the start to `node`, written as an input script (see `parseInputScript`). */
function script(node: Node): string {
  const bursts: Burst[] = [];
  for (let n: Node | null = node; n !== null && n.burst !== null; n = n.parent) bursts.unshift(n.burst);
  const frames: string[] = [];
  let jumpWasHeld = false;
  for (const burst of bursts) {
    for (let f = 0; f < BURST; f++) {
      const c = controlsFor(burst, f, jumpWasHeld);
      const names = [c.left && "left", c.right && "right", c.up && "up", c.down && "down", c.jumpHeld && "jump", c.dashPressed && "dash"].filter(Boolean) as string[];
      frames.push(names.join("+") || "_");
    }
    jumpWasHeld = burst.jump;
  }
  // Run-length encode identical frames: `right+jump` four times is `right*4+jump*4`.
  const items: string[] = [];
  for (let i = 0; i < frames.length; ) {
    let j = i;
    while (j < frames.length && frames[j] === frames[i]) j++;
    const n = j - i;
    items.push(frames[i] === "_" ? (n === 1 ? "_" : `_*${n}`) : (frames[i] as string).split("+").map((name) => (n === 1 ? name : `${name}*${n}`)).join("+"));
    i = j;
  }
  return items.join(", ");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const found: string[] = [];
  let from: Playback | null = null;
  for (let i = 0; i < ROOM_LIST.length; i++) {
    const started = Date.now();
    previousDown = [];
    const result = solve(i, { dash: !NO_DASH.has(i + 1) }, i === 5 ? 3_000_000 : 600_000, from);
    console.log(`room ${i + 1} (${ROOM_LIST[i]!.name}): ${result === null ? "NO SOLUTION" : result.script} [${Date.now() - started} ms]`);
    if (result === null) {
      process.exitCode = 1;
      break;
    }
    // The wait while the camera slides, then the next room's search starts where this one left the body.
    found.push(i + 1 < ROOM_LIST.length ? `${result.script}, _*${WAIT}` : result.script);
    from = result.end;
    for (let w = 0; w < WAIT; w++) from = playFrame(from, NO_CONTROLS, DT);
  }
  if (write && process.exitCode !== 1) {
    const body = found.map((r, i) => `  // ${i + 1}. ${ROOM_LIST[i]!.name}\n  ${JSON.stringify(r)},`).join("\n");
    writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "../test/replays.ts"), `/**\n * One input script per room, played one after the other from the start of the game: each finishes its room from where the\n * one before left the character, and waits out the camera's slide. Found by \`tools/solve.ts\`, which writes this file;\n * \`test/rooms.test.ts\` plays them. Rooms 1 and 2 are found without the dash.\n */\nexport const REPLAYS: readonly string[] = [\n${body}\n];\n`);
    console.log("wrote test/replays.ts");
  }
}
