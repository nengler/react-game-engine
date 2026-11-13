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
the components are thin views over one store, and the game is plain TypeScript in `rules/`. That is a good architecture; the guide
should say it is *the* architecture (A1), and the rest of this plan makes that view layer read like React and fills the gaps the
games worked around.

| # | Item | Kind | Size (estimate) | Depends on |
| --- | --- | --- | --- | --- |
| **A** | **Say what the model is** | | | |
| A1 | Rules are pure, components are views: the guide's first page says so | Guide | \~1–2 days | — |
| **B** | **Parts that do not read like React** | | | |
| B1 | A component's root `<Entity>` is named after the component by default | Compiler | \~1 day | — |
| B2 | Lay out lists with `<Flex>`, not arithmetic; `x` / `y` as shorthand props | Guide, compiler, runtime | \~3–4 days | — |
| B3 | Text style that children inherit, and a theme | Runtime, compiler | \~3–4 days | C3 |
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

## A. Say what the model is

### A1. Rules are pure, components are views

**Today.** Every game the engine has made is built the same way, and it is not the way a React developer would guess:

- Bramble's rules are about 1,080 lines of plain TypeScript (`games/bramble/src/rules/*.ts`); its components are about 380 lines
  of TSX, and `rules/view.ts` works out what each one draws (`heroOf`, `spotsOf`, `dialogueOf`).
- Hearth's `Enemy.tsx` takes eight props from a list in the game state (`kind`, `x`, `y`, `left`, `hp`, `maxHp`, `slow`,
  `flash`) and has no state or update of its own.
- Only Kite's `Player.tsx` and Bramble's `Menu.tsx` hold real local state with behaviour, and even `Player` hands its step to
  `rules/player.ts`.

A React developer arriving from the README expects "an enemy is a component with its own `useState` and `useUpdate`, and it
collides with things". The engine allows that, but frame timing (state set in a handler shows next render), collisions arriving
after `useUpdate`, and the subset all push against it, and the guide's "Three places code can go" says so only in passing. The
author finds out by hitting it.

**Why it matters.** The shape that works is what gives the engine its best properties: headless tests, the solver that proves Kite
and Bramble can be finished, whole-game replays, and byte-identical output under V8 and QuickJS. Said up front, the missing pieces
(no `useEffect`, no refs on elements, a store instead of context for game data) read as choices that serve it, rather than gaps.

**Proposal.** Name the model on the guide's first page (`docs/index.html`, "The mental model in five lines") and in the README:

> The game is plain TypeScript: rules that take the state and the input and return the next state and what happened. Components
> are the view of that state, written in TSX like React: they draw it, lay it out, play its music, and turn presses into actions.
> Local state is for the view (a menu's cursor, a squash), not for the game.

Then, in "Coming from React":

- A short "Redux / Elm, with React for the view" paragraph: `useGame` is the store, actions are reducers that may call effect
  stores, `rules/view.ts` is selectors, and components are connected views.
- One worked example of the same feature written both ways (an enemy with `useState` and `useUpdate` in the component, and the
  same enemy in rules with a view component), with what each costs: the first cannot be tested headless or replayed, and its
  collisions are a step late.
- When a component's own state *is* right: presentation that the rules do not care about (cursor, hover, squash, a dialogue's
  reveal if the rules do not need it), and prototypes.
- The template (`packages/cli/template`) already has `src/rules/move.ts`; its comments point to this section.

**Open questions.**

1. Whether the README example (`Player` with `useState(100)` health) should change to the rules shape, since it is the first thing
   anyone reads and it shows the shape the games moved away from.

**Done when**

- [ ] The guide's first page and the README say what the model is, in a few lines
- [ ] "Coming from React" has the Redux / Elm paragraph and the worked example both ways
- [ ] The template's comments point to it
- [ ] The README's first example is decided (kept with a note, or changed)

---

## B. Parts that do not read like React

### B1. A root `<Entity>` named after its component

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

- [ ] An unnamed root `<Entity>` or fragment gets the component's name, with a compiler test
- [ ] A collision test reads `other.owner` from a component with no written name
- [ ] The games, the template and the guide drop the redundant names

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

- [ ] The guide has "Placing things", with `<Flex>` first and no HUD-only framing
- [ ] Bramble's `Menu` is a `<Flex>` column, and its replays still pass
- [ ] `x`, `y`, `rotation`, `scaleX`, `scaleY`, `z` work as props where `transform` does, with compiler tests and a diagnostic for a
      duplicate key
- [ ] The games use the shorthand where it reads better

