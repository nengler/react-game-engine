import { createGameState, createSave } from "@rge/runtime";
import "./tilemaps.ts";
import { answer } from "./effects.ts";
import { settings } from "./settings.ts";
import { controls } from "./rules/controls.ts";
import { stepVolume, titleRows, type SettingsView } from "./rules/menu.ts";
import { loadRun, newRun, saveOf, step, type GameEvent, type Input, type Run, type SaveData } from "./rules/run.ts";

type Screen = "title" | "settings" | "play" | "end";

/**
 * The game's shared state: which screen is showing, the run, and what the screens show of the save and the settings. What is drawn
 * of the run is worked out by the components from `run` (`rules/view.ts`); which menu row is chosen is each screen's own state.
 */
interface State {
  screen: Screen;
  run: Run;
  /** The events of the latest step, for the effects (sounds, particles) that answer them. */
  events: readonly GameEvent[];
  /** The pause screen is over the world: the inventory and a short menu. The world is not stepped meanwhile. */
  paused: boolean;
  /** Whether there is a save to continue: the title offers Continue. */
  hasSave: boolean;
  /** The row the title's cursor starts on (Settings, when coming back from them). */
  titleCursor: number;
  /** The settings as they are now, kept equal to `settings` (see the subscription below), and the keys of each action. */
  settings: SettingsView;
  bindings: Readonly<Record<string, readonly string[]>>;
  /** Open or close the pause screen. */
  togglePause: () => void;
  /** Start a new run. */
  begin: () => void;
  /** Start from the save, if there is a readable one. */
  continueGame: () => void;
  toTitle: () => void;
  /** The title came on screen: whether there is a save is only known once saved data is open. */
  openTitle: () => void;
  /** One step of the world. */
  advance: (input: Input, dt: number) => void;
  /** A row of the title was chosen. */
  choose: (id: string) => void;
  /** A row of the pause screen was chosen. */
  choosePaused: (id: string) => void;
  closeSettings: () => void;
  /** Left or right on a setting's row (a volume, full screen); any other row does nothing. */
  adjust: (id: string, direction: number) => void;
  /** Give an action a key, and keep it. */
  bindKey: (action: string, key: string) => void;
  resetSettings: () => void;
}

/** The save: what `saveOf` picks from the run, in `{ version, data }`. Written at each shrine; the title's "Continue" loads it. */
export const save = createSave<SaveData>({
  name: "save",
  version: 1,
  pick: () => saveOf(useGame.getState().run),
  apply: (data) => {
    const run = loadRun(data);
    if (run !== null) useGame.setState({ run, events: [], screen: "play", paused: false });
  },
});

const settingsView = (): SettingsView => {
  const s = settings.get();
  return { music: s.music, effects: s.effects, fullscreen: s.fullscreen };
};

export const useGame = createGameState<State>()((set, get) => ({
  screen: "title",
  run: newRun(),
  events: [],
  paused: false,
  hasSave: false,
  titleCursor: 0,
  settings: settingsView(),
  bindings: controls.toJSON(),
  togglePause: () => {
    const { paused, screen } = get();
    if (screen === "play") set({ paused: !paused });
  },
  begin: () => set({ run: newRun(), screen: "play", events: [], paused: false }),
  continueGame: () => {
    if (!save.load()) get().begin();
  },
  toTitle: () => set({ screen: "title", titleCursor: 0, paused: false }),
  openTitle: () => set({ hasSave: save.exists() }),
  advance: (input, dt) => {
    const result = step(get().run, input, dt);
    set({ run: result.run, events: result.events, ...(result.run.done ? { screen: "end" as const } : {}) });
    answer(result.events, { x: result.run.x + 5, y: result.run.y + 5 });
    if (result.events.some((e) => e.type === "shrine")) save.write();
  },
  choose: (id) => {
    if (id === "continue") get().continueGame();
    else if (id === "new") get().begin();
    else if (id === "settings") set({ screen: "settings" });
  },
  choosePaused: (id) => {
    if (id === "resume") get().togglePause();
    else if (id === "quit") {
      save.write();
      get().toTitle();
    }
  },
  closeSettings: () => set({ screen: "title", titleCursor: titleRows(save.exists()).findIndex((r) => r.id === "settings") }),
  adjust: (id, direction) => {
    const s = settings.get();
    if (id === "music") settings.set({ music: stepVolume(s.music, direction) });
    else if (id === "effects") settings.set({ effects: stepVolume(s.effects, direction) });
    else if (id === "fullscreen") settings.set({ fullscreen: !s.fullscreen });
  },
  bindKey: (action, key) => {
    if (controls.bind(action, [key])) settings.set({ bindings: controls.toJSON() });
  },
  resetSettings: () => {
    settings.reset();
  },
}));

// The settings change through `settings` (here, and when a player opens saved data and reads the file): mirror them into the state,
// so the settings screen, which selects them, re-renders.
settings.subscribe(() => useGame.setState({ settings: settingsView(), bindings: controls.toJSON() }));
