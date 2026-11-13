/**
 * Rewind (REACT_FEEL_PLAN.md D1) on a real game: Hearth's battle, in components, played from its winning replay through rewind,
 * then sent back and played again from a snapshot. A replay that differed from the recording would name the frame.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlayer, parseInputScript, RecordingBackend, replayMoment, Rewind, type Player } from "@rge/player";
import { bindings, gameConfig, screen } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { battleOf, findPlay } from "./battle-state.ts";
import { REPLAYS } from "./replays.ts";

const stores = new Map([["src/GameState.ts#useGame", useGame.store]]);
const battle = (): unknown => {
  const play = findPlay();
  return play === null ? useGame.getState().screen : battleOf(play);
};

describe("rewind on Hearth", () => {
  it("goes back to a frame in a wave and plays it again exactly as it was recorded", async () => {
    const backend = new RecordingBackend();
    const script = parseInputScript(REPLAYS.good, { bindings, screen }).slice(0, 900);
    for (const frame of script) backend.queueInput(frame);
    const rewind = new Rewind(backend, { config: () => gameConfig, stores: () => stores });
    const player: Player = createPlayer(rewind.backend, gameConfig);
    rewind.attach(player);
    const seen: unknown[] = [];
    try {
      for (let i = 0; i < script.length; i++) {
        rewind.step();
        seen.push(JSON.stringify(battle()));
      }
      assert.ok(rewind.snapshotFrames.length >= 10, `snapshots: ${rewind.snapshotFrames.length}`);
      // Back into the first wave (enemies on the road, towers firing), between two snapshots.
      rewind.pause();
      rewind.seek(700);
      assert.equal(rewind.divergence, null, "every frame replayed as it was recorded");
      assert.equal(JSON.stringify(battle()), seen[699], "the battle at frame 700, as it was");
      rewind.seek(431);
      assert.equal(rewind.divergence, null);
      assert.equal(JSON.stringify(battle()), seen[430]);

      // The moment from the snapshot before frame 431 to it, played again as a test would.
      const moment = rewind.moment();
      assert.equal(moment.frame, 420);
      const states = replayMoment(gameConfig, JSON.parse(JSON.stringify(moment)), { stores: { useGame: useGame.store }, observe: () => JSON.stringify(battle()) });
      assert.equal(states.at(-1), seen[430], "a saved moment replays to the same battle");
    } finally {
      player.close();
    }
  });
});
