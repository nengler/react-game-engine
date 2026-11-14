# After #121: what is left in the state model

As of 2026-11-14. A follow-up to [MUTABLE_STATE.md](MUTABLE_STATE.md), written after `useMutable` replaced `useState` (#121). It
records what that change left open and what building it turned up, and one decision taken since: **`useRef` is removed.**

Props read live across components ("Shared lists: live everywhere", option A) is being built on its own branch and is not covered
here. Gap 1 below interacts with it: a list item is found again by key in the parent's live list, so how a list is changed in place
has to agree with that lookup.

## Decided: remove `useRef`

`useRef` holds a value that persists across frames and never renders. Before #121 that was a real difference from `useState`, a
snapshot that renders. Now `useMutable` fields are also written directly and read at once in a handler, so a ref is a mutable field
that happens not to render, spelt differently (`r.current` against `s.r`) and readable in handlers only. Two hooks for one kind of
value, differing only in whether a write redraws, is the choice [MUTABLE_STATE.md](MUTABLE_STATE.md) removed `useState` to avoid.

What a ref gave that a field does not is "never renders". That is already free: a render only redoes the parts that read a changed
field (`$in` guards, REACT_FEEL_PLAN.md D5), so a field nothing in render reads costs one comparison, not a redraw. Kite's `Runner`
holds eight fields none of which render, and that is the shape to teach.

To do:

- `useRef` becomes a diagnostic, as `useState` is (`RGE1102`): the message names the replacement and writes the conversion in the
  author's names (`const timer = useRef(0)` becomes a field of `useMutable({ timer: 0 })`, and `timer.current` becomes `s.timer`).
  The editor's quick fix and `tools/codemod-mutable.ts` convert it, extending `convertToMutable`
  (`packages/compiler/src/codemod/mutable.ts`).
- Move the users: `packages/example/src/Level.tsx` (`reported`), `packages/hearth/src/Play.tsx` (`nextId`),
  `packages/kite/src/DashTrail.tsx` (`wait`, `made`), and the compiler tests that declare a ref (`m3`, `m5`, `m6`, `m7`, `m13`,
  `customhooks`, `cleanup-keys`, `hooks-as-functions`, `root-name`, `render-blocks`). Check the shipped hooks too, and what saves and
  hot reload do with a ref, which a field already does.
- Remove the compiler's ref paths (`transform/hooks.ts`, `hooks/inline.ts`, `ir/ids.ts`, `ir/statements.ts`, `ir/declarations.ts`,
  `analyzer/*`, `RGE1106`, the `useRef` export in `runtime/src/jsx.ts`) and the docs that teach it (`DESIGN.md` "Refs",
  `language.html` `#hook-useref`, `index.html`'s "Keep a value that must not re-render" row, which then points at `useMutable`).
- One thing to settle first: a ref was handler-only, so it never showed in render. A field can be read in render. A field written in
  a handler and read in render makes the part that reads it render, which is correct and what the author asked for.

## Open: changing a list or an object in place

The largest gap, and the one to settle first. A list is replaced whole (`s.enemies = [...s.enemies, e]`) and `s.enemies.push(e)` is
refused (`RGE1301`). Once fields are written directly, authors reach for `push` and `enemy.hp -= 1` at once, so the model reads as
"mutable, except lists". The analysis (what breaks if it is allowed, how Svelte 4 and 5 went through it, the four options) is in
[MUTABLE_STATE.md](MUTABLE_STATE.md), "Open: changing a list or an object in place". The short version:

- The engine finds changes by reference. A pushed list is the same array, so the setter's `next === pending` early return, render's
  `$in` guards and the `$memo` memos all skip it, and the screen does not update.
- The compiler cannot see every write (`const e = s.enemies[i]; e.hp -= 1`, or `damage(s.enemies, 3)` in a `rules/*.ts` helper).
- The lean is option 3: each state slot gets a version, render's guards compare reference and version, writes the compiler sees bump
  it, and a call it cannot see into that takes state bumps it afterwards. No proxies, nothing on the read path.

**A silent failure that already exists.** Render compares what it reads by `===`, so a list or object changed in place by code the
compiler does not check (plain `.ts` files allow anything) shows nothing on screen, and nothing warns. This is the same failure as
the one above, reachable today. Until versions exist, a development warning is worth having: a slot whose contents changed while its
reference did not, found by comparing against the committed copy that rewind already takes.

**Open before building it:**

1. Measure the cost on Hearth's wave 10 (about 1.2 ms a frame, held by CI bench budgets). A version bump per write is the cost to
   count.
2. How it meets live props: a child finds its list item by key in the parent's live list, so a change in place to that item must be
   visible there at once, and a re-keyed item must still read its own last props.
3. The gap it leaves: a helper that keeps a reference and changes it in a later frame. Rare; a documented rule, mostly caught by
   `readonly` types (`readonly Foe[]`, `Readonly<Foe>`).

## Open: the game state is not migrated

`createGameState` still takes `set` and `get`, and the state holds its actions. Components write nothing to it directly. The design
in [MUTABLE_STATE.md](MUTABLE_STATE.md), "The game state: actions write, readers read", is proposed and not built:
`createGameState(data, actions)`, the data a plain object, each action taking the live state as its first argument and writing it
directly, components never writing.

The cost today is two models in one game: a component writes its own state directly and reads its own writes, while the store is
changed through `set` and a handler reads the old value after an action. Items to settle when it is built:

- Calling an action marks the store dirty, and at the frame's flush the store compares its live state with the last committed state
  leaf by leaf and tells only the readers whose leaves changed. This depends on the list decision above, since an action's body is
  plain TypeScript the compiler does not lower.
- A write to the store from a component (`game.cursor = 3`) becomes a compile error pointing at the action form.
- Selected values become read-only (`Readonly<…>` types and an error on a write), as props are.
- Boilerplate: a one-line action per `cursor` or `open`. Hearth and Kite have 8 to 11 actions each. If it hurts, try an opt-in
  `free: [...]` list of fields components may write, not a setter per field.
- `GameState.ts` must still return an object literal (`RGE1109`): decide whether the new shape keeps that.

## Rough edges found while building #121

Each is real today. The first two cause wrong behavior; the rest cost time.

1. **TypeScript does not narrow a field inside a closure.** `{s.waiting !== null && <Prompt onKey={() => bind(s.waiting)} />}` is a
   type error in the editor, where `const waiting = s.waiting` above it is not. It is also a real hazard: the callback runs later,
   as a handler, and the field may have changed. The guide teaches the `const`, and Bramble's settings needed it. A better answer
   is a compiler check: a field read in a callback after a narrowing test on it, with no `const`, gets an error that says to copy
   it first.
2. **The codemod is mechanical, and `setX(x + 1); use(x + 1)` is the pattern to check after it.** With a snapshot, `use(x + 1)` read
   the old `x`; converted to `s.x += 1; use(s.x + 1)` it adds one twice. One test hit exactly this (`sharing.test.ts`). The codemod
   should flag a setter call followed, in the same handler, by a read of the same state, rather than leave it to review.
3. **Timing moved by a step in a few places**, as rule 2 says it should: an enemy is defeated in the step its hp reaches 0, and a
   tween starts in the step its target changes, not the next. The tests that pinned the old timing were updated with the reason
   beside each. Anything outside the repo that pins a replay or tuned feel to the old timing will differ, and the guide's frame-timing
   note should say so once.
4. **A hook's internal mutable has a call-specific name.** Where a hook returns fields rather than the object (`useBody` returns
   `{ x, y, move, … }` from `b`), its state is saved as `_useBody1_b.x`, so tests read where the component draws instead. Naming it
   after the hook (`body.x`) would make it readable; not done. It also shows in the inspector and in saves.
5. **`s` read whole is a copy.** `total(s)` and `<Camera shake={shake}>` hand over a copy of the fields, not the live object, so a
   write inside the callee is lost. It is the opposite of `return s` from a hook, which hands the object back. Either make a copy an
   error where the callee could write it, or say it where `useMutable` is taught.
6. **Dead code from `useState`.** The updater paths are unreachable now (`SetState` with an `updater`, `lowerSetState` in
   `transform/statements.ts`, `updaterInPlace` in `generator/handlers.ts`), as nothing declares a setter binding. Remove them in a
   change of their own.
7. **Stale text.** `packages/kite/DESIGN.md` (line 22) still says the character's state is `useState`, and the doc comment on
   `useMutable` in `packages/runtime/src/jsx.ts` (near line 204) still says a list or record "is replaced, not changed in place" and
   that it "replaces React's `useState`" in the old terms; both change with gap 1.
