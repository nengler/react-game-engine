import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/**
 * Sharing state between components (REACT_FEEL_PLAN.md, A6): lifted up to a common parent and passed down by props or through
 * context, with the timing pinned. A value a child reports up in a step is seen, in that step, by a sibling after it that reads it by
 * a prop (props are read live in handlers); a value passed by context is still the one the parent last rendered, seen in the next step.
 */
import { after, describe, it } from "node:test";

import { Entity, World } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, load } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const LEVEL = `import { createContext } from "@tsengine/runtime";
export const PlayerAt = createContext(0);
`;

// The player moves one pixel a step and reports where it is; the chaser (by props) and the watcher (through context) record what
// they saw in each of their updates.
const SOURCE = `import { Entity, useContext, useMutable, useUpdate } from "@tsengine/runtime/jsx";
import { PlayerAt } from "./level.ts";

interface PlayerProps { onMove: (x: number) => void }
function Player({ onMove }: PlayerProps) {
  const s = useMutable({ x: 0 });
  useUpdate(() => {
    s.x += 1;
    onMove(s.x);
  });
  return <Entity transform={{ x: s.x }} />;
}
interface ChaserProps { target: number; onSee: (x: number) => void }
function Chaser({ target, onSee }: ChaserProps) {
  useUpdate(() => { onSee(target); });
  return <Entity />;
}
interface WatcherProps { onSee: (x: number) => void }
function Watcher({ onSee }: WatcherProps) {
  const at = useContext(PlayerAt);
  useUpdate(() => { onSee(at); });
  return <Entity />;
}
interface LevelProps { onChaserSees: (x: number) => void; onWatcherSees: (x: number) => void }
export function Level({ onChaserSees, onWatcherSees }: LevelProps) {
  const s = useMutable({ playerX: 0 });
  return (
    <Entity>
      <Player onMove={(x) => { s.playerX = x; }} />
      <Chaser target={s.playerX} onSee={onChaserSees} />
      <PlayerAt.Provider value={s.playerX}>
        <Watcher onSee={onWatcherSees} />
      </PlayerAt.Provider>
    </Entity>
  );
}`;

describe("sharing state between components", () => {
  it("lifts it up: what a child reports in a step, a later sibling sees at once, by props and through context alike", async () => {
    const compiled = compile(SOURCE, "Level.tsx");
    mkdirSync(dirname(compiled.fileName), { recursive: true });
    writeFileSync(join(dirname(compiled.fileName), "..", "level.ts"), LEVEL);
    type P = { onChaserSees: (x: number) => void; onWatcherSees: (x: number) => void };
    const { Level } = await load<{ Level: new (p: P) => Entity }>(compiled);
    const byProps: number[] = [];
    const byContext: number[] = [];
    const world = new World();
    world.mount(new Level({ onChaserSees: (x) => byProps.push(x), onWatcherSees: (x) => byContext.push(x) }));
    world.flush();
    for (let i = 0; i < 4; i++) {
      world.tick(1 / 60);
      world.flush();
    }
    // Step 1: the player moves to 1 and reports it. The chaser, after it in the tree, reads `target` as the parent has it now: 1.
    assert.deepEqual(byProps, [1, 2, 3, 4]);
    // The watcher reads a context value live too (its provider's getter): 1, not the 0 the provider was last given. Before, a context
    // value lagged a step; it was one of the three places props were not yet live.
    assert.deepEqual(byContext, [1, 2, 3, 4]);
  });
});
