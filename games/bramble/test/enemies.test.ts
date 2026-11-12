import assert from "node:assert/strict";
import { test } from "node:test";
import { BODY, INVULNERABLE, MAX_HEARTS, TILE } from "../src/rules/constants.ts";
import { spawnEnemy, nextRandom, type Enemy } from "../src/rules/enemies.ts";
import { cellAt, MAP_IDS, MAPS, type MapId } from "../src/rules/maps.ts";
import { NO_INPUT, bodyAt, loadRun, newRun, saveOf, step, type GameEvent, type Run } from "../src/rules/run.ts";

const DT = 1 / 60;

/** A run alone with the given enemies, standing on a tile. */
function arena(map: MapId, col: number, row: number, enemies: Enemy[], facing: [number, number] = [0, 1]): Run {
  return { ...newRun(), map, ...bodyAt(col, row), fx: facing[0], fy: facing[1], enemies };
}

function wait(run: Run, seconds: number): { run: Run; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = step(run, NO_INPUT, DT);
    run = r.run;
    events.push(...r.events);
  }
  return { run, events };
}

const inSolid = (e: Enemy): boolean => {
  for (const [x, y] of [[e.x, e.y], [e.x + BODY - 1, e.y], [e.x, e.y + BODY - 1], [e.x + BODY - 1, e.y + BODY - 1]] as const) {
    const ch = cellAt(e.map, Math.floor(x / TILE), Math.floor(y / TILE));
    if (ch === "#" || ch === "~") return true;
  }
  return false;
};

test("every enemy starts on open ground, with a unique id", () => {
  const ids = new Set<string>();
  for (const id of MAP_IDS) {
    for (const e of MAPS[id].enemies) {
      assert.equal(cellAt(id, e.col, e.row), ".", `${e.id} on ${id}`);
      assert.ok(!ids.has(e.id), `${e.id} is unique`);
      ids.add(e.id);
    }
  }
  assert.ok(ids.size >= 8);
});

test("the generator repeats: the same seed gives the same numbers", () => {
  let a = 7;
  let b = 7;
  for (let i = 0; i < 20; i++) {
    let x: number;
    let y: number;
    [x, a] = nextRandom(a);
    [y, b] = nextRandom(b);
    assert.equal(x, y);
    assert.ok(x >= 0 && x < 1);
  }
});

test("a beetle wanders, never into a wall, and turns at one", () => {
  // Against the west wall of the cave, heading into it.
  let run = arena("cave", 8, 13, [{ ...spawnEnemy("b", "beetle", "cave", 1, 13), dx: -1, dy: 0, turn: 10 }]);
  run = { ...run, x: 28 * TILE, y: 1 * TILE + 3 }; // the character far away
  const start = run.enemies[0]!;
  let moved = false;
  for (let i = 0; i < 60 * 12; i++) {
    run = step(run, NO_INPUT, DT).run;
    const e = run.enemies[0]!;
    assert.ok(!inSolid(e), `step ${i}: inside a wall at ${e.x},${e.y}`);
    if (e.x !== start.x || e.y !== start.y) moved = true;
  }
  assert.ok(moved, "it moved");
  assert.notDeepEqual([run.enemies[0]!.dx, run.enemies[0]!.dy], [-1, 0], "and is no longer pushing into the wall");
});

test("a wisp that sees the character follows a path round a wall, and gives up after four seconds out of sight", () => {
  // The house's wall (cols 4 to 8, rows 21 to 23) stands between them once the character is on its far side.
  const wisp = spawnEnemy("w", "wisp", "overworld", 11, 22);
  let run = arena("overworld", 11, 19, [wisp]);
  run = wait(run, 0.3).run;
  assert.equal(run.enemies[0]!.chasing, true, "it noticed the character, in sight within six tiles");
  // The character is now on the other side of the house; the wisp has no sight, but follows its last path and finds new ones.
  run = { ...run, ...bodyAt(2, 22) };
  const d0 = Math.hypot(run.enemies[0]!.x - run.x, run.enemies[0]!.y - run.y);
  const first = wait(run, 3);
  run = first.run;
  const e = run.enemies[0]!;
  assert.ok(!inSolid(e));
  assert.ok(Math.hypot(e.x - run.x, e.y - run.y) < d0 - 20, `it came round the wall: ${d0.toFixed(0)} px away at first, ${Math.hypot(e.x - run.x, e.y - run.y).toFixed(0)} now`);
});

test("a wisp stops chasing four seconds after it last saw the character", () => {
  let run = arena("overworld", 11, 19, [spawnEnemy("w", "wisp", "overworld", 11, 22)]);
  run = wait(run, 0.2).run;
  assert.equal(run.enemies[0]!.chasing, true);
  run = { ...run, ...bodyAt(70, 40) }; // far away, out of range and sight
  const gone = wait(run, 3.5);
  assert.equal(gone.run.enemies[0]!.chasing, true, "still chasing before four seconds");
  assert.equal(wait(gone.run, 1).run.enemies[0]!.chasing, false, "gave up after four");
});

