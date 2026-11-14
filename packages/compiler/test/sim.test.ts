/**
 * `useSim`: state written directly (`s.vx += 1`) and read back at once in a handler. Each field is an ordinary state slot underneath,
 * so what a field is saved as, how it renders and what hot reload keeps are `useState`'s; what differs is the handler's view of it.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Text, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

/** Mount a compiled component with no props, tick it `steps` times and flush each, and give it back. */
async function run(source: string, name: string, steps = 1): Promise<Entity & { s: Record<string, unknown> }> {
  const compiled = compile(source);
  assert.deepEqual(typeCheck(compiled), []);
  const module = await load<Record<string, new () => Entity>>(compiled);
  const world = new World();
  const component = new module[name]!();
  world.mount(component);
  world.flush();
  for (let i = 0; i < steps; i++) {
    world.tick(1 / 60);
    world.flush();
  }
  return component as Entity & { s: Record<string, unknown> };
}

describe("useSim: what a handler reads", () => {
  it("reads its own writes at once, where a setter's value would not show until the next step", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useSim({ n: 0, big: false });
         useUpdate(() => {
           s.n += 5;
           if (s.n > 3) s.big = true;
         });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.deepEqual(hero.s, { n: 5, big: true });
  });

  it("sees what an earlier handler wrote in the same step: useInput, then useUpdate", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useSim({ pressed: 0, seen: 0 });
         useInput(() => {
           s.pressed = 1;
         });
         useUpdate(() => {
           s.seen = s.pressed;
         });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.deepEqual(hero.s, { pressed: 1, seen: 1 });
  });

  it("works out a derived value from the fields as they are now, not as render saw them", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useSim({ n: 1, out: 0 });
         const double = s.n * 2;
         useUpdate(() => {
           s.n = 10;
           s.out = double;
         });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.deepEqual(hero.s, { n: 10, out: 20 });
  });

  it("shows render the committed value, after the step", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useSim({ n: 0 });
         useUpdate(() => {
           s.n += 2;
         });
         return <Entity><Text>{s.n}</Text></Entity>;
       }`,
      "Hero",
      3,
    );
    assert.equal((hero.children[0] as Text).text, "6");
  });

  it("writes with =, the compound operators, ++ and --", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useSim({ a: 1, b: 10, c: 3, d: 8, e: 7, f: 0 });
         useUpdate(() => {
           s.a++;
           s.b -= 4;
           s.c *= 5;
           s.d /= 2;
           s.e--;
           s.f = s.a + s.b;
         });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.deepEqual(hero.s, { a: 2, b: 6, c: 15, d: 4, e: 6, f: 8 });
  });

  it("keeps lists, which are replaced as with useState, and takes a field's type from `as`", async () => {
    const hero = await run(
      `interface Foe { id: number }
       export function Hero() {
         const s = useSim({ foes: [] as readonly Foe[], next: 1 });
         useUpdate(() => {
           s.foes = [...s.foes, { id: s.next }];
           s.next += 1;
           s.foes = s.foes.filter((f) => f.id !== 2);
         });
         return <Entity />;
       }`,
      "Hero",
      3,
    );
    assert.deepEqual(hero.s, { foes: [{ id: 1 }, { id: 3 }], next: 4 });
  });

  it("keeps the fields in hot state, by name, as any state is", async () => {
    const hero = await run(`export function Hero() { const s = useSim({ n: 0 }); useUpdate(() => { s.n += 1; }); return <Entity />; }`, "Hero", 2);
    assert.deepEqual(hero.saveHotState(), { "Hero.s$n": 2 });
  });
});

describe("useSim: what it refuses", () => {
  const errors = (body: string, header = ""): string[] =>
    compileErrors(`${header}export function Hero() { ${body} return <Entity />; }`).map((d) => `${d.code}: ${d.message}`);

  it("a write in the component body, which runs on every render", () => {
    const [first] = errors("const s = useSim({ n: 0 }); const m = s.n + 1; s.n = m;");
    assert.match(first ?? "", /cannot be written in the component body/);
  });

  it("the value read whole, which would hand out a view the compiler cannot follow", () => {
    const [first] = errors("const s = useSim({ n: 0 }); useUpdate(() => { console.log(s); });");
    assert.match(first ?? "", /read a field/);
  });

  it("a field it does not have, with the ones it does", () => {
    const [first] = errors("const s = useSim({ speed: 0 }); useUpdate(() => { s.sped = 1; });");
    assert.match(first ?? "", /has no field 'sped' \(did you mean 'speed'\?\)/);
  });

  it("a write in useUnmount, where the component is going away", () => {
    const [first] = errors("const s = useSim({ n: 0 }); useUnmount(() => { s.n = 1; });");
    assert.match(first ?? "", /cannot be written in `useUnmount`/);
  });

  it("an argument that is not an object literal of plain fields", () => {
    assert.match(errors("const init = { n: 0 }; const s = useSim(init);")[0] ?? "", /one object literal/);
    assert.match(errors("const n = 1; const s = useSim({ n });")[0] ?? "", /name: value/);
    assert.match(errors("const s = useSim({});")[0] ?? "", /at least one field/);
  });

  it("an array field with no type", () => {
    assert.match(errors("const s = useSim({ list: [] });")[0] ?? "", /needs its type/);
  });
});
