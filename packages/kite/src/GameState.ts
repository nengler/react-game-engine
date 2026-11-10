import { createGameState, freeze, type InputState } from "@rge/runtime";
import type { Body } from "./rules/body.ts";
import { readControls } from "./rules/controls.ts";
import { DASH_FREEZE_STEPS, DEATH_FREEZE_STEPS } from "./rules/constants.ts";
import { newRun, stepRun, type Run } from "./rules/level.ts";

/**
 * The game's state, shared by every component: which screen is showing, the run of the level (`Run`, see `rules/level.ts`)
 * and the actions that move it on. All the rules are plain functions in `rules/`; this file only keeps their state where
 * components can read it, and calls them. `step` is one fixed step of the game: the character passes the step's input and time (see
 * `Player.tsx`); the controls are read from the input here, in plain TypeScript (`rules/controls.ts`). A dash and a death freeze the world for a few steps from here, which is where they are known.
 */
interface State {
  /** `"title"`, `"play"` or `"end"`: the screens, switched by the `Main` component's conditions. */
  screen: string;
  room: number;
  originX: number;
  originY: number;
  player: Body;
  dead: boolean;
  deathTimer: number;
  deaths: number;
  transition: number;
  finished: boolean;
  steps: number;
  deathCount: number;
  roomCount: number;
  /** Gems collected: there is one in the level. */
  gems: number;
  step: (input: InputState, dt: number) => void;
  /** Start a new run: the first room, no deaths, no gems. */
  begin: () => void;
  /** Back to the title screen. */
  toTitle: () => void;
  collect: () => void;
}

const RUN_KEYS = ["room", "originX", "originY", "player", "dead", "deathTimer", "deaths", "transition", "finished", "steps", "deathCount", "roomCount"] as const;

export const useGame = createGameState<State>()((set, get) => ({
  screen: "title",
  room: 0,
  originX: 0,
  originY: 0,
  player: {
    x: 21, y: 139, rx: 0, ry: 0, vx: 0, vy: 0, facing: 1, onGround: false, wall: 0, sliding: false, dashing: false, dashes: 1, dashX: 0, dashY: 0,
    coyote: 0, buffer: 0, jumpHold: 0, dashTime: 0, dashCooldown: 0, wallLock: 0, jumps: 0, wallJumps: 0, dashCount: 0, lands: 0,
  },
  dead: false,
  deathTimer: 0,
  deaths: 0,
  transition: 0,
  finished: false,
  steps: 0,
  deathCount: 0,
  roomCount: 0,
  gems: 0,
  step: (input, dt) => {
    const state = get();
    if (state.screen !== "play") return;
    const before = {} as Record<string, unknown>;
    for (const key of RUN_KEYS) before[key] = state[key];
    const after = stepRun(before as unknown as Run, readControls(input), dt);
    if (after.player.dashCount !== state.player.dashCount) freeze(DASH_FREEZE_STEPS);
    if (after.deathCount !== state.deathCount) freeze(DEATH_FREEZE_STEPS);
    set({ ...after, screen: after.finished ? "end" : "play" });
  },
  begin: () => set({ ...newRun(), screen: "play", gems: 0 }),
  toTitle: () => set({ ...newRun(), screen: "title", gems: 0 }),
  collect: () => set((s) => ({ gems: s.gems + 1 })),
}));
