import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Entity, Music, Sound } from "@tsengine/runtime";

import { createPlayer, RecordingBackend, type PlayerConfig } from "../src/index.ts";

function run(
  root: PlayerConfig["root"],
  dts: number[],
  options: ConstructorParameters<typeof RecordingBackend>[0] = {},
  after?: (step: number) => void
): { backend: RecordingBackend; warnings: string[] } {
  const backend = new RecordingBackend(options);
  const warnings: string[] = [];
  for (const dt of dts) backend.queueInput({ dt });
  const player = createPlayer(backend, { root, warn: (m) => warnings.push(m) });
  for (let i = 0; i <= dts.length; i++) {
    player.step();
    after?.(i);
  }
  player.close();
  return { backend, warnings };
}

describe("sounds with a volume", () => {
  it("play at the volume asked, at full volume by default, over themselves (each play is its own call to the backend)", () => {
    let sound!: Sound;
    const { backend } = run(
      () => {
        sound = new Sound("hit.wav");
        return new Entity();
      },
      [1 / 60],
      {},
      (step) => {
        if (step === 0) {
          sound.play();
          sound.play(0.25);
          sound.play(0.25);
        }
      }
    );
    assert.deepEqual(backend.soundLoads, ["assets/hit.wav"], "loaded once");
    assert.deepEqual(
      backend.playVolumes.map((p) => p.volume),
      [1, 0.25, 0.25]
    );
    assert.deepEqual(backend.plays, ["assets/hit.wav", "assets/hit.wav", "assets/hit.wav"]);
  });
});

describe("<Music>", () => {
  const music = (props: Partial<ConstructorParameters<typeof Music>[0]> = {}): Music => new Music({ src: "theme.ogg", ...props });

  it("opens the stream when it is made, starts it silent and fades it in over its fade time, and loops by default", () => {
    const { backend } = run(
      () => music({ volume: 0.8, fade: 0.5 }),
      Array.from({ length: 40 }, () => 1 / 60)
    );
    assert.equal(backend.musicEvents[0], "load:assets/theme.ogg");
    assert.equal(backend.musicEvents[1], "play:assets/theme.ogg:0:true");
    const volumes = backend.musicEvents.filter((e) => e.startsWith("volume:")).map((e) => Number(e.split(":").at(-1)));
    assert.ok(
      volumes.every((v, i) => i === 0 || v >= (volumes[i - 1] as number)),
      "rising"
    );
    assert.equal(volumes.at(-1), 0.8, "up to the volume and no further");
    assert.ok(volumes.length >= 20 && volumes.length < 40, "it stops sending volumes once it arrives");
  });

  it("fades out and stops when playing turns off, and starts again from the beginning when it turns on", () => {
    let m!: Music;
    const { backend } = run(
      () => (m = music({ fade: 0.1 })),
      Array.from({ length: 30 }, () => 1 / 60),
      {},
      (step) => {
        if (step === 8) m.playing = false;
        if (step === 20) m.playing = true;
      }
    );
    const kinds = backend.musicEvents.map((e) => e.split(":")[0]);
    assert.deepEqual(
      kinds.filter((k) => k !== "volume"),
      ["load", "play", "stop", "play"]
    );
    assert.ok(kinds.indexOf("stop") > kinds.indexOf("volume"), "it faded before it stopped");
  });

  it("keeps playing while the rest of the world changes around it", () => {
    let root!: Entity;
    let m!: Music;
    const { backend } = run(
      () => {
        root = new Entity();
        m = music({ fade: 0 });
        root.addChild(m);
        return root;
      },
      Array.from({ length: 10 }, () => 1 / 60),
      {},
      (step) => {
        if (step === 3) root.queueAddChild(new Entity());
        if (step === 5) root.queueRemoveChild(root.children[1] as Entity);
      }
    );
    assert.deepEqual(
      backend.musicEvents.filter((e) => !e.startsWith("load")),
      ["play:assets/theme.ogg:1:true"],
      "started once, never restarted or stopped"
    );
    assert.equal(m.started, true);
  });

  it("warns once for a file that cannot be loaded, and plays nothing", () => {
    const { backend, warnings } = run(() => music(), [1 / 60, 1 / 60, 1 / 60], { missingMusic: ["assets/theme.ogg"] });
    assert.deepEqual(warnings, ["Could not load the music 'assets/theme.ogg': it will not play."]);
    assert.deepEqual(backend.musicEvents, ["load:assets/theme.ogg"]);
  });

  it("does not loop when told not to, and treats a fade of 0 as an instant switch", () => {
    const { backend } = run(() => music({ loop: false, fade: 0, volume: 0.5 }), [1 / 60, 1 / 60]);
    assert.ok(backend.musicEvents.includes("play:assets/theme.ogg:0.5:false"));
  });
});
