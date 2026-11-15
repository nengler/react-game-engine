# Pain points for a new author

As of 2026-11-12, with section 8 added 2026-11-14. What still reads unlike React, or would confuse someone opening the engine for the first time, gathered by
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
- ~~**Custom hooks are inlined text, not functions.**~~ *Since 2026-11-13:* a hook takes destructured parameters and callbacks,
  returns refs, names the chain when hooks recurse, and the guide says how inlining works. A function declared in the component
  body (`const add = (n: number) => …`) is a handler of the component's own.

## 2. Refs on elements and context are missing on purpose

- **No `ref={…}`**: there is no handle on a node.
- ~~**No context**~~ *Since 2026-11-13:* `createContext`, `<Theme.Provider value>` and `useContext`, as in React.
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
  says why the root is made with `new`; and "Coming from React" has a "When something goes wrong" table. *Since 2026-11-15* a game
  packaged on V8 (the default) names the same lines (`src/Main.tsx:12:3`, the engine's as `@rge/runtime/src/World.ts`): its bundle
  carries a source map and a small loader turns maps on before compiling it. Not yet: the Rust host (`--engine quickjs`) reports
  the bundled `game.js`.
- **Setup is heavy.** cmake, a C compiler and cargo are needed to make the tarballs before `rge create` works, since nothing is
  published. *Since:* only Node is needed to write, test and check a game: `npm run dist` builds what the machine can, keeps going
  when cmake or cargo is missing, and ends with what the author has and what to install for the rest (the guide's step 0 is a table of
  the same). Nothing is published, so a checkout and `npm run dist` is still the way in.
- ~~**Input scripts hold a key until it changes**~~ *Done:* the guide's testing section says it, and what an unknown name does.
- **The guide is dense and terse** and mixes design reasons with usage; priority 8's "checked by following it from scratch" is not
  ticked yet.

## 8. React written as React, run through the compiler (2026-11-14)

After everything in [REACT_FEEL_PLAN.md](REACT_FEEL_PLAN.md) but D3, 28 everyday React idioms were compiled one by one. 12 are
accepted as written: arrow-function components and `export default` of one, `filter(…).map(…)` in JSX, a ternary at the root, a
fragment of several roots, `switch` and `let` in the body, a function of the component's own, `useState(() => …)` with an updater,
`?.` and `??`, an index key, and `{n && <X />}`. The rest, in three kinds:

**Messages that were wrong or noisy** (each shown as the author types now, `rge lsp`). *Fixed 2026-11-14:*

- ~~One mistake, several errors~~: a `const` whose value was refused, a `useState` without its type or a props parameter not in the
  supported form left the name undeclared, and every read of it was reported again (`'m' is not a state value of this component`,
  three times for one typo). Now a name that is declared, once an error has been reported, is not reported again.
- ~~`forEach` "changes the array in place"~~: it does not; it is refused for its function, which changes variables around it. The
  message now says to write a `for…of` loop.
- ~~A misspelt method listed the `Math` functions~~: `n.toFixedd(2)` now says `did you mean 'toFixed'?`, and a misspelt function
  (`clmap`) names the nearest one (`clamp`).
- ~~`setTimeout` got the allowlist~~: `setTimeout`, `setInterval`, `clearTimeout`, `requestAnimationFrame`, `Date.now`,
  `performance.now` and `fetch` each say what to use instead (`after`, `every`, `cancelTimers`, `useUpdate`'s `dt`).
- ~~`if (!hero) return null;` said "the component body cannot return a value"~~: it now says to put the condition in what is
  returned, `return dead ? null : <Text>…</Text>;` (which works) or `{!dead && …}`.
- ~~A component declared inside another was "an unsupported statement in handler"~~: it now says to declare it at the top level; a
  plain `function` in the body says to write it as `const f = (…) => …`. Neither is a handler, and the word is gone from both.
- ~~`await` was `Unsupported expression (AwaitExpression)`~~: it now says the game's steps do not wait, and what to use.

**React that could be supported.** *The first four since 2026-11-14:*

- ~~`useState({ x: 0, y: 0 })` needs its type written~~: a literal of plain values gets the type TypeScript infers; an empty array
  still needs `useState<Item[]>([])`, as in TypeScript.
- ~~An inline props type is refused~~: `({ hp }: { hp: number })` is the component's props type, declared as `HeartProps`.
- ~~An early `return` before the last one~~: each `if (c) return A;` at the top of the body becomes a condition of the last
  `return` (the inliner's first pass), and what follows it is worked out only in the branch where it did not return. A memo read
  under a condition starts with `$assume(condition)`, so the generated code narrows what the source did (`hero.name` after
  `if (!hero) return null;`). An RGE error inside a moved early return points at the last `return`; TypeScript's own errors keep
  their place.
- ~~`import * as K from "./constants.ts"` is refused~~: a `.ts` module may be imported whole; Kite's `Runner.tsx` does.
- `useReducer` does not exist. *Kept out (2026-11-15):* `useMutable` and plain functions do its job, and the game state is data and
  actions already.

**Compiled one by one again, 2026-11-15** (eight everyday components in the `useMutable` style). Fixed then:

- ~~`useMutable({ gold: START_GOLD })` could not infer an imported constant~~ (and every later write to `s` had an error of its own):
  an imported constant has its declared type, widened; a call of an imported function, the type it returns. `s.hero.hp -= 1` on an
  object one of the game's own functions made is a write, as on any field (a runtime handle, `createBody()`, still is not).
- ~~`const cost = k === null ? null : PRICES[k]` did not narrow at `cost !== null && gold >= cost`~~ (TS2531 in the generated file):
  a derived conditional or `??` is one memo `const`.
- ~~`{boss && <Text>{boss.hp}</Text>}`, `boss` from `.find()`, crashed the compiler~~ (a memo assumed the condition that was itself);
  a memo read in a condition or a list's source is hoisted, so the branch reads the narrowed `const`.
- ~~`reduce`; `[...list].sort(f)`~~: allowed (the sort of a copy made there is `toSorted`).
- ~~`for (const foe of s.foes) { foe.hp -= 1; }`~~: lowered to a loop over the index (MUTABLE_STATE_FOLLOWUPS.md, item 3).
- ~~`let msg: string;` assigned by a `switch` after it~~: declared the same way in the generated code.
- A list inside a list item (RGE1209): the item has to become a component.

**Different on purpose** (said in the guide, or to be):

- No refs on elements, no spreading props onto a built-in, no render props or function children, no generic components, no
  `async` handlers (the game's clock has timers).
- `x` / `y` as props on built-ins only; a component is placed with `transform` (its own props may say `x`).
- Since D5 a render compares what it reads by `===`, so state changed in place shows nothing, as in React; nothing warns.
- Inside `useUpdate`, `useBody`'s `x` and `y` are the step's snapshot even after `move`, as every state is; `blocked` asks the body
  where it is now.

## What to fix first

1. ~~**Diagnostics in the `.tsx` source**~~ *Done:* `mapToSource` (DESIGN.md, "Errors in the source").
2. ~~**Input focus or consumption**~~ *Done:* `inert` and `modal` (DESIGN.md, "Inert and modal"). The input refs in `Play.tsx` stay:
   they carry a press from `useInput` to `useUpdate`, which a modal does not change.
3. ~~**A "coming from React" page**~~ *Done:* "Coming from React", the guide's second section (`docs/index.html#react`): what
   carries over, what is different and what to write instead, and the three places code can go.
