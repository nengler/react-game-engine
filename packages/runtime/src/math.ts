/** Allowlisted helper available to handler code (`clamp(value, min, max)`). */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A scale on two axes, as squash and stretch sets it: 1 is the sprite's own size. */
export interface Scale2 {
  readonly scaleX: number;
  readonly scaleY: number;
}

/**
 * Move each axis of a scale back toward 1 by `rate` a second over `dt` seconds. Returns the same object once it is at 1 on
 * both, so a state that holds it stops changing (and stops rendering). What `useSquash` does every step.
 */
export function springBack<S extends Scale2>(scale: S, rate: number, dt: number): S {
  if (scale.scaleX === 1 && scale.scaleY === 1) return scale;
  const step = rate * dt;
  const toward = (v: number): number => (v < 1 ? Math.min(1, v + step) : Math.max(1, v - step));
  return { ...scale, scaleX: toward(scale.scaleX), scaleY: toward(scale.scaleY) };
}
