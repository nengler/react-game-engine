/**
 * M12: `<Camera>`. The viewport: its own transform is the view, and `zoom`
 * magnifies. It follows something by being inside it (transforms nest); the
 * runtime also has a `follow` field for code that is not compiled.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Camera, Entity, Sprite, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, elementOf, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
function Level() {
  const [wave, setWave] = useState(1);
  return (
    <Entity name="Level">
      <Camera zoom={wave > 5 ? 2 : 1} transform={{ x: 160, y: 120 }} />
      <Sprite image="bg.png" />
    </Entity>
  );
}

function Hero() {
  const [x, setX] = useState(0);
  useUpdate((dt) => setX((x) => x + dt * 10));
  return (
    <Entity name="Hero" transform={{ x }}>
      <Sprite image="hero.png" />
      <Camera zoom={2} />
    </Entity>
  );
}

interface ViewProps {
  zoom: number;
}

const View = ({ zoom }: ViewProps) => <Camera zoom={zoom} />;
`;

interface LevelInstance extends Entity {
  setWave(value: number): void;
  readonly camera: Camera;
  readonly sprite: Sprite;
}
interface HeroInstance extends Entity {
  readonly camera: Camera;
}
interface ViewInstance extends Camera {
  updateProps(next: { zoom: number }): void;
}

let Level: new () => LevelInstance;
let Hero: new () => HeroInstance;
let View: new (props: { zoom: number }) => ViewInstance;

before(async () => {
  ({ Level, Hero, View } = await load<{ Level: typeof Level; Hero: typeof Hero; View: typeof View }>(compile(SOURCE, "Cam.tsx")));
});

describe("M12: IR and generated code", () => {
  const compiled = compile(SOURCE, "Cam.tsx");
  const level = compiled.ir.components.find((c) => c.name === "Level")!;
  const camera = elementOf(level.root.children[0]!);

  it("makes zoom a dynamic prop over the state it reads, and the view's placement a static transform", () => {
    const zoom = camera.props.find((p) => p.name === "zoom")!;
    assert.equal(zoom.kind, "DynamicProp");
    assert.deepEqual(zoom.kind === "DynamicProp" && zoom.dependencies, [{ kind: "State", state: "Level.wave" }]);
    assert.deepEqual(camera.transform.map((t) => [t.name, t.kind]), [["x", "StaticProp"], ["y", "StaticProp"]]);
  });

  it("builds the camera and updates zoom in place", () => {
    assert.match(compiled.code, /readonly camera: Camera = new Camera\(\{ zoom: \(this\.wave > 5\) \? 2 : 1 \}\);/);
    assert.match(compiled.code, /this\.camera\.zoom = \(this\.wave > 5\) \? 2 : 1;/);
    assert.match(compiled.code, /this\.camera\.transform\.x = 160;/);
  });

  it("makes a Camera-rooted component a Camera", () => {
    assert.match(compiled.code, /export class View extends Camera<ViewProps> \{/);
    assert.match(compiled.code, /this\.zoom = this\.props\.zoom;/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("M12: authored source type-checks", () => {
  const check = (body: string) =>
    getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/M12${Math.random()}.tsx`,
        text: `import { Entity, Camera } from "@rge/runtime/jsx";\nfunction C({ n }: { n: number }) { return <Entity name="C">${body}</Entity>; }`,
      },
    ]);

  it("accepts a zoom and a placement, and a camera with neither", () => {
    assert.deepEqual(check(`<Camera />`), []);
    assert.deepEqual(check(`<Camera zoom={n} transform={{ x: 10 }} />`), []);
  });

  it("rejects what the camera cannot be given: a follow target, a non-number zoom", () => {
    assert.ok(check(`<Camera follow={n} />`).length > 0, "follow is not an authored prop");
    assert.ok(check(`<Camera zoom="2" />`).length > 0);
  });

  it("explains why follow cannot be written, and what to do instead, whatever it is given", () => {
    for (const value of [`{hero}`, `{1}`, `"hero"`, ``]) {
      const errors = compileErrors(`function C() { return <Entity name="C"><Camera follow${value ? `=${value}` : ""} /></Entity>; }`);
      assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.UnsupportedAttribute], value);
      assert.match(errors[0]!.message, /<Camera follow> cannot be set from JSX: nothing in a component can name another object, so a camera follows what it is inside/);
    }
  });

  it("also rejects it on a camera that is a component's root", () => {
    assert.deepEqual(compileErrors(`function C() { return <Camera follow={x} />; }`).map((d) => d.code), [DiagnosticCode.UnsupportedAttribute]);
  });

  it("keeps the runtime-only and method names reserved for a component rooted at a camera", () => {
    for (const name of ["follow", "zoom", "viewTransform", "worldToView", "viewToWorld"]) {
      const codes = compileErrors(`function C() { const [${name}, set] = useState(1); return <Camera />; }`).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), name);
    }
  });

  it("does not apply to a component that merely has a prop with that name", () => {
    assert.doesNotThrow(() => compile(`interface P { follow: number }\nfunction Child({ follow }: P) { return <Entity name="c" />; }\nfunction C() { return <Entity name="C"><Child follow={1} /></Entity>; }`));
  });
});

describe("M12: runtime behaviour", () => {
  it("updates zoom in place when state changes, keeping the instance, in one render", () => {
    const world = new World();
    const level = new Level();
    world.mount(level);
    const camera = level.camera;
    assert.equal(camera.zoom, 1);
    level.setWave(6);
    assert.equal(world.flush(), 1);
    assert.equal(camera.zoom, 2);
    assert.equal(level.camera, camera);
    assert.deepEqual([camera.worldToView(161, 120).x, camera.worldToView(161, 120).y], [2, 0], "centred on its placement, magnified");
  });

  it("pans without moving anything in the world", () => {
    const level = new Level();
    const sprite = level.sprite.worldTransform();
    assert.deepEqual(level.camera.worldToView(160, 120), { x: 0, y: 0 });
    level.camera.transform.x = 500;
    assert.deepEqual(level.sprite.worldTransform(), sprite);
    assert.deepEqual(level.camera.worldToView(500, 120), { x: 0, y: 0 });
  });

  it("follows the entity it is inside as that entity's state moves it", () => {
    const world = new World();
    const hero = new Hero();
    world.mount(hero);
    assert.deepEqual(hero.camera.worldToView(0, 0), { x: 0, y: 0 });
    world.tick(3);
    assert.equal(hero.transform.x, 30);
    assert.deepEqual(hero.camera.worldToView(30, 0), { x: 0, y: 0 }, "the view is on the hero");
    assert.deepEqual(hero.camera.worldToView(31, 0), { x: 2, y: 0 }, "and zoomed in");
  });

  it("is a Camera when it is a component's root, and follows its props", () => {
    const world = new World();
    const view = new View({ zoom: 2 });
    world.mount(view);
    assert.ok(view instanceof Camera);
    assert.equal(view.zoom, 2);
    view.updateProps({ zoom: 4 });
    world.flush();
    assert.equal(view.zoom, 4);
  });

  it("reports a bad zoom from state when the view is read, not when it is set", () => {
    const view = new View({ zoom: 0 });
    assert.equal(view.zoom, 0);
    assert.throws(() => view.viewTransform(), /zoom must be a positive number/);
  });
});
