/**
 * M4: props and callbacks between components, and `transform` on a component
 * element (placement). A parent passes values and callbacks to a local or
 * imported component; a changed value updates the existing child in place.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, World } from "@rge/runtime";
import { DiagnosticCode, type ComponentIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, compileProject, load, loadProject, typeCheck, typeCheckProject } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const GAME = `
interface EnemyProps {
  speed: number;
  skin?: "red" | "blue";
  onDefeated?: () => void;
}

function Enemy({ speed, skin = "red", onDefeated }: EnemyProps) {
  const [hp, setHp] = useState(10);
  useUpdate((dt) => {
    setHp((hp) => hp - speed * dt);
    if (hp <= 0) onDefeated?.();
  });
  return (
    <Entity name="Enemy" transform={{ x: speed }}>
      <Sprite image={skin === "red" ? "enemy-red.png" : "enemy-blue.png"} />
    </Entity>
  );
}

function Level() {
  const [score, setScore] = useState(0);
  return (
    <Entity name="Level">
      <Enemy speed={score > 10 ? 2 : 1} onDefeated={() => setScore((score) => score + 1)} />
    </Entity>
  );
}
`;

interface EnemyProps {
  speed: number;
  skin?: "red" | "blue";
  onDefeated?: () => void;
}
interface EnemyInstance extends Entity {
  props: EnemyProps;
  hp: number;
  updateProps(next: Partial<EnemyProps>): void;
  readonly sprite: Sprite;
}
interface LevelInstance extends Entity {
  score: number;
  setScore(value: number | ((previous: number) => number)): void;
  readonly enemy: EnemyInstance;
}

let Enemy: new (props: EnemyProps) => EnemyInstance;
let Level: new () => LevelInstance;

before(async () => {
  ({ Enemy, Level } = await load<{ Enemy: typeof Enemy; Level: typeof Level }>(compile(GAME, "Game.tsx")));
});

function component(source: string, name: string): ComponentIR {
  const found = compile(source).ir.components.find((c) => c.name === name);
  assert.ok(found, name);
  return found;
}

describe("M4: IR shape", () => {
  it("keeps the props type declaration and describes every prop", () => {
    const { ir } = compile(GAME, "Game.tsx");
    assert.deepEqual(ir.typeDeclarations.map((t) => t.name), ["EnemyProps"]);
    assert.match(ir.typeDeclarations[0]!.text, /^interface EnemyProps \{/);
    const enemy = ir.components.find((c) => c.name === "Enemy")!;
    assert.equal(enemy.propsType, "EnemyProps");
    assert.deepEqual(
      enemy.props.map((p) => [p.name, p.role, p.optional, p.type.kind]),
      [["speed", "value", false, "Primitive"], ["skin", "value", true, "Literals"], ["onDefeated", "callback", true, "Function"]],
    );
    assert.deepEqual(enemy.props[1]!.type, { kind: "Literals", values: ["red", "blue"] });
    assert.deepEqual(enemy.props[1]!.defaultValue, { kind: "StringLiteral", value: "red" });
  });

  it("describes array, literal and unrepresentable prop types for the scene schema", () => {
    const c = component(`
type Shape = { points: number[]; mode: 1 | 2 | 3; label: string | undefined; tags: string[] };
function P({ points }: Shape) { return <Entity name="P" />; }`, "P");
    assert.deepEqual(c.props.map((p) => p.type), [
      { kind: "Array", element: { kind: "Primitive", name: "number" } },
      { kind: "Literals", values: [1, 2, 3] },
      { kind: "SourceText", text: "string | undefined" },
      { kind: "Array", element: { kind: "Primitive", name: "string" } },
    ]);
  });

  it("makes a prop read a dependency, so JSX that uses a prop re-renders when the parent changes it", () => {
    const enemy = component(GAME, "Enemy");
    const sprite = enemy.root.children[0]!.element;
    const image = sprite.props[0]!;
    assert.ok(image.kind === "DynamicProp");
    assert.deepEqual(image.dependencies, [{ kind: "Prop", name: "skin" }]);
    const x = enemy.root.transform[0]!;
    assert.ok(x.kind === "DynamicProp" && x.value.kind === "PropRead");
  });

  it("lowers an inline arrow passed to a component to a callback with contextually typed parameters", () => {
    const level = component(GAME, "Level");
    const props = level.root.children[0]!.element.props;
    assert.deepEqual(props.map((p) => [p.name, p.kind]), [["speed", "DynamicProp"], ["onDefeated", "CallbackProp"]]);
    const callback = props[1]!;
    assert.ok(callback.kind === "CallbackProp");
    assert.equal(callback.handler.params.length, 0);
    const parametrised = component(
      `interface ChildProps { onHit: (amount: number) => void }
function Child({ onHit }: ChildProps) { return <Entity name="C" />; }
function P() { const [n, setN] = useState(0); return <Entity name="P"><Child onHit={(amount) => setN(n + amount)} /></Entity>; }`,
      "P",
    );
    const hit = parametrised.root.children[0]!.element.props[0]!;
    assert.ok(hit.kind === "CallbackProp" && hit.handler.params[0]!.type.kind === "Contextual");
  });
});

describe("M4: generated code", () => {
  it("types the class with its props, passes them and the defaults up, and generates updateProps", () => {
    const { code } = compile(GAME, "Game.tsx");
    assert.match(code, /^export interface EnemyProps \{/m);
    assert.match(code, /export class Enemy extends Entity<EnemyProps> \{/);
    assert.match(code, /constructor\(props: EnemyProps\) \{\n\s+super\(\{ name: "Enemy" \}, props, \{ skin: "red" \}\);/);
    assert.match(code, /updateProps\(next: Partial<EnemyProps>\): void \{\n\s+if \(this\.applyProps\(next, \{ skin: "red" \}\)\) this\.markDirty\(\);/);
    assert.match(code, /this\.props\.onDefeated\?\.\(\)/);
    assert.match(code, /this\.transform\.x = this\.props\.speed;/);
  });

  it("builds a child with all its props and callbacks, and re-sends the dynamic ones in one call", () => {
    const { code } = compile(GAME, "Game.tsx");
    assert.match(code, /readonly enemy: Enemy = new Enemy\(\{ speed: \(this\.score > 10\) \? 2 : 1, onDefeated: \(\) => \{ this\.setScore\(/);
    assert.match(code, /this\.enemy\.updateProps\(\{ speed: \(this\.score > 10\) \? 2 : 1 \}\);/);
    assert.doesNotMatch(code.slice(code.indexOf("class Level")), /updateProps\(\{[^}]*onDefeated/, "a callback is created once, never re-sent");
  });

  it("allows every prop to be omitted when each is optional", () => {
    const { code } = compile(`interface BadgeProps { label?: string }
function Badge({ label = "x" }: BadgeProps) { return <Entity name={label} />; }
function Host() { return <Entity name="H"><Badge /></Entity>; }`);
    assert.match(code, /constructor\(props: BadgeProps = \{\}\)/);
    assert.match(code, /new Badge\(\)/);
  });

  it("type-checks", () => {
    assert.deepEqual(typeCheck(compile(GAME, "Game.tsx")), []);
  });

  it("fails the type-check for a missing required prop, a wrong type and an unknown prop", () => {
    for (const props of [``, `speed="fast"`, `speed={1} wings={2}`, `speed={1} skin="green"`, `speed={1} onDefeated={(x) => {}}`]) {
      const compiled = compile(`${GAME}\nfunction Bad() { return <Entity name="B"><Enemy ${props} /></Entity>; }`, "Bad.tsx");
      assert.ok(typeCheck(compiled).length > 0, props || "(no props)");
    }
  });
});

describe("M4: runtime behaviour", () => {
  it("updates the child in place when the parent's state changes, rendering the child once", () => {
    const world = new World();
    const level = new Level();
    world.mount(level);
    const enemy = level.enemy;
    assert.equal(enemy.props.speed, 1);
    assert.equal(enemy.transform.x, 1);

    let childRenders = 0;
    const render = enemy.render.bind(enemy);
    enemy.render = () => { childRenders++; render(); };

    level.setScore(11);
    assert.equal(world.flush(), 2, "the parent renders once and re-renders the child once, in the same flush");
    assert.equal(childRenders, 1);
    assert.equal(level.enemy, enemy, "same instance");
    assert.equal(enemy.props.speed, 2);
    assert.equal(enemy.transform.x, 2, "JSX that reads a prop followed it");
  });

  it("does not render the child when the parent re-renders with unchanged props", () => {
    const world = new World();
    const level = new Level();
    world.mount(level);
    const enemy = level.enemy;
    level.setScore(1); // speed stays 1
    assert.equal(world.flush(), 1);
    assert.equal(enemy.isDirty, false);
  });

  it("lets the child call a callback that updates the parent's state", () => {
    const world = new World();
    const level = new Level();
    world.mount(level);
    world.tick(20); // hp: 10 - 1 * 20 = -10, applied at the render
    assert.equal(level.enemy.hp, -10);
    assert.equal(level.score, 0);
    world.tick(1); // the handler now sees hp <= 0 and calls onDefeated
    assert.equal(level.score, 1, "the callback's setter was applied in the same tick's flush");
  });

  it("calls an optional callback that was not passed without error", () => {
    const world = new World();
    const enemy = new Enemy({ speed: 1 });
    world.mount(enemy);
    world.tick(20);
    assert.doesNotThrow(() => world.tick(1));
  });

  it("applies defaults at construction, for omitted and undefined props, and on update", () => {
    const enemy = new Enemy({ speed: 1 });
    assert.equal(enemy.props.skin, "red");
    assert.equal(enemy.sprite.image, "enemy-red.png");
    assert.equal(new Enemy({ speed: 1, skin: undefined }).props.skin, "red");

    const world = new World();
    world.mount(enemy);
    enemy.updateProps({ skin: "blue" });
    world.flush();
    assert.equal(enemy.sprite.image, "enemy-blue.png");
    enemy.updateProps({ skin: undefined });
    world.flush();
    assert.equal(enemy.props.skin, "red", "an undefined update falls back to the default");
    assert.equal(enemy.sprite.image, "enemy-red.png");
  });

  it("leaves a prop alone when it is not in the update, and ignores an unchanged update", () => {
    const world = new World();
    const enemy = new Enemy({ speed: 3, skin: "blue" });
    world.mount(enemy);
    enemy.updateProps({ speed: 3 });
    assert.equal(enemy.isDirty, false, "the same value is not a change");
    enemy.updateProps({ skin: "red" });
    assert.equal(enemy.props.speed, 3);
    assert.equal(enemy.isDirty, true);
  });
});

describe("M4: where props can be read", () => {
  it("reads props when a state value is first created, and in handlers, conditions and derived values", async () => {
    const { Counter } = await load<{ Counter: new (props: { start: number; limit: number; show?: boolean }) => Entity & { n: number; updateProps(p: object): void } }>(
      compile(`interface CounterProps { start: number; limit: number; show?: boolean }
function Counter({ start, limit, show = true }: CounterProps) {
  const [n, setN] = useState(start);
  const over = n >= limit;
  useUpdate(() => setN((n) => n + 1));
  return (
    <Entity name="Counter">
      {show && over && <Sprite image="over.png" />}
    </Entity>
  );
}`),
    );
    const world = new World();
    const counter = new Counter({ start: 3, limit: 5 });
    world.mount(counter);
    assert.equal(counter.n, 3, "the initial state read the prop");
    world.tick(1);
    world.tick(1);
    assert.equal(counter.n, 5);
    assert.equal(counter.children.length, 1, "a condition that reads a prop and state is true");
    counter.updateProps({ show: false });
    world.flush();
    assert.equal(counter.children.length, 0, "the condition follows a prop");
    counter.updateProps({ limit: 100, show: true });
    world.flush();
    assert.equal(counter.children.length, 0);
  });

  it("forwards a callback prop whole to a child", async () => {
    const { Panel } = await load<{ Panel: new (props: { onDone?: () => void }) => Entity & { updateProps(p: object): void } }>(
      compile(`interface BarProps { start: number; onDone?: () => void }
function Bar({ start, onDone }: BarProps) {
  const [n, setN] = useState(start);
  useUpdate(() => { if (n > 3) onDone?.(); });
  return <Entity name="Bar" />;
}
interface PanelProps { onDone?: () => void }
function Panel({ onDone }: PanelProps) {
  return <Entity name="Panel"><Bar start={5} onDone={onDone} /></Entity>;
}`),
    );
    let done = 0;
    const world = new World();
    const panel = new Panel({ onDone: () => { done++; } });
    world.mount(panel);
    world.tick(1);
    assert.equal(done, 1);
    let replaced = 0;
    panel.updateProps({ onDone: () => { replaced++; } });
    world.flush();
    world.tick(1);
    assert.deepEqual([done, replaced], [1, 1], "an updated callback reaches the child");
  });
});

describe("M4: placing a component with transform", () => {
  const SCENE = `
function Mover() {
  const [x, setX] = useState(0);
  return <Entity name="Mover" transform={{ x }} />;
}
function Scene() {
  const [spawn, setSpawn] = useState(50);
  const [pinned, setPinned] = useState(false);
  return (
    <Entity name="Scene" transform={{ x: 100 }}>
      <Mover transform={{ x: spawn, y: 5, global: pinned }} />
    </Entity>
  );
}`;

  it("composes the parent's placement under the child's own transform", async () => {
    const { Scene } = await load<{ Scene: new () => Entity & { mover: Entity & { setX(v: number): void }; setSpawn(v: number): void; setPinned(v: boolean): void } }>(compile(SCENE));
    const world = new World();
    const scene = new Scene();
    world.mount(scene);
    const mover = scene.mover;
    assert.deepEqual([mover.placement.x, mover.placement.y, mover.transform.x], [50, 5, 0]);
    assert.deepEqual([mover.worldTransform().x, mover.worldTransform().y], [150, 5], "scene 100 + placement 50, own transform 0");

    mover.setX(7);
    world.flush();
    assert.equal(mover.worldTransform().x, 157, "the child moves relative to where it was placed");

    scene.setSpawn(80);
    world.flush();
    assert.equal(mover.worldTransform().x, 187, "placement follows the parent's state");

    scene.setPinned(true);
    world.flush();
    assert.equal(mover.worldTransform().x, 87, "a global placement ignores the scene's transform; the child's own still applies");
  });

  it("type-checks", () => {
    assert.deepEqual(typeCheck(compile(SCENE)), []);
  });
});

describe("M4: across files", () => {
  const FILES = {
    "Enemy.tsx": `interface EnemyProps { speed: number; onDefeated?: () => void }
export function Enemy({ speed, onDefeated }: EnemyProps) {
  useUpdate(() => { if (speed > 5) onDefeated?.(); });
  return <Entity name="Enemy" transform={{ x: speed }} />;
}`,
    "Level.tsx": `import { Enemy } from "./Enemy.tsx";
export function Level() {
  const [score, setScore] = useState(0);
  const [speed, setSpeed] = useState(1);
  return (
    <Entity name="Level">
      <Enemy speed={speed} onDefeated={() => setScore((score) => score + 1)} transform={{ y: score }} />
    </Entity>
  );
}`,
  };

  it("passes props and callbacks to an imported component, and the project type-checks", async () => {
    const project = compileProject(FILES);
    assert.deepEqual(typeCheckProject(project), []);
    const { Level } = await loadProject<{ Level: new () => Entity & { score: number; setSpeed(v: number): void; enemy: Entity } }>(project, "Level.tsx");
    const world = new World();
    const level = new Level();
    world.mount(level);
    assert.equal(level.enemy.transform.x, 1);
    level.setSpeed(9);
    world.flush();
    assert.equal(level.enemy.transform.x, 9);
    world.tick(1);
    assert.equal(level.score, 1, "the imported child called the parent's callback");
    assert.equal(level.enemy.placement.y, 1, "and the placement follows the score");
  });

  it("catches a wrong prop to an imported component in the project's type-check", () => {
    const bad = compileProject({ ...FILES, "Level.tsx": FILES["Level.tsx"].replace("speed={speed}", `speed="fast"`) });
    assert.ok(typeCheckProject(bad).length > 0);
  });
});

describe("M4: diagnostics", () => {
  const codes = (source: string) => compileErrors(source).map((d) => d.code);
  const withProps = (declaration: string, parameter: string, body = "") =>
    `${declaration}\nfunction A(${parameter}) { ${body} return <Entity name="A" />; }`;

  it("rejects a props parameter that is not a destructuring annotated with a declared type", () => {
    const P = `interface P { a: number; b?: number }`;
    assert.deepEqual(codes(withProps(P, `{ a }: Missing`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(P, `{ a }`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(P, `props: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(P, `{ a, ...rest }: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(P, `{ a: renamed }: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(P, `{ a }: P, other: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(P, `{ nope }: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(P, `{ a }: P = { a: 1 }`)), [DiagnosticCode.InvalidProps]);
  });

  it("rejects props types it cannot describe", () => {
    assert.deepEqual(codes(withProps(`interface P extends Other { a: number }`, `{ a }: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(`type P = number`, `{ a }: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(`interface P { [key: string]: number }`, `{ a }: P`)), [DiagnosticCode.InvalidProps, DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(`interface P<T> { a: T }`, `{ a }: P`)), [DiagnosticCode.UnsupportedSyntax, DiagnosticCode.InvalidProps]);
  });

  it("rejects framework-reserved prop names", () => {
    for (const name of ["key", "ref", "transform", "children"]) {
      assert.ok(codes(withProps(`interface P { ${name}: number }`, `{}: P`)).includes(DiagnosticCode.InvalidProps), name);
    }
  });

  it("rejects defaults that are not constants, and defaults on callbacks", () => {
    assert.deepEqual(codes(withProps(`interface P { a?: number; b?: number }`, `{ a = 1, b = a }: P`)), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(codes(withProps(`interface P { f?: () => void }`, `{ f = () => {} }: P`)), [DiagnosticCode.InvalidProps]);
  });

  it("infers a state's type from a primitive prop, and asks for a type argument otherwise", () => {
    const P = `interface P { label: string; count: number; items: number[]; onX?: () => void }`;
    const state = (initial: string, typeArgument = "") => withProps(P, `{ label, count, items }: P`, `const [v, setV] = useState${typeArgument}(${initial});`);
    assert.equal(compile(state("label")).ir.components[0]!.state[0]!.type, "string");
    assert.equal(compile(state("count")).ir.components[0]!.state[0]!.type, "number");
    assert.deepEqual(codes(state("items")), [DiagnosticCode.UnsupportedStateType]);
    assert.equal(compile(state("count", "<number>")).ir.components[0]!.state[0]!.type, "number");
  });

  it("keeps the generated updateProps name free", () => {
    assert.ok(compileErrors(`function A() { const [updateProps, setU] = useState(0); return <Entity name="A" />; }`).some((d) => d.code === DiagnosticCode.InvalidUseState));
  });

  it("rejects a prop that clashes with state", () => {
    assert.ok(codes(withProps(`interface P { n: number }`, `{ n }: P`, `const [n, setN] = useState(0);`)).includes(DiagnosticCode.InvalidUseState));
  });

  it("rejects calling a value, and reading a callback as a value", () => {
    const P = `interface P { a: number; f: () => void }`;
    assert.deepEqual(codes(withProps(P, `{ a, f }: P`, `useUpdate(() => { a(); });`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withProps(P, `{ a, f }: P`, `const g = f;`)), [DiagnosticCode.UnsupportedExpression]);
    assert.doesNotThrow(() => compile(withProps(P, `{ a, f }: P`, `useUpdate(() => { f?.(); });`)), "calling a callback prop is fine");
  });

  it("rejects a function passed to a built-in, and key or children as attributes", () => {
    assert.deepEqual(codes(`function A() { return <Entity name="A"><Sprite image="a" onClick={() => {}} /></Entity>; }`), [DiagnosticCode.UnsupportedAttribute]);
    assert.deepEqual(codes(`function B() { return <Entity name="B" />; } function A() { return <Entity name="A"><B key="x" /></Entity>; }`), [DiagnosticCode.UnsupportedAttribute]);
    assert.deepEqual(codes(`function B() { return <Entity name="B" />; } function A() { return <Entity name="A"><B children={1} /></Entity>; }`), [DiagnosticCode.UnsupportedAttribute]);
  });
});
