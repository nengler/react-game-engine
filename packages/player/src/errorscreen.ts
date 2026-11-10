import { Entity, Flex, Hud, Text, type GameObject } from "@rge/runtime";

const TITLE_SIZE = 20;
const BODY_SIZE = 13;
const PADDING = 16;
/** A lower bound, so a tiny window still gets a readable column rather than one character per line. */
const MIN_COLUMNS = 20;

/** What an exception looks like as text: its stack when it has one (it starts with the message), else what was thrown. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack !== undefined && error.stack !== "" ? error.stack : `${error.name}: ${error.message}`;
  return `Uncaught ${typeof error === "string" ? error : JSON.stringify(error) ?? String(error)}`;
}

/** Break text into lines of at most `columns` characters: at its own line breaks, then hard, since a stack has few spaces. */
export function wrapLines(text: string, columns: number): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\t/g, "  ").split(/\r?\n/)) {
    const characters = [...raw];
    if (characters.length === 0) lines.push("");
    for (let i = 0; i < characters.length; i += columns) lines.push(characters.slice(i, i + columns).join(""));
  }
  return lines;
}

/**
 * The tree for the error screen, in window pixels: a dark panel with a title and the error's text, as many lines as fit
 * in `height`. It is rebuilt each frame, which is cheap for a screenful and follows a resized window.
 */
export function errorScreen(error: unknown, width: number, height: number): GameObject {
  const columns = Math.max(MIN_COLUMNS, Math.floor((width - 2 * PADDING) / (BODY_SIZE * 0.6)));
  const rows = Math.max(1, Math.floor((height - 2 * PADDING - TITLE_SIZE * 2) / (BODY_SIZE * 1.3)));
  const lines = wrapLines(describeError(error), columns);
  const shown = lines.slice(0, rows);
  if (lines.length > shown.length && shown.length > 0) shown[shown.length - 1] = "…";

  const panel = new Flex({ direction: "column", gap: 4, padding: PADDING, width: "grow", height: "grow", background: "#2a0a0a" });
  panel.addChild(new Text({ text: "The game stopped: an error was thrown", size: TITLE_SIZE, color: "#ff8080" }));
  panel.addChild(new Text({ text: "Close the window to exit.", size: BODY_SIZE, color: "#cccccc" }));
  for (const line of shown) panel.addChild(new Text({ text: line === "" ? " " : line, size: BODY_SIZE, color: "white" }));
  const hud = new Hud();
  hud.addChild(panel);
  const root = new Entity();
  root.addChild(hud);
  return root;
}
