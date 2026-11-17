import assert from "node:assert/strict";
/** `inert` and `modal` written in components: a menu made inert from a prop, and a modal overlay that takes the keys while shown. */
import { after, describe, it } from "node:test";

import { World, createInputState, Entity, Pointer, Text } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
interface MenuProps { disabled: boolean; onLog: (s: string) => void }
function Menu({ disabled, onLog }: MenuProps) {
  useInput((input) => { if (input.pressed("Enter")) onLog("menu"); });
  return <Flex inert={disabled}><Entity name="row" /></Flex>;
}

interface PauseProps { onLog: (s: string) => void }
function Pause({ onLog }: PauseProps) {
  useInput((input) => { if (input.pressed("Enter")) onLog("pause"); });
  return <Entity name="Pause" modal />;
}

interface RootProps { onLog: (s: string) => void }
function Root({ onLog }: RootProps) {
  const s = useMutable({ paused: false, disabled: false });
  useInput((input) => { if (input.pressed("Enter")) onLog("world"); });
  return (
    <Entity name="Root">
      <Menu disabled={s.disabled} onLog={onLog} />
      <Hud inert={s.paused}><Entity name="hint" /></Hud>
      {s.paused && <Pause onLog={onLog} />}
    </Entity>
  );
}`;

describe("inert and modal in components", () => {
  it("type-checks: both are props of <Entity>, <Flex> and <Hud>", () => {
    assert.deepEqual(typeCheck(compile(SOURCE, "Root.tsx")), []);
  });

  it("follows the state: an inert menu hears nothing, and while the modal is shown only it hears", async () => {
    const { Root } = await load<{ Root: new (props: object) => any }>(compile(SOURCE, "Root.tsx"));
    const log: string[] = [];
    const root = new Root({ onLog: (s: string) => log.push(s) });
    const world = new World();
    world.mount(root);
    world.flush();
    const press = (): string[] => {
      world.tick(0.016, createInputState({ pressed: ["Enter"] }));
      return log.splice(0);
    };
    assert.deepEqual(press(), ["world", "menu"]);
    root.s.disabled = true;
    world.flush();
    assert.deepEqual(press(), ["world"]);
    root.s.disabled = false;
    root.s.paused = true;
    world.flush();
    assert.deepEqual(press(), ["pause"]);
    root.s.paused = false;
    world.flush();
    assert.deepEqual(press(), ["world", "menu"]);
  });
});

describe("keys that press things, from TSX", () => {
  it("pressKey, focusable, autoFocus, onFocus / onBlur and a Pointer's origin compile and run", async () => {
    const compiled = compile(`
interface PadsProps { onWave: () => void; }
export function Pads({ onWave }: PadsProps) {
  const s = useMutable({ focused: -1 });
  return (
    <Entity>
      <Flex pressKey="Space" onPress={onWave} />
      <Pointer width={10} height={10} originX={5} originY={5} focusable autoFocus onFocus={() => { s.focused = 0; }} />
      <Pointer width={10} height={10} originX={5} originY={5} x={30} focusable onFocus={() => { s.focused = 1; }} onBlur={() => { s.focused = -1; }} />
      <Text size={8}>{\`\${s.focused}\`}</Text>
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    let waves = 0;
    const { Pads } = await load<{ Pads: new (p: { onWave: () => void }) => Entity }>(compiled);
    const world = new World();
    const pads = new Pads({ onWave: () => waves++ });
    world.mount(pads);
    world.flush();
    const text = pads.children[3] as Text;
    world.tick(1 / 60, createInputState({ pressed: ["Space"] }));
    assert.equal(text.text, "0");
    world.tick(1 / 60, createInputState({ pressed: ["ArrowRight"] }));
    assert.equal(text.text, "1");
    assert.equal(waves, 1);
    assert.equal((pads.children[1] as Pointer).contains(-4, -4), true);
  });
});
