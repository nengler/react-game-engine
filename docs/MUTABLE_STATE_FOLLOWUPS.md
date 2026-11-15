# After #121: what is left in the state model

As of 2026-11-14. A follow-up to [MUTABLE_STATE.md](MUTABLE_STATE.md), written after `useMutable` replaced `useState` (#121). It
records what that change left open and what building it turned up, and one decision taken since: **`useRef` is removed.**

Props read live across components, tree-order handlers and in-place list writes were built in #124 (a separate branch, still open when
this was written). What follows assumes #124's choices; where this note first leaned another way, it says so.

## Decided and done: remove `useRef`

`useRef` holds a value that persists across frames and never renders. Before #121 that was a real difference from `useState`, a
snapshot that renders. Now `useMutable` fields are also written directly and read at once in a handler, so a ref is a mutable field
that happens not to render, spelt differently (`r.current` against `s.r`) and readable in handlers only. Two hooks for one kind of
value, differing only in whether a write redraws, is the choice [MUTABLE_STATE.md](MUTABLE_STATE.md) removed `useState` to avoid.

What a ref gave that a field does not is "never renders". That is already free: a render only redoes the parts that read a changed
field (`$in` guards, REACT_FEEL_PLAN.md D5), so a field nothing in render reads costs one comparison, not a redraw. Kite's `Runner`
holds eight fields none of which render, and that is the shape to teach.

**Done 2026-11-14.** `useRef` is `RGE1102`, whose message writes out the conversion in the author's names; `tools/codemod-mutable.ts`, the
`Compiler.convertToMutable` and the editor's quick fix move a file's refs (`const timer = useRef(0)` becomes a field of the function's
own `useMutable`, or of a new one, and `timer.current` becomes `s.timer`; a ref used as a value, such as returned from a hook, is left
for a person). Kite's `DashTrail`, the example's `Enemy`, Hearth's `Play` and the compiler's tests moved. The compiler lost `RefIR`,
`RefRead`, the `RefCurrent` assignment target, `lowerUseRef`, `RGE1304` (retired) and the runtime's `useRef`; `RGE1106` is now only
`ref={…}` on an element.

What settling it showed:

- **A field written in `useUnmount` is still refused** (`RGE1402`), which a ref could do. The message no longer says "or write a ref".
  `m9`'s badge counted mounts and unmounts in a ref; it now counts mounts only and tells its parent with `onGone`. Allowing a field
  write there (it would render nowhere, harmlessly) is open, if a component needs to leave a note on its way out.
- **A ref used to cost nothing when written; a field marks the component**, which re-runs `render()` (`world.tick` returns 1 where it
  returned 0). Each part of `render()` is guarded by what it reads, so nothing drawn changes. If a hot component writes a field per
  frame that nothing reads, it is one `render()` call a frame; measure before worrying (Kite's `Runner` is the shape).
- **A ref could not be read in render; a field can**, and a field read in render makes that part render. That is what the author asked
  for, and nothing needed settling.

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
   and nothing says why. `readonly Foe[]` and `Readonly<Foe>` on the field catch it in the editor; they are not required. **First fix done 2026-11-15:** `useMutable` gives each array field the type `MutableList<T>`
   (`packages/runtime/src/jsx.ts`): the in-place forms the compiler lowers (`push`, `splice`, `sort`, an index write) type-check, but it is not
   assignable to `T[]`, so a helper that takes `Foe[]` is an error in the editor. It takes `readonly Foe[]` to read, or returns the new
   list; the games needed no change. Items of a list are still plain `T`, so a helper may change an item in place (use `Readonly<Foe>`).
   Still open: the development warning. Two cheap
   fixes, in order: make `readonly` the inferred type of an array or record field of `useMutable`, so a helper taking `Foe[]` does
   not type-check; and a development warning when a slot's contents differ from the committed copy that rewind already takes while
   its reference is the same.
2. **A copy per write.** A loop writing every item of a list is quadratic in its length. #124 puts the limit at hundreds of items,
   not thousands, and says to build the list in a local and assign it once. Measure it on Hearth's wave 10 (about 1.2 ms a frame,
   held by CI bench budgets) before it is relied on for a bigger list, and have the diagnostic that refuses an unsupported form name
   the local-and-assign pattern.
3. **The refusals are a list to keep short.** `?.` in a write, an index that is not plain, an alias, a loop variable and a method's
   result used as a value are refused. Each should keep a test that shows its message. If authors hit one often (a loop over a list
   writing its items is the likeliest), lower it rather than refuse it. *Done 2026-11-15:* a loop over a field that writes through its item
   (`for (const foe of s.foes) { foe.hp -= 1; }`) is lowered to a loop over the index, the item an alias of `s.foes[i]`
   (`lowerItemLoop` in `transform/statements.ts`). A loop over a copy (`s.foes.filter(…)`) is still refused, as is a body that also
   changes the list itself. Each write is still a copy (item 2).
4. **Live props still read the last render in three places** (below): the same "two rules depending on where an element sits" the
   design note warns of. In-place writes make this easier to hit, because a handler can now change an item a child reads by context.

## Open: the game state is not migrated

**Started 2026-11-15.** `createGameState(data, actions)` is built beside the creator form (runtime `GameStore.fromActions`, the
compiler's schema reader, DESIGN.md "Global state"), with a draft per action and a commit that keeps unchanged objects' identity. The
demo and the template use it. Left: Kite, Hearth and Bramble; a handler reading the live store; a component write to the store as a
compile error; read-only selected values; then removing the creator form. The text below is the plan as written.

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
5. ~~**`s` read whole is a copy.**~~ *Fixed 2026-11-14:* in a handler, `s` passed whole is the component's own object for that
   `useMutable`, made the first time a handler passes it and kept (`#sObject` in the generated class), with a getter and a setter per field. A getter reads the
   field as the handler sees it (this step's writes included); a setter goes through the field's setter, so it marks the component dirty
   and renders as `s.hp -= 3` would. So `takeHit(s)` changes the component, as `return s` from a hook already did. In render (props,
   `<Camera shake={shake}>`, `{label(s)}`) it is still a copy of the committed fields, now typed `Readonly<…>`: render writes nothing.
   List fields keep #128's rule: the object's list field is a `MutableList<T>`, so a helper that takes `T[]` to change it in place is
   an error; a helper assigns a new list, which the setter takes. A write through the object after the component is unmounted (a helper
   or a closure kept it) does nothing and warns once per component and field in development (`setDevelopmentWarnings` in the runtime;
   on by default, `null` turns it off). The `component.s` view tests and tools use is unchanged: it reads the committed value.
   Still open: a helper in a plain `.ts` file can still change an *item* of a list field in place (items are plain `T`, as item 1 says).
6. ~~**Dead code from `useState`.**~~ *Fixed in #124:* the updater paths, setter binding and `inUpdater` are removed.
7. **Stale text.** `packages/kite/DESIGN.md` (line 22) still says the character's state is `useState`. The doc comment on `useMutable`
   in `packages/runtime/src/jsx.ts` was updated in #124.
