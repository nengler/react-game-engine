# Making it feel like React: a plan

As of 2026-11-13. Written after a review of the engine as a whole, asking three questions: how close writing a game is to
writing React, what is missing, and what big wins the engine's design makes cheap but it does not have yet. The review read the
authoring guide (`docs/*.html`), [DESIGN.md](DESIGN.md), [PAIN_POINTS.md](PAIN_POINTS.md), [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md)
and the three games (Kite, Hearth and Bramble). Nothing was played in a window for it.

This document does not repeat PAIN_POINTS.md. Where an item there is ranked higher here (custom hooks as macros, and names that
clash with the root built-in), it is said why, and the section proposes a fix rather than restating the problem.

**Held back on purpose:** `useChange(value, (prev) => …)`, the one legitimate `useEffect` use with no answer yet (DESIGN.md, "Why
there is no `useEffect`"). It is kept for a separate discussion and is not planned here. Where an item below touches it, it says so.

## Summary

The engine is strong where it counts for a code-first game engine: the compiler, its diagnostics, deterministic replays, headless
tests, hot reload that keeps state, and native packaging. The React feel, though, holds mostly at the view layer. In all three games
the components are thin views over one store, and the game itself is plain TypeScript in `rules/`.

**Decided 2026-11-13: the goal is that game code lives in components, written like React.** The README's first example (a `Player`
that keeps its own `health` in `useState`) is the target, not a simplification. The games moved their logic into `rules/` because of
specific limits, and each is a problem to fix, not a shape to recommend. Section A plans those fixes; B to D make the rest read like
React and add what the games worked around. Plain functions in `.ts` files stay available, the way a React app extracts a reducer
or a helper, but they stop being the only way to write a game that can be tested, saved and replayed.

| # | Item | Kind | Size (estimate) | Depends on |
| --- | --- | --- | --- | --- |
| **A** | **Game code in components** | | | |
| A1 | Handlers are plain TypeScript, and a component body may compute with statements | Compiler | \~2.5–3.5 weeks | — |
| A2 | Movement and collisions answered in the same step: `useBody` | Runtime, compiler | \~2–3 weeks | — |
| A3 | Contacts carry data: `<Collider data>`, typed by tag | Runtime, compiler | \~3–4 days | — |
| A4 | Testing one component without a window (`@rge/testing`) | New package, runtime | \~1–1.5 weeks | B7 |
| A5 | Component state in saves | Runtime | \~1 week | — |
| A6 | What a component knows about others: lifting state up, and its timing | Guide, runtime | \~3–4 days | C3 |
| A7 | Prove it: Hearth rewritten with its game in components | Game | \~2 weeks | A1–A5 |
| A8 | The guide, the template and the README teach components first | Guide, template | \~3–4 days | A7 |
| **B** | **Parts that do not read like React** | | | |
| B1 | A component's root `<Entity>` is named after the component by default | Compiler | \~1 day | — |
| B2 | Lay out lists with `<Flex>`, not arithmetic; `x` / `y` as shorthand props | Guide, compiler, runtime | \~3–4 days | — |
| B3 | Text wrappers that take their words as children (`<Label>Coins: {coins}</Label>`), and game-wide text defaults | Compiler, runtime | \~3–4 days | — |
| B4 | Actions without `useGame((s) => s)` | Runtime, compiler | \~1–2 days | — |
| B5 | `useStore` for stores outside the game state (`useSyncExternalStore`) | Compiler, runtime | \~3–4 days | — |
| B6 | Custom hooks that behave like functions | Compiler | \~1.5–2 weeks | — |
| B7 | A component's names stop clashing with its root built-in | Compiler | \~3–5 days | — |
| **C** | **Missing functionality** | | | |
| C1 | Motion: springs and tweens for position, scale, rotation and opacity | Runtime, compiler, player | \~1.5–2 weeks | — |
| C2 | Timers and sequences: `after`, `every`, and a sequence for cutscenes | Compiler, runtime | \~1–1.5 weeks | — |
| C3 | Context: `createContext`, a provider, `useContext` | Compiler, runtime | \~1.5–2 weeks | — |
| C4 | A layout overlay and an inspector of the tree and the state | Player, player-node | \~1.5 weeks | — |
| **D** | **Big wins the design makes cheap** | | | |
| D1 | Rewind in `rge dev`: scrub back, edit, replay to the same frame | Player, player-node, CLI | \~2–3 weeks | C4 (shares UI) |
| D2 | `RGE` diagnostics in the editor, as you type | Compiler, new editor package | \~2–3 weeks | — |
| D3 | A web (canvas) backend, and examples that run in the guide | Player, new web package, guide | \~3–4 weeks | — |
| D4 | Preview one component on its own, with props, as Storybook does | CLI, player | \~1 week | — |
| D5 | Dependency-scoped `render()`: use what the compiler knows | Compiler | \~1–1.5 weeks | — |

Sizes are rough, for one engineer, in the style of NEXT_PRIORITIES.md. "Order of work" at the end says what to do first.

---

## A. Game code in components

**Why the games left components.** NEXT_PRIORITIES.md records it, game by game:

| What pushed logic out of components | Where it was found | Fixed by |
| --- | --- | --- |
| "A compiled component can hold almost no logic": no loops, `let` or most method calls in handlers; the escape was a plain function in `rules/` | Kite finding 1; Bramble finding 1 ("the subset is still the main cost, a third time") | A1, and B6 for hooks |
| Collision callbacks run after the step's update, so movement and deaths read tiles in the rules instead | Kite finding 5; PAIN_POINTS.md section 3 | A2 |
| A contact says only `tag` and `owner`, so a handler cannot learn what it touched (a coin's value, an enemy's damage) without the game state | `Contact` in `runtime/src/components/Collider.ts` | A3 |
| The rules could be tested with no engine (Kite 40+ tests, Hearth 27, Bramble 40); a component could be tested only by running the whole game from an input script | Kite and Hearth "rules apart from drawing" | A4 |
| Saves pick from the game state (`createSave({ pick })`), so state kept in a component is lost on save | Bramble's `GameState.ts` | A5 |
| An enemy that chases the player needs the player's position; with no refs and no context, the game state was the only shared place | Hearth, Bramble | A6, C3 |
| Kite's character "stepped itself" in one big component, and Hearth's single `act` in `Play` "worked better" | Hearth findings, "which of Kite's findings held" | A1 and A2 make the first shape workable |

What already works for component state, and needs no change: replays of a whole game from an input script (they drive the
components, so they replay component state too), hot reload (it keeps every `useState` and ref), the fixed step and `freeze`,
keyed lists of components that each own their state, callbacks up to a parent (`onDie`, `onDefeated`) and effect stores called
from handlers (`sfx.play`, `fx.burst`).

What stays a reason to write some code as plain functions: a **search over the game** (Kite's solver, Bramble's "can be finished"
proof) steps the game thousands of times from copied states, which pure functions make cheap. With D1's snapshots a search can run
over a headless world instead, at a higher cost per step. That is a trade the author makes for a given system, as a React app
chooses to put some logic in a reducer; it is not the engine's default.

### A1. Handlers are plain TypeScript, and the body may compute