### B3. Text style that children inherit, and a theme

**Today.** Every `<Text>` in Bramble writes its style: `size={10} color="#e8d9a8"` appears on nearly all of them. Hearth worked
around the same thing by writing `Label.tsx` (a `<Text>` in the game's colour) and `theme.ts` (a `COLOR` object every component
imports). `Label` takes its words as a `text` prop, which is exactly what #81 took out of `<Text>`: the workaround reintroduced
the inconsistency the engine had just removed. `<Game font>` is already one inherited text setting, for the font only.

In React on the web this is CSS inheritance (`color` and `font-size` on a parent apply to text below) or a theme context.

**Proposal.** Text style inherits through the tree, as CSS does, by one built-in provider:

```tsx
<TextStyle size={10} color="#e8d9a8" font="pixel.png">
  <Menu … />          {/* every <Text> under it is 10 px, that colour, that font, unless it says otherwise */}
</TextStyle>
```

- `<TextStyle>` is a container with no position of its own. It takes `size`, `color`, `font`, `lineGap` and `align`.
- A `<Text>` takes each of those from its own prop if written, else from the nearest `<TextStyle>` above it, else from `<Game>`
  (`font` today), else the built-in default. Nested `<TextStyle>`s merge, nearest first.
- It is built on context (C3): `<TextStyle>` is a provider of a built-in context, and `<Text>` reads it. A change to a
  `<TextStyle>` prop re-renders only the texts that read that key.
- `<Game>` gains `textSize` and `textColor` beside `font`, for the whole game's default.

