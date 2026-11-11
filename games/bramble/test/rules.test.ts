import assert from "node:assert/strict";
import { test } from "node:test";
import { BODY, MAX_HEARTS, TILE } from "../src/rules/constants.ts";
import { MAPS, MAP_IDS, cellAt, findDoor, mapSize, type MapId } from "../src/rules/maps.ts";
import { NO_INPUT, bellsFound, bodyAt, carries, facingNpc, hurt, loadRun, newRun, npcState, pagesOf, saveOf, step, type GameEvent, type Input, type Run } from "../src/rules/run.ts";

const DT = 1 / 60;

/** Hold a direction for `seconds`; returns the run and every event. */
function walk(run: Run, dx: number, dy: number, seconds: number): { run: Run; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = step(run, { dx, dy, action: false }, DT);
    run = r.run;
    events.push(...r.events);
  }
  return { run, events };
}

const press = (run: Run): { run: Run; events: readonly GameEvent[] } => step(run, { ...NO_INPUT, action: true }, DT);

/** A run standing on a tile of a map, facing a way. */
function at(map: MapId, col: number, row: number, facing: [number, number] = [0, 1], from: Run = newRun()): Run {
  return { ...from, map, ...bodyAt(col, row), rx: 0, ry: 0, fx: facing[0], fy: facing[1] };
}

test("every map is a rectangle, walled round, with its objects on open ground", () => {
  for (const id of MAP_IDS) {
    const def = MAPS[id];
    const { cols, rows } = mapSize(id);
    assert.ok(def.rows.every((r) => r.length === cols), `${id}: rows are ${cols} wide`);
    for (const d of def.doors) assert.ok(cellAt(id, d.col, d.row) === "#" || cellAt(id, d.col, d.row) === ".", `${id}: door ${d.id}`);
    for (const p of def.pickups) assert.equal(cellAt(id, p.col, p.row), ".", `${id}: pickup ${p.id} is on open ground`);
    for (const n of def.npcs) assert.equal(cellAt(id, n.col, n.row), ".", `${id}: ${n.id} is on open ground`);
    for (const s of def.shrines) assert.equal(cellAt(id, s.col, s.row), ".", `${id}: ${s.id} is on open ground`);
    assert.equal(cellAt(id, 0, 0), "#");
    assert.equal(cellAt(id, cols - 1, rows - 1), "#");
  }
});

test("doors come in pairs: each leads to a door that leads back, and the arrival tile is open", () => {
  for (const id of MAP_IDS) {
    for (const d of MAPS[id].doors) {
      const there = findDoor(d.to.map, d.to.door);
      assert.deepEqual(there.to, { map: id, door: d.id }, `${id}/${d.id} and ${d.to.map}/${there.id} point at each other`);
      assert.equal(cellAt(id, d.col + d.out[0], d.row + d.out[1]), ".", `${id}/${d.id}: the tile outside it is open`);
    }
  }
});

test("walking: eight ways at one speed, stopped by walls and water, with no sub-pixel drift between runs", () => {
  const start = at("overworld", 20, 40);
  const east = walk(start, 1, 0, 1);
  const diag = walk(start, 1, 1, 1);
  assert.ok(Math.abs(east.run.x - start.x - 56) <= 1);
  const dist = Math.hypot(diag.run.x - start.x, diag.run.y - start.y);
  assert.ok(Math.abs(dist - 56) <= 1.5, `diagonal distance ${dist}`);
  // into the ridge across the valley (row 14) from below: stopped with the box against it
  const north = walk(at("overworld", 10, 34), 0, -1, 3);
  assert.equal(north.run.y, 33 * TILE);
  // into the pond
  const pond = walk(at("overworld", 13, 30), 0, -1, 3);
  assert.equal(pond.run.y, 29 * TILE);
  assert.equal(walk(start, 1, 0, 1).run.x, east.run.x, "same input, same place");
});

test("people are solid and the character faces where they last moved", () => {
  const start = at("overworld", 12, 43);
  const r = walk(start, 0, -1, 2);
  assert.equal(r.run.y, 42 * TILE, "stopped against the guide at (12, 41)");
  assert.deepEqual([r.run.fx, r.run.fy], [0, -1]);
  const turned = walk(r.run, 1, 0, 0.1).run;
  assert.deepEqual([turned.fx, turned.fy], [1, 0]);
});

