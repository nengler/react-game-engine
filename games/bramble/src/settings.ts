import { createSettings } from "@rge/runtime";
import { controls } from "./rules/controls.ts";

/**
 * The player's settings, kept apart from the save: volumes, full screen and the keys. Applied when the game starts. Each setting's
 * type is its default's (`fullscreen` is a boolean).
 */
export const settings = createSettings({
  name: "settings",
  controls,
  defaults: { music: 0.6, effects: 0.8, fullscreen: false, bindings: null as Record<string, string[]> | null },
});
