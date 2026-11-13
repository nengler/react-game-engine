/**
 * Hooks the engine ships, written as ordinary custom hooks (the inliner's input), so they are what an author could have written
 * from `useState` and `useUpdate`, and every rule of a component body applies to them. A component imports one from the
 * authoring module (`import { useSquash } from "@rge/runtime/jsx"`), where it is declared for TypeScript; the inliner takes its
 * body from here.
 */
export const LIBRARY_FILE = "rge:hooks.tsx";

export const LIBRARY_SOURCE = `import { createBody, keepIfEqual, shakeOn, springBack, startSpring, startTween, stepSpring, stepTween, useMount, useState, useUpdate } from "@rge/runtime/jsx";

/**
 * Squash and stretch: a scale that is set at a moment and springs back to 1 at \`recover\` a second.
 *   const [squash, setSquash] = useSquash();
 *   setSquash({ x: 0.6, y: 1.4 });
 *   <Sprite transform={{ scaleX: squash.x, scaleY: squash.y }} />
 */
export function useSquash(recover = 1.75) {
  const [squash, setSquash] = useState<{ x: number; y: number }>({ x: 1, y: 1 });
  useUpdate((dt) => {
    setSquash((s) => springBack(s, recover, dt));
  });
  return [squash, setSquash];
}

/**
 * A value that follows its target like a spring, set by \`duration\` (seconds to settle) and \`bounce\` (0: no overshoot).
 *   const y = useSpring(open ? 0 : -40, { duration: 0.4, bounce: 0.2 });
 */
export function useSpring(target, options = {}) {
  const [spring, setSpring] = useState(() => startSpring(target));
  useUpdate((dt) => {
    setSpring((s) => stepSpring(s, target, options, dt));
  });
  return spring.value;
}

/**
 * A value that eases to its target over \`duration\` seconds, along \`ease\`; a new target starts again from where it is.
 *   const opacity = useTween(visible ? 1 : 0, { duration: 0.25, ease: "outCubic" });
 */
export function useTween(target, options = {}) {
  const [tween, setTween] = useState(() => startTween(target));
  useUpdate((dt) => {
    setTween((s) => stepTween(s, target, options, dt));
  });
  return tween.value;
}

/**
 * A shake of the view, as state: set at a moment, it runs down by itself.
 *   const [shake, setShake] = useShake();
 *   setShake({ strength: 3, duration: 0.25 });
 *   <Camera shake={shake}>
 */
export function useShake() {
  const [shake, setShake] = useState<{ strength: number; duration: number; elapsed?: number }>({ strength: 0, duration: 0 });
  useUpdate((dt) => {
    setShake((s) => shakeOn(s, dt));
  });
  return [shake, setShake];
}

/**
 * Seconds since the component mounted, growing with each update (each fixed step, under a fixed timestep): for something
 * that moves or blinks with time.
 *   const time = useTime();
 *   <Label color={time % 1 < 0.66 ? "white" : "black"} />
 */
export function useTime() {
  const [time, setTime] = useState(0);
  useUpdate((dt) => {
    setTime((t) => t + dt);
  });
  return time;
}

/**
 * A box that moves and is stopped by what is solid, in the same step: the solid tiles of a \`<Tilemap solid>\` and every
 * \`<Collider solid>\`. Its position is state; \`move\` returns the sides it was stopped on, \`touching(tag)\` says whether a
 * collider with that tag overlaps it now, and \`place\` puts it somewhere with no collision.
 *   const { x, y, move, touching } = useBody({ x: 16, y: 32, width: 8, height: 11 });
 */
export function useBody(options) {
  const [body] = useState(() => createBody(options));
  const [x, setX] = useState<number>(options.x);
  const [y, setY] = useState<number>(options.y);
  const move = (dx: number, dy: number) => {
    const hit = body.move(dx, dy);
    setX(body.x);
    setY(body.y);
    return hit;
  };
  const touching = (tag: string) => body.touching(tag);
  const blocked = (dx: number, dy: number) => body.blocked(dx, dy);
  const overlapping = <Tag extends string>(tag: Tag) => body.overlapping(tag);
  const place = (toX: number, toY: number) => {
    body.place(toX, toY);
    setX(body.x);
    setY(body.y);
  };
  return { x, y, move, touching, blocked, overlapping, place };
}

/**
 * A value read from a store outside the game state (the settings, the controls, a store of the game's own), kept up to date: it
 * is read when the component mounts and again each time the store says it changed, and renders only when what is read differs.
 *   const values = useStore(settings, settingsView);
 */
export function useStore(store, read) {
  const [value, setValue] = useState(() => read());
  useMount(() => store.subscribe(() => setValue((previous) => keepIfEqual(previous, read()))));
  return value;
}
`;

/** The names of the library's hooks. */
export const LIBRARY_HOOKS: readonly string[] = ["useSquash", "useShake", "useTime", "useStore", "useBody", "useSpring", "useTween"];
