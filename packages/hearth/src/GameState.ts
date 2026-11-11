import { createGameState } from "@rge/runtime";
import { playEvents, sfx } from "./effects.ts";
import { newBattle, stepBattle, type Battle, type Command } from "./rules/battle.ts";
import { MAP } from "./rules/map.ts";
import { STEP } from "./rules/constants.ts";
import { applyIntent, type Intent } from "./rules/ui.ts";
import type { TowerKind } from "./rules/towers.ts";

type Screen = "title" | "play" | "won" | "lost";

/**
 * The game's shared state: which screen is showing, the whole battle as one object (the rules' state, replaced each step), and
 * the panel's cursor. The rules are in `rules/`; `act` is the one place a step of the battle is taken, and everything else
 * (a click on a pad, a button in the panel) is an action that changes the cursor or queues a command for the next step.
 * What the panel shows about the cursor's pad is not kept here: components work it out with a selector, `focusOf(s.battle, s.cursor)`.
 */
interface State {
  screen: Screen;
  battle: Battle;
  /** The pad the cursor is on, whether the panel shows it, the speed and whether the game is paused. */
  cursor: number;
  open: boolean;
  speed: 1 | 2;
  paused: boolean;
  /** Commands from clicks, waiting for the next step. */
  queue: readonly Command[];
  begin: () => void;
  toTitle: () => void;
  /** The mouse (or a touch) chose a pad. */
  select: (pad: number) => void;
  build: (kind: TowerKind) => void;
  upgrade: () => void;
  sell: () => void;
  startWave: () => void;
  toggleSpeed: () => void;
  pause: () => void;
  resume: () => void;
  /** One engine step: what the keys asked for and what was queued, run through the rules (twice at 2× speed). */
  act: (intent: Intent, dt: number) => void;
}

/** A new run on `screen`: a fresh battle, the cursor on the first pad, normal speed, nothing queued. */
function freshRun(screen: Screen): Pick<State, "screen" | "battle" | "cursor" | "open" | "speed" | "paused" | "queue"> {
  return { screen, battle: newBattle(MAP), cursor: 0, open: false, speed: 1, paused: false, queue: [] };
}

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
  select: (pad) => set({ cursor: pad, open: true }),
  build: (kind) => set((s) => ({ queue: [...s.queue, { type: "build", pad: s.cursor, kind }] })),
  upgrade: () => set((s) => ({ queue: [...s.queue, { type: "upgrade", pad: s.cursor }] })),
  sell: () => set((s) => ({ queue: [...s.queue, { type: "sell", pad: s.cursor }] })),
  startWave: () => set((s) => ({ queue: [...s.queue, { type: "startWave" }] })),
  toggleSpeed: () => set((s) => ({ speed: s.speed === 1 ? 2 : 1 })),
  pause: () => set({ paused: true }),
  resume: () => set({ paused: false }),
  act: (intent, dt) => {
    const s = get();
    if (s.screen !== "play") return;
    // The pause key and the panel's buttons go through the same two actions.
    if (intent.pause) {
      if (s.paused) s.resume();
      else s.pause();
      return;
    }
    if (s.paused) return;
    const applied = applyIntent({ cursor: s.cursor, open: s.open, speed: s.speed }, intent, s.battle);
    let battle = s.battle;
    const commands = [...s.queue, ...applied.commands];
    // The first fixed step of the frame takes the commands; at 2x speed a second one follows. With a fixed timestep dt is always STEP, so a
    // battle replays the same however fast the frames come.
    for (let i = 0; i < applied.ui.speed; i++) {
      const result = stepBattle(battle, dt > 0 ? dt : STEP, i === 0 ? commands : [], MAP);
      battle = result.battle;
      playEvents(result.events);
    }
    set({
      battle,
      cursor: applied.ui.cursor,
      open: applied.ui.open,
      speed: applied.ui.speed,
      queue: [],
      screen: battle.status === "won" ? "won" : battle.status === "lost" ? "lost" : "play",
    });
  },
}));
