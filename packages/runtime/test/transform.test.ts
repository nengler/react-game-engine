import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Camera, Entity, GameObject, Screen, Shape, Sprite, Text, World } from "../src/index.ts";

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
}

describe("transform hierarchy", () => {
  it("is relative to the parent, whatever kind of object it is", () => {
    const world = new World();
    const parent = new Entity();
    parent.transform.x = 100;
    parent.transform.y = 20;
    const holder = new GameObject(); // identity transform: passes the parent's through
    const child = new Entity();
    child.transform.x = 10;
    world.mount(parent);
    parent.addChild(holder);
    holder.addChild(child);
    assert.deepEqual(child.worldTransform(), { x: 110, y: 20, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("applies the parent's scale and rotation to the child's position", () => {
    const parent = new Entity();
    parent.transform.x = 100;
    parent.transform.rotation = Math.PI / 2; // clockwise on a y-down screen: +x maps to +y
    parent.transform.scaleX = 2;
    parent.transform.scaleY = 2;
    const child = new Entity();
    child.transform.x = 10;
    child.transform.rotation = 0.5;
    child.transform.scaleX = 3;
    parent.addChild(child);
    const world = child.worldTransform();
    close(world.x, 100);
    close(world.y, 20);
    close(world.rotation, Math.PI / 2 + 0.5);
    assert.equal(world.scaleX, 6);
    assert.equal(world.scaleY, 2);
  });

  it("composes through several levels", () => {
    const [a, b, c] = [new Entity(), new Entity(), new Entity()];
    a.transform.x = 1;
    b.transform.x = 2;
    c.transform.x = 3;
    a.addChild(b);
    b.addChild(new Sprite({ image: "s" }));
    b.addChild(c);
    assert.equal(c.worldTransform().x, 6);
  });

  it("gives every built-in object a transform", () => {
    const parent = new Entity();
    parent.transform.x = 100;
    const sprite = new Sprite({ image: "s" });
    sprite.transform.x = 5;
    sprite.transform.scaleY = 2;
    parent.addChild(sprite);
    assert.deepEqual(sprite.worldTransform(), { x: 105, y: 0, rotation: 0, scaleX: 1, scaleY: 2 });
  });

  it("`global` ignores every ancestor, and its own children are relative to it", () => {
    const parent = new Entity();
    parent.transform.x = 100;
    const pinned = new Entity();
    pinned.transform.x = 5;
    pinned.transform.global = true;
    const grandchild = new Entity();
    grandchild.transform.x = 1;
    parent.addChild(pinned);
    pinned.addChild(grandchild);
    assert.equal(pinned.worldTransform().x, 5);
    assert.equal(grandchild.worldTransform().x, 6);
  });
});

describe("Text", () => {
  it("holds what a renderer draws, with defaults", () => {
    const plain = new Text({ text: "Score: 3" });
    assert.deepEqual([plain.text, plain.size, plain.color], ["Score: 3", 16, "white"]);
    const styled = new Text({ text: "x", size: 24, color: "red" });
    assert.deepEqual([styled.size, styled.color], [24, "red"]);
  });

  it("can be placed like any object", () => {
    const text = new Text({ text: "x" });
    text.transform.x = 8;
    text.transform.y = 4;
    assert.deepEqual([text.worldTransform().x, text.worldTransform().y], [8, 4]);
  });
});

describe("Shape", () => {
  it("holds what a renderer draws, with a default color", () => {
    const shape = new Shape({ kind: "circle", width: 10, height: 6 });
    assert.deepEqual([shape.kind, shape.width, shape.height, shape.color], ["circle", 10, 6, "white"]);
    assert.equal(new Shape({ kind: "rect", width: 1, height: 1, color: "red" }).color, "red");
  });

  it("follows its parent", () => {
    const parent = new Entity();
    parent.transform.x = 100;
    const shape = new Shape({ kind: "rect", width: 4, height: 4 });
    shape.transform.x = 10;
    parent.addChild(shape);
    assert.equal(shape.worldTransform().x, 110);
    parent.transform.x = 200;
    assert.equal(shape.worldTransform().x, 210);
  });
});

describe("layout offset", () => {
  it("is zero, and changes nothing, until layout writes it", () => {
    const child = new Entity();
    child.transform.x = 7;
    assert.deepEqual([child.layoutX, child.layoutY], [0, 0]);
    assert.deepEqual(child.worldTransform(), { x: 7, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("comes before placement and transform, in the parent's space: scaled and turned with the parent", () => {
    const parent = new Entity();
    parent.transform.x = 100;
    parent.transform.rotation = Math.PI / 2;
    parent.transform.scaleX = 2;
    parent.transform.scaleY = 2;
    const child = new Entity();
    child.layoutX = 10;
    child.placement.x = 1;
    child.transform.rotation = 0.25;
    parent.addChild(child);
    const at = child.worldTransform();
    // (10 + 1, 0) scaled by 2 and turned a quarter: (0, 22) from the parent.
    close(at.x, 100);
    close(at.y, 22);
    close(at.rotation, Math.PI / 2 + 0.25);
  });

  it("moves an object without moving its own transform, so a nudge stays relative to the slot", () => {
    const child = new Shape({ kind: "rect", width: 4, height: 4 });
    child.transform.y = -3;
    child.layoutX = 40;
    child.layoutY = 8;
    assert.deepEqual(child.worldTransform(), { x: 40, y: 5, rotation: 0, scaleX: 1, scaleY: 1 });
    assert.equal(child.transform.x, 0);
  });

  it("carries to the object's children", () => {
    const row = new Entity();
    row.layoutY = 12;
    const leaf = new Entity();
    leaf.transform.x = 3;
    row.addChild(leaf);
    assert.deepEqual(leaf.worldTransform(), { x: 3, y: 12, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("is ignored by a global placement or transform, like the parent", () => {
    const pinned = new Entity();
    pinned.layoutX = 50;
    pinned.placement.global = true;
    pinned.placement.x = 2;
    assert.equal(pinned.worldTransform().x, 2);
  });

  it("does not move a camera's children, which are placed as if the camera were not there", () => {
    const camera = new Camera();
    camera.layoutX = 30;
    const target = new Entity();
    target.transform.x = 5;
    camera.addChild(target);
    assert.equal(target.worldTransform().x, 5);
  });
});

describe("Screen", () => {
  it("holds the game's resolution, with defaults for the rest", () => {
    const screen = new Screen({ width: 320, height: 180 });
    assert.deepEqual([screen.width, screen.height, screen.fit, screen.pixelPerfect, screen.border], [320, 180, "integer", true, "black"]);
    const custom = new Screen({ width: 64, height: 64, fit: "stretch", pixelPerfect: false, border: "navy" });
    assert.deepEqual([custom.fit, custom.pixelPerfect, custom.border], ["stretch", false, "navy"]);
  });

  it("does not move its children: a game at (8, 8) is 8 game pixels in", () => {
    const screen = new Screen({ width: 320, height: 180 });
    const hud = new Entity();
    hud.transform.x = 8;
    hud.transform.y = 8;
    screen.addChild(hud);
    assert.deepEqual(hud.worldTransform(), { x: 8, y: 8, rotation: 0, scaleX: 1, scaleY: 1 });
  });
});
