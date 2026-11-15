import type { FlexTransition } from "@rge/runtime";

import { mixColors, type PackedColor } from "./color.ts";

/** The two colours a transitioning `<Flex>` shows this frame. */
export interface ShownColors {
  fill: PackedColor;
  edge: PackedColor;
  /** The opacity of the box and what is in it, 0 to 1. */
  alpha: number;
}

/** Slow in and out, as CSS's default `ease` is: 0 stays 0, 1 stays 1, and it is steepest in the middle. */
export function ease(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/**
 * The colour `t` of the way from `a` to `b`, where a colour with no alpha is nothing, not black: fading in from nothing keeps
 * the target's own red, green and blue and only grows its alpha, so it does not pass through a dark fringe. Both nothing: nothing.
 */
export function mixThrough(a: PackedColor, b: PackedColor, t: number): PackedColor {
  const aNone = (a & 255) === 0;
  const bNone = (b & 255) === 0;
  if (aNone && bNone) return 0;
  return mixColors(aNone ? (b & 0xffffff00) >>> 0 : a, bNone ? (a & 0xffffff00) >>> 0 : b, t);
}

/** What a transition shows at `time`, the colours it has been heading for since `state.since`. */
function shownAt(state: FlexTransition, duration: number, time: number, out: ShownColors): void {
  const t = ease((time - state.since) / duration);
  out.fill = t >= 1 ? state.toFill : mixThrough(state.fromFill, state.toFill, t);
  out.edge = t >= 1 ? state.toEdge : mixThrough(state.fromEdge, state.toEdge, t);
  out.alpha = t >= 1 ? state.toAlpha : state.fromAlpha + (state.toAlpha - state.fromAlpha) * t;
}

/**
 * The colours and opacity a `<Flex>` with a `transition` shows at `time` (seconds on the player's animation clock) when its state says
 * it should be heading for `fill`, `edge` and `alpha`. The first call shows them at once. A new target starts a fade from what is shown at
 * that moment, so a fade interrupted half way turns round from where it is, not from where it began. The result depends only on
 * `time` and the state kept on the box, so a frame built twice at one time (the player does, for tilemaps) shows the same thing.
 * Returns the state to keep.
 */
export function stepTransition(
  state: FlexTransition | null,
  fill: PackedColor,
  edge: PackedColor,
  alpha: number,
  duration: number,
  time: number,
  out: ShownColors
): FlexTransition {
  if (state === null) {
    out.fill = fill;
    out.edge = edge;
    out.alpha = alpha;
    return { fromFill: fill, fromEdge: edge, toFill: fill, toEdge: edge, fromAlpha: alpha, toAlpha: alpha, since: time };
  }
  if (state.toFill !== fill || state.toEdge !== edge || state.toAlpha !== alpha) {
    shownAt(state, duration, time, out);
    state.fromFill = out.fill;
    state.fromEdge = out.edge;
    state.fromAlpha = out.alpha;
    state.toFill = fill;
    state.toEdge = edge;
    state.toAlpha = alpha;
    state.since = time;
  }
  shownAt(state, duration, time, out);
  return state;
}
