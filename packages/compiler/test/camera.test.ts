/**
 * `<Camera>`. The viewport: its own transform is the view, `zoom` magnifies, and it follows its children:
 * `<Camera><Player /></Camera>`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Camera, Entity, Sprite, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, elementOf, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
function Level() {
  const s = useMutable({ wave: 1 });
  return (
    <Entity name="Level">
      <Camera zoom={s.wave > 5 ? 2 : 1} transform={{ x: 160, y: 120 }} />
      <Sprite image="bg.png" />
    </Entity>
  );
}

function Player() {
  const s = useMutable({ x: 0 });
  useUpdate((dt) => { s.x += dt * 10; });
  return (
    <Entity name="Player" transform={{ x: s.x }}>
      <Sprite image="player.png" />
    </Entity>
  );
}

function Stage() {
  const s = useMutable({ pet: false });
  return (
    <Entity name="Stage">
      <Camera zoom={2}>
        <Player />
        {s.pet && <Sprite image="pet.png" transform={{ x: 100 }} />}
      </Camera>
    </Entity>
  );
}

interface Unit {
  id: string;
  x: number;
}

function Swarm() {
  const s = useMutable({ units: [] as Unit[] });
  return (
    <Entity name="Swarm">
      <Camera>
        {s.units.map((u) => (
          <Entity key={u.id} name={u.id} transform={{ x: u.x }} />
        ))}
      </Camera>
    </Entity>
  );
}

function Hero() {
  const s = useMutable({ x: 0 });
  useUpdate((dt) => { s.x += dt * 10; });
  return (
    <Entity name="Hero" transform={{ x: s.x }}>
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
  readonly camera: Camera;
  readonly sprite: Sprite;
  s: { [field: string]: unknown };
}
interface PlayerInstance extends Entity {}
interface GameInstance extends Entity {
  readonly camera: Camera;
  readonly player: PlayerInstance;
  sprite: Sprite | null;
  s: { [field: string]: unknown };
}
interface SwarmInstance extends Entity {
  readonly camera: Camera;
  s: { [field: string]: unknown };
}
interface HeroInstance extends Entity {
  readonly camera: Camera;
}
interface ViewInstance extends Camera {
  updateProps(next: { zoom: number }): void;
}

let Level: new () => LevelInstance;
let Stage: new () => GameInstance;
let Swarm: new () => SwarmInstance;
let Hero: new () => HeroInstance;
let View: new (props: { zoom: number }) => ViewInstance;

before(async () => {
  ({ Level, Stage, Swarm, Hero, View } = await load<{
    Level: typeof Level;
    Stage: typeof Stage;
    Swarm: typeof Swarm;
    Hero: typeof Hero;
    View: typeof View;
  }>(compile(SOURCE, "Cam.tsx")));
});

describe("<Camera>: IR and generated code", () => {
  const compiled = compile(SOURCE, "Cam.tsx");
  const level = compiled.ir.components.find((c) => c.name === "Level")!;
  const camera = elementOf(level.root.children[0]!);
  const game = compiled.ir.components.find((c) => c.name === "Stage")!;
  const wrapper = elementOf(game.root.children[0]!);

  it("makes zoom a dynamic prop over the state it reads, and the view's placement a static transform", () => {
    const zoom = camera.props.find((p) => p.name === "zoom")!;
    assert.equal(zoom.kind, "DynamicProp");
    assert.deepEqual(zoom.kind === "DynamicProp" && zoom.dependencies, [{ kind: "State", state: "Level.s.wave" }]);
    assert.deepEqual(
      camera.transform.map((t) => [t.name, t.kind]),
      [
        ["x", "StaticProp"],
        ["y", "StaticProp"],
      ]
    );
  });

  it("holds the children a camera follows as its own children", () => {
    assert.deepEqual(wrapper.component, { kind: "Intrinsic", name: "Camera" });
    assert.deepEqual(
      wrapper.children.map((c) => c.kind),
      ["StaticChild", "ConditionalChild"]
    );
  });

  it("builds the camera and updates zoom in place", () => {
    assert.match(compiled.code, /readonly camera: Camera = new Camera\(\{ zoom: \(this\.\$s_wave > 5\) \? 2 : 1 \}\);/);
    assert.match(compiled.code, /const (\$\d+) = \(this\.\$s_wave > 5\) \? 2 : 1;[^]*?this\.camera\.zoom = \1;/);
    assert.match(compiled.code, /this\.camera\.transform\.x = 160;/);
  });

  it("attaches the followed children to the camera, and mounts a conditional one there too", () => {
    assert.match(compiled.code, /this\.camera\.addChild\(this\.player, 0\);/);
    assert.match(compiled.code, /this\.camera\.queueAddChild\(this\.sprite, 1\);/);
  });

  it("makes a Camera-rooted component a Camera", () => {
    assert.match(compiled.code, /export class View extends Camera<ViewProps> \{/);
    assert.match(compiled.code, /const (\$\d+) = this\.props\.zoom;[^]*?this\.zoom = \1;/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("<Camera>: authored source type-checks", () => {
  const check = (body: string) =>
    getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/M12${Math.random()}.tsx`,
        text: `import { Entity, Camera } from "@tsengine/runtime/jsx";\nfunction C({ n }: { n: number }) { return <Entity name="C">${body}</Entity>; }`,
      },
    ]);

  it("accepts a zoom, a placement, and children to follow", () => {
    assert.deepEqual(check(`<Camera />`), []);
    assert.deepEqual(check(`<Camera zoom={n} transform={{ x: 10 }} />`), []);
    assert.deepEqual(check(`<Camera zoom={2}><Entity name="player" /></Camera>`), []);
    assert.deepEqual(check(`<Camera>{n > 0 && <Entity name="player" />}</Camera>`), []);
  });

  it("rejects what a camera cannot be given: a follow prop, a non-number zoom, text", () => {
    assert.ok(check(`<Camera follow={n} />`).length > 0, "there is no follow prop: wrap the target instead");
    assert.ok(check(`<Camera zoom="2" />`).length > 0);
    assert.ok(check(`<Camera>player</Camera>`).length > 0);
  });

  it("reports a follow attribute at compile time, since nothing names it", () => {
    const codes = compileErrors(`function C() { return <Entity name="C"><Camera follow={hero} /></Entity>; }`).map((d) => d.code);
    assert.deepEqual(codes, [DiagnosticCode.UnknownIdentifier]);
  });
});

describe("<Camera>: runtime behaviour", () => {
  it("updates zoom in place when state changes, keeping the instance, in one render", () => {
    const world = new World();
    const level = new Level();
    world.mount(level);
    const camera = level.camera;
    assert.equal(camera.zoom, 1);
    level.s.wave = 6;
    assert.equal(world.flush(), 1);
    assert.equal(camera.zoom, 2);
    assert.equal(level.camera, camera);
    assert.deepEqual([camera.worldToView(161, 120).x, camera.worldToView(161, 120).y], [2, 0], "centred on its placement, magnified");
  });

  it("with no children, is where it is and pans without moving anything in the world", () => {
    const level = new Level();
    const sprite = level.sprite.worldTransform();
    assert.deepEqual(level.camera.worldToView(160, 120), { x: 0, y: 0 });
    level.camera.transform.x = 500;
    assert.deepEqual(level.sprite.worldTransform(), sprite);
    assert.deepEqual(level.camera.worldToView(500, 120), { x: 0, y: 0 });
  });

  it("follows its child as the child's own state moves it", () => {
    const world = new World();
    const game = new Stage();
    world.mount(game);
    assert.deepEqual(game.camera.worldToView(0, 0), { x: 0, y: 0 });
    world.tick(3);
    assert.equal(game.player.transform.x, 30);
    assert.equal(game.player.worldTransform().x, 30, "the camera did not move the player, or zoom it");
    assert.deepEqual(game.camera.worldToView(30, 0), { x: 0, y: 0 }, "the view is on the player");
    assert.deepEqual(game.camera.worldToView(31, 0), { x: 2, y: 0 }, "and zoomed in");
  });

  it("centres on the middle of its children when a conditional one appears and leaves", () => {
    const world = new World();
    const game = new Stage();
    world.mount(game);
    world.tick(1); // the player is at 10
    game.s.pet = true;
    world.flush();
    assert.equal(game.camera.children.length, 2, "the pet is a child of the camera");
    assert.equal(game.sprite!.worldTransform().x, 100, "placed in the camera's parent's space");
    const view = game.camera.worldToView(55, 0); // (10 + 100) / 2
    assert.ok(Math.abs(view.x) < 1e-9 && Math.abs(view.y) < 1e-9, `${JSON.stringify(view)}`);
    game.s.pet = false;
    world.flush();
    assert.deepEqual(game.camera.worldToView(10, 0), { x: 0, y: 0 }, "back on the player");
  });

  it("follows the middle of a list of children as it grows and shrinks", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    assert.deepEqual(swarm.camera.worldToView(0, 0), { x: 0, y: 0 }, "no children: where it is");
    swarm.s.units = [
      { id: "a", x: 0 },
      { id: "b", x: 100 },
    ];
    world.flush();
    assert.deepEqual(swarm.camera.worldToView(50, 0), { x: 0, y: 0 });
    swarm.s.units = [
      { id: "b", x: 100 },
      { id: "c", x: 300 },
    ];
    world.flush();
    assert.deepEqual(swarm.camera.worldToView(200, 0), { x: 0, y: 0 });
  });

  it("still follows the entity it is inside, by nesting, when it has no children of its own", () => {
    const world = new World();
    const hero = new Hero();
    world.mount(hero);
    world.tick(3);
    assert.deepEqual(hero.camera.worldToView(30, 0), { x: 0, y: 0 });
    assert.deepEqual(hero.camera.worldToView(31, 0), { x: 2, y: 0 });
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

describe("a camera rig passes what it follows through {children}", () => {
  const RIG = `
import { type Child, Camera, Entity, Sprite, useMutable, useUpdate } from "@tsengine/runtime/jsx";

interface RigProps {
  children: Child;
}

function Rig({ children }: RigProps) {
  return <Camera zoom={3}>{children}</Camera>;
}

function Runner() {
  const s = useMutable({ x: 0 });
  useUpdate((dt) => { s.x += dt * 4; });
  return <Entity name="Runner" transform={{ x: s.x }}><Sprite image="runner.png" /></Entity>;
}

function Stage() {
  return (
    <Entity name="Stage">
      <Rig>
        <Runner />
      </Rig>
    </Entity>
  );
}`;
  interface StageInstance extends Entity {
    readonly rig: Camera;
    readonly runner: Entity;
  }
  let Stage: new () => StageInstance;
  before(async () => {
    ({ Stage } = await load<{ Stage: typeof Stage }>(compile(RIG, "Stage.tsx")));
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(RIG, "Stage.tsx")), []);
  });

  it("follows the child a parent passes in", () => {
    const world = new World();
    const stage = new Stage();
    world.mount(stage);
    assert.ok(stage.rig instanceof Camera);
    assert.equal(stage.runner.parent, stage.rig, "the passed child is mounted in the camera");
    world.tick(5);
    assert.equal(stage.runner.transform.x, 20);
    assert.deepEqual(stage.rig.worldToView(20, 0), { x: 0, y: 0 });
    assert.deepEqual(stage.rig.worldToView(21, 0), { x: 3, y: 0 }, "at the rig's zoom");
  });
});

describe("<Camera>: diagnostics", () => {
  it("lets state take the camera's own names, kept in `$name` fields", () => {
    for (const name of ["zoom", "viewTransform", "worldToView", "viewToWorld", "childSpace"]) {
      assert.ok(compile(`function C() { const ${name} = useMutable({ n: 1 }); return <Camera />; }`).code.includes(`get $${name}()`), name);
    }
  });
});
