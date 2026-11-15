import assert from "node:assert/strict";
/** Named input actions: createControls, <Game controls>, and input.pressed("jump") meaning any of the action's keys. */
import { describe, it } from "node:test";

import { Entity, Game, createControls, createInputState, type InputState } from "@rge/runtime";

import { createPlayer, parseInputScript, RecordingBackend } from "../src/index.ts";

const controls = createControls({ jump: ["Z", "Space", "PadA"], left: ["ArrowLeft", "A"] });

describe("createControls", () => {
  it("answers for an action from any of its keys, and for a plain key as before", () => {
    const input = createInputState({ down: ["Space", "A"], pressed: ["Space"], released: ["Z"] }, controls);
    assert.equal(input.down("jump"), true);
    assert.equal(input.pressed("jump"), true);
    assert.equal(input.released("jump"), false, "Z went up but Space is still held: the action is not released");
    assert.equal(input.down("left"), true);
    assert.equal(input.down("Space"), true, "a key name still works");
    assert.equal(createInputState({ released: ["Z"] }, controls).released("jump"), true);
    assert.throws(() => createControls({ jump: [] }), /'jump' has no keys/);
  });

  it("takes only key names the player knows: a misspelt one is a type error (checked by npm run typecheck)", () => {
    // @ts-expect-error "Spcae" is not a KeyName (tsc says: Did you mean '"Space"'?)
    const typo = createControls({ jump: ["Z", "Spcae"] });
    assert.deepEqual(typo.keysOf("jump"), ["Z", "Spcae"], "at run time it is still a binding, which warns when it is read");
  });

  it("is the game's when <Game controls> has it: a handler asks for an action, and a script can use the same names", () => {
    const seen: string[] = [];
    class Probe extends Entity {
      override onUpdate(_dt: number, input?: InputState): void {
        if (input?.pressed("jump")) seen.push("jump");
        if (input?.down("left")) seen.push("left");
      }
    }
    const backend = new RecordingBackend({});
    for (const frame of parseInputScript("_, PadA, _, A*2, _", { bindings: { PadA: "PadA", A: "A" } })) backend.queueInput(frame);
    const player = createPlayer(backend, {
      root: () => {
        const game = new Game({ controls, fixedStep: 60 });
        game.addChild(new Probe());
        return game;
      },
    });
    for (let i = 0; i < 6; i++) player.step();
    player.close();
    assert.deepEqual(seen, ["jump", "left", "left"]);
    assert.deepEqual(
      parseInputScript("jump", { bindings: controls.bindings })[0]?.down.sort(),
      ["PadA", "Space", "Z"],
      "a script's 'jump' holds the action's keys"
    );
  });
});