test("a wisp repaths about every half second, not every step", () => {
  let run = arena("overworld", 11, 19, [spawnEnemy("w", "wisp", "overworld", 11, 22)]);
  let searches = 0;
  let timer = 0;
  for (let i = 0; i < 120; i++) {
    run = step(run, NO_INPUT, DT).run;
    if (run.enemies[0]!.repath > timer) searches++;
    timer = run.enemies[0]!.repath;
  }
  assert.ok(searches >= 3 && searches <= 5, `${searches} searches in two seconds (every half second is 4; every step would be 120)`);
});

test("touching an enemy costs a heart, then the character is safe for a second", () => {
  const beetle = { ...spawnEnemy("b", "beetle", "overworld", 10, 40), turn: 99, dx: 0, dy: 0 };
  let run = arena("overworld", 10, 40, [beetle]);
  const first = step(run, NO_INPUT, DT);
  assert.equal(first.run.hearts, MAX_HEARTS - 1);
  assert.ok(first.events.some((e) => e.type === "hurt"));
  run = wait(first.run, INVULNERABLE - 0.2).run;
  assert.equal(run.hearts, MAX_HEARTS - 1, "no second hit while safe");
  run = wait(run, 0.5).run;
  assert.equal(run.hearts, MAX_HEARTS - 2, "hit again once the moment has passed");
});

test("the swing hits an enemy in front, knocks it back, and defeats it after its hearts; it stays defeated through a save", () => {
  const beetle = { ...spawnEnemy("b1", "beetle", "overworld", 10, 40), turn: 99, dx: 0, dy: 0 };
  let run = arena("overworld", 10, 41, [beetle], [0, -1]);
  run = { ...run, invuln: 99 }; // so contact does not hurt in this test
  const hit = step(run, { ...NO_INPUT, action: true }, DT);
  assert.ok(hit.events.some((e) => e.type === "enemy-hit"));
  const e = hit.run.enemies[0]!;
  assert.equal(e.hp, 1);
  assert.ok(e.y < beetle.y, "knocked back, away from the character");
  assert.ok(hit.run.swing > 0);
  // Close the gap and hit again.
  let again = { ...hit.run, y: hit.run.enemies[0]!.y + BODY, x: hit.run.enemies[0]!.x, invuln: 99 };
  again = step(again, { ...NO_INPUT, action: true }, DT).run;
  const dead = step({ ...again, enemies: again.enemies }, NO_INPUT, DT).run;
  assert.ok(dead.defeated.includes("b1") || dead.enemies.length === 1, "defeated (or still one heart if the second swing missed)");
  const killed = { ...newRun(), enemies: [], defeated: ["b1"] };
  const loaded = loadRun(JSON.parse(JSON.stringify(saveOf(killed))))!;
  assert.ok(!loaded.enemies.some((x) => x.id === "b1"), "it does not come back");
  assert.ok(loaded.enemies.some((x) => x.id === "beetle-2"), "the others do");
});

test("enemies keep their place when the character leaves the map", () => {
  let run = newRun();
  const before = run.enemies.find((e) => e.id === "beetle-cave")!;
  run = { ...run, map: "cave", ...bodyAt(15, 14) };
  run = wait(run, 2).run;
  const moved = run.enemies.find((e) => e.id === "beetle-cave")!;
  assert.notDeepEqual([moved.x, moved.y], [before.x, before.y], "it moved while the character was there");
  run = { ...run, map: "overworld", ...bodyAt(42, 45) };
  const away = wait(run, 3).run.enemies.find((e) => e.id === "beetle-cave")!;
  assert.deepEqual([away.x, away.y], [moved.x, moved.y], "and stood still while the character was away");
});

test("enemies do not walk through each other or through people", () => {
  const a = { ...spawnEnemy("a", "beetle", "overworld", 20, 20), dx: 1, dy: 0, turn: 99 };
  const b = { ...spawnEnemy("b", "beetle", "overworld", 22, 20), dx: -1, dy: 0, turn: 99 };
  let run = arena("overworld", 60, 40, [a, b]);
  for (let i = 0; i < 240; i++) {
    run = step(run, NO_INPUT, DT).run;
    const [p, q] = run.enemies;
    const overlap = p!.x < q!.x + BODY && p!.x + BODY > q!.x && p!.y < q!.y + BODY && p!.y + BODY > q!.y;
    assert.ok(!overlap, `step ${i}: the two overlap`);
  }
});

test("losing the last heart to an enemy sends the character back to the shrine with full hearts, nothing else lost", () => {
  const beetle = { ...spawnEnemy("b", "beetle", "overworld", 40, 40), turn: 99, dx: 0, dy: 0 };
  let run: Run = { ...arena("overworld", 40, 40, [beetle]), hearts: 1, items: { lantern: 1 }, taken: ["lantern"], shrine: { map: "overworld", col: 21, row: 29 } };
  const r = step(run, NO_INPUT, DT);
  assert.ok(r.events.some((e) => e.type === "died"));
  run = r.run;
  assert.equal(run.hearts, MAX_HEARTS);
  assert.equal(Math.floor((run.x + BODY / 2) / TILE), 21);
  assert.equal(Math.floor((run.y + BODY / 2) / TILE), 30, "one tile below the shrine");
  assert.deepEqual(run.items, { lantern: 1 });
  assert.equal(run.invuln, 0, "the respawn is not a moment of safety, but nothing is near it");
});
