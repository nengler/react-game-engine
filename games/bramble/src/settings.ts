import { createSettings } from "@tsengine/runtime";

import { controls } from "./rules/controls.ts";
import type { SettingsView } from "./rules/menu.ts";

/**
 * The player's settings, kept apart from the save: volumes, full screen and the keys. Applied when the game starts. Each setting's
 * type is its default's (`fullscreen` is a boolean).
 */
export const settings = createSettings({
  name: "settings",
  controls,
  defaults: { music: 0.6, effects: 0.8, fullscreen: false, bindings: null as Record<string, string[]> | null },
});

/** What the settings screen shows of the settings now. */
export function settingsView(): SettingsView {
  const s = settings.get();
  return { music: s.music, effects: s.effects, fullscreen: s.fullscreen };
}

/** The keys of each action now. */
export function bindingsView(): Bindings {
  return controls.toJSON();
}

export type Bindings = Readonly<Record<string, readonly string[]>>;
