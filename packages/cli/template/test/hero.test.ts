import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@rge/testing";
import { Hero } from "../generated/Hero.ts";

// One component, tested alone, as React Testing Library tests one React component: mounted in a world with no window, stepped
// with an input script (the format of the game's replays), and its own state read back by the names in its source.

test("holding right moves the hero its speed in pixels a second, and letting go stops it", () => {
  const t = render(Hero, {});
  const start = t.state();
  t.input("ArrowRight*60");
  assert.equal(t.state().x, (start.x as number) + 120);
  assert.equal(t.state().y, start.y);
  t.step(30);
  assert.equal(t.state().x, (start.x as number) + 120, "no key held: it stays");
});

test("its speed is a prop", () => {
  const t = render(Hero, { speed: 30 });
  const start = t.state().y as number;
  t.input("ArrowDown*60");
  assert.equal(t.state().y, start + 30);
});
