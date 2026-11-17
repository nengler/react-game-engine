import assert from "node:assert/strict";
/** The tree as text: `describeScene`, `sceneText` and `Rendered.describe`. */
import { describe, it } from "node:test";

import { Collider, Entity, Pointer, Sprite, Text } from "@tsengine/runtime";

import { describeScene, render, sceneText } from "../src/index.ts";

/** A component as the compiler writes one, as far as the description reads: a managed class named for itself, its props kept apart, with state it saves. */
class Enemy extends Entity<{ name?: string; hp: number; onDefeated?: () => void }> {
  static readonly managed = true;
  constructor(props: { name?: string; hp: number; onDefeated?: () => void }) {
    super({ name: "Enemy" }, props);
    this.transform.x = 10.04;
    this.transform.y = 20;
    this.addChild(new Sprite({ image: "enemy.png" }));
    const collider = new Collider({ width: 12, height: 14, tag: "enemy" });
    this.addChild(collider);
  }
  override saveHotState(): Record<string, unknown> {
    return { "Enemy.s.hp": this.props.hp, "Enemy.s.vx": 1.23456, "Enemy.path": [1, 2] };
  }
}

class Field extends Entity {
  static readonly managed = true;
  constructor() {
    super({ name: "Field" });
    const label = new Text({ text: "Gold 120" });
    label.transform.x = 8;
    label.transform.y = 8;
    this.addChild(label);
    this.addChild(new Enemy({ hp: 3, onDefeated: () => {} }));
  }
}

describe("describing a scene", () => {
  it("lists every object with its world position, texts, colliders, props and state", () => {
    const t = render(Field);
    const scene = describeScene(t.root);
    assert.equal(scene.name, "Field");
    assert.equal(scene.component, true);
    const enemy = scene.children[1]!;
    assert.equal(enemy.name, "Enemy");
    assert.equal(enemy.x, 10);
    assert.deepEqual(enemy.props, { hp: 3 }, "functions are left out");
    assert.deepEqual(enemy.state, { s: { hp: 3, vx: 1.23 }, path: [1, 2] }, "numbers are rounded");
    assert.equal(
      sceneText(scene),
      [
        "Field @(0,0)",
        '  Text "Gold 120" @(8,8)',
        "  Enemy @(10,20) hp=3 state={s: {hp: 3, vx: 1.23}, path: [1, 2]}",
        '    Sprite image="enemy.png"',
        '    Collider tag="enemy" 12×14',
      ].join("\n")
    );
  });

  it("lists only components and texts with only: components, and cuts at a depth or a number of objects", () => {
    const t = render(Field);
    assert.equal(
      t.describe({ only: "components", state: false, props: false }),
      ["Field @(0,0)", '  Text "Gold 120" @(8,8)', "  Enemy @(10,20)"].join("\n")
    );
    assert.equal(
      t.describe({ depth: 1, state: false, props: false }),
      ["Field @(0,0)", '  Text "Gold 120" @(8,8)', "  Enemy @(10,20)", "    … 2 more"].join("\n")
    );
    const few = describeScene(t.root, { maxNodes: 2 });
    assert.equal(few.children.length, 1);
    assert.equal(few.omitted, 3);
  });

  it("gives what can be clicked its size", () => {
    const holder = new Entity({ name: "Button" });
    holder.addChild(new Pointer({ width: 30, height: 12 }));
    assert.equal(sceneText(describeScene(holder)), ["Button @(0,0)", "  Pointer 30×12"].join("\n"));
  });

  it("describes the running game's tree when given no root, and says so when there is none", () => {
    render(Field);
    assert.equal(describeScene().name, "Field");
  });
});