**Built 2026-11-13**, in three steps, one PR each: (a) every loop, `try` and `throw` in handlers (2026-11-13; DESIGN.md, "Every loop,
and `try`, in handlers"); (b) any expression in a handler: `new`, `typeof`, `instanceof`, methods of local values (2026-11-13; DESIGN.md, "Any expression in
handlers"); (c) statements in the component body (2026-11-13; DESIGN.md, "Statements in the component body"). Left for
later: destructuring declarations in a block. Point 2's check is by the compiler (an owned value, see DESIGN.md), not by
`readonly` types.

**Today.** Three languages in one file (PAIN_POINTS.md section 1): the component body allows expressions only; handlers allow `let`,
`for…of` and `switch` but not `while`, C-style `for`, `try`, or methods outside an allowlist (`push` and `sort` are rejected);
plain `.ts` files allow anything. Handlers are lowered statement by statement into the IR (DESIGN.md, "Handlers"), which is why
each construct has to be added by hand. A React developer writes a `useUpdate` like any function and is refused.

**Proposal.**

1. **Handlers are copied, not lowered.** A handler's body (in `useUpdate`, `useInput`, `useMount`, an `on…` prop, a callback) is
   emitted as the TypeScript it was written as, with only the names that mean something to the component rewritten: a state read
   becomes the snapshot field, a setter call becomes the generated setter, a ref becomes its field, a prop becomes the props field,
   a game-state action becomes the store call. This is what the hook inliner already does for hooks (`hooks/inline.ts`: rewrite
   names, keep the text). Everything else in TypeScript works because nothing else is touched: loops of every kind, `try`, local
   arrays with `push` and `sort`, closures, early `return`.
2. **What the compiler still checks in a handler**: that a setter is not called during render, that state is not assigned
   directly (`health = 3` is an error naming `setHealth`), and that a state array or object is not mutated in place
   (`items.push(x)` on state; a local array is fine). The last is checked by type (state arrays are `readonly`) rather than by an
   allowlist, so the TypeScript error appears in the editor with no `RGE` code needed.
3. **The component body may hold statements.** Everything before `return` that is not a hook call is a *derived block*: the
   compiler finds what state, props and game-state paths it reads, and runs the block again when any of them change, as it does for
   a derived `const` today. So this compiles:

   ```tsx
   function Inventory({ items }: InventoryProps) {
     const rows: Row[] = [];
     let total = 0;
     for (const item of items) {
       if (item.count === 0) continue;
       rows.push({ id: item.id, label: `${item.name} ×${item.count}` });
       total += item.count;
     }
     return …;
   }
   ```

   The block's results (`rows`, `total`) are cached fields; JSX reads them. Combined with D5, only the blocks whose inputs changed
   run.
4. **The rule that stays**: hooks at the top level only, never in a condition or a loop. React has the same rule, and the message
   can say so.

**Constraints.** Source maps (DESIGN.md, "Errors in the source") already map generated lines to the `.tsx`; copied handlers map
one to one, which is simpler than lowered ones. Hot reload, replays and parity are unaffected: the generated code is still a class
with the same fields. The IR loses its statement kinds for handlers; the compiler's tests for each handler construct become tests
of the rewrite.

**Open questions.**

1. Whether the derived block may call setters (React forbids it during render). Suggested no, with an error that says to move it
   into a handler.

**Done when**

- [x] Any TypeScript compiles in a handler, with tests for `while`, C-style `for`, `try`, local arrays and closures
- [x] Direct assignment to state and in-place mutation of state are errors at the right line
- [x] A component body may hold statements, re-run only when what they read changes
- [x] PAIN_POINTS.md section 1's first two bullets are closed

### A2. Movement and collisions answered in the same step: `useBody`

**Built 2026-11-13** as `const { x, y, move, touching, place } = useBody({ … })` (DESIGN.md, "Bodies: `useBody`"): the hook
returns functions, which B6 made possible, rather than a handle with methods. Not done: the body as a collider others hit, one-way
platforms, and Kite's movement rewritten with it (left to A7).

**Today.** Collisions are found after every step and reported to `onCollisionEnter` after the step's `useUpdate` (DESIGN.md, "Why
collisions are per step"). So a component that moves in its update learns it hit a wall one step later, after it is already inside
it. Kite read tiles in its rules instead, with `moveActorX` / `moveActorY` (`runtime/src/move.ts`), which take a `blocked(x, y)`
function the rules write. That works for tiles only, and only in a `.ts` file.

**Proposal.** A hook that owns a box's position and moves it against what is solid, answering at once:

```tsx
function Player() {
  const [vy, setVy] = useState(0);
  const [dead, setDead] = useState(false);
  const body = useBody({ x: 16, y: 32, width: 8, height: 11, layer: "player" });

  useUpdate((dt, input) => {
    const dx = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
    const hit = body.move(dx * 90 * dt, vy * dt);      // pixel by pixel, stops at solids, now
    if (hit.down) setVy(input.pressed("jump") ? -220 : 0);
    else setVy(vy + 600 * dt);
    if (body.touching("spikes")) setDead(true);        // overlaps right now, not next step
  });

  return (
    <Entity transform={{ x: body.x, y: body.y }}>
      <Sprite image={dead ? "hero-dead.png" : "hero.png"} />
    </Entity>
  );
}
```

- `useBody(initial)` returns a handle with `x`, `y` (state: reading them renders), `move(dx, dy)` and `touching(tag)`.
- `move` uses `moveActorX` / `moveActorY` with a `blocked` built by the engine from what is solid: `<Tilemap solid>` (or a tile
  property, as Bramble's maps already carry) and `<Collider solid>`. It returns `{ left, right, up, down }` for the sides it was
  stopped on, and the tags of the solids it met.
- `touching(tag)` asks the collision tracker for this body's overlaps *now*, against the positions after this move.
  `onCollisionEnter` keeps working, after the update as today, for things that do not need an answer in the same step.
- The body is a collider with the given `layer` and `hits`, so others collide with it as with any `<Collider>`.
- Order: bodies move in tree order within a step, each against the others' positions as moved so far. Deterministic, and what the
  pixel movers in the games already assume.

**Constraints.** `useBody` is a hook that returns an object with methods, which B6 must allow (custom hooks returning functions) or
which the compiler knows as a built-in hook (as `useGame` is). The tracker needs a query by box (`rge_overlaps` already finds the
boxes that overlap, NATIVE_PLAN.md); in script, the sweep it replaces is the fallback. Parity holds because movement is whole pixels
and order is fixed.

**Open questions.**

1. Slopes and one-way platforms: `solid="top"` on a collider or a tile for one-way; slopes wait for a game.
2. Whether `useBody` should also carry velocity and gravity (a small physics body). Suggested no: velocity is the game's own state,
   as above; a `usePlatformer` built from `useBody` can ship later as an ordinary hook.

**Done when**

- [x] `useBody` moves against solid tiles and solid colliders and returns the sides it hit, in the same step
- [x] `touching(tag)` answers in the same step; parity and replays pass
- [ ] Kite's movement is written once with `useBody` in a component as a test (beside its rules, to compare feel and cost)
- [x] The guide's "Tilemaps and movement" section leads with it

### A3. Contacts carry data

**Built 2026-11-13**, typed through a global `ColliderData` interface rather than `declare module "@rge/runtime"` (DESIGN.md, "What
`other` exposes"). Not done: the games still pass values through the game state (the A7 rewrite moves Hearth to `data`).

**Today.** `Contact` has `tag` and `owner`. A player touching a coin knows it is `"coin"` but not that it is worth 5; an enemy
touching the player cannot say how much it hurts. The games put this in the game state, keyed by id, and looked it up.

**Proposal.**

```tsx
<Collider width={8} height={8} tag="coin" data={{ value }} />

onCollisionEnter={(other) => {
  if (other.tag === "coin") setCoins(coins + other.data.value);
}}
```

- `data` is any value (compared like a prop: a new object only when what is in it changed).
- `other` is typed as a union by tag from one declaration in a `.ts` file, so `other.data.value` is a `number` after the
  `other.tag === "coin"` check:

  ```ts
  // colliders.ts
  declare global {
    interface ColliderData { coin: { value: number }; enemy: { damage: number }; spikes: undefined }
  }
  ```

  With no declaration, `data` is `unknown`, as today's code would expect.
- `useBody`'s `move` and `touching` (A2) return contacts with `data` too.

**Done when**

- [x] `<Collider data>` reaches `other.data` in both callbacks, typed by tag (not yet through `useBody`)
- [x] A coin's value and an enemy's damage travel by collision in one game, not through the game state (Hearth's blasts, A7)

### A4. Testing one component without a window

**Built 2026-11-13** (`packages/testing`; DESIGN.md, "Testing one component"), with `separate` and `unmount` besides the planned
methods. Not done: the template's tests, which wait for A8 since the package must then be packed for games outside the repository.

**Today.** A rule is a function, so a test calls it. A component can be tested only by running the whole game from an input
script (`runScript`, `packages/player/src/harness.ts`) and reading the game state or the draw records. There is nothing like React
Testing Library for one component, so a component that owns its logic is harder to test than the same logic in `rules/`. That
alone is a reason authors would keep logic out of components.

**Proposal.** A small package, `@rge/testing`, over the headless `World` the runtime already has (`tick`, `reportCollision`,
`reportPress`):

```ts
import { render } from "@rge/testing";
import { Enemy } from "../generated/Enemy.ts";

test("an enemy dies after three hits", () => {
  const onDefeated = mock.fn();
  const t = render(Enemy, { x: 0, y: 0, hp: 3, onDefeated }, { tilemaps: ["field"] });
  t.collide("enemy", { tag: "shot", data: { damage: 1 } }, 3);   // three contacts on its collider tagged "enemy"
  t.step(1);
  assert.equal(onDefeated.mock.callCount(), 1);
});

test("the player walks right", () => {
  const t = render(Player, {}, { tilemaps: ["room1"] });
  t.input("right*30");                     // the input script language the games already use
  assert.ok(t.state(Player).x > 40);       // the component's own state, through B7's accessor
  assert.deepEqual(t.find("Sprite").image, "hero.png");
});
```

- `render(Component, props, options)` mounts the component as a root in a headless world, with the game state reset (or a given
  state), assets and tilemaps registered, and no backend.
- `step(n)`, `input(script)` (the script syntax of `parseInputScript`), `press(x, y)`, `collide(tag, contact, times)`,
  `setProps(props)`.
- Queries: `find(nameOrClass)`, `findAll`, `state(Component)` (its `useState` values and refs, read through the accessor B7 adds),
  and `records()` for what would be drawn.
- Tests import the generated class, as `game.ts` does today; the testing package runs the compiler first if the generated code is
  older than the source (as `rge check` does).

**Done when**

- [x] `@rge/testing` exists with `render`, `step`, `input`, `collide`, `press`, `setProps` and the queries
- [x] The template's tests show it (A8: beside a whole-game replay; the template has no rules left to test)
- [x] A7's Hearth has component tests for its enemies and towers

### A5. Component state in saves

**Built 2026-11-13** (DESIGN.md, "Component state in saves"). Not done: `useState(…, { save: false })` to leave a state out (a
cursor, a hover), which waits for a game that wants it; and Hearth saving mid-wave (A7).

**Today.** `createSave({ pick, apply })` saves what `pick` returns from the game state. A component's own state is not saved, so a
game that keeps an enemy's health in the enemy loses it.

**Proposal.** A save can include the tree, as hot reload already does:

```ts
export const save = createSave<SaveData>({
  name: "save",
  version: 1,
  pick: () => ({ screen: useGame.getState().screen }),   // the game state part, as today
  tree: true,                                          // and every component's own state
});
```

- With `tree: true`, `write()` stores `captureHotState(root)` beside `pick()`'s data, and `load()` rebuilds the tree from the
  game state, then restores component state with `restoreHotState`, as a hot reload does.
- Paths name objects by `key` where one is given, not only by class and index (`Main/Play:0/Enemy[beetle-3]`), so a list item
  keeps its own state when an earlier one was removed. Hot reload gains the same improvement.
- Saved values are what `saveHotState` returns: state and refs, which are plain data. A component whose state holds something that
  is not (a function, an effect handle) is skipped with a warning naming the field.
- `version` works as today: a save from an older version is passed to `migrate` (or refused), the tree part included.

**Open questions.**

1. Whole tree, or only components that opt in (`useState(3, { save: true })`)? The whole tree is simplest and matches hot reload;
   opt-in keeps saves small and stable across code changes. Suggested: the whole tree, with `save: false` on a state to leave it out
   (a cursor, a hover).

**Done when**

- [x] `createSave({ tree: true })` saves and restores component state, with tests for keyed lists and a removed item
- [x] Hot reload paths use keys
- [ ] A7's Hearth saves mid-wave and loads back to the same enemies

### A6. What a component knows about others

**Built 2026-11-13**: the guide and the timing test (DESIGN.md, "Sharing state between components"); C3 dropped its "not for game
data" rule when it was built.

**Today.** There are no refs on elements and no context, so an enemy that chases the player reads the player's position from the
game state, which means the player's position lives there and not in the player.

**Proposal.** React's answer, said plainly in the guide, with the engine's timing spelled out:

- **Lift state up.** What two components need lives in their nearest common parent, as in React: the level holds the player's
  position if enemies need it, and passes it down as a prop or through context (C3); the player reports it up through a callback
  (`onMove`). The game state is the top of that ladder, for what the whole game shares (the screen, the score, the run).
- **Timing.** A child's update sees its parent's state as of the start of the step (the snapshot rule every component already has),
  and a value reported up through a callback in this step is seen by others next step. One step of lag between independent things
  is deterministic and is what most engines do; where it matters (a camera following the player), the built-in reads the child's
  transform directly, as `<Camera>` already does.
- **Context for game data is fine.** C3 drops its "not for game data" rule: a `<Level>` providing the player's position to every
  enemy is what context is for.

**Done when**

- [x] The guide has a "Sharing state between components" section with the chase example, both by props and by context
- [x] The step timing is in "How a frame works", with a test that pins it

### A7. Prove it: Hearth with its game in components

**Built 2026-11-13**, in place (the old version is the commit before it, `stepBattle` in `rules/battle.ts`). Findings, the costs and
what still did not read like React: NEXT_PRIORITIES.md, "Findings from Hearth in components". It took four engine additions:
`overlapping(tag)` on `useBody`, `<Game timeScale paused>`, `once` sounds, and `collisions` / `place` in `@rge/testing`.

**Why Hearth.** Its world is a list of things that each have their own state and behaviour: enemies walk a path and take damage,
towers aim and fire, shots fly and hit. Today all of it is `stepBattle` in `rules/` and the components are views (`Enemy.tsx` takes
eight props). It has 27 rule tests and replays to compare against.

**Work.**

- Rewrite Hearth so that `Enemy`, `Tower` and `Shot` own their state and step themselves in `useUpdate`, collide with `A2`/`A3`, and
  report up by callbacks; `Play` keeps the wave, the gold and the lives.
- Keep the old version on a branch or in a folder for the comparison; do not ship both.
- Port the rule tests to `@rge/testing` (A4), and keep the whole-game replays.
- Measure: lines of code, the step cost at wave 10 under V8 and QuickJS (each enemy renders each step either way), and how the
  tests read.
- Write what still did not read like React, as each game has.

**Done when**

- [x] Hearth plays the same waves with its game in components, its replays and parity passing
- [x] Its tests are component tests, and none needed a plain function to be testable
- [x] Wave 10's cost is recorded beside today's
- [x] The findings are in NEXT_PRIORITIES.md

### A8. The guide, the template and the README teach components first

**Built 2026-11-13.** The guide's mental model, "Coming from React", "Three places code can go", the recipes and "Custom hooks
and plain functions" put game code in components and plain functions where React would extract them; "When something goes
wrong" has the questions A2 and A6 raised. The template's hero is `src/Hero.tsx` with `useBody`, tested alone with `@rge/testing`
(`test/hero.test.ts`), which is now packed (`npm run pack`) and a dev dependency of a new game. Checked by making a game from the
packs outside the repository and running `rge check` (3 tests, parity with the Rust host).

**Work.**

- The README's first example stays as it is: it is the target.
- The guide's "mental model" and "Coming from React" say that game code goes in components, as in React, and that a plain function
  in a `.ts` file is for what you would extract in React too (a pure calculation, a table, something a search runs many times).
  The "Three places code can go" table changes to match.
- The template's `src/rules/move.ts` becomes a component with `useBody`, and its tests use `@rge/testing`.
- "When something goes wrong" gets the new questions: "my enemy does not see the player" (A6), "my collision is a step late" (A2).

**Done when**

- [x] The guide, the template and the README all start from component state, checked by following the guide from scratch

---

## B. Parts that do not read like React

### B1. A root `<Entity>` named after its component

**Built 2026-11-13.** See DESIGN.md, "A root named after its component".

**Today.** Nearly every component starts `<Entity name="Play">`, repeating the component's name: 17 times in Bramble alone. The
name is not decoration. `Collider.owner` walks up the tree to the nearest non-empty `name` and falls back to the class name
(`packages/runtime/src/components/Collider.ts`), and collision handlers read it as `other.owner`. So leaving the name out does not
break anything, but it changes what `other.owner` says, and nobody can see that from the source.

**Proposal.** When a component's root is an `<Entity>` (or a fragment, which is an implicit `Entity`) with no `name`, the compiler
writes the component's name: `super({ name: "Play" })`. An explicit `name` still wins. Nested `<Entity>` elements are unchanged:
they stay unnamed unless written.

- Generated code: in the constructor's `super({ … })` call, the default comes before the author's props.
- The games and the template drop their redundant `name="…"`; the guide's examples do too.
- A component used twice still has two objects with one name, as today when it is written by hand; `key` and `tag` remain the way
  to tell them apart.

**Open questions.**

1. Whether to warn on a root `name` equal to the component's (redundant), or leave it. Suggested: leave it; it is harmless.
2. Whether `other.owner` should prefer the component's name over an entity's `name` at all. Not proposed; recorded in case
   collisions want it.

**Done when**

- [x] An unnamed root `<Entity>` or fragment gets the component's name, with a compiler test
- [x] A collision test reads `other.owner` from a component with no written name
- [x] The games, the template and the guide drop the redundant names

### B2. Lists laid out with `<Flex>`, and `x` / `y` as shorthand

**Today.** Two ways of placing things exist side by side, and the one that reads least like React is the easy one. Bramble's
`Menu.tsx` places its rows by hand:

```tsx
<Shape … transform={{ x: 10, y: top + cursor * 13 }} />
{rows.map((row, i) => (
  <Entity key={row.id} name={row.id} transform={{ x: 14, y: top + i * 13 }}>
```

`<Flex>` works outside a `<Hud>` (UI_PLAN.md: an `Entity` or component counts by its bounding box, and a `Flex` inside one is a
layout root of its own), so this could have been `<Flex direction="column" gap={1}>`. The guide's "Layout with `<Flex>`" sits under
"UI, screen and camera", so an author reads it as HUD-only. Hearth, whose UI is all `Flex`, never hand-places a row; Bramble, whose
menus are in the world space of a `<Screen>`, always does.

Separately, every placed element writes `transform={{ x, y }}`. It is precise, but it is the most frequent line in every game and
it reads like a style object, not like a prop.

**Proposal.**

1. **Guide.** Move "Layout with `<Flex>`" up to its own section, "Placing things", that starts: use `<Flex>` for anything laid out
   in rows or columns, anywhere; use `transform` for things placed in the world by the rules. Show Bramble's menu both ways.
2. **Bramble.** Rewrite `Menu.tsx` with `<Flex>`; the cursor bar becomes the row's `background` (or `focusBackground` with the
   cursor as focus). This is the test that `Flex` does what a menu in world space needs.
3. **Shorthand props.** `x`, `y`, `rotation`, `scaleX`, `scaleY` and `z` are accepted directly on any element that takes
   `transform` (the manifest's `transformIntrinsics`), and on components whose root takes one:

   ```tsx
   <Sprite image="coin.png" x={spot.x} y={spot.y} />
   ```

   The compiler lowers them into the same transform write as `transform={{ … }}`; nothing changes at run time. Writing both a
   shorthand and the same key in `transform` is a diagnostic. `transform={{ … }}` stays, and is what a computed transform object
   (`transform={placeOf(spot)}`) uses.

**Constraints.** The shorthand names become reserved members of every built-in that takes a transform (`reservedMembers`), so a
component rooted in one cannot have a prop or state named `x`. That is today's rule (B7) made wider; it should land after B7 or be
weighed against it. A component that already declares an `x` prop of its own (Hearth's `Enemy`) keeps its meaning: the shorthand applies only where the root's own props are written, never to a component's declared props.

**Open questions.**

1. Shorthand on components: only when the component does not declare a prop of that name? Suggested yes, so `<Enemy x={…}>` stays
   Hearth's own prop.
2. Whether `<Flex>` in world space needs anything new for a menu (a cursor highlight that is not mouse focus). Bramble's rewrite
   answers it.

**Done when**

- [x] The guide has "Placing things", with `<Flex>` first and no HUD-only framing
- [x] Bramble's `Menu` is a `<Flex>` column, and its replays still pass
- [x] `x`, `y`, `rotation`, `scaleX`, `scaleY`, `z` work as props where `transform` does, with compiler tests and a diagnostic for a
      duplicate key
- [x] The games use the shorthand where it reads better

**Done (2026-11-13).** Open question 1: the shorthand is on built-ins only, never on a component. The compiler compiles one file at
a time and cannot see whether an imported component declares an `x`, so `<Enemy x={…}>` always means the component's own prop and
a component is placed with `transform`. Nothing is reserved: the shorthand is lowered to the element's transform, never a field.
Open question 2: nothing new was needed. Bramble's menu is a `<Flex>` column whose rows take the cursor's bar as `background`, and
it draws the same pixels as the hand-placed one (its stories' stored screenshots match). 52 `transform={{…}}` on built-ins in the
games, the demo, the example and the template became `x={…} y={…}`.

### B3. Text wrappers that take their words as children

**Built 2026-11-13** (DESIGN.md, "Text", "Text wrappers"). Hearth's `Label` and `StatRow` take their words as children; Bramble sets
`<Game textSize={10} textColor="#e8d9a8">` and its texts dropped 15 repeated props.

**Today.** Every `<Text>` in Bramble writes its style: `size={10} color="#e8d9a8"` appears on nearly all of them. In React the
answer is a component: write the style once in a `<Label>` and use `<Label>Coins: {coins}</Label>` everywhere. Hearth tried
exactly that (`packages/hearth/src/Label.tsx`), but had to take the words as a `text` prop, which is what #81 took out of
`<Text>`. The React way does not compile. Checked 2026-11-13 with this component and a use of it:

```tsx
interface LabelProps {
  color?: string;
  children: TextChild | readonly TextChild[];
}
export function Label({ color = "#fff1d6", children }: LabelProps) {
  return <Text size={10} color={color}>{children}</Text>;
}
// used as: <Label>Coins: {coins}</Label>
```

It fails five ways:

- `RGE1004`: `TextChild` is not exported as a type.
- `RGE1208`: `children` must be typed `Child`, which means elements.
- `RGE1302`: `{children}` inside a `<Text>` is not understood.
- `RGE1202`, twice at the use: a component cannot take text, or `{expressions}` other than conditions and lists, as children.

**Decided 2026-11-13: no inherited text style.** A first draft proposed a `<TextStyle>` element whose style every `<Text>` below it
would inherit, as CSS does. It is dropped. `<Text>` already takes its style as props, and a wrapper component is how React shares
a style; a second, invisible way for a `<Text>` to get its colour would make a text's look depend on where it is in the tree. What
is missing is not a new styling mechanism but the wrapper working.

**Proposal.**

1. **Text children on components.** A component whose props declare `children: TextChild | readonly TextChild[]` (the type
   `<Text>` already uses, exported for use in props) accepts text and `{expressions}` of strings and numbers between its tags,
   exactly as `<Text>` does.
2. **Forwarding them into `<Text>`.** Inside such a component, `<Text>{children}</Text>` passes them on. The compiler lowers the
   use site's children to one string expression (`` `Coins: ${coins}` ``, as it does for `<Text>` today) and passes it as the
   component's `children` prop; the component's `<Text>` reads it like any other prop, so a change of `coins` re-renders only the
   text.
3. **Mixed children stay refused.** A component typed for text children takes only text; one typed `Child` takes only elements. The
   message for a mix names both types.
4. **Game-wide defaults.** `<Game>` already sets `font` for every `<Text>` that does not set its own. It gains `textSize` and
   `textColor` beside it, the same kind of default: written once at the root, not inherited from containers. A game with one text
   style then needs no wrapper at all.

With these, Hearth's `Label` takes children, and Bramble either writes a `Label` of its own or sets `<Game textSize={10}
textColor="#e8d9a8">` and drops the repeated props.

A **theme** for other colours (Hearth's `COLOR.panel`, `COLOR.button`) stays what it is today: a constant object in `theme.ts`. A
theme that changes at run time (a colour-blind setting, light and dark palettes) is an ordinary context once C3 exists.

**Open questions.**

1. Whether a text-children component may also forward to a component (a `<Label>` inside a `<Button>` that takes text). Suggested
   yes, by the same lowering; it is one more hop of a string prop.

**Done when**

- [x] The `Label` above compiles and works, with compiler tests for literal text, `{expressions}`, and forwarding through a second
      component
- [x] `TextChild` is exported for use in props, and the diagnostics for a mix of text and elements name both types
- [x] `<Game textSize textColor>` exist
- [x] Hearth's `Label` takes children; Bramble drops its repeated `size` and `color`
- [x] The guide's "Passing children" section shows a text wrapper

### B4. Actions without `useGame((s) => s)`

**Built 2026-11-13.** See DESIGN.md, "Actions: `useGame.actions()`".

**Today.** To get actions, a component writes `const { advance, togglePause } = useGame((s) => s)`: nine times across the games.
Selecting the whole state is otherwise refused ("Read a path of the game state, not the whole state"), so this is a special case
the author has to learn, and it looks like the Zustand anti-pattern it is an exception to. The alternative, one
`useGame((s) => s.advance)` per action, is long.

**Proposal.** A way to get actions that says what it means:

```tsx
const { advance, togglePause } = useGame.actions();
```

- `useGame.actions()` returns the store's functions, and the compiler knows it subscribes to nothing: actions never change, so no
  render ever depends on them.
- In generated code it is the same as today's destructure; only the source and the diagnostic change.
- `useGame((s) => s)` keeps compiling for a release, with a warning that names `useGame.actions()`, then becomes the same error as
  any whole-state read.
- Plain `.ts` code keeps `useGame.getState().advance(…)`.

**Open questions.**

1. `useGame.actions()` or a free hook `useActions(useGame)`? The first is closer to Zustand's own idioms (`useStore.getState()`)
   and keeps the store's type; suggested.

**Done when**

- [x] `useGame.actions()` compiles, subscribes to nothing, and is typed by the store
- [x] `useGame((s) => s)` warns with the new spelling; the games and the template use the new one
- [x] The guide's game state section shows it

### B5. `useStore` for stores outside the game state

**Built 2026-11-13.** See DESIGN.md, "`useStore`". As built, `read` takes no arguments and is required; the form with no `read`
(the store's whole value) waits for a store that wants it.

**Today.** Bramble's settings screen copies an outside store into local state by hand (`games/bramble/src/Settings.tsx`):

```tsx
const [values, setValues] = useState<SettingsView>(() => settingsView());
const [bindings, setBindings] = useState<Bindings>(() => bindingsView());
useMount(() =>
  settings.subscribe(() => {
    setValues(settingsView());
    setBindings(bindingsView());
  }),
);
```

That is React's `useSyncExternalStore`, written out. DESIGN.md defers it "until a game wants it"; Bramble is that game.

**Proposal.** One hook for any store with `subscribe` and a read:

```tsx
const values = useStore(settings, settingsView);
const bindings = useStore(settings, bindingsView);
```

- `useStore(store, read)` takes anything with `subscribe(listener): () => void` (`createSettings` stores, `controls`, a game's own
  stores) and a function of no arguments, or of the store's value, that returns what to show.
- It reads once at mount, subscribes in the mount, re-reads on each notification, and renders only when the result changed
  (`Object.is`, or leaf by leaf for objects, as `set` already compares). The subscription ends at unmount.
- It is a shipped hook in `hooks/library.ts` if the inliner can express it (a `useState` with a lazy initial value, a `useMount`
  with a cleanup); otherwise a compiler-known hook like `useGame`'s selector.
- `createSettings` stores and `controls` get a `get()`-compatible shape so `useStore(settings)` with no read function returns the
  whole value.

**Constraints.** A notification arriving mid-step renders next frame, as any setter does; settings change from a menu, so a frame
does not matter. The read function must be pure (it runs when the store notifies); it is an imported function, so the compiler
already treats it as opaque and pure.

**Done when**

- [x] `useStore` exists, with tests for render-on-change, no render on an equal value, and unsubscribe at unmount
- [x] Bramble's `Settings.tsx` uses it, and the mirror into `useGame` is gone wherever it was only for display
- [x] The guide's "Saved data and settings" section shows it

### B6. Custom hooks that behave like functions

**Built 2026-11-13** (DESIGN.md, "Hooks that behave like functions, and functions in the body"), with one addition the plan did
not list: functions declared in the component body, which callback arguments need and which are common React on their own.
Not done: point 5 (diagnostics inside a hook name the hook's line and the call).

**Today.** A custom hook is inlined text (`packages/compiler/src/hooks/inline.ts`): its statements are pasted into the component
with a per-call prefix (`_useName3_x`). PAIN_POINTS.md, section 1, lists what follows: a hook cannot return a ref, destructured
parameters do not work, nesting stops at six levels, and a literal argument is pasted into the body. The guide says it in passing.

This is ranked higher here than in PAIN_POINTS.md because it is the item most likely to feel *broken* rather than *restricted*.
The subset's other rules come with a message that says what to write instead; a hook that cannot take `({ speed, range })` looks
like a bug, since in React a hook is just a function.

**Proposal.** Keep inlining (it is what makes hooks free at run time and lets the compiler see every state they declare), but
close the gaps until the difference cannot be seen from the source:

1. **Destructured parameters.** `function useMover({ speed, range }: MoverOptions)` lowers to one local per field, bound to the
   argument's fields at the call site. A literal object argument binds each field directly; an identifier binds `arg.speed`.
2. **Returning refs.** A hook may return a ref (`return { position, ref }`, or `return ref`); the caller gets the prefixed ref.
   This needs refs to be addressable through the returned object, which the inliner already does for state setters.
3. **Arguments are evaluated once.** A non-literal argument is bound to a local at the call, so a call in the argument runs once,
   not wherever the parameter is read. Literals still fold.
4. **Nesting.** Raise the limit from six, and make the error name the chain of hooks when it is hit (`useA → useB → … → useA` for
   recursion, which is the real reason for a limit).
5. **Errors name the hook.** A diagnostic inside an inlined hook points at the line in the hook's own file, then "called from"
   the component's line, as a stack would.
6. **The guide** gets a short "How custom hooks work" box: inlined at compile time, which is why each call has its own state and
   why a hook cannot be called conditionally or in a loop (the same rule as React, for a different reason).

**Constraints.** Hooks still cannot be called conditionally or in loops; that rule is shared with React and the message can say
so. Hooks still cannot be recursive.

**Open questions.**

1. Whether a hook may return JSX (a "render hook"). Not proposed: components already do that.
2. Whether the inliner's output should be visible (`rge explain Player.tsx`, printing the component with its hooks inlined).
   Useful for debugging; small.

**Done when**

- [x] Destructured parameters, returned refs and evaluate-once arguments work, each with compiler tests
- [ ] Nesting errors name the chain (done); diagnostics inside a hook point at the hook's line and the call (not yet)
- [x] PAIN_POINTS.md section 1's hook bullet is closed or narrowed to what is left
- [x] The guide explains the model in a few lines

### B7. A component's names stop clashing with its root built-in

**Built 2026-11-13**, differently from the proposal below: only a name that clashes is renamed (`$name`), rather than every
state becoming a private field, so tests and tools that read a component's state keep working. See DESIGN.md, "Roots".

**Today.** The generated class extends its root built-in (DESIGN.md, "Roots and component forms"), so state, refs and props cannot
reuse the root's member names (`RGE1103`): no `width` prop on a component whose root is a `<Collider>`, no `image` on a `<Sprite>`
root, no state called `name` on an `<Entity>` root. There is no React equivalent, and the rule follows from code the author never
sees. B2's shorthand props would widen the list.

**Proposal.** Generate a component's own members so they cannot meet the root's:

- State, refs and props become JavaScript private fields (`#health`, `#healthNext`) or are kept under one object
  (`this.$state.health`, `this.$props.width`). Private fields cannot clash with a superclass's public members by construction, are
  as fast as plain fields in V8, and are supported by QuickJS-ng.
- Setters (`setHealth`) become private methods too, or are called directly where the compiler emits them.
- Handlers and render code change only in the member names they emit; the IR is unchanged.
- `RGE1103` goes, except for the names the runtime itself calls on every object (`render`, `commitState`, `markDirty`…), which
  stay reserved because a component must not override them by accident. Those names are not ones an author picks for state.

**Constraints.**

- **Hot reload** saves state by name (`"Player.health"` in `saveHotState`); the saved keys are strings and do not change.
- **Tests and the harness** sometimes read a component's state from outside (`player.find(...).health`). Those reads move to an
  explicit accessor (`debugState()`, which C4's inspector and A4's `@rge/testing` need anyway).
  A search of the games' tests sizes this before starting.
- **Benchmarks.** `npm run bench:check` guards against private fields costing anything under QuickJS.

**Open questions.**

1. Private fields or one state object? Private fields keep each value monomorphic and are what the generated code already does for
   `#healthNext`; suggested.

**Done when**

- [x] A component rooted in a `<Collider>` can take a `width` prop, and one rooted in an `<Entity>` can have state called `name`
- [x] `RGE1103` is gone for these names, the runtime's method names included (they are renamed too)
- [x] Hot reload, parity and the bench pass unchanged

---

## C. Missing functionality

### C1. Motion: springs and tweens

**Built 2026-11-13** (DESIGN.md, "Motion: springs, tweens and opacity"), the hooks layer. Two differences from the proposal: the hooks
take numbers only (a point is two springs; the math functions take points), and an initial value may now read state declared above
it, so a spring starts at a target that comes from state. Found: `<Game paused>` stops a pause menu's motion too, so Hearth animates
its side panel rather than its pause modal. Not built: the `transition` layer.

**Today.** What moves smoothly, the games write by hand from `dt`:

- `<Flex transition>` fades *colours* between states. `useSquash` and `useShake` spring one kind of value each. Nothing eases a
  position, scale, rotation or opacity.
- There is no opacity on a transform (`Transform` has `x`, `y`, `rotation`, `scaleX`, `scaleY`); fading an entity means changing
  every child's `tint` alpha.
- Kite's room slides, Hearth's panels and Bramble's notice card all either snap or are eased in rules code.

Motion is the most visible thing a React developer reaches for a library for (Framer Motion, react-spring), and for a game it is
most of what "juice" is.

**Proposal, in two layers.**

1. **Hooks, now.** Shipped hooks in `hooks/library.ts`, built from `useState` and `useUpdate` as `useSquash` is, so they cost
   nothing in the compiler:

   ```tsx
   const y = useSpring(open ? 0 : -40, { duration: 0.4, bounce: 0.2 });    // follows its target
   const a = useTween(visible ? 1 : 0, { duration: 0.25, ease: "outCubic" });
   <Flex y={y} opacity={a}>…</Flex>
   ```

   - The target is any number (or `{ x, y }` object); when it changes, the value moves to it. `useSpring` keeps velocity across
     target changes; `useTween` restarts from where it is.
   - **Decided 2026-11-13: a spring is set by `duration` and `bounce`**, as SwiftUI and Framer Motion's newer API do, not by
     `stiffness` and `damping` (react-spring). `duration` is roughly the seconds it takes to settle; `bounce` is 0 for no
     overshoot (critically damped) up to just under 1 for a lot of it. Both convert to stiffness and damping inside the hook
     (`springFrom(duration, bounce)` in `math.ts`), so the physics is one standard spring. Defaults: `duration: 0.5`,
     `bounce: 0`.
   - Easing functions are a fixed set by name (`linear`, `inQuad` … `outBack`, `outElastic`) in `math.ts`, plus a function from a
     `.ts` file.
   - They step in `useUpdate`, so they follow the fixed step, `freeze`, and replays, and they render each step while moving and not
     at all once settled.

2. **A `transition` on transforms, later, if renders cost too much.** As `<AnimatedSprite>` "costs no renders", a built-in could
   ease its own transform without the component rendering:

   ```tsx
   <Entity x={slot.x} y={slot.y} transition={{ x: 0.2, y: 0.2, ease: "outCubic" }}>
   ```

   The runtime keeps the from and to values and interpolates in the tick, marking the object changed. Built only if a game with
   many easing objects measures the hooks as too costly.

3. **Opacity.** `opacity` (0 to 1) on the transform, multiplied down the tree like position, and applied to each draw record's
   colour alpha. This needs the player's walk to carry it; whether it needs an ABI change depends on whether records already carry
   a colour for every kind (sprites have `tint`; text and shapes have `color`).

**Constraints.** Determinism: every easing is a function of fixed-step time, so parity between V8 and QuickJS holds; the parity
test covers a moving spring. Hot reload: a spring's value and velocity are state, so they survive a reload. Motion here is
presentation; a body that moves by gameplay uses `useBody` (A2).

**Open questions.**

1. Whether `opacity` should apply to the whole subtree as a group (one layer, as CSS does) or per draw record (overlaps show
   through). Per record is cheap and is what pixel-art games usually want; a group needs render targets.

**Done when**

- [x] `useSpring` and `useTween` ship, with easing by name, and tests for settle, retarget and freeze
- [x] `opacity` on transforms, inherited, drawn in both backends, with a parity test
- [x] One game uses each (Bramble's notice card, Hearth's panels)
- [x] The guide's effects page has a "Motion" section

### C2. Timers and sequences

**Built 2026-11-13**, the timers (DESIGN.md, "Timers"). One difference: hot reload drops pending timers with a note in the log rather
than keeping them by call site, since a timer's function belongs to the instance the reload replaces. Hearth's enemies flash with
`after`. Sequences wait, as planned.

**Today.** There is no "do this in 0.3 seconds". Each delay is a countdown kept as state and counted down by hand: Hearth's
`flash` and `slow`, Bramble's `invuln`, the dialogue's reveal. React code would write `setTimeout` in a handler: an enemy flashing
for 0.1 s after a hit, a few seconds of safety after the player is hurt, a title that appears a beat after the music, a short
cutscene.

**Proposal.**

1. **Timers in handlers.** Two built-ins callable as statements in a handler, like `freeze`:

   ```tsx
   onPress={() => {
     setFlash(true);
     after(0.15, () => setFlash(false));
   }}
   ```

   - `after(seconds, fn)` runs `fn` once; `every(seconds, fn)` runs it repeatedly. Both return nothing in the source (no handle to
     keep, as there are no element refs); `cancelTimers()` cancels this component's timers.
   - The compiler binds each timer to the component that calls it: it is cancelled when the component unmounts, so a timer can
     never set state on a component that is gone (the classic React `setTimeout` bug).
   - Timers count fixed-step time, in the update phase, and stop during `freeze`. They are deterministic and replay.
   - `fn` follows handler rules (it is a handler).

2. **Sequences, for cutscenes.** A sequence is data, written in a `.ts` file and run by the rules or by a component:

   ```ts
   export const intro = sequence([
     wait(0.5),
     call(() => useGame.getState().say("elder", "You're awake.")),
     waitFor(() => useGame.getState().run.talk === null),
     parallel([tweenTo(cameraY, 120, 1.0), fadeMusic(0.3, 1.0)]),
   ]);
   ```

   A sequence is a plain value with `step(dt)`, so the rules can own it and save it (it is serialisable), and tests can step it.
   This is a `.ts` library, not compiler work. It waits for a game with a cutscene; the adventure is the likeliest.

**Constraints.** Hot reload and rewind (D1) must capture pending timers. A timer's callback is code, which cannot be saved, so a
reload keeps a timer only if the callback still exists at the same place in the new code (by component path and call site, as
`captureHotState` keys state); otherwise the timer is dropped with a note in the log.

**Open questions.**

1. Whether `after` should also exist as a hook (`useTimeout(seconds, fn, [deps])`). Suggested no: it would be `useEffect` by
   another name, and the handler form covers presentation.
2. Saves: a pending timer is code and cannot be saved (A5). A game delay that must survive a save (invulnerability) is state, or a
   timer whose end time is state; the guide says which. Suggested: `after` returns nothing to keep, and the guide shows the
   end-time-in-state form for delays that are saved.

**Done when**

- [x] `after`, `every` and `cancelTimers` compile, are cancelled on unmount, follow the fixed step and `freeze`, and replay
- [x] Hot reload drops timers, with a note and a test (keeping them by call site is not possible: see above)
- [x] The guide says which delays are timers and which are state that is saved
- [x] Sequences: built when a game with a cutscene asks (recorded in NEXT_PRIORITIES.md's "Not now")

### C3. Context

**Built 2026-11-13** (DESIGN.md, "Context"). A consumer renders again when its provider's value changes, as a whole (not field by
field: the value is one state). Not done: Hearth and Bramble do not use it yet.

**Today.** There is none, on purpose (PAIN_POINTS.md section 2; NEXT_PRIORITIES.md "Not now": "a tree three or more levels deep
passing the same props through"). Once game code lives in components (section A), context is how a parent shares its state with a
deep subtree, as in React. What it is for:

- **State a parent owns that its descendants read**: a level's player position for every enemy (A6), a battle's gold for every
  tower's button.

- **A theme that changes at run time**: a colour-blind setting, or light and dark palettes. Today's constant `theme.ts` (Hearth)
  covers a fixed theme, so this waits for a game that switches.
- **A reusable component's configuration**: a `<Menu>` inside a `<Panel>` that should take the panel's
  accent colour, a `<Slot>` that should know its inventory's size.
- **The engine's own built-ins**, which already pass things down by hand: `<Game font>` reaches every `<Text>`, a `<Router>`'s
  route reaches its `<Route>`s.

**Proposal.** React's API, compiled:

```ts
// theme.ts
export const Theme = createContext({ accent: "#ffb15e", text: "#fff1d6" });
```

```tsx
<Theme.Provider value={palette}>…</Theme.Provider>
const { accent } = useContext(Theme);
```

- `createContext(default)` in a `.ts` file makes a context object. It is a module constant, so the compiler resolves which context
  a `useContext` reads by import, like `useGame`.
- `<X.Provider value>` is a container with no position. `useContext(X)` returns the nearest provider's value above the component,
  or the default.
- At mount, a consumer finds its provider by walking up the parent chain once and keeps it. When a provider's `value` changes
  (compared leaf by leaf, as game state is), it marks its consumers dirty; they render in the same flush.
- `useContext(X).field` and destructuring track the fields read, as game state selectors do, so a consumer renders only when a
  field it reads changed.
- Objects are never re-parented, so a consumer's provider cannot change under it; a provider that is removed takes its subtree
  with it.

**Constraints.**

- What the whole game shares stays in the game state (it is global already); context is for what one subtree shares. The guide
  says so; nothing enforces it.
- Values follow the same rules as game state values (no class instances that mutate in place; objects compared leaf by leaf).
- Hot reload and saves (A5): providers hold props, not state, so nothing new is saved; the state they pass down is saved where it
  is owned.

**Open questions.**

1. Whether to allow `useContext` in custom hooks (yes, by inlining, as any hook) and in plain `.ts` (no: there is no tree there).
2. Whether built-ins should migrate to context internally (`<Game font>` → a font context). Only where it makes code simpler;
   not required.

**Done when**

- [x] `createContext`, `Provider` and `useContext` compile and run, with tests for a nested reader, the default and re-render
      (not field-level re-render or a provider's removal)
- [x] The guide has a "Context" section that says what it is for and what it is not for
- [x] NEXT_PRIORITIES.md's "Not now" row for context is moved to done

### C4. A layout overlay and an inspector

**Built 2026-11-13** (DESIGN.md, "Seeing inside a running game"). The page talks to the game over server-sent events and POSTs
rather than a WebSocket (Node has no WebSocket server built in; it is the same exchange). Gaps are not outlined.

**Today.** There is no way to see the tree or its state while the game runs. `docs/CLAY_NOTES.md` notes Clay's debug overlay
("a good tool for this engine too… not planned"). Debugging a `<Flex>` today means reasoning about the layout code or reading
`rge screenshot` output; debugging state means `console.log`.

**Proposal.** A development overlay in `rge dev`, toggled by a key (F1 by default, configurable in `<Game>`), drawn by the player
over the game. It is never in a packaged build.

1. **Layout overlay.** Outline every `<Flex>` box, its padding and its gap; outline every `Collider` (by layer colour) and every
   `Pointer`. Hovering a box shows its component path, size and the props that sized it (`grow`, `fit`, `50%`).
2. **Tree inspector.** A panel listing the tree by component name (with `key`s), like React DevTools' component tab. Selecting a
   component shows its props, its `useState` values and refs (from `saveHotState`, which already enumerates them), the game state
   paths it subscribes to, and how many times it rendered in the last second.
3. **Game state inspector.** The store as a tree, with the last action's name and what it changed (a diff of leaves), as Redux
   DevTools shows.
4. **Editing.** Changing a state value in the inspector calls the setter; changing a game state leaf calls `setState`. Both are
   development-only and are recorded as such so a replay does not include them (or does, marked; see D1).

**Where it runs. Decided 2026-11-13: the overlay in the game window, the panels in a browser page.** The overlay (outlines and
hover labels) draws through the same backend as the game (records after the game's), so it works under Node and in the web backend
(D3). The tree and game state panels are a local web page that `rge dev` serves on a port and prints the address of, talking to the
running game over a WebSocket: a browser is far better than raylib at trees, scrolling and text fields, and it keeps the game
window free of debugging UI. The page does not need D3; it is ordinary HTML that shows what the game sends.

**Constraints.** The inspector reads; it does not change how the game runs. Reading `saveHotState` each frame for every object is
too slow for large trees, so the inspector reads only the selected component each frame and the tree's shape when it changes
(the world already stamps structural changes).

**Done when**

- [x] The layout overlay draws `Flex` boxes, colliders and pointers, toggled by a key, in `rge dev` only
- [x] The tree inspector shows components with props, state, refs, subscriptions and render counts
- [x] The game state inspector shows the store and each action's diff
- [x] Editing a value works and is marked as development-only
- [x] The guide's "When something goes wrong" table points to it

---

## D. Big wins the design makes cheap

### D1. Rewind in `rge dev`

**Built 2026-11-13** (DESIGN.md, "Rewind in `rge dev`"). Tried on Hearth (its winning game, to the end of wave 10, every frame
replays exactly) and on Kite (the first three rooms' jumps), by tests that play the games' replays through rewind and go back;
not yet tried by a person in a window. Effect stores are not snapshotted: particles in flight and a playing sound are not put back
(new bursts and sounds in the replayed frames come again, and sounds are muted while replaying).

**Today.** The engine already has every part of a time-travelling debugger, used for other things:

- A **fixed step** (`FixedDriver`, `packages/player/src/fixed.ts`), so a game is a function of its inputs, step by step.
- **Deterministic** runtime code: no `Math.random` in the runtime (the camera's shake is a fixed walk); the only clock read is the
  frame loop's own, outside the step.
- **Input recording and replay**: `InputFrame`, `RecordingBackend`, `parseInputScript`, `runScript` (`packages/player/src/`), used
  by every game's replays and the parity test, byte-identical under V8 and QuickJS.
- **One store** for game state, with `setState` and leaf-by-leaf comparison.
- **Hot reload that keeps component state** (`captureHotState` / `restoreHotState`, `packages/runtime/src/hot.ts`).

What it does not have is the loop that joins them: play, notice something wrong, go back a few seconds, change a rule, and watch the
same moment again with the fix. For a precision platformer, where the bug is a frame-perfect wall jump, this is worth more than any
other tool.

**Proposal.**

1. **Record while playing.** `rge dev` records every step's input (the `InputFrame`s it already builds) in a ring buffer, by
   default the last 5 minutes (at 60 steps a second and tens of bytes a step, a few megabytes).
2. **Snapshots.** Every N steps (one second by default), take a snapshot: the game state (`useGame.getState()`, structurally
   cloned), the component tree's hot state (`captureHotState`), and the effect stores' state (particles in flight, timers from C2,
   the music's position). Snapshots are what makes going back cheap: going to step S restores the nearest snapshot at or before S
   and re-runs the recorded input from there, with sound muted and nothing drawn until S.
3. **Scrub.** A key pauses the game and shows a timeline. **Decided 2026-11-13:** a minimal bar in the game window (where
   the paused moment is and how much is recorded), and the full timeline, with snapshots and actions marked, in C4's browser page. Left and right step one step;
   a drag scrubs. The screen shows the game at that step.
4. **Edit and replay.** While paused at step S, saving a file hot-reloads (as today), then re-runs from the snapshot before S with
   the new code to S. The author sees the same moment with the fix. "Resume" plays on from there with live input, dropping the
   recorded future.
5. **Save a moment.** A key writes the recording from the last snapshot to now as an input script plus the snapshot, which a test
   can load: the bug becomes a replay test in one keypress. This joins the tool to the existing test harness (`runScript`).

**Constraints.**

- **Determinism is the whole feature.** Anything a game does that is not a function of the step (reading `Date.now()`, using
  `Math.random` in rules, reading storage mid-play) breaks replay. Kite and Bramble's rules are already deterministic; the
  template's rules should be too. `rge dev` can detect a divergence (re-run a span twice and compare game state) and say which
  step diverged.
- **Effect stores** (`createParticles`, `createSounds`, `createShake`) hold state outside the game state. Each needs
  `snapshot()` / `restore()`; sounds are muted during re-runs and not restored (a sound that was playing at S is not resumed).
- **Hot reload across a code change** keeps state by path; a change that adds or removes components may not restore cleanly.
  Then the replay starts from the snapshot's game state only, and the tool says so.
- **Cost.** Snapshots of a large game state each second are small next to a frame; component hot state is larger. Measure on
  Hearth's wave 10.

**Open questions.**

1. Whether rewind is also for players (a game feature, as in some puzzle games). Not proposed; it would need all of the above in
   the packaged build.

**Done when**

- [x] `rge dev` records input and snapshots, and can pause, step back and scrub
- [x] Saving a file while paused re-runs to the same step with the new code
- [x] Sounds are muted while re-running; effect stores are not snapshotted (particles in flight are lost on a restore)
- [x] A divergence is detected and the step named
- [x] "Save a moment" writes a replay that a test runs
- [x] Tried on Kite (a wall-jump timing) and Hearth (a wave), with the cost measured

### D2. `RGE` diagnostics in the editor

**Today.** The subset is the biggest cost three games in a row (NEXT_PRIORITIES.md, "Findings from the third game", item 1). Each
`RGE` message is good, but the author sees it only when the compiler runs: on save in `rge dev`, or in `rge check`. In the editor,
TypeScript sees the `.tsx` against `@rge/runtime/jsx`'s declarations and is happy with `let`, loops and `.push` in a component
body. The author writes React, saves, and is told no.

**Why it matters.** Shown as you type, with a quick fix, a subset rule feels like a lint rule; shown after a save in a terminal, it
feels like the engine refusing your code. This is the cheapest way to make the subset feel smaller without changing it.

**Proposal.**

1. **A language server.** A small LSP server in a new package (`@rge/language-server`) that runs the compiler's front half (parse
   and analyse, `packages/compiler/src/analyzer` and `transform`) on each change of a `.tsx` under a game's source folder, and
   publishes `RGE` diagnostics at their source ranges. It runs beside TypeScript's own server, not inside it.
2. **Quick fixes.** Many messages already say what to write instead; the common ones become code actions:
   - `RGE1102` `useEffect` → the replacement the message names (`useMount` with a cleanup, a derived `const`).
   - A loop or `let` in a component body → "Move to a function in `rules/`", extracting the block into a plain function in a
     `.ts` file and calling it.
   - A `text=` on `<Text>` → move into children.
   - A whole-state selector → `useGame.actions()` (B4).
3. **A VS Code extension** that starts the server for folders whose `package.json` has an `"rge"` field or a `@rge/runtime` dependency. Other editors
   use the server directly through their LSP support.
4. **Hover help.** Hovering a built-in, hook or diagnostic code shows the guide's reference entry (the guide already has an index:
   `npm run docs:index`).

**Constraints.**

- **TypeScript 7 does not load JavaScript language-service plugins** the way TypeScript 5's tsserver did (the compiler is native),
  which is why this is a separate server rather than a tsserver plugin. Confirm against the 7.1 release before starting; if plugins
  are supported, a plugin is less to install.
- **Speed.** The compiler holds a TypeScript 7 API process (`typescript/sync`); the server keeps one alive and re-analyses only the
  changed file. Analysis without type checking should be well under 100 ms per file; type checking of generated code stays in
  `rge check` and `rge dev`.
- **Diagnostics that need other files** (a prop's type from another component) use the project's other sources as the compiler
  already does across files.

**Done when**

- [x] The language server publishes `RGE` diagnostics for a game's `.tsx` as it is edited, at the right ranges
- [x] Quick fixes for at least the four messages above
- [x] A VS Code extension, installable from a local `.vsix` (nothing published, as with the packages)
- [x] The guide's setup step mentions it
- [ ] Checked by writing a component from scratch in the editor and never running `rge check` to find a subset error

**Done (2026-11-13), but for the check in a real editor.** `@rge/language-server`, run as `rge lsp`; `editors/vscode` (`npm run
vscode:pack`). Since A1 a loop or `let` in a component body is allowed, so that fix is not needed; the fixes are a missing import, an
import from `"react"`, `useEffect(…, [])` to `useMount`, `useMemo` and `useCallback` to the value and the function, `<Text text>`
to children, a whole-state selector to `useGame.actions()`, and a name the authoring module does not export. Hover help is left
to TypeScript's own server, which already shows each built-in's and hook's documentation from `@rge/runtime/jsx`. The last box
needs a person in VS Code: a test takes a component written as for React to one that compiles with the quick fixes alone, and a
test drives the extension through a stand-in `vscode` module, but no editor was opened. TypeScript 7.1's beta was not checked
for plugin support: a separate server works whatever it supports. See DESIGN.md, "Diagnostics in the editor".

### D3. A web backend, and examples that run in the guide

**Today.** Listed in NEXT_PRIORITIES.md "Not now" as cheap to add later: "records map directly onto canvas calls". The `Backend`
interface (`packages/player/src/backend.ts`) is 16 members: open and close a window, load textures and sounds, play sounds, and
`frame(clearColor, records, …)` with the draw records, input and keys. The player above it is pure TypeScript.

**Why it matters, more than "a browser build".**

- **Sharing.** A link instead of a 125 MB executable or a folder for Linux only. Every playtest of a game so far has needed the
  author's own machine.
- **The guide.** PAIN_POINTS.md says "the guide is dense and terse". Examples that run in the page, beside the code, teach faster
  than rewriting the prose. With a web backend, each guide example is a small game shown in a `<canvas>`.
- **The inspector and rewind** (C4, D1) can use a browser page for their panels.

**Proposal.**

1. **`@rge/player-web`.** A `Backend` over `<canvas>` 2D (WebGL later only if measured): textures from `fetch`ed images, sounds
   through Web Audio (with an unlock on first input, as browsers require), keyboard, mouse and the Gamepad API mapped to the same
   input arrays, `localStorage` behind the `Storage` interface (NEXT_PRIORITIES.md already notes this).
2. **`rge build --web`.** Bundles the compiled game (the existing `bundle` step, aimed at the browser) and copies the assets into a
   folder that any static server can host.
3. **Parity.** The draw records are the same, so the recording backend's parity test can compare the web backend's canvas calls
   against the native one's, record for record. Pixel output will differ (fonts, filtering); records will not.
4. **The guide's examples.** Each example in `docs/*.html` gets a "Run" that plays a precompiled bundle of it in the page. The
   examples are compiled at `npm run docs:index` time, since the compiler needs the TypeScript 7 binary and cannot run in the
   browser. A live editor in the guide (edit and see) would need the compiler in the browser too; that waits.

**Constraints.**

- **The compiler is not in the browser.** TypeScript 7's API is a native process; examples are compiled ahead of time. A
  playground with editing would need a hosted compile step or a JavaScript build of the front half; not proposed now.
- **Fixed step and timing.** `requestAnimationFrame` drives the frame; the existing `FixedDriver` does the stepping, unchanged.
- **Bitmap fonts and `<Text>`** are drawn from the same glyph sheets; the built-in font needs an image version of raylib's default
  (or a canvas font, which would differ in metrics; the image is suggested so layout stays identical).
- **Local first** (NEXT_PRIORITIES.md, decided 2026-11-10) still holds: this builds a folder, it does not host anything.

**Done when**

- [ ] `@rge/player-web` implements `Backend`; Kite, Hearth and Bramble play in Chrome and Firefox from `rge build --web`
- [ ] Sound, gamepads, full screen and saves work in the browser
- [ ] Records match the native backend's for the parity replays
- [ ] At least the guide's start page and five reference entries have examples that run in the page
- [ ] NEXT_PRIORITIES.md's "Not now" row for the web backend is moved to done

### D4. Preview one component on its own

**Today.** `rge screenshot` renders a game after an input script. There is no way to render *one component* with given props, as
Storybook does for React. Building a `<HealthBar>`, a `<MenuButton>` or a dialogue box means playing the game to the point where it
shows.

**Proposal.**

1. **Stories.** A `*.stories.ts` file beside a component lists named cases:

   ```ts
   import { HealthBar } from "./HealthBar.tsx";
   export default { component: HealthBar, size: [64, 32] };
   export const Full = { hp: 10, maxHp: 10 };
   export const Hurt = { hp: 3, maxHp: 10 };
   export const Dead = { hp: 0, maxHp: 10 };
   ```

   A story may also set game state (`state: { run: … }`) for a component that reads `useGame`, and an input script to run first.
2. **`rge preview`.** Opens a window (or, with D3, a browser page) showing one story, with hot reload; arrow keys switch stories.
3. **`rge preview --screenshot`.** Writes one PNG per story; with a stored baseline, `rge check` fails on a changed image. That is
   visual regression testing, which the games' UI (Hearth's panels, Bramble's menus) has none of today.

**Constraints.** A story renders the component as a root under a minimal `<Game>` with the game's assets and fonts. Components that
need a provider (C3) get it from the story (`wrap`). The compiler compiles stories' components as it compiles any other.

**Done when**

- [x] `rge preview` shows a component's stories with hot reload
- [x] `--screenshot` writes PNGs, and `rge check` compares them with a baseline
- [x] Hearth and Bramble have stories for their UI components
- [x] The guide's testing section shows it

**Done (2026-11-13).** As built, stories live in a `stories/` folder beside `test/` and import the generated class, as tests do
(the compiler leaves `src/`'s plain `.ts` files in place, so an import of `./HealthBar.tsx` would not run). F5 and F6 switch stories,
since the arrow keys are the component's own. The window is a desktop window only; a browser page waits for D3. Hearth's stories
found the build menu wider than the side panel; its icons came out of the buttons. See DESIGN.md, "Previews".

### D5. Dependency-scoped `render()`

**Today.** The compiler knows exactly what every expression reads: a dynamic prop "depends on the state in its arguments"
(DESIGN.md, "Plain functions in components"), and game state selectors subscribe by path. But a generated `render()` re-evaluates
every dynamic prop when anything changed, then compares each result with the current value
(`packages/example/generated/Player.ts`: `const $1 = …; if (this.sprite.image !== $1) …`). NEXT_PRIORITIES.md priority 4 lists
"dependency-scoped `render()`" as its one remaining open item, deprioritised when V8 became the main engine.

**Why it matters.** It is the React-like ergonomics win that comes for free from compiling: no `useMemo`, no `React.memo`, no
dependency arrays, and still only the work that changed. A derived `const` that calls an expensive plain function (`spotsOf(run)`,
`settingsRows(…)`) is evaluated once per change of what it reads, not once per render. Today an author who cares has no tool for
that; with this, they never need one. It also lowers the cost of every motion hook in C1, which renders each step while moving.

**Proposal.**

1. Each piece of state, ref-free prop and game-state path a component reads gets a bit in a per-component dirty mask; setters and
   store notifications set the bit, not only the dirty flag.
2. The generated `render()` is split into blocks by dependency set. A block runs only when its mask overlaps the dirty mask.
   Derived `const`s become cached fields recomputed in their own block.
3. Conditions and lists keep their current structure code; only their inputs are guarded.
4. Imported functions stay assumed pure (they already are); a block that calls one runs when that call's arguments' dependencies
   change.

**Constraints.** More than 31 dependencies in one component needs a second mask word or a `Set`; rare, and the compiler can fall
back to today's full render. The parity test and `npm run bench:check` guard correctness and cost; the bench's "2,000 by state"
scene is the measure.

**Open questions.**

1. Whether to expose a way to mark an imported function impure ("call on every render"). Suggested no until a game needs it.

**Done when**

- [x] Generated `render()`s run only the blocks whose dependencies changed, and derived `const`s are cached
- [x] Parity passes byte for byte; ~~the bench's state-driven scenes are faster~~ Hearth's wave 10 is faster (see below)
- [x] The guide says that there is no `useMemo` because none is needed, and why

**Done (2026-11-13), differently from the proposal.** No setter or store notification sets bits: `render()` starts by comparing each
input its guarded parts read (state fields, props, game-state fields) with its value at the last render, kept in `$in`, which
builds the dirty mask; each element's values and each child's `updateProps` run only when their mask overlaps it. That needs
nothing outside the render, so hot reload, rewind, context and the game state work as they did. Derived `const`s were already cached
(`$memo`, A1); a memo the render always reads is now worked out once at its top instead of at each place it is read (Hearth's
enemy read one six times a render). Conditions, lists, a route's children and a part that reads something the compiler does not
follow (a component's own function, a callback prop, an action, an element's own field) always run, and a render whose parts all
read the same inputs is written as before, unguarded. The bench's state scenes are hand-written classes that mirror generated code
with one part each, so they do not change; Hearth's wave 10 is the measure: 1.40 → 1.18 ms a frame under Node, 13.5 → 12.2 ms under
the Rust host (QuickJS). Open question 1: no way to mark a function impure; none was needed.

---

## Order of work

Section A is the main track: it is the goal. The rest is grouped around it so each step is useful on its own.

1. **Cheap, visible wins** (about 1 week): B1 (root names), B4 (`useGame.actions()`), B5 (`useStore`). Each removes a line that
   confuses a newcomer, and none depends on another.
2. **The compiler's foundations for section A** (about 5–6 weeks): A1 (handlers as plain TypeScript, statements in the body), then
   B7 (no root name clashes, which gives `@rge/testing` its state accessor) and B6 (hooks that may return functions, which
   `useBody` needs unless it is a built-in hook). D5 (dependency-scoped render) fits here if A1's derived blocks are built with it.
3. **The runtime for section A** (about 5–6 weeks): A2 (`useBody`), A3 (contact data), A4 (`@rge/testing`), A5 (component state in
   saves), C3 (context) and A6 (sharing state, which leans on C3).
4. **The proof** (about 2.5 weeks): A7 (Hearth with its game in components), then A8 (the guide, the template and the README).
   What A7 finds may reorder what follows.
5. **Text, motion and timers** (about 3.5 weeks): B3, C1, C2. C2's timers are useful to A7 for flashes and safety windows, so they
   can move into step 3 if Hearth asks.
6. **Tools** (about 5 weeks): C4 (overlay and inspector), then D1 (rewind), which shares its panel and snapshots component state
   and timers. D4 (preview) can run alongside.
7. **The editor** (about 2.5 weeks): D2. Independent of the rest; worth moving earlier if the subset is still the main complaint
   after A1.
8. **After the editor** (decided 2026-11-13): B2 (lists laid out with `<Flex>`, `x` / `y` shorthand, Bramble's `Menu`), then D5
   (dependency-scoped `render()`), then A2's open item (Kite's movement written once with `useBody`, to compare).
9. **The web** (about 3–4 weeks): D3. On the back burner (2026-11-13): the largest item, and nothing else needs it; first if
   sharing a build becomes urgent.

## Not in this plan

| Item | Why | What would pull it in |
| --- | --- | --- |
| `useChange(value, (prev) => …)` | Held for a separate discussion (2026-11-13). Its design is in DESIGN.md, "Why there is no `useEffect`" | That discussion |
| `useEffect` | Stays out (DESIGN.md, 2026-11-12) | — |
| Recommending rules in `.ts` files as the shape of a game | Dropped 2026-11-13: the goal is game code in components (section A). Plain functions stay available for what React would extract too | — |
| Refs on elements (`ref={…}`) | Stays out; C4's inspector and B7's accessor cover the debugging uses | A built-in that needs an imperative handle no prop can express |
| A live editing playground in the guide | Needs the compiler in the browser (D3, constraints) | A JavaScript build of the compiler's front half, or a hosted compile step |
| Rewind for players | Needs snapshots in packaged builds | A game designed around it |
| Group opacity (render targets) | Per-record opacity covers pixel art (C1) | A game where overlapping translucent sprites look wrong |
