# React API review

Written 2026-11-08. This review checks the authoring API, both what exists today (M0–M3) and what is planned (M4–M6), against one goal: **writing a component should feel as close to ideal React as possible.** "Ideal" means React's model (UI as a function of state and props, hooks, composition), not React's accidents such as stale closures and dependency arrays.

Each item is marked:

- **OK:** already React-like.
- **Fixed:** changed in this PR.
- **Recommend** / **Decided:** a change proposed in the review; the outcome of each is in [Decisions](#decisions-made-2026-11-08).

## Today's API (M0–M3)

### Already React-like

| Area | Today | Notes |
| --- | --- | --- |
| Components | `function Player() { …; return <Entity>…</Entity>; }` | OK |
| State | `const [health, setHealth] = useState(100)`, `setHealth(v)`, `setHealth((h) => h - 1)` | OK. Setters batch: any number of calls in a frame cause one render |
| Rules of hooks | Hooks only at the top level of the component | OK, and enforced (`RGE1101`) |
| Conditional rendering | `{cond && <Warning />}` | OK |
| Refs | `const cooldown = useRef(0)`, `cooldown.current -= dt` in handlers | OK. Values only: no `ref={…}` on elements (see Decisions) |
| Position | `transform={{ x, y, global }}` from state; on any built-in element, relative to its parent | OK. Plays the role of React Native's `style` |
| Composition across files | `import { WarningIcon } from "./WarningIcon.tsx"` | OK, but named imports only (see below) |

### Fixed in this PR

| Was | Now | Why it mattered |
| --- | --- | --- |
| `setN((n) => n + 1)` was a compile error (`RGE1401`): handler code could not reuse a state name | Allowed. Shadowing follows JS; only redeclaring in the same scope, or rebinding `Math`/`clamp`, is an error | The most common updater idiom in React. Generated code reads state as `this.n`, so the parameter cannot be confused with it |
| The component body allowed only hooks and `return`. `const hurt = health < 25;` was an error | Derived `const`s are allowed. They are inlined where used, so JSX that uses them updates with their state | In React, almost every component computes values before `return` |
| Only `{cond && <X />}` was accepted | `{cond ? <A /> : <B />}` and `{cond ? <A /> : null}` also work, lowered to two conditional children | Ternaries are the other everyday conditional in JSX |

Tests for these are in `react.test.ts` and `handlers.test.ts`.

### Gaps

| # | Today | Ideal React | Recommendation |
| --- | --- | --- | --- |
| 1 | `onUpdate(…)`, `onInput(…)`, `onCollisionEnter(…)` | Hooks are named `use*`. React-three-fiber, the closest prior art, uses `useFrame((state, delta) => …)` | **Decided:** rename to `useUpdate((dt) => …)` and `useInput((input) => …)`. The `use` prefix also makes the standard `eslint-plugin-react-hooks` rules apply to source files. Keep the old names for one release as `RGE1102` errors that suggest the new name |
| 2 | Collisions are a component-wide hook: `onCollisionEnter((other) => …)` | Events are props on the element that emits them: `<button onClick={…}>` | **Decided:** `<Collider width={16} onCollisionEnter={(other) => …} />`. It says *which* collider was hit, which matters for hitboxes vs hurtboxes. It is also just a callback prop on an intrinsic, which M4 builds anyway. Do it in M4 |
| 3 | State reads in handlers are *live*: after `setX(5)`, a later `x` in the same handler reads 5 | React gives each render's handlers a snapshot: `setX(x + 1); setX(x + 1)` adds 1, and `x` keeps its value until the next render | **Decided: snapshots (done)** (see [Decisions](#decisions)). Besides matching React, it makes a frame order-independent: every handler in a frame sees the same state, whichever runs first |
| 4 | Source files use `useState`, `Entity` and `Sprite` with no imports. The compiler is fine with that, but an editor reports every one as undefined, and the TSX itself is never type-checked | React code imports hooks and components (`import { View } from "react-native"`), and the editor type-checks JSX props | **Decided:** an authoring entry point, `@rge/runtime/jsx` or a separate `@rge/react`, that exports typed declarations of the hooks and intrinsics plus a `JSX` namespace via `jsxImportSource`. Then `import { useState, Entity, Sprite } from "@rge/react"` gives autocomplete and prop checking in the editor. The analyzer already ignores non-relative imports, so this is mostly a `.d.ts` file plus updated examples. **This is the biggest day-to-day difference from React** |
| 5 | The root element must be `<Entity>` | A component can return any element or a fragment | **Decided:** `<>…</>` becomes an implicit container. A non-Entity root needs no container: `return <Sprite image="coin.png" />` makes the generated class extend `Sprite`. JSX children under a root are allowed only if that element type accepts children. Every built-in element has a transform (**done** in #8), so such a component can still be placed (M4) |
| 6 | Components must be `function Name() {}`; default exports and default imports are rejected | `const Enemy = () => …`, `export default function Enemy`, and `import Enemy from "./Enemy.tsx"` are all common | **Decided:** accept arrow-function components and default exports and imports. This is analyzer work only |
| 7 | No way to run code on mount or unmount: "clean up on despawn" | `useEffect(() => { …; return cleanup; }, [])` | **Decided:** `useMount` / `useUnmount` hooks (M9), not `useEffect`. Reacting to a state change happens where the state changes |
| 8 | No reuse of stateful logic | Custom hooks: `function useHealth(max) { const [h, setH] = useState(max); …; return [h, damage]; }` | **Recommend, later:** inline custom hooks at compile time. They are ordinary functions whose hooks follow the same top-level rule, so inlining fits the "hooks are compiler intrinsics" model |
| 9 | Sharing state across the tree means passing props down | `createContext` and `useContext` | Later, after M4. Note only |
| 10 | State is `number`, `string` or `boolean` | `useState({ x: 0, y: 0 })`, arrays | Planned in M5a (records and arrays). OK |

## Planned API (M4–M6)

### M4: props and callbacks

| Planned | Verdict |
| --- | --- |
| `function Enemy({ speed, onDefeated }: EnemyProps)` with defaults in the destructuring | OK, React exactly. Also accept the non-destructured `function Enemy(props: EnemyProps)` and `props.speed`, which React code uses as well |
| `<Enemy speed={…} onDefeated={() => setScore((s) => s + 1)} />` | OK. Callbacks are created once and read state through `this`, so they never go stale. That is better than React and needs no `useCallback` |
| `onDefeated?.()` in the child | OK |
| `children` unsupported | **Recommend: support it.** `<Panel><Button /></Panel>` is central to composing in React. Design: the parent constructs the child elements (it owns their state and props) and passes them as `children`; the child mounts them where `{children}` appears in its JSX. This is a slot child in the IR, a new `ChildIR` variant that holds the instances the parent passed. It can follow M4 as its own milestone |
| `transform` on a component element = placement, composed with the child's own transform | OK. Like `key` and `ref`, it is reserved by the framework, not a prop the component declares |
| Spread props `{...rest}` | Not planned. **Recommend:** a diagnostic in M4 with a clear message; consider it later |
| Collision events as props on `<Collider>` | **Recommend** in M4; see gap #2 |

### M5: keyed lists

| Planned | Verdict |
| --- | --- |
| `{enemies.map((e) => <Enemy key={e.id} speed={e.speed} />)}` | OK, React exactly |
| A missing `key` is an error | OK. React warns; making it an error is fine |
| Immutable updates (`setEnemies([...enemies, e])`) | OK, the same rule as React |
| Restrictions: a single element, no conditionals inside the callback | Acceptable for v1. **Recommend** also accepting `enemies.filter(…).map(…)` as the source, since filtering in JSX is very common, and lifting the conditional restriction later |
| M5a: array and object literals, spread, `filter`/`map` in handlers | Needed for React-style immutable updates. OK |

### M6: prefabs and scenes

| Planned | Verdict |
| --- | --- |
| Every exported component is a prefab; props are its schema | OK. Nothing new to learn |
| TSX scenes (a component that composes prefabs) | OK, the React way |
| JSON and Tiled scenes | An addition for data and editors, outside what React covers. It does not change how components are written. OK |

## Decisions (made 2026-11-08)

| Question | Decision | Status |
| --- | --- | --- |
| Hook names | `useUpdate` / `useInput`; the old `onUpdate` / `onInput` report `RGE1102` with the new name | **Done** in #8 |
| Collision events | A prop on `<Collider onCollisionEnter={…}>`, replacing the hook | M4 |
| State reads in handlers | React's snapshot semantics: reads see the last render's values, setters queue, updaters chain, `commitState()` applies before render | **Done** in #8 (`Hero.tsx`'s second handler now uses the updater form, the React-correct fix) |
| Refs | Values only: `const timer = useRef(0)`, a plain field that never renders, `.current` only in handlers. **No `ref={…}` on elements or components** | **Done** in #8 |
| Authoring types | A typed entry point for hooks and intrinsics; examples import explicitly | M7, next |
| Fragments and roots | A component may return a fragment or a non-Entity root; the root may have JSX children only if its element type accepts children | M4 |
| Component forms | Arrow-function components, default exports and default imports are allowed | M4 |
| `children` | Supported | M8 |
| Lifecycle | `useMount` / `useUnmount` hooks. **No `useEffect`** | M9 |

Planned order:

1. M7 authoring types.
2. M4, with collision props, fragment and non-Entity roots, and the extra component forms.
3. M8 children.
4. M5a, then M5b.
5. M9 mount and unmount hooks.
6. M6.
7. Later: custom hooks and context.
