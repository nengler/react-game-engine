/** The game's colours and icon pictures, by name: every component reads these instead of writing the hex or the frame. */
export const COLOR = {
  text: "#fff1d6",
  dim: "#8e9ac2",
  title: "#ffb15e",
  gold: "#f2c83c",
  lives: "#e04a5a",
  wave: "#5ac8e8",
  good: "#7de37a",
  prompt: "#7de3ff",
  background: "#12151f",
  panel: "#1c2033",
  button: "#3b4468",
  buttonOff: "#262b40",
  shade: "#000000aa",
  hurt: "#7a2030",
} as const;

/** The 10 × 10 pictures in `icons.png`. */
export const ICON = { bolt: 0, mortar: 1, frost: 2, gold: 3, lives: 4, wave: 5 } as const;
