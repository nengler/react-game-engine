import { createSettings } from "@rge/runtime";
import { controls } from "./rules/controls.ts";

interface Settings {
  music: number;
  effects: number;
  fullscreen: boolean;
  bindings: Record<string, string[]> | null;
}

/** The player's settings, kept apart from the save: volumes, full screen and the keys. Applied when the game starts. */
export const settings = createSettings<Settings>({
  name: "settings",
  controls,
  defaults: { music: 0.6, effects: 0.8, fullscreen: false, bindings: null as Record<string, string[]> | null },
});
