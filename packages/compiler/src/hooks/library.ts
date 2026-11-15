/**
 * Hooks the engine ships, written as ordinary custom hooks (the inliner's input), so they are what an author could have written
 * from `useMutable` and `useUpdate`, and every rule of a component body applies to them. A component imports one from the
 * authoring module (`import { useSquash } from "@tsengine/runtime/jsx"`), where it is declared for TypeScript; the inliner takes its
 * body from here. A hook that hands back state returns its `useMutable` (`return s`), and the caller reads and writes its fields.
 */
export const LIBRARY_FILE = "tse:hooks.tsx";

export const LIBRARY_SOURCE = `import { createBody, keepIfEqual, shakeOn, springBack, startSpring, startTween, stepSpring, stepTween, useMount, useMutable, useUpdate } from "@tsengine/runtime/jsx";

/**
 * Squash and stretch: a scale that is set at a moment and springs back to 1 at \`recover\` a second.
 *   const squash = useSquash();
 *   squash.x = 0.6;
 *   squash.y = 1.4;
 *   <Sprite transform={{ scaleX: squash.x, scaleY: squash.y }} />
 */
export function useSquash(recover = 1.75) {
  const squash = useMutable({ x: 1, y: 1 });
  useUpdate((dt) => {
    const next = springBack(squash, recover, dt);
    squash.x = next.x;
    squash.y = next.y;
  });
  return squash;
}

/**
 * A value that follows its target like a spring, set by \`duration\` (seconds to settle) and \`bounce\` (0: no overshoot).
 *   const y = useSpring(open ? 0 : -40, { duration: 0.4, bounce: 0.2 });
 */
export function useSpring(target, options = {}) {
  const s = useMutable({ spring: startSpring(target) });
  useUpdate((dt) => {
    s.spring = stepSpring(s.spring, target, options, dt);
  });
  return s.spring.value;
}

/**
 * A value that eases to its target over \`duration\` seconds, along \`ease\`; a new target starts again from where it is.
 *   const opacity = useTween(visible ? 1 : 0, { duration: 0.25, ease: "outCubic" });
 */
export function useTween(target, options = {}) {
  const s = useMutable({ tween: startTween(target) });
  useUpdate((dt) => {
    s.tween = stepTween(s.tween, target, options, dt);
  });
  return s.tween.value;
}

/**
 * A shake of the view, as state: started at a moment, it runs down by itself.
 *   const shake = useShake();
 *   shake.strength = 3;
 *   shake.duration = 0.25;
 *   shake.elapsed = 0;
 *   <Camera shake={shake}>
 */
export function useShake() {
  const shake = useMutable({ strength: 0, duration: 0, elapsed: 0 });
  useUpdate((dt) => {
    shake.elapsed = shakeOn(shake, dt).elapsed ?? 0;
  });
  return shake;
}

/**
 * Seconds since the component mounted, growing with each update (each fixed step, under a fixed timestep): for something
 * that moves or blinks with time.
 *   const time = useTime();
 *   <Label color={time % 1 < 0.66 ? "white" : "black"} />
 */
export function useTime() {
  const s = useMutable({ time: 0 });
  useUpdate((dt) => {
    s.time += dt;
  });
  return s.time;
}

/**
 * A box that moves and is stopped by what is solid, in the same step: the solid tiles of a \`<Tilemap solid>\` and every
 * \`<Collider solid>\`. Its position is state; \`move\` returns the sides it was stopped on, \`touching(tag)\` says whether a
 * collider with that tag overlaps it now, and \`place\` puts it somewhere with no collision.
 *   const { x, y, move, touching } = useBody({ x: 16, y: 32, width: 8, height: 11 });
 */
export function useBody(options) {
  const b = useMutable({ body: createBody(options), x: options.x as number, y: options.y as number });
  const move = (dx: number, dy: number) => {
    const hit = b.body.move(dx, dy);
    b.x = b.body.x;
    b.y = b.body.y;
    return hit;
  };
  const touching = (tag: string) => b.body.touching(tag);
  const blocked = (dx: number, dy: number) => b.body.blocked(dx, dy);
  const overlapping = <Tag extends string>(tag: Tag) => b.body.overlapping(tag);
  const place = (toX: number, toY: number) => {
    b.body.place(toX, toY);
    b.x = b.body.x;
    b.y = b.body.y;
  };
  return { x: b.x, y: b.y, move, touching, blocked, overlapping, place };
}

/**
 * A value read from a store outside the game state (the settings, the controls, a store of the game's own), kept up to date: it
 * is read when the component mounts and again each time the store says it changed, and renders only when what is read differs.
 *   const values = useStore(settings, settingsView);
 */
export function useStore(store, read) {
  const s = useMutable({ value: read() });
  useMount(() => store.subscribe(() => {
    s.value = keepIfEqual(s.value, read());
  }));
  return s.value;
}
`;

/** The names of the library's hooks. */
export const LIBRARY_HOOKS: readonly string[] = ["useSquash", "useShake", "useTime", "useStore", "useBody", "useSpring", "useTween"];
