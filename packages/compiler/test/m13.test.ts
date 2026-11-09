/**
 * M13: `<AnimatedSprite>`. Cycles through `frames` at `fps`; `playing={false}`
 * freezes it; different `frames` restart it. Advancing is not state, so it
 * costs no renders. A component rooted at one that writes its own `useUpdate`
 * must still animate, so the generated override calls `super` first.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnimatedSprite, Entity, World, runtimeManifest } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, elementOf, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
function Walker() {
  const [running, setRunning] = useState(true);
  const [n, setN] = useState(0);
  return (
    <Entity name={\`Walker \${n}\`}>
      <AnimatedSprite frames={running ? ["run1.png", "run2.png", "run3.png"] : ["idle1.png", "idle2.png"]} fps={8} playing={running} />
      <AnimatedSprite frames={["blink1.png", "blink2.png"]} />
    </Entity>
  );
}

interface FlameProps {
  fps: number;
}

function Flame({ fps }: FlameProps) {
  const ticks = useRef(0);
  useUpdate(() => {
    ticks.current += 1;
  });
  return <AnimatedSprite frames={["f1.png", "f2.png"]} fps={fps} />;
}

interface LoopProps {
  frames: string[];
}

const Loop = ({ frames }: LoopProps) => <AnimatedSprite frames={frames} fps={2} />;

function Twice() {
  const ticks = useRef(0);
  useUpdate((dt) => {
    ticks.current += 1;
  });
  useUpdate(() => {
    if (ticks.current > 100) return;
    ticks.current += 10;
  });
  return <AnimatedSprite frames={["t1.png", "t2.png"]} fps={4} />;
}
`;

interface WalkerInstance extends Entity {
  setRunning(value: boolean): void;
  setN(value: number): void;
  readonly animatedSprite: AnimatedSprite;
  readonly animatedSprite2: AnimatedSprite;
}
interface FlameInstance extends AnimatedSprite {
  ticks: number;
  updateProps(next: { fps: number }): void;
}
interface TwiceInstance extends AnimatedSprite {
  ticks: number;
}
interface LoopInstance extends AnimatedSprite {
  updateProps(next: { frames: string[] }): void;
}

let Walker: new () => WalkerInstance;
let Flame: new (props: { fps: number }) => FlameInstance;
let Twice: new () => TwiceInstance;
let Loop: new (props: { frames: string[] }) => LoopInstance;

before(async () => {
  ({ Walker, Flame, Twice, Loop } = await load<{ Walker: typeof Walker; Flame: typeof Flame; Twice: typeof Twice; Loop: typeof Loop }>(compile(SOURCE, "Anim.tsx")));
});

describe("M13: IR and generated code", () => {
  const compiled = compile(SOURCE, "Anim.tsx");
  const walker = compiled.ir.components.find((c) => c.name === "Walker")!;
  const [moving, still] = walker.root.children.map((c) => elementOf(c));

  it("makes frames that depend on state a dynamic prop, and a fixed list a static one", () => {
    const frames = moving!.props.find((p) => p.name === "frames")!;
    assert.equal(frames.kind, "DynamicProp");
    assert.deepEqual(frames.kind === "DynamicProp" && frames.dependencies, [{ kind: "State", state: "Walker.running" }]);
    assert.equal(frames.kind === "DynamicProp" && frames.value.kind, "Conditional");
    assert.equal(still!.props.find((p) => p.name === "frames")!.kind, "StaticProp");
    assert.equal(moving!.props.find((p) => p.name === "fps")!.kind, "StaticProp");
  });

  it("builds the sprite with its frames, and re-assigns only what varies", () => {
    assert.match(compiled.code, /readonly animatedSprite: AnimatedSprite = new AnimatedSprite\(\{ frames: this\.running \? \["run1\.png", "run2\.png", "run3\.png"\] : \["idle1\.png", "idle2\.png"\], fps: 8, playing: this\.running \}\);/);
    assert.match(compiled.code, /readonly animatedSprite2: AnimatedSprite = new AnimatedSprite\(\{ frames: \["blink1\.png", "blink2\.png"\] \}\);/);
    assert.match(compiled.code, /this\.animatedSprite\.frames = this\.running \? \[/);
    assert.match(compiled.code, /this\.animatedSprite\.playing = this\.running;/);
    assert.doesNotMatch(compiled.code, /this\.animatedSprite2\./, "a fixed sprite is never touched by render");
  });

  it("calls super first in a hook override on a component rooted at one that implements the hook", () => {
    assert.match(compiled.code, /override onUpdate\(dt: number\): void \{\n\s+super\.onUpdate\(dt\);\n\s+this\.#onUpdate0\(\);\n\s+\}/);
    assert.match(compiled.code, /#onUpdate0\(\): void \{\n\s+this\.ticks \+= 1;/);
  });

  it("calls super once, then each handler in order, when there are several", () => {
    assert.match(compiled.code, /override onUpdate\(dt: number\): void \{\n\s+super\.onUpdate\(dt\);\n\s+this\.#onUpdate0\(dt\);\n\s+this\.#onUpdate1\(\);\n\s+\}/);
  });

  it("does not add super to a component whose root does not implement the hook", () => {
    const plain = compile(`function C() { const r = useRef(0); useUpdate(() => { r.current += 1; }); return <Sprite image="a.png" />; }`);
    assert.doesNotMatch(plain.code, /super\.onUpdate/);
    assert.match(plain.code, /override onUpdate\(\): void \{/);
    const mount = compile(`function C() { const r = useRef(0); useMount(() => { r.current += 1; }); return <AnimatedSprite frames={["a.png"]} />; }`);
    assert.doesNotMatch(mount.code, /super\.onMount/, "the sprite does not implement onMount");
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("M13: authored source type-checks", () => {
  const check = (body: string) =>
    getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/M13${Math.random()}.tsx`,
        text: `import { Entity, AnimatedSprite } from "@rge/runtime/jsx";\nfunction C({ on, names }: { on: boolean; names: string[] }) { return <Entity name="C">${body}</Entity>; }`,
      },
    ]);

  it("accepts a list of images, an fps, a playing flag, and a list that comes from a prop", () => {
    assert.deepEqual(check(`<AnimatedSprite frames={["a.png", "b.png"]} />`), []);
    assert.deepEqual(check(`<AnimatedSprite frames={on ? ["a.png"] : ["b.png"]} fps={12} playing={on} />`), []);
    assert.deepEqual(check(`<AnimatedSprite frames={names} transform={{ x: 4 }} />`), []);
  });

  it("rejects frames that are missing, a string, or not images, and a wrong fps or playing", () => {
    assert.ok(check(`<AnimatedSprite />`).length > 0, "frames is required");
    assert.ok(check(`<AnimatedSprite frames="a.png" />`).length > 0);
    assert.ok(check(`<AnimatedSprite frames={[1, 2]} />`).length > 0);
    assert.ok(check(`<AnimatedSprite frames={["a.png"]} fps="fast" />`).length > 0);
    assert.ok(check(`<AnimatedSprite frames={["a.png"]} playing={1} />`).length > 0);
  });
});

describe("M13: runtime behaviour", () => {
  it("advances at fps from the world's tick, without rendering", () => {
    const world = new World();
    const walker = new Walker();
    world.mount(walker);
    const sprite = walker.animatedSprite;
    assert.deepEqual([sprite.image, sprite.fps], ["run1.png", 8]);
    assert.equal(world.tick(0.125), 0, "advancing a frame renders nothing");
    assert.equal(sprite.image, "run2.png");
    world.tick(0.125);
    world.tick(0.125);
    assert.equal(sprite.image, "run1.png", "it loops");
  });

  it("freezes on playing={false} and restarts when frames change, as state flips", () => {
    const world = new World();
    const walker = new Walker();
    world.mount(walker);
    const sprite = walker.animatedSprite;
    world.tick(0.125);
    assert.equal(sprite.image, "run2.png");
    walker.setRunning(false);
    world.flush();
    assert.deepEqual([sprite.playing, sprite.image, sprite.frame], [false, "idle1.png", 0], "different frames restart at the first");
    world.tick(1);
    assert.equal(sprite.frame, 0, "frozen");
    walker.setRunning(true);
    world.flush();
    assert.deepEqual([sprite.playing, sprite.image], [true, "run1.png"], "restarted again");
    world.tick(0.125);
    assert.equal(sprite.image, "run2.png", "and playing");
  });

  it("does not restart when the component renders again with equal frames", () => {
    const world = new World();
    const walker = new Walker();
    world.mount(walker);
    const sprite = walker.animatedSprite;
    world.tick(0.125);
    world.tick(0.0625);
    assert.deepEqual([sprite.frame, sprite.elapsed], [1, 0.0625]);
    walker.setN(1); // the component renders and assigns a fresh, equal array
    assert.equal(world.flush(), 1);
    assert.deepEqual([sprite.frame, sprite.elapsed], [1, 0.0625], "the animation carried on");
  });

  it("leaves a fixed sprite alone and keeps animating it", () => {
    const world = new World();
    const walker = new Walker();
    world.mount(walker);
    const blink = walker.animatedSprite2;
    world.tick(0.1);
    assert.equal(blink.image, "blink2.png");
    walker.setRunning(false);
    world.flush();
    assert.equal(blink.image, "blink2.png", "its frames never changed, so it did not restart");
  });

  it("animates a component rooted at one even though it writes its own useUpdate", () => {
    const world = new World();
    const flame = new Flame({ fps: 10 });
    world.mount(flame);
    assert.ok(flame instanceof AnimatedSprite);
    world.tick(0.1);
    world.tick(0.1);
    assert.equal(flame.ticks, 2, "its own handler ran");
    assert.equal(flame.image, "f1.png", "and the sprite advanced two frames, back to the first");
    world.tick(0.1);
    assert.equal(flame.image, "f2.png");
  });

  it("works as a root whose frames come from a prop: the required prop is a placeholder until the first render", () => {
    assert.match(compile(SOURCE, "Anim.tsx").code, /super\(\{ fps: 2, frames: undefined as never \}, props\);/);
    const world = new World();
    const loop = new Loop({ frames: ["a.png", "b.png"] });
    world.mount(loop);
    assert.deepEqual([loop.image, loop.frames], ["a.png", ["a.png", "b.png"]]);
    world.tick(0.5);
    assert.equal(loop.image, "b.png");
    loop.updateProps({ frames: ["a.png", "b.png"] });
    world.flush();
    assert.equal(loop.image, "b.png", "equal frames from the parent do not restart it");
    loop.updateProps({ frames: ["x.png", "y.png"] });
    world.flush();
    assert.deepEqual([loop.image, loop.frame], ["x.png", 0], "different frames do");
  });

  it("follows a prop that changes its fps", () => {
    const world = new World();
    const flame = new Flame({ fps: 1 });
    world.mount(flame);
    world.tick(0.5);
    assert.equal(flame.image, "f1.png");
    flame.updateProps({ fps: 4 });
    world.flush();
    world.tick(0.25);
    assert.equal(flame.image, "f2.png");
  });

  it("runs every handler and the sprite's own advance when there are several", () => {
    const world = new World();
    const twice = new Twice();
    world.mount(twice);
    world.tick(0.25);
    assert.equal(twice.ticks, 11, "both handlers ran");
    assert.equal(twice.image, "t2.png", "and the sprite advanced");
  });
});

describe("M13: the manifest says which hooks a built-in implements", () => {
  it("lists onUpdate for AnimatedSprite and no other built-in", () => {
    assert.deepEqual(runtimeManifest.intrinsicHooks, { AnimatedSprite: ["onUpdate"] });
  });

  it("is driven by the manifest, not by AnimatedSprite: any intrinsic can be marked", () => {
    const withSuper = (manifest: typeof runtimeManifest) => {
      const compiler = new (getCompiler().constructor as new (config: object) => ReturnType<typeof getCompiler>)({ manifest });
      try {
        const result = compiler.compile("C.tsx", `import { Sprite, useUpdate, useRef } from "@rge/runtime/jsx";\nfunction C() { const r = useRef(0); useUpdate((dt) => { r.current += dt; }); return <Sprite image="a.png" />; }`);
        assert.ok(result.ok, JSON.stringify(result.diagnostics));
        return result.code;
      } finally {
        compiler.close();
      }
    };
    assert.doesNotMatch(withSuper(runtimeManifest), /super\.onUpdate/);
    assert.match(withSuper({ ...runtimeManifest, intrinsicHooks: { Sprite: ["onUpdate"] } }), /override onUpdate\(dt: number\): void \{\n\s+super\.onUpdate\(dt\);\n\s+this\.#onUpdate0\(dt\);/);
  });

  it("reserves the sprite's own names for a component rooted at it", () => {
    for (const name of ["frames", "fps", "playing", "frame", "elapsed", "image"]) {
      const codes = getCompiler()
        .compile("C.tsx", `import { AnimatedSprite, useState } from "@rge/runtime/jsx";\nfunction C() { const [${name}, set] = useState(1); return <AnimatedSprite frames={["a.png"]} />; }`)
        .diagnostics.map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), name);
    }
  });
});
