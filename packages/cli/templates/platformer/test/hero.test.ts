import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@tsengine/testing";

import { Hero } from "../generated/Hero.ts";

// One component, tested alone: mounted in a world with no window and nothing to stand on, stepped with an input script.

test("with nothing below it the hero falls, faster and faster up to its fastest fall", () => {
  const t = render(Hero, { startX: 0, startY: 0 });
  t.step(10);
  const early = t.root.transform.y;
  t.step(10);
  const later = t.root.transform.y;
  assert.ok(early > 0 && later - early > early, `it speeds up: ${early}, then ${later}`);
  t.step(120);
  const a = t.root.transform.y;
  t.step(60);
  assert.ok(Math.abs(t.root.transform.y - a - 400) <= 1, "a second at the fastest fall is 400 pixels");
});

test("holding right runs at its speed, which is a prop", () => {
  const t = render(Hero, { startX: 0, startY: 0, speed: 60 });
  t.input("ArrowRight*60");
  assert.equal(t.root.transform.x, 60);
});
