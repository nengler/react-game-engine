/** Allowlisted helper available to handler code (`clamp(value, min, max)`). */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Two numbers, one per axis: a position, a speed, or a scale (squash and stretch: 1 is the sprite's own size). */
export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Move each axis back toward 1 by `rate` a second over `dt` seconds: a scale springing back to normal. Returns the same object
 * once it is at 1 on both, so a state that holds it stops changing (and stops rendering). What `useSquash` does every step.
 */
export function springBack<V extends Vector2>(scale: V, rate: number, dt: number): V {
  if (scale.x === 1 && scale.y === 1) return scale;
  const step = rate * dt;
  const toward = (v: number): number => (v < 1 ? Math.min(1, v + step) : Math.max(1, v - step));
  return { ...scale, x: toward(scale.x), y: toward(scale.y) };
}

/**
 * A shake of the view, as state (`useShake`): `strength` pixels at first, dying away over `duration` seconds, `elapsed` of
 * them gone (absent: just started). `<Camera shake={shake}>` draws it.
 */
export interface ShakeState {
  readonly strength: number;
  readonly duration: number;
  readonly elapsed?: number;
}

/** No shake. */
export const NO_SHAKE: ShakeState = Object.freeze({ strength: 0, duration: 0 });

/** A shake `dt` seconds on. Returns the same object once it is over, so a state that holds it stops changing. */
export function shakeOn(shake: ShakeState, dt: number): ShakeState {
  const elapsed = shake.elapsed ?? 0;
  if (!(shake.duration > 0) || elapsed >= shake.duration) return shake;
  return { ...shake, elapsed: Math.min(shake.duration, elapsed + dt) };
}
