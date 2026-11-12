/**
 * The menus as plain data: what the title offers, and the rows of the settings screen. A screen draws `Row`s; the game state
 * moves a cursor over them and acts on the row under it.
 */
export interface Row {
  readonly id: string;
  readonly label: string;
  /** What is shown at the right of the label: a volume, on or off, the keys, "press a key…". Empty for a plain row. */
  readonly value: string;
}

/** The title's choices: "Continue" only when there is a save. */
export function titleRows(hasSave: boolean): Row[] {
  return [...(hasSave ? [{ id: "continue", label: "Continue", value: "" }] : []), { id: "new", label: "New game", value: "" }, { id: "settings", label: "Settings", value: "" }];
}

/** The actions a player can rebind, and what the settings screen calls them. */
export const BINDABLE: readonly { readonly action: string; readonly label: string }[] = [
  { action: "up", label: "Up" },
  { action: "down", label: "Down" },
  { action: "left", label: "Left" },
  { action: "right", label: "Right" },
  { action: "action", label: "Talk / use" },
  { action: "confirm", label: "Confirm" },
  { action: "back", label: "Back" },
];

export interface SettingsView {
  readonly music: number;
  readonly effects: number;
  readonly fullscreen: boolean;
}

/** The volume's step on the settings screen, as a fraction of full. */
export const VOLUME_STEP = 0.1;

export const percent = (v: number): string => `${Math.round(v * 100)}%`;

/** A key's name for the screen: `ArrowLeft` is "Left". */
export function keyLabel(key: string): string {
  if (key === "Escape") return "Esc";
  return key.startsWith("Arrow") ? key.slice(5) : key;
}

/** The settings screen's rows: two volumes, full screen, a row for each rebindable action, reset, back. `capturing` is the action waiting for a key. */
export function settingsRows(values: SettingsView, bindings: Readonly<Record<string, readonly string[]>>, capturing: string | null): Row[] {
  return [
    { id: "music", label: "Music", value: percent(values.music) },
    { id: "effects", label: "Effects", value: percent(values.effects) },
    { id: "fullscreen", label: "Full screen", value: values.fullscreen ? "On" : "Off" },
    ...BINDABLE.map(({ action, label }) => ({ id: `bind:${action}`, label, value: capturing === action ? "press a key..." : (bindings[action] ?? []).map(keyLabel).join(" / ") })),
    { id: "reset", label: "Reset to defaults", value: "" },
    { id: "back", label: "Back", value: "" },
  ];
}

/** A volume one step up or down, kept to tenths and in 0 to 1. */
export function stepVolume(volume: number, direction: number): number {
  return Math.min(1, Math.max(0, Math.round((volume + direction * VOLUME_STEP) * 10) / 10));
}

/** The pause screen's choices. */
export function pauseRows(): Row[] {
  return [
    { id: "resume", label: "Resume", value: "" },
    { id: "quit", label: "Save and quit", value: "" },
  ];
}

/** A cursor moved past either end of `count` rows comes round to the other. */
export function wrap(cursor: number, count: number): number {
  return (cursor + count) % count;
}
