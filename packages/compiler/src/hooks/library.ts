/**
 * Hooks the engine ships, written as ordinary custom hooks (the inliner's input), so they are what an author could have written
 * from `useState` and `useUpdate`, and every rule of a component body applies to them. A component imports one from the
 * authoring module (`import { useSquash } from "@rge/runtime/jsx"`), where it is declared for TypeScript; the inliner takes its
 * body from here.
 */
export const LIBRARY_FILE = "rge:hooks.tsx";

export const LIBRARY_SOURCE = `import { springBack, useState, useUpdate } from "@rge/runtime/jsx";

/**
 * Squash and stretch: a scale that is set at a moment and springs back to 1 at \\\`recover\\\` a second.
 *   const [squash, setSquash] = useSquash();
 *   setSquash({ scaleX: 0.6, scaleY: 1.4 });
 *   <Sprite transform={{ scaleX: squash.scaleX, scaleY: squash.scaleY }} />
 */
export function useSquash(recover = 1.75) {
  const [squash, setSquash] = useState<{ scaleX: number; scaleY: number }>({ scaleX: 1, scaleY: 1 });
  useUpdate((dt) => {
    setSquash((s) => springBack(s, recover, dt));
  });
  return [squash, setSquash];
}
`;

/** The names of the library's hooks. */
export const LIBRARY_HOOKS: readonly string[] = ["useSquash"];
