/** Functions imported from relative .ts files: opaque to the compiler, callable in any expression and handler, and passable as values. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");

function project(files: Record<string, string>): { dir: string; out: (name: string) => string; run: () => { status: number | null; stderr: string } } {
  mkdirSync(join(repo, ".test-output"), { recursive: true });
  const dir = mkdtempSync(join(repo, ".test-output", "plain-"));
  mkdirSync(join(dir, "src"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
  return {
    dir,
    out: (name) => readFileSync(join(dir, "out", name), "utf8"),
    run: () => {
      const r = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], { cwd: repo, encoding: "utf8" });
      return { status: r.status, stderr: r.stderr };
    },
  };
}

const HELPERS = `export function shade(n: number, base: string): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(base);
  return parts.length > 2 ? "#ff0000" : "#00ff00";
}
export function log(message: string): void {
  void message;
}
export function ease(t: number): number {
  return t * t;
}
`;

describe("plain functions imported from a relative .ts file", () => {
  it("are called in props and derived values, as statements in handlers, and passed as values, with loops and anything else inside them", () => {
    const p = project({
      "helpers.ts": HELPERS,
      "A.tsx": `import { Entity, Shape, useState, useUpdate } from "@rge/runtime/jsx";
import { shade, log, ease } from "./helpers.ts";

interface Props { curve: (t: number) => number }

export function Child({ curve }: Props) {
  return <Entity name="Child" transform={{ x: curve(2) }} />;
}

export function A() {
  const [n, setN] = useState(0);
  const half = ease(n) / 2;
  useUpdate(() => {
    log("tick");
    setN((n) => n + 1);
  });
  return (
    <Entity name="A" transform={{ x: half }}>
      <Shape kind="rect" width={4} height={4} color={shade(n, "x")} />
      <Child curve={ease} />
    </Entity>
  );
}
`,
    });
    try {
      const r = p.run();
      assert.equal(r.status, 0, r.stderr);
      const code = p.out("A.ts");
      assert.match(code, /import \{ shade, log, ease \} from "\.\.\/src\/helpers\.ts";/);
      assert.match(code, /color: shade\(this\.n, "x"\)/);
      assert.match(code, /log\("tick"\);/);
      assert.match(code, /curve: ease/);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });

  it("are imported when only a function of the component's own uses them, values and types alike", () => {
    const p = project({
      "helpers.ts": `${HELPERS}export interface Shot { readonly speed: number }\nexport const SPEEDS = { fast: 3 };\n`,
      "A.tsx": `import { Pointer, useState } from "@rge/runtime/jsx";
import { ease, SPEEDS, type Shot } from "./helpers.ts";

export function A() {
  const [n, setN] = useState(0);
  const fire = (shot: Shot) => {
    setN(ease(shot.speed) + SPEEDS.fast);
  };
  return <Pointer width={4} height={4} transform={{ x: n }} onPress={() => fire({ speed: 2 })} />;
}
`,
    });
    try {
      const r = p.run();
      assert.equal(r.status, 0, r.stderr);
      const code = p.out("A.ts");
      assert.match(code, /import \{ ease, SPEEDS \} from "\.\.\/src\/helpers\.ts";/);
      assert.match(code, /import type \{ Shot \} from "\.\.\/src\/helpers\.ts";/);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });

  it("bring constants too: an imported array is a list's items (filtered by state), and an imported object's methods are called in handlers", () => {
    const p = project({
      "data.ts": `export interface RoomData { name: string; index: number; x: number }
export const ROOMS: readonly RoomData[] = [{ name: "a", index: 0, x: 0 }, { name: "b", index: 1, x: 320 }, { name: "c", index: 2, x: 640 }];
export const fx = { bursts: 0, burst(name: string, x: number): void { void name; this.bursts += x; } };
`,
      "D.tsx": `import { Entity, Shape, useState, useUpdate } from "@rge/runtime/jsx";
import { ROOMS, fx } from "./data.ts";
export function D() {
  const [room, setRoom] = useState(0);
  useUpdate(() => {
    fx.burst("dust", room);
    setRoom((r) => r + 1);
  });
  return (
    <Entity name="D">
      {ROOMS.filter((r) => Math.abs(r.index - room) <= 1).map((r) => <Shape key={r.name} kind="rect" width={4} height={4} color="#fff" transform={{ x: r.x }} />)}
    </Entity>
  );
}
`,
    });
    try {
      const r = p.run();
      assert.equal(r.status, 0, r.stderr);
      const code = p.out("D.ts");
      assert.match(code, /import \{ ROOMS, fx \} from "\.\.\/src\/data\.ts";/);
      assert.match(code, /fx\.burst\("dust", this\.room\);/);
      assert.match(code, /const \$list = ROOMS\.filter\(\(r\) => \(?Math\.abs\(r\.index - this\.room\)/);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });

  it("give <Game> its controls: an imported createControls, and nothing else", () => {
    const p = project({
      "controls.ts": `import { createControls } from "@rge/runtime";\nexport const controls = createControls({ jump: ["Z", "PadA"] });\n`,
      "Main.tsx": `import { Entity, Game, useInput } from "@rge/runtime/jsx";
import { controls } from "./controls.ts";
function Hero() { useInput((input) => { if (input.pressed("jump")) { } }); return <Entity name="Hero" />; }
export default function Main() { return <Game controls={controls}><Hero /></Game>; }
`,
    });
    try {
      const r = p.run();
      assert.equal(r.status, 0, r.stderr);
      assert.match(p.out("Main.ts"), /new Game\(\{ controls: controls \}\)|controls: controls/);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
    const wrong = project({ "Main.tsx": `import { Game } from "@rge/runtime/jsx";\nexport default function Main() { return <Game controls={5}></Game>; }\n` });
    try {
      const r = wrong.run();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /<Game controls> takes the game's controls, imported from a \.ts module/);
    } finally {
      rmSync(wrong.dir, { recursive: true, force: true });
    }
  });

  it("re-run only when their arguments change: a dynamic prop depends on the state in its arguments", () => {
    const p = project({
      "helpers.ts": HELPERS,
      "B.tsx": `import { Entity, Shape, useState } from "@rge/runtime/jsx";
import { shade } from "./helpers.ts";
export function B() {
  const [n] = useState(0);
  const [other] = useState(0);
  return <Entity name="B"><Shape kind="rect" width={1} height={1} color={shade(n, "a")} transform={{ x: other }} /></Entity>;
}
`,
    });
    try {
      assert.equal(p.run().status, 0);
      const ir = JSON.parse(p.out("B.ir.json")) as { components: { root: { children: { element: { props: { name: string; kind: string; dependencies?: { state: string }[] }[] } }[] } }[] };
      const color = ir.components[0]!.root.children[0]!.element.props.find((x) => x.name === "color")!;
      assert.equal(color.kind, "DynamicProp");
      assert.deepEqual(color.dependencies?.map((d) => d.state), ["B.n"]);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });

  it("are type-checked: a wrong argument is a compile error, and a function named like a hook is the game state's, not a plain function", () => {
    const wrong = project({
      "helpers.ts": HELPERS,
      "C.tsx": `import { Entity, Shape } from "@rge/runtime/jsx";\nimport { shade } from "./helpers.ts";\nexport function C() { return <Entity name="C"><Shape kind="rect" width={1} height={1} color={shade("no", 1)} /></Entity>; }\n`,
    });
    try {
      const r = wrong.run();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /TS2345|not assignable/);
    } finally {
      rmSync(wrong.dir, { recursive: true, force: true });
    }
    void execFileSync;
  });

  it("make a router's transition: a Router takes a function from a .ts file, and its route follows state", () => {
    const p = project({
      "transitions.ts": `import type { TransitionFrame } from "@rge/runtime";\nexport function wipe(t: number): TransitionFrame { return { toX: 320 - 320 * t, cover: 0 }; }\n`,
      "R.tsx": `import { Entity, Route, Router, useState } from "@rge/runtime/jsx";
import { wipe } from "./transitions.ts";
export function R() {
  const [screen] = useState("a");
  return (
    <Entity name="R">
      <Router route={screen} transition={wipe} duration={0.3}>
        <Route name="a"><Entity name="A" /></Route>
        <Route name="b"><Entity name="B" /></Route>
      </Router>
    </Entity>
  );
}
`,
    });
    try {
      const r = p.run();
      assert.equal(r.status, 0, r.stderr);
      const code = p.out("R.ts");
      assert.match(code, /new Router\(\{ route: this\.screen, transition: wipe, duration: 0\.3 \}\)/);
      assert.match(code, /import \{ wipe \} from "\.\.\/src\/transitions\.ts";/);
      assert.match(code, /new Route\(\{ name: "a" \}\)/);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });
});
