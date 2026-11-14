/**
 * `useMutable`: state written directly (`s.vx += 1`) and read back at once in a handler. Each field is an ordinary state slot underneath,
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

describe("useMutable: what a handler reads", () => {
  it("reads its own writes at once, where a setter's value would not show until the next step", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useMutable({ n: 0, big: false });
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
         const s = useMutable({ pressed: 0, seen: 0 });
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
         const s = useMutable({ n: 1, out: 0 });
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

  it("works out a destructured derived value live, from an object or an array", async () => {
    const hero = await run(
      `function split(n: number) { return { half: n / 2, twice: n * 2 }; }
       function pair(n: number): [number, number] { return [n + 1, n - 1]; }
       export function Hero() {
         const s = useMutable({ n: 2, half: 0, twice: 0, up: 0, down: 0 });
         const { half, twice } = split(s.n);
         const [up, down] = pair(s.n);
         useUpdate(() => {
           s.n = 10;
           s.half = half;
           s.twice = twice;
           s.up = up;
           s.down = down;
         });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.deepEqual(hero.s, { n: 10, half: 5, twice: 20, up: 11, down: 9 });
  });

  it("works out a render block's names live", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useMutable({ n: 2, big: false, total: 0 });
         let big = false;
         let total = 0;
         for (let i = 1; i <= s.n; i++) total += i;
         if (s.n > 5) big = true;
         useUpdate(() => {
           s.n = 10;
           s.big = big;
           s.total = total;
         });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.deepEqual(hero.s, { n: 10, big: true, total: 55 });
  });

  it("works a derived value out once until a field it reads is written, then again", async () => {
    const source = `function doubled(n: number) { return n * 2; }
       export function Hero() {
         const s = useMutable({ n: 1, a: 0, b: 0, c: 0 });
         const d = doubled(s.n);
         useUpdate(() => {
           s.a = d + d;
           s.n = 3;
           s.b = d;
           s.c = d;
         });
         return <Entity><Text>{d}</Text></Entity>;
       }`;
    const compiled = compile(source);
    // One memo of its own for handlers, keyed on the field's live value; render keeps its own, on the committed value.
    assert.match(compiled.code, /\$memo\("d@live", \[this\.#\$s_nNext\]/);
    assert.match(compiled.code, /\$memo\("d", \[this\.\$s_n\]/);
    const hero = await run(source, "Hero");
    assert.deepEqual(hero.s, { n: 3, a: 4, b: 6, c: 6 });
    assert.equal((hero.children[0] as Text).text, "6", "render works it out from the committed value");
  });

  it("shows render the committed value, after the step", async () => {
    const hero = await run(
      `export function Hero() {
         const s = useMutable({ n: 0 });
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
         const s = useMutable({ a: 1, b: 10, c: 3, d: 8, e: 7, f: 0 });
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
         const s = useMutable({ foes: [] as readonly Foe[], next: 1 });
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

  it("keeps the fields in hot state as `s.n`, which no state's own name can be", async () => {
    const hero = await run(`export function Hero() { const s = useMutable({ n: 0 }); useUpdate(() => { s.n += 1; }); return <Entity />; }`, "Hero", 2);
    assert.deepEqual(hero.saveHotState(), { "Hero.s.n": 2 });
  });
});

describe("useMutable: read whole, and handed back by a hook", () => {
  it("reads whole as a copy of its fields: live in a handler, and changing the copy leaves the fields alone", async () => {
    const hero = await run(
      `function total(p: { a: number; b: number }) { return p.a + p.b; }
       export function Hero() {
         const s = useMutable({ a: 1, b: 2, sum: 0 });
         useUpdate(() => {
           s.a = 10;
           s.sum = total(s);
           const copy = s;
           copy.b = 99;
         });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.deepEqual(hero.s, { a: 10, b: 2, sum: 12 });
  });

  it("is handed back by a custom hook's `return s`, and the caller reads and writes its fields under its own name", async () => {
    const source = `function useCounter(step: number) {
         const s = useMutable({ n: 0, ticks: 0 });
         useUpdate(() => {
           s.n += step;
           s.ticks++;
         });
         return s;
       }
       export function Hero() {
         const counter = useCounter(2);
         useUpdate(() => {
           if (counter.n > 3) counter.n = 0;
         });
         return <Entity><Text>{counter.n}</Text></Entity>;
       }`;
    const hero = await run(source, "Hero", 3);
    // 2, 4 (then back to 0 in the same step, the caller's update running after the hook's), 2.
    assert.deepEqual((hero as unknown as { counter: unknown }).counter, { n: 2, ticks: 3 });
    assert.deepEqual(hero.saveHotState(), { "Hero.counter.n": 2, "Hero.counter.ticks": 3 });
    assert.equal((hero.children[0] as Text).text, "2");
  });

  it("is what the shipped hooks hand back: a squash and a shake are written field by field", async () => {
    const compiled = compile(`export function Hero() {
      const squash = useSquash();
      const shake = useShake();
      useInput(() => {
        squash.x = 0.6;
        shake.strength = 3;
        shake.duration = 0.25;
        shake.elapsed = 0;
      });
      return <Camera shake={shake}><Sprite image="a.png" transform={{ scaleX: squash.x, scaleY: squash.y }} /></Camera>;
    }`);
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("useMutable: its name", () => {
  it("is kept apart from a member the root already has: `name` on an <Entity> root is read as the source writes it", async () => {
    const hero = await run(
      `export function Hero() {
         const name = useMutable({ n: 0 });
         useUpdate(() => { name.n += 1; });
         return <Entity />;
       }`,
      "Hero",
    );
    assert.equal(hero.name, "Hero", "the entity's own name is untouched");
    assert.deepEqual((hero as unknown as { $name: unknown }).$name, { n: 1 });
    assert.deepEqual(hero.saveHotState(), { "Hero.name.n": 1 });
  });

  it("is claimed before the elements are named: `enemy` beside an <Enemy> child leaves the child its own field", async () => {
    const compiled = compile(`
      function Enemy() { return <Entity />; }
      export function Wave() {
        const enemy = useMutable({ hp: 3 });
        useUpdate(() => { enemy.hp -= 1; });
        return <Entity><Enemy /></Entity>;
      }`);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /get enemy\(\)/);
    assert.match(compiled.code, /readonly enemy2: Enemy/);
  });

  it("is not guessed from a `$` in a name: a mutable called `a$b`, and a field called `x$y`, keep their names", async () => {
    const hero = await run(
      `export function Hero() {
        const a$b = useMutable({ x$y: 1 });
        const s = useMutable({ n: 0 });
        useUpdate(() => { a$b.x$y += 1; s.n = a$b.x$y; });
        return <Entity />;
      }`,
      "Hero",
    );
    assert.deepEqual(hero.saveHotState(), { "Hero.a$b.x$y": 2, "Hero.s.n": 2 });
    assert.deepEqual({ ...(hero as unknown as { a$b: object }).a$b }, { x$y: 2 });
  });
});

describe("useMutable: what it refuses", () => {
  const errors = (body: string, header = ""): string[] =>
    compileErrors(`${header}export function Hero() { ${body} return <Entity />; }`).map((d) => `${d.code}: ${d.message}`);

  it("a write in the component body, which runs on every render", () => {
    const [first] = errors("const s = useMutable({ n: 0 }); const m = s.n + 1; s.n = m;");
    assert.match(first ?? "", /cannot be written in the component body/);
  });

  it("a field it does not have, with the ones it does", () => {
    const [first] = errors("const s = useMutable({ speed: 0 }); useUpdate(() => { s.sped = 1; });");
    assert.match(first ?? "", /has no field 'sped' \(did you mean 'speed'\?\)/);
  });

  it("a write in useUnmount, where the component is going away", () => {
    const [first] = errors("const s = useMutable({ n: 0 }); useUnmount(() => { s.n = 1; });");
    assert.match(first ?? "", /cannot be written in `useUnmount`/);
  });

  it("an argument that is not an object literal of plain fields", () => {
    assert.match(errors("const init = { n: 0 }; const s = useMutable(init);")[0] ?? "", /one object literal/);
    assert.match(errors("const n = 1; const s = useMutable({ n });")[0] ?? "", /name: value/);
    assert.match(errors("const s = useMutable({});")[0] ?? "", /at least one field/);
  });

  it("a list changed in place, with the assignment to write instead", () => {
    const header = "interface Foe { id: number }\n";
    const push = errors("const s = useMutable({ enemies: [] as readonly Foe[] }); useUpdate(() => { s.enemies.push({ id: 1 }); });", header);
    assert.equal(push.length, 1);
    assert.match(push[0]!, /`push` changes `s\.enemies` in place/);
    assert.match(push[0]!, /`s\.enemies = \[\.\.\.s\.enemies, \{ id: 1 \}\]`/);
    const sort = errors("const s = useMutable({ enemies: [] as readonly Foe[] }); useUpdate(() => { s.enemies.sort((a, b) => a.id - b.id); });", header);
    assert.match(sort[0] ?? "", /`s\.enemies = s\.enemies\.toSorted\(…\)`/);
  });

  it("an array field with no type", () => {
    assert.match(errors("const s = useMutable({ list: [] });")[0] ?? "", /needs its type/);
  });
});