test("talking: the action starts a conversation, pages advance, and the world waits meanwhile", () => {
  let run = walk(at("overworld", 12, 43), 0, -1, 1).run;
  assert.equal(facingNpc(run), "guide");
  let r = press(run);
  assert.deepEqual(r.events, [{ type: "talk", npc: "guide", page: 0 }]);
  run = r.run;
  const moved = walk(run, 1, 0, 1).run;
  assert.deepEqual([moved.x, moved.y], [run.x, run.y], "no walking during a conversation");
  r = press(run);
  assert.deepEqual(r.events, [{ type: "talk", npc: "guide", page: 1 }]);
  r = press(r.run);
  assert.deepEqual(r.events, [{ type: "talk-end", npc: "guide" }]);
  assert.equal(r.run.talk, null);
});

test("what people say changes once, when the bell nearest them is found", () => {
  const run = newRun();
  assert.equal(npcState(run, "guide"), 0);
  const found = { ...run, taken: ["bell-cave"] };
  assert.equal(npcState(found, "guide"), 1);
  assert.notDeepEqual(pagesOf(run, "guide"), pagesOf(found, "guide"));
  assert.equal(npcState(found, "keeper"), 0, "the gatekeeper waits for all three");
  assert.equal(npcState({ ...run, taken: ["bell-cave", "bell-house", "bell-maze"] }, "keeper"), 1);
});

test("items: walking onto one picks it up once and shows a notice", () => {
  const run = at("overworld", 8, 43, [1, 0]);
  const r = walk(run, 1, 0, 0.5);
  assert.deepEqual(r.events, [{ type: "pickup", item: "lantern", id: "lantern" }]);
  assert.ok(carries(r.run, "lantern"));
  assert.match(r.run.notice ?? "", /lantern/);
  const again = walk(r.run, -1, 0, 0.5);
  assert.deepEqual(again.events, [], "it is not picked up twice");
  assert.equal(r.run.items.lantern, 1);
});

test("doors: locked without the lantern or key, and they lead through when carried", () => {
  const cave = findDoor("overworld", "cave");
  const outside = at("overworld", cave.col, cave.row + 1, [0, -1]);
  const refused = walk(outside, 0, -1, 0.5);
  assert.ok(refused.events.some((e) => e.type === "locked" && e.needs === "lantern"));
  assert.equal(refused.run.map, "overworld");
  const lit = walk({ ...outside, items: { lantern: 1 } }, 0, -1, 0.5);
  assert.equal(lit.run.map, "cave");
  assert.ok(lit.events.some((e) => e.type === "door" && e.to === "cave"));
  // arrives one tile in from the cave's own door, facing in
  const exit = findDoor("cave", "cave-exit");
  const inRow = Math.floor((lit.run.y + BODY / 2) / TILE);
  assert.ok(inRow < exit.row && inRow >= exit.row - 3, `arrived just inside the cave (row ${inRow})`);
  // and back out
  const out = walk(lit.run, 0, 1, 1);
  assert.equal(out.run.map, "overworld");
  assert.equal(Math.floor((out.run.x + BODY / 2) / TILE), cave.col);
  assert.ok(Math.floor((out.run.y + BODY / 2) / TILE) > cave.row, "back outside the cave's door");
});

test("bushes block until cut with the shears", () => {
  const front = at("maze", 14, 4, [0, -1], { ...newRun(), items: {} });
  const blocked = walk(front, 0, -1, 1);

  assert.ok(blocked.run.y >= 4 * TILE, "stopped below the bush row");
  const without = press(blocked.run);
  assert.match(without.run.notice ?? "", /too thick/);
  const armed = { ...blocked.run, items: { shears: 1 } };
  const cut = press(armed);
  assert.deepEqual(cut.events, [{ type: "cut", col: 14, row: 3 }]);
  const through = walk(cut.run, 0, -1, 1);
  assert.ok(through.run.y < 3 * TILE, "walked through where the bush was");
});

test("shrines: touching one saves the place and refills the hearts; dying sends the character back to it", () => {
  const shrine = MAPS.overworld.shrines[1]!;
  let run = at("overworld", shrine.col, shrine.row + 2, [0, -1], { ...newRun(), hearts: 2 });
  const r = walk(run, 0, -1, 0.5);
  assert.ok(r.events.some((e) => e.type === "shrine" && e.id === "shrine-middle"));
  assert.equal(r.run.hearts, MAX_HEARTS);
  assert.deepEqual(r.run.shrine, { map: "overworld", col: shrine.col, row: shrine.row });
  run = { ...r.run, items: { lantern: 1 }, taken: ["lantern"] };
  const hit = hurt(run, 2);
  assert.equal(hit.run.hearts, MAX_HEARTS - 2);
  const dead = hurt(run, MAX_HEARTS);
  assert.deepEqual(dead.events, [{ type: "died" }]);
  assert.equal(dead.run.hearts, MAX_HEARTS);
  assert.equal(Math.floor((dead.run.x + BODY / 2) / TILE), shrine.col);
  assert.deepEqual(dead.run.items, { lantern: 1 }, "nothing else is lost");
});

