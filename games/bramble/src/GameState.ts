import { createGameState, createSave } from "@rge/runtime";

import "./tilemaps.ts";
import { answer } from "./effects.ts";
import { controls } from "./rules/controls.ts";
import { stepVolume, titleRows } from "./rules/menu.ts";
import { loadRun, newRun, saveOf, step, type GameEvent, type Input, type Run, type SaveData } from "./rules/run.ts";
import { settings } from "./settings.ts";

type Screen = "title" | "settings" | "play" | "end";

/** The save: what `saveOf` picks from the run, in `{ version, data }`. Written at each shrine; the title's "Continue" loads it. */
export const save = createSave<SaveData>({
  name: "save",
  version: 1,
  pick: () => saveOf(useGame.getState().run as Run),
  apply: (data) => {
    const run = loadRun(data);
    if (run !== null) useGame.actions().loaded(run);
  },
});

/**
 * The game's shared state: which screen is showing, the run, and whether there is a save. The settings screen reads the settings
 * itself (`settings.ts`), listening while it is shown. What is drawn
 * of the run is worked out by the components from `run` (`rules/view.ts`); which menu row is chosen is each screen's own state.
 */
export const useGame = createGameState(
  {
    screen: "title" as Screen,
    run: newRun() as Run,
    /** The events of the latest step, for the effects (sounds, particles) that answer them. */
    events: [] as readonly GameEvent[],
    /** The pause screen is over the world: the inventory and a short menu. The world is not stepped meanwhile. */
    paused: false,
    /** Whether there is a save to continue: the title offers Continue. */
    hasSave: false,
    /** The row the title's cursor starts on (Settings, when coming back from them). */
    titleCursor: 0,
  },
  {
    /** Open or close the pause screen. */
    togglePause(s) {
      if (s.screen === "play") s.paused = !s.paused;
    },
    /** Start a new run. */
    begin(s) {
      s.run = newRun();
      s.screen = "play";
      s.events = [];
      s.paused = false;
    },
    /** A run read from the save: play it. */
    loaded(s, run: Run) {
      s.run = run;
      s.events = [];
      s.screen = "play";
      s.paused = false;
    },
    /** Start from the save, if there is a readable one. */
    continueGame() {
      if (!save.load()) useGame.actions().begin();
    },
    toTitle(s) {
      s.screen = "title";
      s.titleCursor = 0;
      s.paused = false;
    },
    /** The title came on screen: whether there is a save is only known once saved data is open. */
    openTitle(s) {
      s.hasSave = save.exists();
    },
    /** One step of the world. */
    advance(s, input: Input, dt: number) {
      const result = step(s.run, input, dt);
      s.run = result.run;
      s.events = result.events;
      if (result.run.done) s.screen = "end";
      answer(result.events, { x: result.run.x + 5, y: result.run.y + 5 });
      if (result.events.some((e) => e.type === "shrine")) save.write();
    },
    /** A row of the title was chosen. */
    choose(s, id: string) {
      if (id === "continue") useGame.actions().continueGame();
      else if (id === "new") useGame.actions().begin();
      else if (id === "settings") s.screen = "settings";
    },
    /** A row of the pause screen was chosen. */
    choosePaused(_s, id: string) {
      if (id === "resume") useGame.actions().togglePause();
      else if (id === "quit") {
        save.write();
        useGame.actions().toTitle();
      }
    },
    closeSettings(s) {
      s.screen = "title";
      s.titleCursor = titleRows(save.exists()).findIndex((r) => r.id === "settings");
    },
    /** Left or right on a setting's row (a volume, full screen); any other row does nothing. */
    adjust(_s, id: string, direction: number) {
      const values = settings.get();
      if (id === "music") settings.set({ music: stepVolume(values.music, direction) });
      else if (id === "effects") settings.set({ effects: stepVolume(values.effects, direction) });
      else if (id === "fullscreen") settings.set({ fullscreen: !values.fullscreen });
    },
    /** Give an action a key, and keep it. */
    bindKey(_s, action: string, key: string) {
      if (controls.bind(action, [key])) settings.set({ bindings: controls.toJSON() });
    },
    resetSettings() {
      settings.reset();
    },
  }
);
