import { createGameState } from "@rge/runtime";
import { playEvents, sfx } from "./effects.ts";
import { newBattle, stepBattle, type Battle, type Command } from "./rules/battle.ts";
import { MAP } from "./rules/map.ts";
import { STEP } from "./rules/constants.ts";
import type { TowerKind } from "./rules/towers.ts";

type Screen = "title" | "play" | "won" | "lost";

/**
 * The game's shared state: which screen is showing, the whole battle as one object (the rules' state, replaced each step), and
 * the panel's cursor. The rules are in `rules/`; `step` is the one place a step of the battle is taken, and everything else is an
 * action: a pad taking the focus or being pressed, a button (clicked, or pressed by its key) queueing a command for the next step.
 * What the panel shows about the cursor's pad is not kept here: components work it out with a selector, `focusOf(s.battle, s.cursor)`.
 */
interface State {
  screen: Screen;
  battle: Battle;
  /** The pad the cursor is on (the focused pad), whether the panel shows it, the speed and whether the game is paused. */
  cursor: number;
  open: boolean;
  speed: 1 | 2;
  paused: boolean;
  /** Commands from the buttons and keys, waiting for the next step. */
  queue: readonly Command[];
  begin: () => void;
  toTitle: () => void;
  /** The focus came to a pad (the arrow keys, or a click): the cursor moves, the panel stays as it is. */
  point: (pad: number) => void;
  /** A pad was pressed (a click, or confirm on the focused pad): the cursor moves and the panel opens. */
  select: (pad: number) => void;
  close: () => void;
  build: (kind: TowerKind) => void;
  upgrade: () => void;
  sell: () => void;
  startWave: () => void;
  toggleSpeed: () => void;
  togglePause: () => void;
  resume: () => void;
  /** One engine step: what was queued, run through the rules (twice at 2× speed). */
  step: (dt: number) => void;
}

/** A new run on `screen`: a fresh battle, the cursor on the first pad, normal speed, nothing queued. */
function freshRun(screen: Screen): Pick<State, "screen" | "battle" | "cursor" | "open" | "speed" | "paused" | "queue"> {
  return { screen, battle: newBattle(MAP), cursor: 0, open: false, speed: 1, paused: false, queue: [] };
}

/** Queue a command for the next step (nothing is queued while paused, as nothing would run). */
const queued = (s: State, command: Command): Partial<State> => (s.paused ? {} : { queue: [...s.queue, command] });

export const useGame = createGameState<State>()((set, get) => ({
  // Written out, not `...freshRun("title")`: the compiler reads the state's shape from this object.
  screen: "title",
  battle: newBattle(MAP),
  cursor: 0,
  open: false,
  speed: 1,
  paused: false,
  queue: [],
  begin: () => {
    sfx.play("click");
    set(freshRun("play"));
  },
  toTitle: () => set(freshRun("title")),
  point: (pad) => set({ cursor: pad }),
  select: (pad) => set({ cursor: pad, open: true }),
  close: () => set({ open: false }),
  build: (kind) => set((s) => queued(s, { type: "build", pad: s.cursor, kind })),
  upgrade: () => set((s) => queued(s, { type: "upgrade", pad: s.cursor })),
  sell: () => set((s) => queued(s, { type: "sell", pad: s.cursor })),
  startWave: () => set((s) => queued(s, { type: "startWave" })),
  toggleSpeed: () => set((s) => ({ speed: s.speed === 1 ? 2 : 1 })),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  resume: () => set({ paused: false }),
  step: (dt) => {
    const s = get();
    if (s.screen !== "play" || s.paused) return;
    let battle = s.battle;
    // The first fixed step of the frame takes the commands; at 2x speed a second one follows. With a fixed timestep dt is always STEP, so a
    // battle replays the same however fast the frames come.
    for (let i = 0; i < s.speed; i++) {
      const result = stepBattle(battle, dt > 0 ? dt : STEP, i === 0 ? s.queue : [], MAP);
      battle = result.battle;
      playEvents(result.events);
    }
    set({ battle, queue: [], screen: battle.status === "won" ? "won" : battle.status === "lost" ? "lost" : "play" });
  },
}));
