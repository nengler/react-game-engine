# Pain points for a new author

As of 2026-11-12. What still reads unlike React, or would confuse someone opening the engine for the first time, gathered by
reading the authoring guide (`docs/*.html`), the findings in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md) and
[`games/bramble/DESIGN.md`](../games/bramble/DESIGN.md), and Bramble's code. Findings that have already been fixed (computed lists,
conditions in `.map`, spread props, `!== undefined`, component roots, objects in the game state) are left out.

`useEffect` stays out; what replaces each of its uses is decided in [DESIGN.md](DESIGN.md), "Why there is no `useEffect`"
(2026-11-12). Two of those answers are built since: a cleanup returned from `useMount`, and `key` on any element.

The fixes for what is left here (custom hooks, names that clash with the root, context, `useGame((s) => s)`, mirroring settings,
repeated text style) are planned in [REACT_FEEL_PLAN.md](REACT_FEEL_PLAN.md) (2026-11-13), with what that review found besides.

## 1. It looks like React but compiles a subset

TSX invites people to write React, and then they hit `RGE` codes.

- ~~**Three languages in one file.**~~ *Since 2026-11-13:* the component body takes `let`, loops and a list built up, worked out
  together and again only when what they read changes; handlers take every loop, `try`, `new`, the standard library and in-place
  changes to their own values. What remains is that a component body runs during render, so it cannot set state, as in React. Plain `.ts` files allow anything. A newcomer has to know which zone they are in.
- **Method allowlists.** `push`, `sort` and "other methods of values" are rejected; the fix is "put it in a plain function". Defensible,
  but not visible from the syntax. *Since 2026-11-13:* in a handler, any method of a value the handler made itself, `new`, and the
  standard library work; only state and props stay immutable.
- **Imported functions are assumed pure** and not checked. A call in JSX runs on every render.
- **Custom hooks are inlined text, not functions.** They cannot return refs, destructured parameters do not work, nesting stops at six,
  and a literal argument is pasted into the hook. They behave like macros; the guide says so only in passing.

## 2. Refs on elements and context are missing on purpose

- **No `ref={…}`**: there is no handle on a node.
- **No context**: deep trees pass props by hand or use the global store.
- **`useMount` / `useUnmount`** stand in for `useEffect(…, [])`, with an unusual order (mount runs children first, unmount runs
  the parent first). *Since:* `useMount` may return a cleanup, and a handler may hand an arrow to a function
  (`useMount(() => settings.subscribe(() => …))`).

## 3. Game-engine semantics on React concepts

- **Input is polled, not event-driven.** Every `useInput` sees every key, so components guarded themselves: Bramble's `Menu` took a
  `disabled` prop and `Play` wrote `if (paused) return` so that two components did not both act on one press. *Since:* `inert` and
  `modal` on `<Entity>`, `<Flex>` and `<Hud>`, as in HTML, decide which subtrees hear input; Bramble's pause screen and its "press a
  key" prompt are modals, and `Menu` has no `disabled` prop.
- **Refs carried input from `useInput` to `useUpdate`.** `Play.tsx` kept three (`dx`, `dy`, `action`) and kept a press until the
  update took it, and the demo and the project template did the same. A newcomer asks why there are two hooks. *Since:* they were
  never needed: `useUpdate((dt, input) => …)` gets the same input in the same step (Kite always read it there). The template, the demo
  and Bramble do, and the guide says which hook is for what (a press goes in `useInput`, movement reads the keys in `useUpdate`).
- **Frame timing.** State set in a handler shows next render; objects attached mid-frame get hooks next frame; collision callbacks run
  after `useUpdate`, which is why the guide says to read tiles, not colliders, for movement and deaths.
- **`transform={{ x, y }}`** rather than style or position props. The origin is top-left except where `originX` / `originY` exist, and
  `z` adds to the parent's.

## 4. Game state: Zustand-shaped, with extra rules

- ~~A selector subscribes to the paths it reads, but `useGame((s) => s)` is allowed only to destructure actions~~ *Since
  2026-11-13:* actions come from `const { collect } = useGame.actions()`; taking them from `useGame((s) => s)` warns.
