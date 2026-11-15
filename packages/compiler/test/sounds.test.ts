/**
 * `useSound`. `const playHit = useSound("hit.wav")` binds a sound, and calling `playHit()` in a handler plays it. Playing is an
 * effect, not state: it happens at once and never renders. The mock `Sound` records plays. Sound stores (`createSounds`) are
 * in soundstores.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Collider, Entity, Sound, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const HERO = `
function Hero() {
  const s = useMutable({ hits: 0 });
  const playHit = useSound("hit.wav");
  const playDing = useSound("ding.wav");

  useUpdate((dt) => {
    if (s.hits >= 2) {
      playDing();
    }
  });

  return (
    <Entity name="Hero">
      <Collider
        width={10}
        height={10}
        onCollisionEnter={() => {
          playHit();
          s.hits += 1;
        }}
      />
    </Entity>
  );
}
`;

interface HeroInstance extends Entity {
  readonly hits: number;
  readonly playHit: Sound;
  readonly playDing: Sound;
  readonly collider: Collider;
  s: { [field: string]: unknown };
}
let Hero: new () => HeroInstance;

before(async () => {
  ({ Hero } = await load<{ Hero: typeof Hero }>(compile(HERO, "Hero.tsx")));
});

describe("useSound: IR and generated code", () => {
  const compiled = compile(HERO, "Hero.tsx");

  it("records each sound with its path, and the plays as statements", () => {
    const hero = compiled.ir.components[0]!;
    assert.deepEqual(
      hero.sounds.map((s) => [s.name, s.path]),
      [
        ["playHit", "hit.wav"],
        ["playDing", "ding.wav"],
      ]
    );
    assert.ok(JSON.stringify(hero).includes('"kind":"PlaySound"'));
  });

  it("makes a Sound field per binding, and plays through it", () => {
    assert.match(compiled.code, /import \{[^}]*\bSound\b[^}]*\} from "@tsengine\/runtime";/);
    assert.match(compiled.code, /readonly playHit: Sound = new Sound\("hit\.wav"\);/);
    assert.match(compiled.code, /this\.playHit\.play\(\);/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("has no Sound import in a component that uses none", () => {
    assert.doesNotMatch(compile(`function C() { return <Entity name="C" />; }`).code, /\bSound\b/);
  });
});

describe("useSound: runtime behaviour", () => {
  it("records a play for a call in a handler, immediately and without a render", () => {
    const world = new World();
    const hero = new Hero();
    world.mount(hero);
    world.reportCollision(hero.collider, new Collider({ width: 1, height: 1 }));
    assert.equal(hero.playHit.plays, 1, "played at once, before any flush");
    assert.equal(world.flush(), 1, "only the state change renders");
    assert.equal(hero.s.hits, 1);
  });

  it("keeps each sound's plays separate", () => {
    const world = new World();
    const hero = new Hero();
    world.mount(hero);
    world.reportCollision(hero.collider, new Collider({ width: 1, height: 1 }));
    world.reportCollision(hero.collider, new Collider({ width: 1, height: 1 }));
    world.flush();
    assert.deepEqual([hero.playHit.plays, hero.playDing.plays], [2, 0]);
    world.tick(0.016);
    assert.deepEqual([hero.playHit.plays, hero.playDing.plays], [2, 1], "plays from useUpdate too");
    assert.equal(hero.playHit.path, "hit.wav");
  });

  it("gives two bindings of the same path independent plays, and two instances their own", () => {
    const { Twin } = loadSync();
    const a = new Twin();
    const b = new Twin();
    assert.notEqual(a.first, a.second);
    a.first.play();
    assert.deepEqual([a.first.plays, a.second.plays, b.first.plays], [1, 0, 0]);
  });
});

function loadSync(): { Twin: new () => { first: Sound; second: Sound } } {
  return twin;
}
let twin: { Twin: new () => { first: Sound; second: Sound } };
before(async () => {
  twin = await load(
    compile(
      `function Twin() { const first = useSound("a.wav"); const second = useSound("a.wav"); return <Entity name="T" />; }`,
      "Twin.tsx"
    )
  );
});

describe("useSound: diagnostics", () => {
  const codes = (body: string, extra = "") =>
    compileErrors(`function C() { const play = useSound("a.wav"); ${extra} return <Entity name="C">${body}</Entity>; }`).map((d) => d.code);

  it("rejects a call in JSX, a derived value, or an expression", () => {
    assert.deepEqual(codes(`<Collider width={play()} height={1} />`), [DiagnosticCode.SoundOutsideHandler]);
    assert.deepEqual(codes(``, `const x = play();`), [DiagnosticCode.SoundOutsideHandler]);
    assert.deepEqual(
      codes(`<Collider width={1} height={1} onCollisionEnter={() => { const x = play(); }} />`),
      [DiagnosticCode.SoundOutsideHandler],
      "a call that is not a statement"
    );
  });

  it("rejects using the function as a value", () => {
    assert.deepEqual(codes(`<Collider width={1} height={1} onCollisionEnter={play} />`), [DiagnosticCode.SoundOutsideHandler]);
  });

  it("reports a call with more than the volume as an unsupported statement", () => {
    assert.deepEqual(codes(`<Collider width={1} height={1} onCollisionEnter={() => play(1, 2)} />`), [DiagnosticCode.UnsupportedStatement]);
  });

  it("keeps the runtime's Sound class name for itself", () => {
    assert.deepEqual(
      compileErrors(`function Sound() { return <Entity name="S" />; }`).map((d) => d.code),
      [DiagnosticCode.DuplicateComponent]
    );
  });

  it("requires one string literal path", () => {
    for (const call of [`useSound()`, `useSound(path)`, `useSound("a", "b")`, "useSound(`a${1}`)", `useSound(3)`]) {
      assert.deepEqual(
        compileErrors(`function C() { const path = "x"; const play = ${call}; return <Entity name="C" />; }`).map((d) => d.code),
        [DiagnosticCode.InvalidUseSound],
        call
      );
    }
  });

  it("rejects a name that is taken, and a binding that is not a plain const", () => {
    assert.deepEqual(
      compileErrors(
        `function C() { const play = useMutable({ n: 0 }); const play2 = useSound("a.wav"); const play = useSound("b.wav"); return <Entity name="C" />; }`
      ).length > 0,
      true
    );
    assert.deepEqual(
      compileErrors(`function C() { let play = useSound("a.wav"); return <Entity name="C" />; }`).map((d) => d.code),
      [DiagnosticCode.InvalidUseSound]
    );
  });

  it("is only valid at the top level, and must be imported", () => {
    assert.ok(
      compileErrors(`function C() { useUpdate(() => { const p = useSound("a.wav"); }); return <Entity name="C" />; }`).some(
        (d) => d.code === DiagnosticCode.HookNotAtTopLevel
      )
    );
    const result = getCompiler().compile(
      "C.tsx",
      `import { Entity } from "@tsengine/runtime/jsx";\nfunction C() { const play = useSound("a.wav"); return <Entity name="C" />; }`
    );
    assert.deepEqual(
      result.diagnostics.map((d) => d.code),
      [DiagnosticCode.MissingImport]
    );
  });

  it("can be called in a nested if, and in useMount", () => {
    const compiled = compile(
      `function C() { const play = useSound("a.wav"); useMount(() => { if (true) { play(); } }); return <Entity name="C" />; }`
    );
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("useSound: authored source type-checks", () => {
  const check = (body: string) =>
    getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/M15${Math.random()}.tsx`,
        text: `import { Entity, useSound } from "@tsengine/runtime/jsx";\nfunction C() { ${body} return <Entity name="C" />; }`,
      },
    ]);

  it("accepts a path and a call without arguments", () => {
    assert.deepEqual(check(`const play = useSound("a.wav"); play();`), []);
  });

  it("rejects a non-string path, and a volume that is not a number", () => {
    assert.ok(check(`const play = useSound(3);`).length > 0);
    assert.deepEqual(check(`const play = useSound("a.wav"); play(0.5);`), [], "a volume is fine");
    assert.ok(check(`const play = useSound("a.wav"); play("loud");`).length > 0);
    assert.ok(check(`const play = useSound("a.wav"); play(1, 2);`).length > 0);
  });
});
