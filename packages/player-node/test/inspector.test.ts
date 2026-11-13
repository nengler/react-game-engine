/** The development inspector (REACT_FEEL_PLAN.md C4): `rge dev`'s page of the tree, a component's state and the game state. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World, createGameState } from "@rge/runtime";
import { createPlayer, RecordingBackend, Rewind } from "@rge/player";
import { startInspector } from "../src/inspector.ts";

/** A component as the compiler writes one, as far as the inspector looks: a `managed` class with state it saves and loads. */
class Enemy extends Entity {
  static readonly managed = true;
  hp = 3;
  override saveHotState(): Record<string, unknown> {
    return { "Enemy.hp": this.hp };
  }
  override loadHotState(saved: Record<string, unknown>): void {
    if (typeof saved["Enemy.hp"] === "number") this.hp = saved["Enemy.hp"];
  }
}

interface State {
  coins: number;
  player: { hp: number };
  collect: () => void;
}

/** Read server-sent events from the page's stream until `want` has a value for each name it asks for. */
async function events(url: string, until: (seen: Map<string, unknown>) => boolean): Promise<Map<string, unknown>> {
  const controller = new AbortController();
  const res = await fetch(`${url}events`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const seen = new Map<string, unknown>();
  let buffer = "";
  try {
    while (!until(seen)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event !== undefined && data !== undefined) seen.set(event, JSON.parse(data));
      }
    }
  } finally {
    controller.abort();
  }
  return seen;
}

const post = (url: string, path: string, data: unknown) => fetch(`${url}${path.slice(1)}`, { method: "POST", body: JSON.stringify(data) });

describe("the inspector", () => {
  it("serves its page, the tree by component, a selected component's state, and the game state with each action's changes; edits are logged as development-only", async () => {
    const world = new World();
    const root = new Entity({});
    const enemy = new Enemy({});
    root.addChild(enemy);
    world.mount(root);
    world.flush();
    const game = createGameState<State>()((set) => ({ coins: 0, player: { hp: 5 }, collect: () => set((s) => ({ coins: s.coins + 1 })) }));
    const stores = new Map([["/game/src/GameState.ts#useGame", game.store]]);
    const logged: string[] = [];
    const inspector = await startInspector({ root: () => root, stores: () => stores, log: (m) => logged.push(m) });
    try {
      const page = await (await fetch(inspector.url)).text();
      assert.match(page, /<title>rge inspector<\/title>/);

      const first = await events(inspector.url, (seen) => seen.has("tree") && seen.has("stores"));
      const tree = first.get("tree") as { children: { id: number; name: string; component: boolean }[] };
      const listed = tree.children[0]!;
      assert.deepEqual([listed.name, listed.component], ["Enemy", true]);

      await post(inspector.url, "/select", { id: listed.id });
      const selected = await events(inspector.url, (seen) => seen.get("object") !== undefined && seen.get("object") !== null);
      assert.deepEqual((selected.get("object") as { state: unknown }).state, { hp: 3 });

      assert.equal((await post(inspector.url, "/edit", { target: "state", id: listed.id, name: "hp", value: 9 })).status, 200);
      assert.equal(enemy.hp, 9);
      assert.equal((await post(inspector.url, "/edit", { target: "store", key: "/game/src/GameState.ts#useGame", path: "player.hp", value: 1 })).status, 200);
      assert.deepEqual(game.getState().player, { hp: 1 });
      assert.ok(logged.some((m) => /Enemy\.hp = 9 .*not input: a replay does not repeat it/.test(m)), logged.join("\n"));

      game.getState().collect();
      const after = await events(inspector.url, (seen) => seen.has("stores"));
      const history = (after.get("stores") as { history: { action: string; changes: unknown[] }[] }[])[0]!.history;
      assert.deepEqual(history.at(-1), { action: "collect", changes: [{ path: "coins", before: 0, after: 1 }] });
      assert.equal(history.at(-2)?.action, "setState", "the inspector's own edit");
    } finally {
      await inspector.close();
    }
  });

  it("shows rewind's timeline and drives it: pause, go to a frame, play on", async () => {
    const backend = new RecordingBackend();
    for (let i = 0; i < 90; i++) backend.queueInput({ dt: 1 / 60 });
    const config = { root: () => new Enemy({}), fixedStep: 60 };
    const rewind = new Rewind(backend, { config: () => config, stores: () => new Map() });
    const player = createPlayer(rewind.backend, config);
    rewind.attach(player);
    for (let i = 0; i < 90; i++) rewind.step();
    const inspector = await startInspector({ root: () => player.world.root.children[0] ?? null, stores: () => new Map(), rewind });
    try {
      const first = await events(inspector.url, (seen) => seen.has("rewind"));
      assert.deepEqual(first.get("rewind"), { paused: null, from: 0, to: 90, snapshots: [0, 60], divergence: null });
      assert.equal((await post(inspector.url, "/rewind", { action: "seek", frame: 70 })).status, 200);
      assert.equal(rewind.paused, 70);
      const paused = await events(inspector.url, (seen) => seen.has("rewind"));
      assert.equal((paused.get("rewind") as { paused: number }).paused, 70);
      await post(inspector.url, "/rewind", { action: "resume" });
      assert.equal(rewind.paused, null);
      assert.equal(rewind.range.to, 70);
    } finally {
      await inspector.close();
      player.close();
    }
  });
});
