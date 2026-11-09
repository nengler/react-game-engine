import type { ScreenFit, ViewTransform } from "@rge/runtime";

/**
 * Where a root `<Screen>` lands in the window: the game's size, the scale on each axis, and the window position
 * of the game's top-left corner. A game pixel at (x, y) is drawn at (left + x·scaleX, top + y·scaleY).
 */
export interface ScreenPlacement {
  /** The game's resolution (the `<Screen>`'s `width` and `height`). */
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** The window position of the game's top-left corner. */
  readonly left: number;
  readonly top: number;
}

/**
 * Fit a `width` × `height` game into a `windowWidth` × `windowHeight` window, centred.
 *
 * - `"integer"`: the largest whole-number scale that fits, and the corner on a whole window pixel, so every game
 *   pixel covers the same number of window pixels. A window smaller than the game falls back to `"contain"`, so
 *   the game is shrunk rather than cut off.
 * - `"contain"`: the largest scale that fits, the same on both axes.
 * - `"stretch"`: each axis scaled to fill the window.
 *
 * A window with no area (minimised) gets a scale of 1 at the top-left: there is nothing to see, and a scale of 0
 * would make the mouse impossible to map back.
 */
export function fitScreen(width: number, height: number, windowWidth: number, windowHeight: number, fit: ScreenFit): ScreenPlacement {
  if (!(windowWidth > 0 && windowHeight > 0)) return { width, height, scaleX: 1, scaleY: 1, left: 0, top: 0 };
  if (fit === "stretch") return { width, height, scaleX: windowWidth / width, scaleY: windowHeight / height, left: 0, top: 0 };
  const contain = Math.min(windowWidth / width, windowHeight / height);
  if (fit === "integer" && contain >= 1) {
    const scale = Math.floor(contain);
    return { width, height, scaleX: scale, scaleY: scale, left: Math.floor((windowWidth - width * scale) / 2), top: Math.floor((windowHeight - height * scale) / 2) };
  }
  return { width, height, scaleX: contain, scaleY: contain, left: (windowWidth - width * contain) / 2, top: (windowHeight - height * contain) / 2 };
}

/** `view` (world → game pixels) followed by the screen's placement (game pixels → window pixels). */
export function viewToWindow(view: ViewTransform, at: ScreenPlacement): ViewTransform {
  return {
    a: view.a * at.scaleX,
    b: view.b * at.scaleY,
    c: view.c * at.scaleX,
    d: view.d * at.scaleY,
    e: view.e * at.scaleX + at.left,
    f: view.f * at.scaleY + at.top,
  };
}

/** Whether a window point is on the game, not on the bars around it. */
export function onScreen(at: ScreenPlacement, windowX: number, windowY: number): boolean {
  const x = (windowX - at.left) / at.scaleX;
  const y = (windowY - at.top) / at.scaleY;
  return x >= 0 && x < at.width && y >= 0 && y < at.height;
}

/** A window-space rectangle. */
export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The parts of the window the game does not cover, as up to four rectangles: full-height sides, then the top and bottom between them. */
export function borderRects(at: ScreenPlacement, windowWidth: number, windowHeight: number): WindowRect[] {
  const rects: WindowRect[] = [];
  const right = at.left + at.width * at.scaleX;
  const bottom = at.top + at.height * at.scaleY;
  if (at.left > 0) rects.push({ x: 0, y: 0, width: at.left, height: windowHeight });
  if (right < windowWidth) rects.push({ x: right, y: 0, width: windowWidth - right, height: windowHeight });
  const innerLeft = Math.max(at.left, 0);
  const innerWidth = Math.min(right, windowWidth) - innerLeft;
  if (innerWidth > 0 && at.top > 0) rects.push({ x: innerLeft, y: 0, width: innerWidth, height: at.top });
  if (innerWidth > 0 && bottom < windowHeight) rects.push({ x: innerLeft, y: bottom, width: innerWidth, height: windowHeight - bottom });
  return rects;
}
