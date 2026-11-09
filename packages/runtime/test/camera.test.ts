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

describe("Camera follow", () => {
  it("tracks a target set from code, with the camera's own x and y as an offset", () => {
    const target = new Entity();
    target.transform.x = 300;
    target.transform.y = 200;
    const camera = new Camera();
    camera.transform.x = 5;
    camera.follow = target;
    assert.deepEqual(viewOf(camera, 305, 200), [0, 0]);
    target.transform.x = 400;
    assert.deepEqual(viewOf(camera, 405, 200), [0, 0], "the view stays on the target after it moves");
  });

  it("uses the target's world position, wherever it is in the tree", () => {
    const outer = new Entity();
    outer.transform.x = 1000;
    const target = new Entity();
    target.transform.x = 50;
    outer.addChild(target);
    const camera = new Camera();
    camera.follow = target;
    assert.deepEqual(viewOf(camera, 1050, 0), [0, 0]);
  });

  it("goes back to its own position when the target is cleared", () => {
    const target = new Entity();
    target.transform.x = 300;
    const camera = new Camera();
    camera.transform.x = 10;
    camera.follow = target;
    camera.follow = null;
    assert.deepEqual(viewOf(camera, 10, 0), [0, 0]);
  });

  it("keeps the camera's own rotation and zoom while following", () => {
    const target = new Entity();
    target.transform.x = 100;
    const camera = new Camera({ zoom: 2 });
    camera.follow = target;
    assert.deepEqual(viewOf(camera, 101, 0), [2, 0]);
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

  it("rejects a scale of 0, which would see nothing", () => {
    const camera = new Camera();
    camera.transform.scaleX = 0;
    assert.throws(() => camera.viewTransform(), /scale of 0/);
  });
});
