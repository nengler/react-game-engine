/**
 * Rewind (REACT_FEEL_PLAN.md D1) on a platformer, where a bug is a frame-exact jump: Kite's first rooms, played through rewind,
 * then sent back to frames in the middle of wall jumps and played again from a snapshot. Every frame must replay as recorded.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlayer, parseInputScript, RecordingBackend, Rewind } from "@rge/player";
import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { REPLAYS } from "./replays.ts";

describe("rewind on Kite", () => {
  it("goes back into the jumps of the first rooms and plays every frame again as it was recorded", () => {
    const stores = new Map([["src/GameState.ts#useGame", useGame.store]]);
    const frames = parseInputScript(`Enter, _*3, ${REPLAYS.slice(0, 3).join(", ")}`, { bindings });
    const backend = new RecordingBackend();
    for (const frame of frames) backend.queueInput(frame);
    const rewind = new Rewind(backend, { config: () => gameConfig, stores: () => stores, snapshotEvery: 60 });
    const player = createPlayer(rewind.backend, gameConfig);
    rewind.attach(player);
    const seen: string[] = [];
    try {
      for (let i = 0; i < frames.length; i++) {
        rewind.step();
        seen.push(JSON.stringify(useGame.getState().run));
      }
      rewind.pause();
      // Frames spread over the three rooms, each between two snapshots.
      for (const at of [45, 233, 517, Math.floor(frames.length * 0.8)]) {
        rewind.seek(at);
        assert.equal(rewind.divergence, null, `frame ${at}: every frame replayed as it was recorded`);
        assert.equal(JSON.stringify(useGame.getState().run), seen[at - 1], `the run at frame ${at}, as it was`);
      }
      // Stepping one frame at a time, as ← and → do.
      rewind.seek(300);
      rewind.seek(301);
      assert.equal(JSON.stringify(useGame.getState().run), seen[300]);
    } finally {
      player.close();
    }
  });
});
