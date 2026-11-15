import assert from "node:assert/strict";
/**
 * Its own file, so it runs in a fresh process: the other layout tests give the passes many shapes of input, and a
 * deoptimised pass allocates numbers that the optimised one does not. This measures the steady state a game reaches.
 */
import { describe, it } from "node:test";

import { Flex, Shape, Text, type FlexProps, type GameObject } from "@tsengine/runtime";

import { Layouter, type MeasuredSize } from "../src/layout.ts";

const host = {
  measure(object: GameObject, out: MeasuredSize): boolean {
    if (object instanceof Shape) {
      out.width = object.width;
      out.height = object.height;
      return true;
    }
    if (object instanceof Text) {
      out.width = object.text.length * 10;
      out.height = object.size;
      return true;
    }
    return false;
  },
  warn(): void {},
};

const box = (width: number, height: number): Shape => new Shape({ kind: "rect", width, height });

function flex(props: FlexProps, ...children: GameObject[]): Flex {
  const f = new Flex(props);
  for (const child of children) f.addChild(child);
  return f;
}

describe("layout: allocation", () => {
  it("allocates nothing per box per frame: once warm, laying out a 50-box tree 20,000 times triggers no garbage collection", async () => {
    const { PerformanceObserver } = await import("node:perf_hooks");
    const rows: Flex[] = [];
    for (let r = 0; r < 10; r++) {
      const row = flex({ gap: 2, padding: 1, alignItems: "center", justifyContent: "space-between", width: "grow" });
      for (let c = 0; c < 4; c++)
        row.addChild(flex({ width: c % 2 === 0 ? "grow" : "fit", maxWidth: 80 }, box(10 + c, 4), new Text({ text: "abc", size: 8 })));
      rows.push(row);
    }
    const root = flex({ direction: "column", width: "grow", height: "grow", gap: 3 }, ...rows);
    const layouter = new Layouter(host);
    // Warm up: the first frames size the scratch arrays and compile the passes, which allocates; steady state must not.
    for (let i = 0; i < 20_000; i++) layouter.layout(root, 320, 180);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A collection can come from outside the layout (the test runner, a timer, a busy machine), so a pass is any of a few
    // attempts with none: an allocation per box per frame collects on every attempt, and still fails.
    const attempts: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const collections: unknown[] = [];
      const observer = new PerformanceObserver((list) => collections.push(...list.getEntries()));
      observer.observe({ entryTypes: ["gc"] });
      for (let i = 0; i < 20_000; i++) layouter.layout(root, 320, 180);
      await new Promise((resolve) => setTimeout(resolve, 20));
      collections.push(...observer.takeRecords());
      observer.disconnect();
      attempts.push(collections.length);
      if (collections.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(attempts.at(-1), 0, `garbage collections while laying out, per attempt: ${attempts.join(", ")}`);
  });
});
