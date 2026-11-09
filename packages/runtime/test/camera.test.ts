import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Camera, Entity, Sprite } from "../src/index.ts";

function close(actual: number, expected: number, what = ""): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what} ${actual} ≈ ${expected}`);
}

function viewOf(camera: Camera, x: number, y: number): [number, number] {
  const p = camera.worldToView(x, y);
  return [p.x, p.y];
}

describe("Camera view", () => {
  it("defaults to zoom 1 and, at the origin, leaves the world as it is", () => {
    const camera = new Camera();
    assert.equal(camera.zoom, 1);
    assert.deepEqual(camera.viewTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, "plain zeros, not negative ones");
    assert.deepEqual(viewOf(camera, 5, 7), [5, 7]);
  });

  it("pans: the point the camera is at lands on the viewport centre", () => {
    const camera = new Camera();
    camera.transform.x = 100;
    camera.transform.y = 50;
    assert.deepEqual(viewOf(camera, 100, 50), [0, 0]);
    assert.deepEqual(viewOf(camera, 110, 50), [10, 0]);
    assert.deepEqual(viewOf(camera, 100, 40), [0, -10]);
  });

  it("moving the camera changes the view but no object's world transform", () => {
    const world = new Entity();
    const sprite = new Sprite({ image: "a.png" });
    sprite.transform.x = 30;
    world.addChild(sprite);
    const camera = new Camera();
    world.addChild(camera);
    const before = sprite.worldTransform();
    const viewBefore = viewOf(camera, 30, 0);
    camera.transform.x = 25;
    camera.zoom = 3;
    assert.deepEqual(sprite.worldTransform(), before);
    assert.notDeepEqual(viewOf(camera, 30, 0), viewBefore);
  });

  it("magnifies with zoom, about the camera's position", () => {
    const camera = new Camera({ zoom: 2 });
    assert.deepEqual(viewOf(camera, 10, 0), [20, 0]);
    camera.transform.x = 100;
    assert.deepEqual(viewOf(camera, 101, 0), [2, 0]);
  });

  it("turns the view the opposite way when the camera turns (clockwise on a y-down screen)", () => {
    const camera = new Camera();
    camera.transform.rotation = Math.PI / 2;
    const [x1, y1] = viewOf(camera, 10, 0);
    close(x1, 0);
    close(y1, -10, "a point to the right moves up");
    const [x2, y2] = viewOf(camera, 0, 10);
    close(x2, 10, "a point below moves right");
    close(y2, 0);
  });

  it("shows more of the world when the camera is scaled up, and zoom cancels it", () => {
    const camera = new Camera();
    camera.transform.scaleX = 2;
    camera.transform.scaleY = 2;
    assert.deepEqual(viewOf(camera, 10, 4), [5, 2]);
    camera.zoom = 2;
    assert.deepEqual(viewOf(camera, 10, 4), [10, 4]);
  });

  it("follows the entity it is in, by transform nesting", () => {
    const hero = new Entity();
    hero.transform.x = 100;
    const camera = new Camera();
    camera.transform.x = 10;
    hero.addChild(camera);
    assert.deepEqual(viewOf(camera, 110, 0), [0, 0]);
    hero.transform.x = 400;
    assert.deepEqual(viewOf(camera, 410, 0), [0, 0], "the hero moved, the view moved with it");
    hero.transform.rotation = Math.PI;
    const [x, y] = viewOf(camera, 390, 0);
    close(x, 0, "a rotated parent turns the view");
    close(y, 0);
  });

  it("ignores its parent when its transform is global", () => {
    const parent = new Entity();
    parent.transform.x = 500;
    const camera = new Camera();
    camera.transform.global = true;
    camera.transform.x = 20;
    parent.addChild(camera);
    assert.deepEqual(viewOf(camera, 20, 0), [0, 0]);
  });
});

describe("Camera children", () => {
  it("centres the view on its child and keeps it there as the child moves", () => {
    const camera = new Camera();
    const player = new Entity();
    player.transform.x = 300;
    player.transform.y = 200;
    camera.addChild(player);
    assert.deepEqual(viewOf(camera, 300, 200), [0, 0]);
    player.transform.x = 400;
    assert.deepEqual(viewOf(camera, 400, 200), [0, 0], "the view stays on the player after it moves");
    assert.deepEqual(viewOf(camera, 410, 200), [10, 0]);
  });

  it("does not move its children: they are placed in its parent's space, as if it were not there", () => {
    const camera = new Camera({ zoom: 3 });
    camera.transform.x = 500;
    camera.transform.rotation = 1;
    camera.transform.scaleX = 4;
    camera.placement.y = 70;
    const player = new Entity();
    player.transform.x = 10;
    camera.addChild(player);
    const at = player.worldTransform();
    assert.deepEqual([at.x, at.y, at.rotation, at.scaleX], [10, 0, 0, 1], "exactly its own transform");
  });

  it("places its children in the space of its parent, scale and rotation included", () => {
    const parent = new Entity();
    parent.transform.x = 100;
    parent.transform.scaleX = 2;
    parent.transform.scaleY = 2;
    const camera = new Camera();
    const player = new Entity();
    player.transform.x = 10;
    camera.addChild(player);
    parent.addChild(camera);
    assert.equal(player.worldTransform().x, 120, "100 + 10 × 2, as if the player were the parent's own child");
    assert.deepEqual(viewOf(camera, 120, 0), [0, 0]);
  });

  it("centres on the middle of several children", () => {
    const camera = new Camera();
    const [a, b, c] = [new Entity(), new Entity(), new Entity()];
    b.transform.x = 100;
    b.transform.y = 40;
    c.transform.x = 20;
    c.transform.y = 20;
    camera.addChild(a);
    camera.addChild(b);
    camera.addChild(c);
    const middle = camera.viewToWorld(0, 0);
    close(middle.x, 40);
    close(middle.y, 20);
  });

  it("is where it is, as before, with no children, and goes back when the last one leaves", () => {
    const camera = new Camera();
    camera.transform.x = 10;
    assert.deepEqual(viewOf(camera, 10, 0), [0, 0]);
    const player = new Entity();
    player.transform.x = 300;
    camera.addChild(player);
    assert.deepEqual(viewOf(camera, 310, 0), [0, 0], "its own x is an offset from the player now");
    camera.removeChild(player);
    assert.deepEqual(viewOf(camera, 10, 0), [0, 0]);
  });

  it("uses its own transform as an offset from the followed point", () => {
    const camera = new Camera();
    camera.transform.x = 5;
    camera.transform.y = -8;
    const player = new Entity();
    player.transform.x = 300;
    camera.addChild(player);
    assert.deepEqual(viewOf(camera, 305, -8), [0, 0]);
  });

  it("keeps the offset in its parent's space, so adding a child at the parent's own position changes nothing", () => {
    const parent = new Entity();
    parent.transform.x = 100;
    parent.transform.scaleX = 2;
    parent.transform.scaleY = 2;
    const camera = new Camera();
    camera.transform.x = 10; // 20 world units from the parent, because the parent is scaled
    parent.addChild(camera);
    assert.deepEqual(viewOf(camera, 120, 0), [0, 0], "no children: at the parent plus the scaled offset");
    const atParent = new Entity();
    camera.addChild(atParent);
    assert.deepEqual(viewOf(camera, 120, 0), [0, 0], "a child at the parent's position: the same view");
    atParent.transform.x = 200; // 400 world units on
    const [x, y] = viewOf(camera, 520, 0);
    close(x, 0, "following a child 400 away, with the same scaled offset");
    close(y, 0);
  });

  it("measures the offset of a global camera from the origin, while its children stay in its parent's space", () => {
    const parent = new Entity();
    parent.transform.x = 900;
    const camera = new Camera();
    camera.transform.global = true; // the camera's own transform ignores the parent...
    camera.transform.x = 5;
    parent.addChild(camera);
    const player = new Entity();
    player.transform.x = 300;
    camera.addChild(player);
    assert.equal(player.worldTransform().x, 1200, "...but its children are still placed in the parent's space");
    assert.deepEqual(viewOf(camera, 1205, 0), [0, 0], "the player at 1200, plus the camera's offset of 5");
  });

  it("keeps its own rotation and zoom while following", () => {
    const camera = new Camera({ zoom: 2 });
    const player = new Entity();
    player.transform.x = 100;
    camera.addChild(player);
    assert.deepEqual(viewOf(camera, 101, 0), [2, 0]);
    camera.transform.rotation = Math.PI / 2;
    const [x, y] = viewOf(camera, 100, 10);
    close(x, 20, "a point below the player is to the right, magnified");
    close(y, 0);
  });

  it("follows a grandchild's world position through its child, which is placed in the same space", () => {
    const camera = new Camera();
    const group = new Entity();
    group.transform.x = 50;
    const player = new Entity();
    player.transform.x = 25;
    group.addChild(player);
    camera.addChild(group);
    assert.deepEqual(viewOf(camera, 50, 0), [0, 0], "it follows its child, the group, not what is inside it");
  });

  it("is transparent through nested cameras", () => {
    const outer = new Camera();
    outer.transform.x = 7;
    const inner = new Camera();
    const player = new Entity();
    player.transform.x = 40;
    inner.addChild(player);
    outer.addChild(inner);
    assert.equal(player.worldTransform().x, 40);
  });

  it("leaves every other object placing its children in its own space", () => {
    const entity = new Entity();
    const child = new Entity();
    entity.transform.x = 9;
    entity.addChild(child);
    assert.equal(entity.childSpace().x, 9, "an ordinary object places its children in its own space");
    assert.equal(child.worldTransform().x, 9);
  });
});

describe("Camera conversions", () => {
  it("viewToWorld undoes worldToView, whatever the transform", () => {
    const camera = new Camera({ zoom: 1.5 });
    camera.transform.x = 40;
    camera.transform.y = -12;
    camera.transform.rotation = 0.7;
    camera.transform.scaleX = 2;
    camera.transform.scaleY = 0.5;
    for (const [x, y] of [[0, 0], [10, 20], [-33, 7], [100, -100]] as const) {
      const view = camera.worldToView(x, y);
      const back = camera.viewToWorld(view.x, view.y);
      close(back.x, x);
      close(back.y, y);
    }
  });

  it("turns a click at the viewport centre into the camera's position", () => {
    const camera = new Camera({ zoom: 4 });
    camera.transform.x = 70;
    camera.transform.y = 30;
    const p = camera.viewToWorld(0, 0);
    close(p.x, 70);
    close(p.y, 30);
  });
});

describe("Camera errors", () => {
  it("rejects a zoom that is not a positive number", () => {
    for (const zoom of [0, -1, NaN, Infinity]) {
      assert.throws(() => new Camera({ zoom }).viewTransform(), /zoom must be a positive number/, String(zoom));
    }
  });

  it("rejects a position, rotation or scale that is not finite, which would give a view of NaN", () => {
    for (const set of [
      (c: Camera) => (c.transform.x = NaN),
      (c: Camera) => (c.transform.y = Infinity),
      (c: Camera) => (c.transform.rotation = NaN),
      (c: Camera) => (c.transform.scaleX = Infinity),
      (c: Camera) => (c.transform.scaleY = NaN),
    ]) {
      const camera = new Camera();
      set(camera);
      assert.throws(() => camera.viewTransform(), /must be a finite number/);
    }
  });

  it("rejects a scale of 0, which would see nothing", () => {
    const camera = new Camera();
    camera.transform.scaleX = 0;
    assert.throws(() => camera.viewTransform(), /scale of 0/);
  });
});
