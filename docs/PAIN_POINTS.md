# Pain points for a new author

As of 2026-11-15. What still reads unlike React, or would confuse someone opening the engine for the first time. Rewritten after
`useMutable` replaced `useState` and `useRef` (#121, #127), lists inside list items (#140) and the game-state migration (#144): what
those fixed is gone from this list, and the history of each fix is in [DESIGN.md](DESIGN.md) and the notes it names. The order of the
work that follows is in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md), "Now".

`useEffect` stays out on purpose; what replaces each of its uses is in [DESIGN.md](DESIGN.md), "Why there is no `useEffect`".

## 1. It looks like React but compiles a subset

TSX invites people to write React. Most everyday React compiles as written (early returns, `let` and loops in the body, a function of
the component's own, `filter(…).map(…)`, conditions and lists inside list items, inline props types, `?.` and `??`); what is left:

- **Three zones.** The component body runs during render, so it cannot set state; a handler may run any loop, `try`, `new` or method
  on values it made; a plain `.ts` file allows anything. A newcomer has to know which zone they are in.
- **The body's calls are an allowlist.** Array methods that make a new value (`reduce` included since 2026-11-15), string and number
  methods, `Math` and the engine's helpers; handlers also have the standard library on values they made. A refused call says so in one
  short line.
- **No generic components** (`function List<T>(…)`, `TSE1001`, reported at the type parameter): a component is one class.
- **Imported functions are assumed pure** and not checked. A call in JSX runs on every render.
- **`useReducer` does not exist.** A reducer is a plain function in a `.ts` file that a handler calls (`s.n = reducer(s.n, action)`).

*Fixed 2026-11-15*, from eight everyday components compiled one by one: an imported constant or a call of an imported function as a
`useMutable` field's value (`{ gold: START_GOLD, hero: makeHero() }`, typed as TypeScript would, and `s.hero.hp -= 1` writes through
it); a derived value that may be null narrowing where it is tested (`cost !== null && gold >= cost`); `[...list].sort(f)` on a copy
made there; `{boss && <Text>{boss.hp}</Text>}` with `boss` from `.find()`, which crashed the compiler; a loop writing through the item
of a field's list (`for (const foe of s.foes) { foe.hp -= 1; }`, not when it also changes the list); and `let msg: string;` assigned by
a `switch` after it.

## 2. Refs on elements are missing on purpose

- **No `ref={…}`**: there is no handle on a node (`TSE1106`).
- **`useMount` / `useUnmount`** stand in for `useEffect(…, [])`, with an unusual order (mount runs children first, unmount runs the
  parent first). `useMount` may return a cleanup. A field cannot be written in `useUnmount` (`TSE1402`): tell the parent instead.

## 3. Game-engine semantics on React concepts

- **Input is polled.** Every `useInput` sees every key; `inert` and `modal` on `<Entity>`, `<Flex>` and `<Hud>` decide which subtrees
  hear it, as in HTML. A press goes in `useInput`; movement reads held keys in `useUpdate((dt, input) => …)`.
- **Frame timing.** A write in a handler is read back at once by that handler, and drawn at the next render; objects attached
  mid-frame get hooks next frame; collision callbacks run after `useUpdate`, which is why the guide says to read tiles, not colliders,
  for movement and deaths.
- **Props read live in handlers** everywhere but a callback prop (a function, made once) and a list inside a list item (since
  2026-11-15).
- **Placement.** Built-ins take `x` / `y`; a component is placed with `transform={{ x, y }}` (its own props may say `x`). The origin is
  top-left except where `originX` / `originY` exist, and `z` adds to the parent's.

## 4. Game state

- `GameState.ts` must call `createGameState` with an object literal for the data (no spreads or computed keys, `TSE1109`).
- Only actions change it: a write to a selected value is an error that names the action to add, and selected values are typed
  read-only. An action per small write (`point(s, pad) { s.cursor = pad; }`) is boilerplate; Kite has 8 actions, Hearth 10,
  Bramble 14, and none wanted a shortcut yet.
- A handler reads the game state as its component's last render saw it, not live, unlike its own `useMutable` fields.

## 5. Smaller gotchas

- **Keys.** A key reading only the index warns; a callback on a list item cannot read the index.
- **Side-effect imports** are refused in component files (`TSE1001`), and the message says to put them in a `.ts` file such as the game
  state.
- **The manifest gates the API.** A new runtime method compiles in plain TypeScript but fails in a component until
  `runtime/src/manifest.ts` lists it (Bramble finding 8).
- **A helper in a `.ts` file can change an item of a `useMutable` list in place** and nothing warns: render compares by `===`, so
  the screen shows nothing. Lists themselves are typed `MutableList<T>`, which a helper taking `T[]` refuses.

## 6. Tooling and getting started

- **Nothing is published.** A checkout and `npm run dist` (about two minutes, most of it building raylib) come before `tse create`.
  Only Node is needed to write, test and check a game; the window, screenshots and the Rust host need more, and `dist` says what.
- **The Rust host (`--engine quickjs`) reports errors in the bundled `game.js`**, not the `.tsx` line; Node and the V8 package map
  them back.
- **The guide is dense** and mixes design reasons with usage; priority 8's "checked by following it from scratch" is not ticked yet.

## Different on purpose

Said in the guide: no refs on elements, no spreading props onto a built-in, no render props or function children, no `async`
handlers (the game's clock has timers: `after`, `every`), no `useEffect`. Since D5 a render compares what it reads by `===`, so a
value changed in place shows nothing, as in React. Inside `useUpdate`, `useBody`'s `x` and `y` are the step's snapshot even after
`move`; `blocked` asks the body where it is now.
