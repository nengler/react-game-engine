/**
 * Custom hooks that behave like functions (REACT_FEEL_PLAN.md, B6): a destructured parameter, a returned ref, a callback
 * argument, and the functions a component declares in its body that a callback argument needs.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, GameObject, Pointer, Text, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

async function run<T extends GameObject>(source: string, exported: string, steps: number): Promise<T> {
  const compiled = compile(source);
  assert.deepEqual(typeCheck(compiled), []);
  const module = await load<Record<string, new () => T>>(compiled);
  const world = new World();
  const object = new module[exported]!();
  world.mount(object);
  world.flush();
  for (let i = 0; i < steps; i++) {
    world.tick(1 / 2);
    world.flush();
  }
  return object;
}

describe("custom hooks", () => {
  it("take a destructured parameter, from an object literal or a value", async () => {
    const source = `interface Options { speed: number; limit: number }
function useMover({ speed, limit: max }: Options) {
  const [x, setX] = useState(0);
  useUpdate((dt) => setX((v) => Math.min(v + speed * dt, max)));
  return x;
}
const SLOW: Options = { speed: 1, limit: 100 };
export function Pair() {
  const fast = useMover({ speed: 4, limit: 3 });
  const slow = useMover(SLOW);
  return <Text>{\`\${fast} \${slow}\`}</Text>;
}`;
    const pair = await run<Text>(source, "Pair", 2);
    assert.equal(pair.text, "3 1");
  });

  it("return a ref by itself", async () => {
    const counter = await run<Text>(`function useCounter() { const count = useRef(0); return count; }
export function Counter() {
  const steps = useCounter();
  const [shown, setShown] = useState(0);
  useUpdate(() => { steps.current += 1; setShown(steps.current); });
  return <Text>{shown}</Text>;
}`, "Counter", 3);
    assert.equal(counter.text, "3");
  });

  it("take a callback", async () => {
    const ticker = await run<Text>(`function useEvery(seconds: number, fn: () => void) {
  const elapsed = useRef(0);
  useUpdate((dt) => {
    elapsed.current += dt;
    if (elapsed.current >= seconds) {
      elapsed.current = 0;
      fn();
    }
  });
}
export function Ticker() {
  const [ticks, setTicks] = useState(0);
  useEvery(1, () => setTicks((t) => t + 1));
  return <Text>{ticks}</Text>;
}`, "Ticker", 4);
    assert.equal(ticker.text, "2", "a tick every second: four half-second steps");
  });

  it("name the chain when they call each other without end", () => {
    const errors = compileErrors(`function useA(): number { return useB(); }
function useB(): number { return useA(); }
export function C() { const n = useA(); return <Text>{n}</Text>; }`);
    assert.match(errors[0]!.message, /cannot recurse: 'useA' calls itself through useA → useB → useA/);
  });
});

describe("functions declared in the component body", () => {
  it("are handlers: called in handlers and passed to elements and hooks", async () => {
    const compiled = compile(`export function Score() {
  const [points, setPoints] = useState(0);
  const add = (n: number) => {
    setPoints((p) => p + n);
  };
  const press = () => add(10);
  useUpdate(() => add(1));
  return (
    <Entity>
      <Text>{points}</Text>
      <Pointer width={4} height={4} onPress={press} />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Score } = await load<{ Score: new () => Entity }>(compiled);
    const world = new World();
    const score = new Score();
    world.mount(score);
    world.flush();
    world.tick(1 / 60);
    world.flush();
    assert.equal((score.children[0] as Text).text, "1");
    world.reportPress(score.children[1] as Pointer, 1, 1);
    world.flush();
    assert.equal((score.children[0] as Text).text, "11");
  });

  it("are not called while rendering", () => {
    const errors = compileErrors(`export function C() {
  const [n, setN] = useState(0);
  const bump = () => setN(n + 1);
  return <Text>{bump()}</Text>;
}`);
    assert.ok(errors.some((d) => d.code === DiagnosticCode.UnsupportedExpression && /function of this component/.test(d.message)));
  });
});
