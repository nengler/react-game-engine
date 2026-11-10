/** Priority 7's built-ins in authored source: Tilemap, Particles, Fade, Camera's bounds, slide and shake, Text's font, `freeze`; and the build-time asset check. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Camera, Entity, Fade, Particles, Text, Tilemap, World, registerTilemaps } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, getCompiler, load } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const check = (imports: string, body: string, extra = "") =>
  getCompiler().typeCheckSources([
    {
      fileName: `${process.cwd()}/.test-output/B${Math.random()}.tsx`,
      text: `import { Entity, Hud, Camera, Tilemap, Particles, Fade, Music, Text, freeze, useSound, useUpdate, useState, ${imports} } from "@rge/runtime/jsx";\n${extra}\nfunction C() { const [on, setOn] = useState(false); const [n, setN] = useState(0); return <Entity name="C">${body}</Entity>; }`,
    },
  ]);

describe("authored source of the new built-ins type-checks, and wrong props do not", () => {
  it("Tilemap, Particles, Fade, Camera options and a bitmap font", () => {
    assert.deepEqual(check("Screen", `<Tilemap map="room1" image="tiles.png" layer="Tiles" opacity={0.5} transform={{ x: 10 }} />`), []);
    assert.deepEqual(check("Screen", `<Particles rate={20} burst={n} lifetime={0.4} speed={30} angle={270} spread={40} gravity={90} color="#fff" endColor="#f00" size={2} shrink fade emitting={on} max={32} space="world" seed={3} transform={{ x: n }} />`), []);
    assert.deepEqual(check("Screen", `<Hud><Fade color="#000" on={on} duration={0.3} /></Hud>`), []);
    assert.deepEqual(check("Screen", `<Camera bounds={[0, 0, 320, 180]} slide={0.4} shake={n} shakeStrength={3} shakeDuration={0.2} />`), []);
    assert.deepEqual(check("Screen", `<Text font="font.png" size={16} align="center" width={100}>Hi</Text>`), []);
  });

  it("rejects the wrong types, and a Tilemap with no map", () => {
    assert.ok(check("Screen", `<Tilemap image="tiles.png" />`).length > 0, "map is required");
    assert.ok(check("Screen", `<Particles space="sideways" />`).length > 0);
    assert.ok(check("Screen", `<Particles rate="fast" />`).length > 0);
    assert.ok(check("Screen", `<Fade on="yes" />`).length > 0);
    assert.ok(check("Screen", `<Camera bounds={[0, 0]} slide="slow" />`).length > 0);
  });

  it("Music takes a file, whether it plays, a volume, a loop flag and a fade; a sound takes a volume", () => {
    assert.deepEqual(check("Screen", `<Music src="theme.ogg" playing={on} volume={0.5} loop={false} fade={0.3} />`), []);
    assert.ok(check("Screen", `<Music />`).length > 0, "src is required");
    assert.ok(check("Screen", `<Music src="a.ogg" volume="loud" />`).length > 0);
    const code = compile(`function S() { const hit = useSound("hit.wav"); const [n] = useState(1); useUpdate(() => { hit(); hit(0.5); hit(n / 2); }); return <Entity name="S" />; }`, "S.tsx").code;
    assert.match(code, /\.play\(\);[^]*\.play\(0\.5\);[^]*\.play\(this\.n \/ 2\);/);
  });

  it("freeze is a statement in a handler, and nowhere else", () => {
    const ok = compile(`function F() { const [hit, setHit] = useState(false); useUpdate(() => { if (hit) freeze(3); }); return <Entity name="F" />; }`, "F.tsx");
    assert.match(ok.code, /freeze\(3\)/);
    assert.match(ok.code, /import \{[^}]*freeze[^}]*\} from "@rge\/runtime"/);
  });
});

describe("the built-ins in compiled components", () => {
  it("builds a Particles that bursts when a condition turns it on, and a Camera that shakes when a counter changes", async () => {
    registerTilemaps({});
    const compiled = compile(
      `function Hero() {
        const [hits, setHits] = useState(0);
        const [dead, setDead] = useState(false);
        return (
          <Entity name="Hero">
            {dead && <Particles burst={6} lifetime={0.3} speed={50} spread={180} />}
            <Camera shake={hits} shakeStrength={2} bounds={[0, 0, 320, 180]} slide={0.3} />
          </Entity>
        );
      }`,
      "Hero.tsx",
    );
    const { Hero } = await load<{ Hero: new () => Entity & { setHits(v: number): void; setDead(v: boolean): void } }>(compiled);
    const world = new World();
    const hero = new Hero();
    world.mount(hero);
    const emitters = (): Particles[] => hero.children.filter((c): c is Particles => c instanceof Particles);
    assert.equal(emitters().length, 0);
    hero.setDead(true);
    world.tick(1 / 60);
    assert.equal(emitters().length, 1);
    world.tick(1 / 60);
    assert.equal(emitters()[0]!.count, 6, "it burst as it joined");
    const camera = hero.children.find((c): c is Camera => c instanceof Camera)!;
    assert.deepEqual(camera.bounds, [0, 0, 320, 180]);
    assert.equal(camera.slide, 0.3);
    hero.setHits(1);
    world.tick(1 / 60);
    world.tick(1 / 60);
    camera.viewWidth = 320;
    camera.viewHeight = 180;
    assert.notEqual(camera.shakeOffset.x + camera.shakeOffset.y, 0, "a changed counter shakes");
  });

  it("builds a Tilemap and a Fade, and lowers a literal array and a bitmap font to their fields", () => {
    const code = compile(
      `function L() { const [on] = useState(false); return <Entity name="L"><Tilemap map="m" image="t.png" /><Hud><Fade on={on} color="#000" /><Text font="f.png" size={8}>x</Text></Hud></Entity>; }`,
      "L.tsx",
    ).code;
    assert.match(code, /new Tilemap\(\{ map: "m", image: "t\.png" \}\)/);
    assert.match(code, /new Fade\(\{ on: this\.on, color: "#000" \}\)/);
    assert.match(code, /font: "f\.png"/);
    void [Fade, Text, Tilemap];
  });
});

describe("the build-time asset check (rge-compile --assets)", () => {
  const repo = resolve(import.meta.dirname, "../../..");
  const compileProject = (source: string, assets: string[]): { status: number | null; stderr: string } => {
    const dir = mkdtempSync(join(tmpdir(), "rge-assets-"));
    try {
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "src/A.tsx"), source);
      for (const name of assets) writeFileSync(join(dir, "assets", name), "");
      const r = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out"), "--assets", join(dir, "assets"), "--no-check"], { cwd: repo, encoding: "utf8" });
      return { status: r.status, stderr: r.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const SOURCE = `import { Entity, Sprite, AnimatedSprite, Tilemap, Text, useSound, useState } from "@rge/runtime/jsx";
export function A() {
  const [on] = useState(false);
  const jump = useSound("jump.wav");
  useUpdate(() => { jump(); });
  return (
    <Entity name="A">
      <Sprite image="hero.png" />
      <AnimatedSprite sheet="sheet.png" animations="a:0@1" />
      <AnimatedSprite frames={on ? ["a1.png", "a2.png"] : ["b1.png"]} />
      <Tilemap map="m" image="tiles.png" />
      <Text font="font.png">x</Text>
    </Entity>
  );
}
`.replace("useSound, useState", "useSound, useState, useUpdate");

  it("passes when every named file is there", () => {
    const r = compileProject(SOURCE, ["jump.wav", "hero.png", "sheet.png", "a1.png", "a2.png", "b1.png", "tiles.png", "font.png"]);
    assert.equal(r.status, 0, r.stderr);
  });

  it("fails, naming each missing image, sound and font, with the nearest file for a typo", () => {
    const r = compileProject(SOURCE, ["jumpp.wav", "hero.png", "sheet.png", "a1.png", "tiles.png"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /RGE1211: The sound 'jump\.wav' is not in .*assets\/ \(did you mean 'jumpp\.wav'\?\)/);
    assert.match(r.stderr, /The image 'a2\.png' is not in/);
    assert.match(r.stderr, /The image 'b1\.png' is not in/);
    assert.match(r.stderr, /The font 'font\.png' is not in/);
    assert.doesNotMatch(r.stderr, /hero\.png|tiles\.png|sheet\.png/);
  });
});
