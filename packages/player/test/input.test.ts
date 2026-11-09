import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Camera, Entity } from "@rge/runtime";
import { PlayerInput } from "../src/input.ts";
import { KEYS, RGE_IN_HEIGHT, RGE_IN_WIDTH } from "../src/protocol.ts";
import { RecordingBackend, type InputFrame } from "../src/recording.ts";
import { Warner } from "../src/warn.ts";

function close(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} ≈ ${expected}`);
}

/** An input that has been through one `frame` of a recording backend, as a player's would. */
function inputAfter(frame: InputFrame, warnings: string[] = []): PlayerInput {
  const backend = new RecordingBackend();
  backend.open({ width: 800, height: 600, title: "t" });
  backend.queueInput(frame);
  const input = new PlayerInput(new Warner((m) => warnings.push(m)));
  backend.frame(0, new Float64Array(0), 0, [], input.values, input.keys);
  return input;
}

describe("PlayerInput keys", () => {
  it("reports pressed, down and released from the keys buffer", () => {
    const input = inputAfter({ pressed: ["Space"], down: ["A"], released: ["B"] });
    assert.deepEqual([input.pressed("Space"), input.down("Space"), input.released("Space")], [true, true, false], "a pressed key is also down");
    assert.deepEqual([input.pressed("A"), input.down("A"), input.released("A")], [false, true, false], "held, not new");
    assert.deepEqual([input.pressed("B"), input.down("B"), input.released("B")], [false, false, true]);
    assert.equal(input.pressed("C"), false);
  });

  it("treats mouse buttons as keys", () => {
    const input = inputAfter({ pressed: ["MouseLeft"], down: ["MouseRight"] });
    assert.equal(input.pressed("MouseLeft"), true);
    assert.equal(input.down("MouseRight"), true);
    assert.equal(input.down("MouseMiddle"), false);
  });

  it("answers every known key name without warning", () => {
    const warnings: string[] = [];
    const input = inputAfter({}, warnings);
    for (const name of KEYS) input.pressed(name);
    assert.deepEqual(warnings, []);
  });

  it("returns false for an unknown key and warns once, listing the valid names", () => {
    const warnings: string[] = [];
    const input = inputAfter({ pressed: ["Space"] }, warnings);
    assert.equal(input.pressed("Spcae"), false);
    assert.equal(input.down("Spcae"), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /'Spcae'.*Space/);
    input.pressed("Other");
    assert.equal(warnings.length, 2, "a different name warns again");
  });
});

describe("PlayerInput window and mouse", () => {
  it("exposes the window size, dt, the screen mouse and quit", () => {
    const input = inputAfter({ dt: 0.25, mouse: { x: 12, y: 34 }, quit: true, width: 1024, height: 768 });
    assert.deepEqual([input.dt, input.screenX, input.screenY, input.width, input.height, input.quit], [0.25, 12, 34, 1024, 768, true]);
  });

  it("is the world position with no camera: the world origin is the window's top-left", () => {
    const input = inputAfter({ mouse: { x: 120, y: 80 } });
    assert.deepEqual([input.pointerX, input.pointerY], [120, 80]);
  });

  it("takes the mouse back through the view of the last frame", () => {
    const input = inputAfter({ mouse: { x: 420, y: 330 } });
    // The camera is at (100, 50) in an 800×600 window: world (100, 50) is drawn at (400, 300).
    input.view = { a: 1, b: 0, c: 0, d: 1, e: 300, f: 250 };
    assert.deepEqual([input.pointerX, input.pointerY], [120, 80]);
  });

  it("round-trips through a zoomed, rotated, moved camera", () => {
    const parent = new Entity();
    parent.transform.x = 15;
    const camera = new Camera({ zoom: 2.5 });
    camera.transform.x = 40;
    camera.transform.y = -20;
    camera.transform.rotation = 0.7;
    parent.addChild(camera);
    const v = camera.viewTransform();
    const view = { a: v.a, b: v.b, c: v.c, d: v.d, e: v.e + 400, f: v.f + 300 };
    for (const [x, y] of [[0, 0], [100, 50], [-30, 220], [12.5, -7.25]] as const) {
      const screen = camera.worldToView(x, y);
      const input = inputAfter({ mouse: { x: screen.x + 400, y: screen.y + 300 } });
      input.view = view;
      close(input.pointerX, x, `x for (${x}, ${y})`);
      close(input.pointerY, y, `y for (${x}, ${y})`);
    }
  });

  it("falls back to the screen point if the view cannot be inverted", () => {
    const input = inputAfter({ mouse: { x: 5, y: 6 } });
    input.view = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
    assert.deepEqual([input.pointerX, input.pointerY], [5, 6]);
  });

  it("starts with the window size unset until a backend writes it", () => {
    const input = new PlayerInput(new Warner(() => {}));
    assert.deepEqual([input.values[RGE_IN_WIDTH], input.values[RGE_IN_HEIGHT]], [0, 0]);
  });
});
