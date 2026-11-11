import { createGameState, createSave } from "@rge/runtime";
import "./tilemaps.ts";
import { settings } from "./settings.ts";
import { controls } from "./rules/controls.ts";
import { settingsRows, stepVolume, titleRows, type Row } from "./rules/menu.ts";
import { viewOf, type View } from "./rules/view.ts";
import { loadRun, newRun, saveOf, step, type GameEvent, type Input, type Run, type SaveData } from "./rules/run.ts";

type Screen = "title" | "settings" | "play" | "end";

/** The cursor and rows of the menu on screen (the title's or the settings'), and the action waiting for a key, if any. */
interface Menu {
  readonly cursor: number;
  readonly rows: readonly Row[];
  readonly capturing: string | null;
}

/**
 * The game's shared state: which screen is showing, the run, what the screen draws of it, and the menus. The play screen steps the
 * run through `advance`; the menus move through `moveCursor`, `adjust`, `activate` and `capture`.
 */
interface State {
  screen: Screen;
  run: Run;
  /** What the screen draws of the map the run is on (see `rules/view.ts`). */
  view: View;
  /** The events of the latest step, for the effects (sounds, particles) that answer them. */
  events: readonly GameEvent[];
  menu: Menu;
  /** Start a new run. */
  begin: () => void;
  /** Start from the save, if there is a readable one. */
  continueGame: () => void;
  toTitle: () => void;
  /** The title came on screen: its rows are made now, since whether there is a save to continue is only known once saved data is open. */
  openTitle: () => void;
  /** One step of the world. */
  advance: (input: Input, dt: number) => void;
  moveCursor: (direction: number) => void;
  /** Left or right on a row that has a value (a volume, full screen). */
  adjust: (direction: number) => void;
  /** Confirm on the row under the cursor. */
  activate: () => void;
  /** A key was pressed while a row waits for one: it becomes that action's key (Escape cancels). */
  capture: (key: string | undefined) => void;
}

/** The save: what `saveOf` picks from the run, in `{ version, data }`. Written at each shrine; the title's "Continue" loads it. */
export const save = createSave<SaveData>({
  name: "save",
  version: 1,
  pick: () => saveOf(useGame.getState().run),
  apply: (data) => {
    const run = loadRun(data);
    if (run !== null) useGame.setState({ run, view: viewOf(run), events: [], screen: "play" });
  },
});

function settingsMenu(cursor: number, capturing: string | null): Menu {
  const s = settings.get();
  return { cursor, capturing, rows: settingsRows({ music: s.music, effects: s.effects, fullscreen: s.fullscreen }, controls.toJSON(), capturing) };
}

const titleMenu = (cursor: number): Menu => ({ cursor, capturing: null, rows: titleRows(save.exists()) });

export const useGame = createGameState<State>()((set, get) => ({
  screen: "title",
  run: newRun(),
  view: viewOf(newRun()),
  events: [],
  menu: titleMenu(0),
  begin: () => set({ run: newRun(), view: viewOf(newRun()), screen: "play", events: [] }),
  continueGame: () => {
    if (!save.load()) get().begin();
  },
  toTitle: () => set({ screen: "title", menu: titleMenu(0) }),
  openTitle: () => set({ menu: titleMenu(0) }),
  advance: (input, dt) => {
    const result = step(get().run, input, dt);
    set({ run: result.run, view: viewOf(result.run), events: result.events, ...(result.run.done ? { screen: "end" as const } : {}) });
    if (result.events.some((e) => e.type === "shrine")) save.write();
  },
  moveCursor: (direction) => {
    const { menu } = get();
    if (menu.capturing !== null) return;
    set({ menu: { ...menu, cursor: (menu.cursor + direction + menu.rows.length) % menu.rows.length } });
  },
  adjust: (direction) => {
    const { menu, screen } = get();
    if (screen !== "settings" || menu.capturing !== null) return;
    const id = menu.rows[menu.cursor]?.id;
    const s = settings.get();
    if (id === "music") settings.set({ music: stepVolume(s.music, direction) });
    else if (id === "effects") settings.set({ effects: stepVolume(s.effects, direction) });
    else if (id === "fullscreen") settings.set({ fullscreen: !s.fullscreen });
    else return;
    set({ menu: settingsMenu(menu.cursor, null) });
  },
  activate: () => {
    const { menu, screen } = get();
    const id = menu.rows[menu.cursor]?.id ?? "";
    if (screen === "title") {
      if (id === "continue") get().continueGame();
      else if (id === "new") get().begin();
      else if (id === "settings") set({ screen: "settings", menu: settingsMenu(0, null) });
      return;
    }
    if (screen !== "settings" || menu.capturing !== null) return;
    if (id === "back") set({ screen: "title", menu: titleMenu(2) });
    else if (id === "reset") {
      settings.reset();
      set({ menu: settingsMenu(menu.cursor, null) });
    } else if (id === "music" || id === "effects" || id === "fullscreen") get().adjust(1);
    else if (id.startsWith("bind:")) set({ menu: settingsMenu(menu.cursor, id.slice(5)) });
  },
  capture: (key) => {
    const { menu } = get();
    const action = menu.capturing;
    if (action === null || key === undefined) return;
    if (key !== "Escape") {
      controls.bind(action, [key]);
      settings.set({ bindings: controls.toJSON() });
    }
    set({ menu: settingsMenu(menu.cursor, null) });
  },
}));
