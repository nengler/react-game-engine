import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/** `useStore(store, read)`: a value from a store outside the game state, kept up to date (DESIGN.md, "`useStore`"). */
import { after, describe, it } from "node:test";

import { Entity, Text, World, keepIfEqual, sameData } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const STORE = `export interface View { music: number; muted: boolean }
type Listener = () => void;
const listeners = new Set<Listener>();
let values: View = { music: 5, muted: false };
export let reads = 0;
export const settings = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  set(next: View): void {
    values = next;
    for (const listener of [...listeners]) listener();
  },
  listening(): number {
    return listeners.size;
  },
};
export function view(): View {
  reads++;
  return { ...values };
}
`;

const PANEL = `import { settings, view } from "./store.ts";
export function Panel() {
  const values = useStore(settings, view);
  return <Entity><Text>{values.muted ? "muted" : \`music \${values.music}\`}</Text></Entity>;
}`;

interface Store {
  settings: { set(next: { music: number; muted: boolean }): void; listening(): number };
}

describe("useStore", () => {
  it("reads at mount, follows the store, renders only on new data, and stops listening when the component leaves", async () => {
    const compiled = compile(PANEL);
    // Generated code sits in its own folder and imports the source folder's modules from one level up.
    const storeFile = join(dirname(compiled.fileName), "..", "store.ts");
    mkdirSync(dirname(storeFile), { recursive: true });
    writeFileSync(storeFile, STORE);
    assert.deepEqual(typeCheck(compiled), []);
    const store = (await import(storeFile)) as Store;
    const { Panel } = await load<{ Panel: new () => Entity }>(compiled);

    const world = new World();
    const root = new Entity({});
    world.mount(root);
    const panel = new Panel();
    root.addChild(panel);
    world.flush();
    const text = (): string => (panel.children[0] as Text).text;
    assert.equal(text(), "music 5");
    assert.equal(store.settings.listening(), 1);

    // Count renders from here: a notification with the same data renders nothing.
    let renders = 0;
    const render = panel.render.bind(panel);
    panel.render = () => {
      renders++;
      render();
    };
    store.settings.set({ music: 5, muted: false });
    world.flush();
    assert.equal(renders, 0, "the same data: kept, not rendered");
    store.settings.set({ music: 3, muted: false });
    world.flush();
    assert.equal(text(), "music 3");
    assert.equal(renders, 1);
    store.settings.set({ music: 3, muted: true });
    world.flush();
    assert.equal(text(), "muted");

    root.removeChild(panel);
    world.flush();
    assert.equal(store.settings.listening(), 0, "the subscription ends with the component");
  });
});

describe("keepIfEqual and sameData", () => {
  it("compare data all the way down", () => {
    assert.ok(sameData({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] }));
    assert.ok(!sameData({ a: [1, 2] }, { a: [1, 2, 3] }));
    assert.ok(!sameData({ a: 1 }, { a: 1, b: undefined }));
    assert.ok(!sameData([1], { 0: 1 }));
    const previous = { music: 1 };
    assert.equal(keepIfEqual(previous, { music: 1 }), previous);
    assert.notEqual(keepIfEqual(previous, { music: 2 }), previous);
  });
});
