import type { TransitionFrame } from "@rge/runtime";

/**
 * How the game changes screen: a plain function of progress, which the `<Router>` calls every step while a transition runs.
 * Fade out to the cover colour over the first half, switch screens behind it, fade back in over the second.
 */
export function fadeThrough(progress: number): TransitionFrame {
  return progress < 0.5 ? { toVisible: false, cover: progress * 2 } : { fromVisible: false, cover: 2 - progress * 2 };
}
