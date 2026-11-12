/** `inert` and `modal` written in components: a menu made inert from a prop, and a modal overlay that takes the keys while shown. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { World, createInputState } from "@rge/runtime";
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
  const [paused, setPaused] = useState(false);
  const [disabled, setDisabled] = useState(false);
  useInput((input) => { if (input.pressed("Enter")) onLog("world"); });
  return (
    <Entity name="Root">
      <Menu disabled={disabled} onLog={onLog} />
      <Hud inert={paused}><Entity name="hint" /></Hud>
      {paused && <Pause onLog={onLog} />}
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
    root.setDisabled(true);
    world.flush();
    assert.deepEqual(press(), ["world"]);
    root.setDisabled(false);
    root.setPaused(true);
    world.flush();
    assert.deepEqual(press(), ["pause"]);
    root.setPaused(false);
    world.flush();
    assert.deepEqual(press(), ["world", "menu"]);
  });
});
