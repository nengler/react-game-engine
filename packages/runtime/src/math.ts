/**
 * A `{value}` between a `<Text>`'s tags, as it is drawn: `null`, `undefined` and booleans are no text, as in React. The compiler
 * wraps each such value in it (`Score: ${textOf(score)}`).
 */
export function textOf(value: unknown): string | number {
  return value === null || value === undefined || typeof value === "boolean" ? "" : (value as string | number);
}

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

/** What moves smoothly: a number, or a point (each axis on its own). */
export type Animatable = number | Vector2;

/** A spring's options: `duration` is roughly the seconds it takes to settle; `bounce` 0 is no overshoot, up to just under 1 for a lot. */
export interface SpringOptions {
  readonly duration?: number;
  readonly bounce?: number;
}

/** Where a spring is, how fast it is moving, and where it is going (`useSpring` keeps one in state). */
export interface SpringState<T extends Animatable> {
  readonly value: T;
  readonly velocity: T;
  readonly target: T;
}

/**
 * A spring's stiffness and damping (unit mass) from `duration` and `bounce`, as SwiftUI and Framer Motion set a spring:
 * stiffness (2π / duration)², damping 4π (1 − bounce) / duration. Bounce 0 is critically damped.
 */
export function springFrom(duration = 0.5, bounce = 0): { readonly stiffness: number; readonly damping: number } {
  const d = duration > 0 ? duration : 0.5;
  const b = Math.min(Math.max(bounce, 0), 0.99);
  return { stiffness: ((2 * Math.PI) / d) ** 2, damping: (4 * Math.PI * (1 - b)) / d };
}

/** A spring at rest at `value`. */
// The number overload is last: \`ReturnType<typeof startSpring>\`, which types a hook's state made by it, is the number one.
export function startSpring(value: Vector2): SpringState<Vector2>;
export function startSpring(value: number): SpringState<number>;
export function startSpring(value: Animatable): SpringState<Animatable> {
  return { value, velocity: typeof value === "number" ? 0 : { x: 0, y: 0 }, target: value };
}

/** Closer than this to its target, and slower than this, a spring is at rest. */
const SETTLED = 1e-3;
/** A spring is stepped in pieces no longer than this, so a stiff one stays stable at any step. */
const SPRING_SLICE = 1 / 240;

function springAxis(value: number, velocity: number, target: number, k: number, c: number, dt: number): [number, number] {
  let x = value;
  let v = velocity;
  const slices = Math.max(1, Math.ceil(dt / SPRING_SLICE));
  const h = dt / slices;
  for (let i = 0; i < slices; i++) {
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
  }
  return Math.abs(x - target) < SETTLED && Math.abs(v) < SETTLED ? [target, 0] : [x, v];
}

/**
 * A spring `dt` seconds on, pulled toward `target`; a new target keeps the speed it had (a spring turns round smoothly). Returns
 * the same object once it is at rest on its target, so a state that holds it stops changing (and stops rendering).
 */
export function stepSpring<T extends Animatable>(spring: SpringState<T>, target: T, options: SpringOptions, dt: number): SpringState<T> {
  const same =
    typeof target === "number"
      ? spring.target === target
      : (spring.target as Vector2).x === (target as Vector2).x && (spring.target as Vector2).y === (target as Vector2).y;
  const resting =
    typeof spring.velocity === "number"
      ? spring.velocity === 0
      : (spring.velocity as Vector2).x === 0 && (spring.velocity as Vector2).y === 0;
  const there =
    typeof target === "number"
      ? spring.value === target
      : (spring.value as Vector2).x === (target as Vector2).x && (spring.value as Vector2).y === (target as Vector2).y;
  if (same && resting && there) return spring;
  if (!(dt > 0)) return same ? spring : { ...spring, target };
  const { stiffness, damping } = springFrom(options.duration, options.bounce);
  if (typeof target === "number") {
    const [value, velocity] = springAxis(spring.value as number, spring.velocity as number, target, stiffness, damping, dt);
    return { value: value as T, velocity: velocity as T, target };
  }
  const v = spring.value as Vector2;
  const s = spring.velocity as Vector2;
  const t = target as Vector2;
  const [x, vx] = springAxis(v.x, s.x, t.x, stiffness, damping, dt);
  const [y, vy] = springAxis(v.y, s.y, t.y, stiffness, damping, dt);
  return { value: { x, y } as T, velocity: { x: vx, y: vy } as T, target };
}

/** An easing: progress 0 to 1 in, eased progress out (0 at 0, 1 at 1, and may overshoot between). */
export type Easing = (t: number) => number;

const back = 1.70158;
/** The easings by name, for `useTween(…, { ease: "outCubic" })`. */
export const EASINGS = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inBack: (t: number) => (back + 1) * t * t * t - back * t * t,
  outBack: (t: number) => 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2,
  outElastic: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t - 1.5 / d) * (t - 1.5 / d) + 0.75;
    if (t < 2.5 / d) return n * (t - 2.25 / d) * (t - 2.25 / d) + 0.9375;
    return n * (t - 2.625 / d) * (t - 2.625 / d) + 0.984375;
  },
} as const satisfies Record<string, Easing>;

export type EasingName = keyof typeof EASINGS;

/** A tween's options: how long it takes, and how it eases (a name, or a function from a `.ts` file). Defaults 0.25 s, `"outCubic"`. */
export interface TweenOptions {
  readonly duration?: number;
  readonly ease?: EasingName | Easing;
}

/** A tween from `from` to `target`, `elapsed` seconds in, at `value` (`useTween` keeps one in state). */
export interface TweenState<T extends Animatable> {
  readonly from: T;
  readonly target: T;
  readonly elapsed: number;
  readonly value: T;
}

/** A tween at rest at `value`. */
// The number overload is last: \`ReturnType<typeof startTween>\`, which types a hook's state made by it, is the number one.
export function startTween(value: Vector2): TweenState<Vector2>;
export function startTween(value: number): TweenState<number>;
export function startTween(value: Animatable): TweenState<Animatable> {
  return { from: value, target: value, elapsed: Infinity, value };
}

/**
 * A tween `dt` seconds on; a new target starts again from where it is now. Returns the same object once it has arrived, so a state
 * that holds it stops changing.
 */
export function stepTween<T extends Animatable>(tween: TweenState<T>, target: T, options: TweenOptions, dt: number): TweenState<T> {
  const same =
    typeof target === "number"
      ? tween.target === target
      : (tween.target as Vector2).x === (target as Vector2).x && (tween.target as Vector2).y === (target as Vector2).y;
  const duration = options.duration !== undefined && options.duration > 0 ? options.duration : 0.25;
  if (same && tween.elapsed >= duration) return tween;
  const start: TweenState<T> = same ? tween : { from: tween.value, target, elapsed: 0, value: tween.value };
  const elapsed = Math.min(duration, start.elapsed + (dt > 0 ? dt : 0));
  const ease = typeof options.ease === "function" ? options.ease : EASINGS[options.ease ?? "outCubic"];
  const k = elapsed >= duration ? 1 : ease(elapsed / duration);
  const mix = (a: number, b: number): number => (k === 1 ? b : a + (b - a) * k);
  const value = (
    typeof target === "number"
      ? mix(start.from as number, target)
      : { x: mix((start.from as Vector2).x, (target as Vector2).x), y: mix((start.from as Vector2).y, (target as Vector2).y) }
  ) as T;
  return { from: start.from, target, elapsed, value };
}
