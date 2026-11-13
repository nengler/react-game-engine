import { createGameState } from "@rge/runtime";
import { sfx } from "./effects.ts";

type Screen = "title" | "play" | "won" | "lost";

/**
 * What the screens share: which screen shows, the cursor (the pad the panel is about, which the pads and the side panel both
 * read), the speed and the pause (which `<Game timeScale paused>` reads), and how the last battle ended (for the end screen). The
 * battle itself is not here: `Play` keeps the gold, the lives and the wave, and each enemy, tower and shot keeps its own state.
 */
interface State {
  screen: Screen;
  /** The pad the cursor is on (the focused pad), and whether the panel shows it. */
  cursor: number;
  open: boolean;
  speed: 1 | 2;
  paused: boolean;
  /** The lives left and the wave reached when the last battle ended. */
  endLives: number;
  endWave: number;
  begin: () => void;
  toTitle: () => void;
  /** The focus came to a pad (the arrow keys, or a click): the cursor moves, the panel stays as it is. */
  point: (pad: number) => void;
  /** A pad was pressed (a click, or confirm on the focused pad): the cursor moves and the panel opens. */
  select: (pad: number) => void;
  close: () => void;
  toggleSpeed: () => void;
  togglePause: () => void;
  resume: () => void;
  /** The battle is over: `Play` says how it went, and the end screen shows. */
  finish: (won: boolean, lives: number, wave: number) => void;
}

/** The cursor on the first pad, the panel closed, normal speed, not paused. */
const fresh = { cursor: 0, open: false, speed: 1, paused: false } as const;

export const useGame = createGameState<State>()((set) => ({
  screen: "title",
  cursor: 0,
  open: false,
  speed: 1,
  paused: false,
  endLives: 0,
  endWave: 0,
  begin: () => {
    sfx.play("click");
    set({ ...fresh, screen: "play" });
  },
  toTitle: () => set({ ...fresh, screen: "title" }),
  point: (pad) => set({ cursor: pad }),
  select: (pad) => set({ cursor: pad, open: true }),
  close: () => set({ open: false }),
  toggleSpeed: () => set((s) => ({ speed: s.speed === 1 ? 2 : 1 })),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  resume: () => set({ paused: false }),
  finish: (won, lives, wave) => {
    sfx.play(won ? "win" : "lose");
    set({ screen: won ? "won" : "lost", endLives: lives, endWave: wave, paused: false, speed: 1 });
  },
}));
