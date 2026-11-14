# After #121: what is left in the state model

As of 2026-11-14. A follow-up to [MUTABLE_STATE.md](MUTABLE_STATE.md), written after `useMutable` replaced `useState` (#121). It
records what that change left open and what building it turned up, and one decision taken since: **`useRef` is removed.**

Props read live across components, tree-order handlers and in-place list writes were built in #124 (a separate branch, still open when
this was written). What follows assumes #124's choices; where this note first leaned another way, it says so.

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

## Settled in #124, with what it leaves: changing a list or an object in place

This note first leaned to option 3 (versions on each state slot). #124 built **option 2 instead: the compiler lowers an in-place
write to the copy the author would write** (`s.list.push(x)` becomes `s.list = [...s.list, x]`, `s.list[i].hp -= 1` becomes
`with(i, { ...item, hp })`, copying only what the path passes through). The reason it gives is the right one: a version on the slot
cannot reach what the engine compares item by item (a keyed list hands each child its item, and a child's props guard is `===`), so
copying keeps `===` true everywhere, costs nothing at run time and keeps the committed value a snapshot. Gap 1 as first written is
closed, and the decision here is to keep the copy model and not add versions. What is left is the edges of it:

1. **A helper or alias changes a list in place and nothing warns.** The compiler refuses the forms it can see (an alias,
   `const e = s.list[0]; e.hp = 0`, a loop variable, the result of `push` used as a value) with what to write instead. It cannot see
   `damage(s.enemies, 3)` in a plain `.ts` file, which allows anything, and render compares by `===`, so the screen shows nothing
   and nothing says why. `readonly Foe[]` and `Readonly<Foe>` on the field catch it in the editor; they are not required. Two cheap
   fixes, in order: make `readonly` the inferred type of an array or record field of `useMutable`, so a helper taking `Foe[]` does
   not type-check; and a development warning when a slot's contents differ from the committed copy that rewind already takes while
   its reference is the same.
2. **A copy per write.** A loop writing every item of a list is quadratic in its length. #124 puts the limit at hundreds of items,
   not thousands, and says to build the list in a local and assign it once. Measure it on Hearth's wave 10 (about 1.2 ms a frame,
   held by CI bench budgets) before it is relied on for a bigger list, and have the diagnostic that refuses an unsupported form name
   the local-and-assign pattern.
3. **The refusals are a list to keep short.** `?.` in a write, an index that is not plain, an alias, a loop variable and a method's
   result used as a value are refused. Each should keep a test that shows its message. If authors hit one often (a loop over a list
   writing its items is the likeliest), lower it rather than refuse it.
4. **Live props still read the last render in three places** (below): the same "two rules depending on where an element sits" the
   design note warns of. In-place writes make this easier to hit, because a handler can now change an item a child reads by context.

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

## Open: props still read the last render in three places

#124 makes a child's props live in its handlers, found again by key for a list item. Not built there, and still reading what the
parent's last render copied (the old one-step lag):

- a value passed by context (`<Ctx.Provider value={s.x}>`);
- what is below a list item (an item's own children), and a list item that switches between two elements (`c ? <A key … /> : <B key … />`);
- a callback prop, which is never live (it is created once). This is by design: a callback is a function, not a value.

Doing it for some elements and not others leaves two rules depending on where an element sits, so either finish these or document
the three in the guide's frame-timing note, where an author looks. A list-item getter also does a `find` over the live list on each
read; a per-frame cache is the fix if a game needs it.

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
4. ~~**A hook's internal mutable has a call-specific name.**~~ *Fixed in #124:* named after the hook (`body.x`, `body2` on a clash).
   Hot-reload keys for a hook's own state changed with it.
5. **`s` read whole is a copy.** `total(s)` and `<Camera shake={shake}>` hand over a copy of the fields, not the live object, so a
   write inside the callee is lost. It is the opposite of `return s` from a hook, which hands the object back. Either make a copy an
   error where the callee could write it, or say it where `useMutable` is taught.
6. ~~**Dead code from `useState`.**~~ *Fixed in #124:* the updater paths, setter binding and `inUpdater` are removed.
7. **Stale text.** `packages/kite/DESIGN.md` (line 22) still says the character's state is `useState`. The doc comment on `useMutable`
   in `packages/runtime/src/jsx.ts` was updated in #124.
