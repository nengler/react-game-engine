/** Reading a running game: findComponent, findComponents and componentState, outside `render`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity } from "@rge/runtime";
import { createPlayer, RecordingBackend } from "@rge/player";
import { componentState, findComponent, findComponents } from "../src/index.ts";

/** A component as the compiler writes one, as far as these read: a class with state it saves. */
class Enemy extends Entity {
  static readonly managed = true;
  hp = 3;
  override saveHotState(): Record<string, unknown> {
    return { "Enemy.hp": this.hp, "Enemy.s.vx": 2 };
  }
}

class Field extends Entity {
  constructor() {
    super({ name: "field" });
    this.addChild(new Enemy({ name: "first" }));
    this.addChild(new Enemy({ name: "second" }));
  }
}

describe("finding components in a running game", () => {
  it("finds by class, class name or name, in the running game's tree by default, and reads state by source names", () => {
    const backend = new RecordingBackend();
    backend.queueInput({ dt: 1 / 60 });
    const player = createPlayer(backend, { root: () => new Field() });
    player.step();
    assert.equal(findComponents(Enemy).length, 2);
    assert.equal(findComponent(Enemy)?.name, "first");
    assert.equal(findComponent<Entity>("second")?.name, "second");
    assert.equal(findComponent<Entity>("Field")?.name, "field");
    assert.equal(findComponent("Nothing"), null);
    assert.deepEqual(componentState(findComponent(Enemy)!), { hp: 3, s: { vx: 2 } });
    const only = new Enemy({ name: "alone" });
    assert.deepEqual(findComponents(Enemy, only), [only], "or under a root given");
    player.close();
  });
});