A **theme** for colours other than text (Hearth's `COLOR.panel`, `COLOR.button`) is an ordinary context once C3 exists:
`createContext(THEME)` in `theme.ts`, a provider in the root, `useContext(Theme)` where it is needed. Most games will keep a
constant object (as Hearth does), which is fine and needs nothing; the context is for themes that change at run time (a
colour-blind setting, a dark and a light palette).

**Open questions.**

1. A dedicated `<TextStyle>` element, or a `textStyle` prop on `<Entity>`, `<Flex>` and `<Hud>`? The element is easier to explain
   and to find; the prop avoids a level of nesting. Suggested: the element, plus the props on `<Game>`.
2. Whether `<Flex>` should also take `color` for the text inside it, as a button's colour on the web does. Suggested no: one way.

**Done when**

- [ ] `<TextStyle>` exists, with runtime and compiler tests for nesting and override order
- [ ] `<Game textSize textColor>` exist
- [ ] Bramble drops its repeated `size` and `color`; Hearth's `Label` takes children, or goes
- [ ] The reference has an entry with an example

### B4. Actions without `useGame((s) => s)`

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

- [ ] `useGame.actions()` compiles, subscribes to nothing, and is typed by the store
- [ ] `useGame((s) => s)` warns with the new spelling; the games and the template use the new one
- [ ] The guide's game state section shows it

### B5. `useStore` for stores outside the game state

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

- [ ] `useStore` exists, with tests for render-on-change, no render on an equal value, and unsubscribe at unmount
- [ ] Bramble's `Settings.tsx` uses it, and the mirror into `useGame` is gone wherever it was only for display
- [ ] The guide's "Saved data and settings" section shows it

### B6. Custom hooks that behave like functions

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

- [ ] Destructured parameters, returned refs and evaluate-once arguments work, each with compiler tests
- [ ] Nesting errors name the chain; diagnostics inside a hook point at the hook's line and the call
- [ ] PAIN_POINTS.md section 1's hook bullet is closed or narrowed to what is left
- [ ] The guide explains the model in a few lines

### B7. A component's names stop clashing with its root built-in

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
  explicit accessor (`debugState()`, which C4's inspector needs anyway) or to the game state, which is where game data belongs (A1).
  A search of the games' tests sizes this before starting.
- **Benchmarks.** `npm run bench:check` guards against private fields costing anything under QuickJS.

**Open questions.**

1. Private fields or one state object? Private fields keep each value monomorphic and are what the generated code already does for
   `#healthNext`; suggested.

**Done when**

- [ ] A component rooted in a `<Collider>` can take a `width` prop, and one rooted in an `<Entity>` can have state called `name`
- [ ] `RGE1103` is gone except for the runtime's own method names
- [ ] Hot reload, parity and the bench pass unchanged

---

## C. Missing functionality

### C1. Motion: springs and tweens

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
   const y = useSpring(open ? 0 : -40, { stiffness: 300, damping: 26 });   // follows its target
   const a = useTween(visible ? 1 : 0, { duration: 0.25, ease: "outCubic" });
   <Flex y={y} opacity={a}>…</Flex>
   ```

   - The target is any number (or `{ x, y }` object); when it changes, the value moves to it. `useSpring` keeps velocity across
     target changes; `useTween` restarts from where it is.
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
test covers a moving spring. Hot reload: a spring's value and velocity are state, so they survive a reload. Gameplay positions
still belong in rules (A1); motion here is presentation.

**Open questions.**

1. Spring parameters as `stiffness` / `damping` (react-spring) or as `duration` / `bounce` (SwiftUI, Framer Motion's newer API)?
   The second is easier to tune by feel; suggested, with the first available.
2. Whether `opacity` should apply to the whole subtree as a group (one layer, as CSS does) or per draw record (overlaps show
   through). Per record is cheap and is what pixel-art games usually want; a group needs render targets.

**Done when**

- [ ] `useSpring` and `useTween` ship, with easing by name, and tests for settle, retarget and freeze
- [ ] `opacity` on transforms, inherited, drawn in both backends, with a parity test
- [ ] One game uses each (Bramble's notice card, Hearth's panels)
- [ ] The guide's effects page has a "Motion" section

### C2. Timers and sequences

**Today.** There is no "do this in 0.3 seconds". Each delay is a countdown kept as state and counted down by hand: Hearth's
`flash` and `slow`, Bramble's `invuln`, the dialogue's reveal. That is the right shape for *game* time that must be saved and
replayed (it lives in the rules). It is clumsy for *presentation* time (a button flashing after a press, a title that appears a
beat after the music, a short cutscene), where React code would write `setTimeout` in a handler.

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
2. Whether timers belong in components at all, given A1. Suggested yes for presentation only; the guide says that game delays stay
   countdowns in the rules, and why (saves and replays).

**Done when**

- [ ] `after`, `every` and `cancelTimers` compile, are cancelled on unmount, follow the fixed step and `freeze`, and replay
- [ ] Hot reload keeps or drops timers as described, with a test
- [ ] The guide says which delays are timers and which are countdowns in rules
- [ ] Sequences: built when a game with a cutscene asks (recorded in NEXT_PRIORITIES.md's "Not now")

### C3. Context

**Today.** There is none, on purpose (PAIN_POINTS.md section 2; NEXT_PRIORITIES.md "Not now": "a tree three or more levels deep
passing the same props through"). Game data goes in the game state, which covers most of what context is used for in React apps.
What it does not cover:

- **Style and theme** (B3): Bramble's repeated text style and Hearth's `Label` and `theme.ts` are the trigger, in two games.
- **A reusable component's configuration** that is not game data: a `<Menu>` inside a `<Panel>` that should take the panel's
  accent colour, a `<Slot>` that should know its inventory's size.
- **The engine's own built-ins**, which already pass things down by hand: `<Game font>` reaches every `<Text>`, a `<Router>`'s
  route reaches its `<Route>`s. A general mechanism is what B3 builds on.

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

- Context is not for game data. The guide says so, and a diagnostic could warn when a provider's `value` reads `useGame`
  (the data is already global; pass the selector instead). Suggested as a warning, not an error.
- Values follow the same rules as game state values (no class instances that mutate in place; objects compared leaf by leaf).
- Hot reload: providers hold props, not state, so nothing new is saved.

**Open questions.**

1. Whether to allow `useContext` in custom hooks (yes, by inlining, as any hook) and in plain `.ts` (no: there is no tree there).
2. Whether built-ins should migrate to context internally (`<Game font>` → a font context). Only where it makes code simpler;
   not required.

**Done when**

- [ ] `createContext`, `Provider` and `useContext` compile and run, with tests for nesting, default, field-level re-render and
      removal
- [ ] B3's `<TextStyle>` is built on it
- [ ] The guide has a "Context" section that says what it is for and what it is not for
- [ ] NEXT_PRIORITIES.md's "Not now" row for context is moved to done

### C4. A layout overlay and an inspector

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

**Where it runs.** The overlay draws through the same backend as the game (records after the game's), so it works under Node and
in the web backend (D3). The panels can be either in the window (simple, always available) or in a browser page served by `rge dev`
on a local port (more room, real text input; it reuses D3's canvas work for nothing but still needs a UI). Suggested: overlay in the
window first; panels in a local web page, since a browser is better at trees and text fields than raylib.

**Constraints.** The inspector reads; it does not change how the game runs. Reading `saveHotState` each frame for every object is
too slow for large trees, so the inspector reads only the selected component each frame and the tree's shape when it changes
(the world already stamps structural changes).

**Done when**

- [ ] The layout overlay draws `Flex` boxes, colliders and pointers, toggled by a key, in `rge dev` only
- [ ] The tree inspector shows components with props, state, refs, subscriptions and render counts
- [ ] The game state inspector shows the store and each action's diff
- [ ] Editing a value works and is marked as development-only
- [ ] The guide's "When something goes wrong" table points to it

---

## D. Big wins the design makes cheap

### D1. Rewind in `rge dev`

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
3. **Scrub.** A key pauses the game and shows a timeline (in the window's overlay, or in C4's panel). Left and right step one step;
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

1. Where the timeline lives: in the window (always there) or in C4's browser panel (more room). Suggested: a minimal bar in the
   window, the full timeline in the panel.
2. Whether rewind is also for players (a game feature, as in some puzzle games). Not proposed; it would need all of the above in
   the packaged build.

**Done when**

- [ ] `rge dev` records input and snapshots, and can pause, step back and scrub
- [ ] Saving a file while paused re-runs to the same step with the new code
- [ ] Effect stores snapshot and restore; sounds are muted while re-running
- [ ] A divergence is detected and the step named
- [ ] "Save a moment" writes a replay that a test runs
- [ ] Tried on Kite (a wall-jump timing) and Hearth (a wave), with the cost measured

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

- [ ] The language server publishes `RGE` diagnostics for a game's `.tsx` as it is edited, at the right ranges
- [ ] Quick fixes for at least the four messages above
- [ ] A VS Code extension, installable from a local `.vsix` (nothing published, as with the packages)
- [ ] The guide's setup step mentions it
- [ ] Checked by writing a component from scratch in the editor and never running `rge check` to find a subset error

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

- [ ] `rge preview` shows a component's stories with hot reload
- [ ] `--screenshot` writes PNGs, and `rge check` compares them with a baseline
- [ ] Hearth and Bramble have stories for their UI components
- [ ] The guide's testing section shows it

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

- [ ] Generated `render()`s run only the blocks whose dependencies changed, and derived `const`s are cached
- [ ] Parity passes byte for byte; the bench's state-driven scenes are faster
- [ ] The guide says that there is no `useMemo` because none is needed, and why

---

## Order of work

Grouped so that each step is useful on its own and later steps build on earlier ones.

1. **The cheap, visible wins first** (about 1.5 weeks): A1 (say what the model is), B1 (root names), B4 (`useGame.actions()`),
   B5 (`useStore`). Each removes a line that confuses a newcomer, and none depends on another.
2. **Context and style** (about 2.5 weeks): C3 (context), then B3 (`<TextStyle>` on it). Bramble and Hearth are rewritten to use
   them, which tests both.
3. **Motion and timers** (about 2.5 weeks): C1's hooks and `opacity`, then C2's `after` / `every`. These are the most visible
   things a player sees.
4. **Tools** (about 5 weeks): C4 (overlay and inspector), then D1 (rewind), which shares its panel and needs C2's timers to be
   snapshot. D4 (preview) can run alongside.
5. **The editor** (about 2.5 weeks): D2. Independent of the rest; can move earlier if the subset is the next complaint.
6. **The compiler's deeper work** (about 3–4 weeks): B6 (hooks like functions), B7 (no root name clashes), B2's shorthand (after B7),
   D5 (dependency-scoped render).
7. **The web** (about 3–4 weeks): D3. Last because it is the largest and because the inspector and rewind benefit from it but do
   not need it; first if sharing a build becomes urgent.

B2's guide and Bramble's `Menu` rewrite can be done at any point; they need no engine change.

## Not in this plan

| Item | Why | What would pull it in |
| --- | --- | --- |
| `useChange(value, (prev) => …)` | Held for a separate discussion (2026-11-13). Its design is in DESIGN.md, "Why there is no `useEffect`" | That discussion |
| `useEffect` | Stays out (DESIGN.md, 2026-11-12) | — |
| Refs on elements (`ref={…}`) | Stays out; C4's inspector and B7's accessor cover the debugging uses | A built-in that needs an imperative handle no prop can express |
| A live editing playground in the guide | Needs the compiler in the browser (D3, constraints) | A JavaScript build of the compiler's front half, or a hosted compile step |
| Rewind for players | Needs snapshots in packaged builds | A game designed around it |
| Group opacity (render targets) | Per-record opacity covers pixel art (C1) | A game where overlapping translucent sprites look wrong |