test("the gate: closed with fewer than three bells, ends the game with three", () => {
  const gate = MAPS.overworld.gate!;
  const front = at("overworld", gate.col, gate.row + 1, [0, -1]);
  const shut = walk({ ...front, items: { bell: 2 } }, 0, -1, 0.5);
  assert.ok(shut.events.some((e) => e.type === "gate-locked"));
  assert.equal(shut.run.done, false);
  const open = walk({ ...front, items: { bell: 3 } }, 0, -1, 0.5);
  assert.ok(open.events.some((e) => e.type === "win"));
  assert.equal(open.run.done, true);
  assert.equal(bellsFound(open.run), 3);
});

test("a save holds a plain object with a version, and loads back to the shrine", () => {
  const run: Run = { ...newRun(), items: { lantern: 1, key: 1 }, taken: ["lantern", "key"], cut: ["maze:14,3"], time: 321, hearts: 1, shrine: { map: "overworld", col: 21, row: 11 } };
  const save = saveOf(run);
  assert.deepEqual(JSON.parse(JSON.stringify(save)), save, "plain data");
  const back = loadRun(JSON.parse(JSON.stringify(save)))!;
  assert.deepEqual([back.items, back.taken, back.cut, back.time, back.shrine], [run.items, run.taken, run.cut, run.time, run.shrine]);
  assert.equal(back.hearts, MAX_HEARTS);
  assert.equal(Math.floor((back.y + BODY / 2) / TILE), 12, "one tile below the shrine");
  assert.equal(loadRun({ ...save, version: 99 }), null);
  assert.equal(loadRun("nonsense"), null);
});

test("the game can be finished: a search through the world, with locks and bushes, reaches every bell and the gate", () => {
  // Reachability over (map, tile) with the items found so far, until nothing new opens up.
  const inv = new Set<string>();
  const seen = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const queue: [MapId, number, number][] = [["overworld", 6, 43]];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const [map, col, row] = queue.pop()!;
      const key = `${map}:${col},${row}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const def = MAPS[map];
      const ch = cellAt(map, col, row);
      if (def.gate !== undefined && def.gate.col === col && def.gate.row === row) {
        seen.add("gate");
        continue;
      }
      const door = def.doors.find((d) => d.col === col && d.row === row);
      if (door !== undefined) {
        if (door.needs !== undefined && !inv.has(door.needs)) continue;
        const there = findDoor(door.to.map, door.to.door);
        queue.push([door.to.map, there.col + there.out[0], there.row + there.out[1]]);
        continue;
      }
      if (ch === "#" || ch === "~") continue;
      if (ch === "b" && !inv.has("shears")) continue;
      if (def.npcs.some((n) => n.col === col && n.row === row)) continue;
      if (def.gate !== undefined && def.gate.col === col && def.gate.row === row) {
        seen.add("gate");
        continue;
      }
      for (const p of def.pickups) if (p.col === col && p.row === row && !inv.has(p.id)) (inv.add(p.id), (changed = true), inv.add(p.item));
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) queue.push([map, col + dc, row + dr]);
    }
  }
  for (const id of ["lantern", "key", "shears", "bell-cave", "bell-house", "bell-maze"]) assert.ok(inv.has(id), `${id} can be reached`);
  assert.ok(seen.has("gate"), "the gate can be reached");
});

test("input is plain data", () => {
  const input: Input = { dx: 0, dy: 0, action: false };
  assert.deepEqual(step(newRun(), input, DT).events, []);
});

test("a shrine saves when stepped onto, not every step the character stands on it", () => {
  const shrine = MAPS.overworld.shrines[0]!;
  const below = at("overworld", shrine.col, shrine.row + 1, [0, -1]);
  const onto = walk(below, 0, -1, 0.3);
  assert.equal(onto.events.filter((e) => e.type === "shrine").length, 1, "stepping onto the first shrine saves, even though it is already the last one touched");
  const shuffle = walk(onto.run, 0, -1, 0.2);
  assert.deepEqual(shuffle.events.filter((e) => e.type === "shrine"), [], "moving about on it does not save again");
  const away = walk(shuffle.run, 0, 1, 0.6);
  const back = walk(away.run, 0, -1, 0.6);
  assert.equal(back.events.filter((e) => e.type === "shrine").length, 1, "stepping off and on does");
});
