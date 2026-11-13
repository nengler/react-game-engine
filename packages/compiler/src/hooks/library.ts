/**
 * Hooks the engine ships, written as ordinary custom hooks (the inliner's input), so they are what an author could have written
 * from `useState` and `useUpdate`, and every rule of a component body applies to them. A component imports one from the
 * authoring module (`import { useSquash } from "@rge/runtime/jsx"`), where it is declared for TypeScript; the inliner takes its
 * body from here.
 */
export const LIBRARY_FILE = "rge:hooks.tsx";

export const LIBRARY_SOURCE = `import { keepIfEqual, shakeOn, springBack, useMount, useState, useUpdate } from "@rge/runtime/jsx";

/**
 * Squash and stretch: a scale that is set at a moment and springs back to 1 at \\\`recover\\\` a second.
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
export const LIBRARY_HOOKS: readonly string[] = ["useSquash", "useShake", "useTime", "useStore"];
