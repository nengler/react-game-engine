/**
 * Sharing state between components (REACT_FEEL_PLAN.md, A6): lifted up to a common parent and passed down by props or through
 * context, with the timing pinned. A value a child reports up in a step is seen by its siblings in the next one.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Entity, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const LEVEL = `import { createContext } from "@rge/runtime";
export const PlayerAt = createContext(0);
`;

// The player moves one pixel a step and reports where it is; the chaser (by props) and the watcher (through context) record what
// they saw in each of their updates.
const SOURCE = `import { Entity, useContext, useState, useUpdate } from "@rge/runtime/jsx";
import { PlayerAt } from "./level.ts";

interface PlayerProps { onMove: (x: number) => void }
function Player({ onMove }: PlayerProps) {
  const [x, setX] = useState(0);
  useUpdate(() => {
    setX(x + 1);
    onMove(x + 1);
  });
  return <Entity transform={{ x }} />;
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
  const [playerX, setPlayerX] = useState(0);
  return (
    <Entity>
      <Player onMove={(x) => setPlayerX(x)} />
      <Chaser target={playerX} onSee={onChaserSees} />
      <PlayerAt.Provider value={playerX}>
        <Watcher onSee={onWatcherSees} />
      </PlayerAt.Provider>
    </Entity>
  );
}`;

describe("sharing state between components", () => {
  it("lifts it up: what a child reports in a step, the others see in the next, by props and through context alike", async () => {
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
    // Step 1: the player moves to 1 and reports it; the others still see 0, the state as the step began.
    assert.deepEqual(byProps, [0, 1, 2, 3]);
    assert.deepEqual(byContext, [0, 1, 2, 3]);
  });
});
