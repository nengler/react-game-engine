/** The size of the window the game is shown in, in logical pixels (a phone's points, not its device pixels). */
export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

let size: WindowSize = { width: 0, height: 0 };
const sizeListeners = new Set<() => void>();

/**
 * The window's size, so a game can tell a phone held upright from one turned on its side (`height > width`) and say so, or lay out
 * for it. It is the window, not the game's resolution: a `<Screen>` is scaled into it. Each frame the player sets it before the
 * world steps; it is 0 × 0 until a player has opened a window. A component reads it with `useWindowSize()`.
 */
export function getWindowSize(): WindowSize {
  return size;
}

/** Hear each change of `getWindowSize()`; returns the function that stops listening. */
export function watchWindowSize(listener: () => void): () => void {
  sizeListeners.add(listener);
  return () => {
    sizeListeners.delete(listener);
  };
}

/** Say how big the window is (the player does, every frame; a test may). Listeners hear it only when it changes. */
export function setWindowSize(width: number, height: number): void {
  if (width === size.width && height === size.height) return;
  size = { width, height };
  for (const listener of [...sizeListeners]) listener();
}
