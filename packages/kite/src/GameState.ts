import { createGameState } from "@rge/runtime";
import { packControls, unpackControls, type Body } from "./rules/body.ts";
import { stepRun, type Run } from "./rules/level.ts";

/**
 * The game's state, shared by every component: the run of the level (`Run`, see `rules/level.ts`) and the actions that
 * move it on. All the rules are plain functions in `rules/`; this file only keeps their state where components can read
 * it, and calls them. `step` is one fixed step of the game: components pass the buttons held (`packControls`) and the time.
 */
interface State {
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
  /** Gems collected. */
  gems: number;
  step: (buttons: number, dt: number) => void;
  collect: () => void;
}

const RUN_KEYS = ["room", "originX", "originY", "player", "dead", "deathTimer", "deaths", "transition", "finished", "steps", "deathCount", "roomCount"] as const;

export const useGame = createGameState<State>()((set, get) => ({
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
  step: (buttons, dt) => {
    const state = get();
    const run = {} as Record<string, unknown>;
    for (const key of RUN_KEYS) run[key] = state[key];
    set(stepRun(run as unknown as Run, unpackControls(buttons), dt));
  },
  collect: () => set((s) => ({ gems: s.gems + 1 })),
}));

export { packControls };