- Actions are called as statements in handlers, never in JSX.
- `GameState.ts` must return an object literal: no spreads or computed keys (`RGE1109`).
- ~~Settings and controls are stores of their own, so the game mirrors them by hand~~ *Since 2026-11-13:*
  `useStore(settings, settingsView)` shows a store outside the game state and follows it.
- A selected object is trusted not to be changed in place; nothing enforces it.

## 5. ~~Names collide with the root built-in~~ (fixed 2026-11-13)

*Since:* a state, ref or sound named like a member of the root built-in is kept in a `$name` field, so the name is the author's to
use (`REACT_FEEL_PLAN.md`, B7). What follows is how it was.

The component's class extends its root built-in, so state, refs and props cannot reuse the root's member names: no `width` prop on a
`<Collider>` root, no `name` on an `<Entity>` root, and a `useState` called `name` is still refused. An invisible inheritance rule with
no React equivalent.

## 6. Smaller gotchas

- ~~**Text.** The words went in `text={…}` or as children, two ways to write one thing.~~ *Since:* `<Text>` takes its words as children
  only; `text=` is an error that says where the words go, and the games, templates and guide use children.
- **Keys.** A key reading only the index warns; a callback on a list item cannot read the index. ~~`key` only inside a `.map`~~
  *Since:* `key` works on any element but a component's root, and starts it over when it changes (`<Dialogue key={talk.id} />`).
- **Props** need a named type declared in the same file (an inline `{ top: number }` is refused); the props object cannot be passed on
  or spread except onto components.
- **No list inside a list item**, nor `{children}` or a `<Route>` there; the workaround is "make the item a component".
- **Side-effect imports** are refused in component files (`RGE1001`); registering tilemaps moved into a `.ts` file `GameState.ts`
  imports.
- ~~**Docs disagree about refs.**~~ *Done:* the guide says what the compiler allows (any value but an element, RGE1106), as `DESIGN.md` did.
- **The manifest gates the API.** A new runtime method compiles in plain TypeScript but fails in a component until
  `runtime/src/manifest.ts` lists it (Bramble finding 8).
- ~~**`useEffect` gave a bare `Unknown hook 'useEffect'.`**~~ *Since:* its message names what to write instead.

## 7. Tooling and getting started

- **Errors name generated files.** `generated/Play.ts:9:23 … './World.ts'` when the real cause is a `src/` file that failed to compile
  earlier in the output (Bramble finding 6). *Since:* a type error in generated code is reported at the `.tsx` line it was written
  for, and a file that fails to compile is not reported again as a missing module.
- **The generated code shows through.** `game.ts` imports `./generated/Main.ts` and calls `new Main()`: a function became a class, and
  an error thrown while the game ran read `at Main.onInput (generated/Main.ts:71:7)`. *Since:* `rge` compiles with source maps and runs
  the window and the tests under `--enable-source-maps`, so it reads `at Main.onInput (src/Main.tsx:14:3)`; the template's `game.ts`
  says why the root is made with `new`; and "Coming from React" has a "When something goes wrong" table. Not yet: a packaged game and
  the Rust host report the bundled `game.js`.
- **Setup is heavy.** cmake, a C compiler and cargo are needed to make the tarballs before `rge create` works, since nothing is
  published. *Since:* only Node is needed to write, test and check a game: `npm run dist` builds what the machine can, keeps going
  when cmake or cargo is missing, and ends with what the author has and what to install for the rest (the guide's step 0 is a table of
  the same). Nothing is published, so a checkout and `npm run dist` is still the way in.
- ~~**Input scripts hold a key until it changes**~~ *Done:* the guide's testing section says it, and what an unknown name does.
- **The guide is dense and terse** and mixes design reasons with usage; priority 8's "checked by following it from scratch" is not
  ticked yet.

## What to fix first

1. ~~**Diagnostics in the `.tsx` source**~~ *Done:* `mapToSource` (DESIGN.md, "Errors in the source").
2. ~~**Input focus or consumption**~~ *Done:* `inert` and `modal` (DESIGN.md, "Inert and modal"). The input refs in `Play.tsx` stay:
   they carry a press from `useInput` to `useUpdate`, which a modal does not change.
3. ~~**A "coming from React" page**~~ *Done:* "Coming from React", the guide's second section (`docs/index.html#react`): what
   carries over, what is different and what to write instead, and the three places code can go.
