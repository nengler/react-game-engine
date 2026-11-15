import { createPlayer, parseInputScript, RecordingBackend, Rewind } from "@tsengine/player";
import { captureHotState } from "@tsengine/runtime";

import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { REPLAYS } from "../test/replays.ts";
const stores = new Map([["k", useGame.store]]);
const frames = parseInputScript(`Enter, _*3, ${REPLAYS[0]}`, { bindings });
const backend = new RecordingBackend();
for (const f of frames) backend.queueInput(f);
const rewind = new Rewind(backend, { config: () => gameConfig, stores: () => stores });
const player = createPlayer(rewind.backend, gameConfig);
rewind.attach(player);
const snap = (): Map<string, string> =>
  new Map([...captureHotState(player.world.root.children[0]!)].map(([k, v]) => [k, JSON.stringify(v)]));
let at2: Map<string, string> | null = null;
let st2 = "";
for (let i = 1; i <= 60; i++) {
  rewind.step();
  if (i === 2) {
    at2 = snap();
    st2 = JSON.stringify(useGame.store.values());
  }
}
rewind.pause();
rewind.seek(2);
const now = snap();
for (const [k, v] of at2!) if (now.get(k) !== v) console.log("DIFF", k, v.slice(0, 300), "||", (now.get(k) ?? "MISSING").slice(0, 300));
for (const k of now.keys()) if (!at2!.has(k)) console.log("EXTRA", k);
const st = JSON.stringify(useGame.store.values());
if (st !== st2) {
  for (let i = 0; i < st.length; i++)
    if (st[i] !== st2[i]) {
      console.log("STORE", st2.slice(i - 80, i + 80), "\n||", st.slice(i - 80, i + 80));
      break;
    }
}
