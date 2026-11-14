# State you write directly: a design note

As of 2026-11-14. **Status: decided and built in #121 for a component's own state** (the hook is `useMutable`, and `useState` is
removed); changing lists in place, and props read live, are still open. "What #121 built" at the end says what was settled and
what building it found. Written while reviewing #121 (`useSim`), which adds a second state hook whose fields are
written directly (`s.vx += 1`) and read back at once in handlers. This note asks the larger question that PR raises: should that be
the engine's state model, not an extra hook beside `useState`? It changes two settled decisions in [DESIGN.md](DESIGN.md) ("State
reads in handlers" and "Mutating state in place"), which is why it is a note first.

## The problem

React's state is a snapshot: a handler sees the value from the last render, and a setter's value shows only after the next one.
That suits UI, where a handler does one thing. It does not suit a step function, which reads, changes and re-reads the same values
many times in one frame. Kite's `Runner` before #121 shows the cost: eight `let nvx = vx` copies at the top of `useUpdate`, the
whole step written against the copies, and eight setters at the end. It is the shape that pushed the games' logic out of components
and into `rules/`, the thing [REACT_FEEL_PLAN.md](REACT_FEEL_PLAN.md) section A sets out to undo.

#121 fixes it for one hook. But two hooks that hold the same kind of value and differ only in when a read sees a write are a
choice every author has to make, and an author who knows the engine will pick the direct one every time, since it is the one that
never needs a local copy. If that is where everyone ends up, it should be the model on purpose.

## Why this is still React

React's state is immutable because React finds changes at run time, by comparing a new value with the old one. This engine does not
need that: the compiler sees every write, and there is no virtual DOM. Compiled frameworks that know their writes already make state
mutable and are seen as React's peers: Svelte 5 (`let count = $state(0); count++`), Vue and Solid.

What makes code read like React is kept:

- components and JSX;
- props flow down and are read-only;
- render is a function of state and props, with no writes in it;
- hooks for lifecycle and per-frame work.

What changes is the syntax for state, and when a handler sees its own write. DESIGN.md's first rule, "feel like ideal React", already
says "React's model, not its accidents"; a handler that cannot read what it just wrote is one of those accidents (it is among the
most asked React questions).

## The rules

### 1. State is written directly; a handler reads its own writes

```tsx
const s = useSim({ vx: 0, coyote: 0, enemies: [] as readonly Foe[] });

useUpdate((dt) => {
  s.coyote = onGround ? COYOTE : s.coyote - dt;
  s.vx += ACCEL * dt;
  if (s.vx > MAX) s.vx = MAX; // reads the sum just written
});
```

Each field is still a state slot as `useState` makes it: it renders when it changes, it is saved, and hot reload and rewind keep it.
(Name to be settled, `useMutable` is the lean: `useSim` reads as "for simulations"; this note calls it `useSim` because #121 does.)

### 2. One timing rule, for all state

**A handler sees every write at once. Render sees the state the frame committed.** `useInput` then `useUpdate` run, each seeing the
other's writes; then the component renders once from what they left. This holds across components too (lean, see "Shared lists"
below): a child's handler reading a prop sees its parent's value as it is now, and only render sees what the frame committed.

Taught once, for all state, this is easy to hold. It only felt like "two views of one value" in #121 because it applied to one hook
and not the other.

A component-body `const` that reads state follows the same rule: in a handler it is worked out from the state as it is now, in render
from what the frame committed. That has to hold for every form of `const`, destructuring included (#121 misses `const { a } = f(s.x)`).

### 3. Props are read-only; a child changes its parent's state through a callback

```tsx
// Parent
<Enemy hp={s.hp} onHit={(dmg) => (s.hp -= dmg)} />

// Enemy
function Enemy({ hp, onHit }: EnemyProps) { … onHit(1) … }
```

Writing to a prop, or to anything inside one (`hp = 0`, `enemy.hp -= 1` where `enemy` is a prop), is a compile error that points to
the callback form. Svelte allows the last case with a development warning; the compiler here can refuse it outright.

**No two-way binding for now.** Svelte's `$bindable` / `bind:value` lets a child write a parent's state when both opt in. It is left out:
it hides who owns a value, and games rarely need it. Revisit only if callbacks for editor-style controls (sliders, inspectors) become
real boilerplate.

### 4. Render stays pure

No writes in the component body (`RGE1402` today, and #121 keeps it for its fields). A write belongs in a handler.

## Open: changing a list or an object in place

Today a list is replaced whole: `s.enemies = [...s.enemies, e]`, and `push` is `RGE1301`. Once fields are written directly, authors
will write `s.enemies.push(e)` and `enemy.hp -= 1` inside a list, and refusing it makes the model stop at the first list. This is the
largest piece of work here, and the question to settle before anything else.

### What breaks if it is simply allowed

A number written directly is fine: every write goes through the generated setter. A write inside a list or an object changes its
contents but keeps the same reference, and the engine finds changes by comparing references:

1. **The screen does not update.** The setter returns early when `next === pending`; render's guards (`$in`, REACT_FEEL_PLAN.md D5)
   and the derived-value memos (`$memo`) compare each input with its value at the last render. A pushed list is the same array, so
   the parts that draw it, and the props handed to children, are skipped.
2. **The timing rule bends.** The committed value and the live value are the same object, so another component sees the list changed
   mid-frame, before any render, while it still sees numbers as the frame began.
3. **The compiler cannot see every write.** `s.enemies.push(e)` in a component, yes. `const e = s.enemies[i]; e.hp -= 1` takes alias
   tracking, and `damage(s.enemies, 3)` in a `rules/*.ts` helper cannot be seen at all.

Rewind and saves are not affected: they deep-copy state with `structuredClone` (`packages/player/src/rewind.ts`).

### How Svelte went through the same question

Svelte 4 was compile-time, like this engine: an assignment was what made a value reactive, so `arr.push(x)` updated nothing and the
documented fix was `arr.push(x); arr = arr;`. Reactivity also stopped at file boundaries: a `.js` helper that changed an object went
unseen. It was one of Svelte's best-known pain points.

Svelte 5 moved to runtime proxies (signals): `$state` on an object or array returns a deeply reactive proxy, nested objects are
proxied lazily on access, and every write is tracked wherever it happens, a plain `.js` helper included, because the proxy travels
with the value. Its escape hatches show the costs: `$state.raw` turns deep tracking off for large data (a proxy trap on every read is
slow), `$state.snapshot` hands a plain copy to code that cannot take a proxy (`structuredClone`, outside libraries), and class
instances are not proxied (a class declares `$state` fields instead).

The lesson for this engine: compile-time tracking alone runs into aliases and helpers sooner or later; the runtime answer works, but
it is paid for on every read.

### Signals inside the engine, not exposed to authors

DESIGN.md's ground rule is "no signals … updates stay direct". Change detection that only says *this changed*, while render still
assigns fields directly, keeps to the spirit of that rule, so signals used only inside the engine are worth considering. But signals do
two jobs, and the engine needs only one:

- **Noticing writes** (this value changed): missing today for writes the compiler cannot see.
- **Tracking reads** (this part of the screen read that value, re-run it): already done at compile time by D5's guards. Doing it again
  at run time would duplicate it and cost more.

Hidden proxies would still cost:

- **Speed.** A proxy trap on each property read in a per-frame loop is far slower in V8 than a plain read. Hearth's wave 10 is about
  1.2 ms a frame, and CI holds bench budgets.
- **Rewind, silently.** `structuredClone` cannot copy a proxy; `copyState` catches the error and keeps the live reference, so a proxied
  list would stop being snapshotted with no error. It would need an unwrap step, as Svelte's `$state.snapshot`.
- **Identity and debugging.** A proxy is not `===` to its target, the debugger shows `Proxy {}`, and classes, `Map` and `Set` need
  special handling. "Not exposed" is not wholly true: authors meet proxies in the debugger and in edge cases.

### The options

1. **Keep refusing in-place writes** (what #121 does). Consistent and free, but the model is "mutable, except lists".
2. **The compiler lowers in-place writes to copies.** `s.enemies.push(e)` becomes `s.enemies = [...s.enemies, e]`, copied once on a
   handler's first write and changed in place after. Nothing downstream changes, and the timing rule holds. Aliases and helpers are
   refused; TypeScript enforces much of that already if fields are `readonly Foe[]` with `Readonly<Foe>` items, so a helper taking
   `Foe[]` does not type-check.
3. **Versions, with "assume changed" after calls the compiler cannot see.** Each state slot gets a version; render's guards and memos
   compare reference *and* version. Writes the compiler sees (`s.enemies.push(e)`, `s.enemies[i].hp -= 1`) bump it, at the cost of
   an increment. A call it cannot see into that takes state (`damage(s.enemies, 3)`) bumps it afterwards; the worst case is checking
   a part of render that did not need it. Known-pure calls (`Math`, the allowlisted array methods) are exempt. This catches the helper
   case Svelte 5 needed proxies for, with nothing added to the read path. The gap is a helper that keeps a reference and changes it in
   a later frame: rare, a documented rule, and mostly caught by `readonly` types.
4. **Hidden write-tracking proxies.** Catches everything, at the costs above.

Options 3 and 4 change lists in place, so another component sees the change before the next render. Only copying (option 2, or
copy-on-write) keeps the list a snapshot. Which is right depends on the timing between components, below.

**Lean:** option 3, and option 4 only if option 3 proves too coarse. Speed is set aside for now; it is measured on Hearth's wave 10
before this is built.

### Shared lists: live everywhere

Under today's rule, state is a snapshot between components until the next render. A list changed in place breaks that while a number
does not, which leaves two rules depending on the type of a value: the worst outcome. There are two consistent ways out.

**A. Live everywhere (Svelte's way).** Svelte 5 keeps one copy of each value: props are not copied into a child but read through
getters to the parent's state, so a child reading `hp` or `enemies` straight after its parent wrote it sees the new value. Only the
screen lags. Here, rule 2 extends across components: every handler reads current values, its own state and its props alike, and only
render sees the frame's committed state. The compiler can do it the way #121 handles derived consts: in a handler, a prop read is
worked out again against the parent's live state.

- One rule for every value and every component; lists are shared in place for free; it is how game code is usually reasoned about.
- **Update order becomes visible.** Whether a child sees its parent's write depends on whether the parent's `useUpdate` ran first.
  It stays deterministic, so replays do not change, but the order has to be defined and documented, as Unity documents its script
  execution order.

**B. Snapshot everywhere (React's way).** A list changed in place is copied on its first write in a frame, so other components see it
as the frame began, as they see numbers.

- Update order does not matter: every handler in a frame sees the same outside world, the guarantee DESIGN.md took on 2026-11-08.
- A copy on the first write each frame, and a split model: your own state is live, everyone else's is stale.

**Lean: A.** #121 already gives up "every handler sees the same state" within a component; A applies the same rule across components
instead of drawing a line at their edges. Game logic usually wants live reads. Two towers firing at an enemy with 1 hp: under B both
see it alive and both fire, the second shot wasted unless the author guards against it; under A the second sees it dead and picks
another target. React keeps reads stale for reasons of UI (a consistent screen, concurrent rendering) that a fixed-step game loop
does not have.

A needs:

1. **A defined update order** within a frame: likely tree order, parents before children, with `useInput` before `useUpdate` across
   the whole tree. Documented, and held by a replay test.
2. **Props read live in handlers and committed in render**, the split a component's own state has.
3. **DESIGN.md's guarantee restated:** "every handler in a frame sees the same state" becomes "every handler sees the latest writes;
   render sees the frame's committed state".

## One hook: `useState` is removed

Leaning (2026-11-14): one state hook, named for what it is (`useMutable` or similar), and `useState` removed. Keeping both leaves a
choice every author has to make between two hooks that hold the same kind of value; renaming the direct hook to `useState` would
give React's name a meaning React code does not expect (`setA(b); setB(a)` and `setX(x + 1)` twice behave differently). A new name
says plainly that this is not React's hook.

`useState` becomes a diagnostic that names the replacement and shows the conversion (`const [hp, setHp] = useState(3)` becomes a
field of `useMutable({ hp: 3 })`, and `setHp(v)` becomes `s.hp = v`). The games move with a codemod.

## The game state: actions write, readers read

The same direct form for the store (`createGameState`, DESIGN.md "Global state"), with one difference from component state: **only
actions written in `GameState.ts` change it.** A component reads with a selector and calls actions; writing to the store from a
component (`game.cursor = 3`) is a compile error that points to the action form.

```ts
export const useGame = createGameState(
  { screen: "title" as Screen, cursor: 0, open: false, speed: 1 as 1 | 2, run: newRun(), gems: 0 },
  {
    select(s, pad: number) { s.cursor = pad; s.open = true; },
    toggleSpeed(s)         { s.speed = s.speed === 1 ? 2 : 1; },
    tick(s, dt: number)    { if (!s.run.finished) s.run.time += dt; },
    begin(s)               { sfx.play("start"); Object.assign(s, fresh, { screen: "play" }); },
  },
);
// component, unchanged:  const { select } = useGame.actions();  const cursor = useGame((s) => s.cursor);
```

- **Data and actions are separate.** The state is a plain object (no functions in it), so saves, `structuredClone` for rewind and the
  compiler's schema reading get simpler, and arrays stop being a "not yet". Each action gets the live state as its first argument;
  the bound action drops it (`select(3)`). `set`, `get` and the `{ ...s.run, time }` copies go away.
- **Why not direct writes from components.** The store is owned by the game, as a parent owns its state (rule 3): its owner defines
  how it changes. An action keeps an invariant and its side effects together (`finish` sets the screen, the results and the speed,
  and plays a sound; a bare `screen = "won"` skips all that), gives replays and debugging a named event, and keeps one place to
  answer "what can change `run`?". Svelte 5 allows any importer to write a `$state` module's fields and relies on convention; the
  compiler here can refuse it. Closed is easy to open later; the other way breaks games that came to rely on it.
- **How the store notices writes.** An action's body is plain TypeScript the compiler does not lower, so it cannot see each write. It
  does not need to: calling an action marks the store dirty (option 3's "assume changed after a call it cannot see"), and at the
  frame's flush the store compares its live state with the last committed state leaf by leaf, as `set` does today, and tells only
  the readers whose leaves changed. The cost is one comparison on frames where an action ran. No proxies, nothing on the read path.
- **Timing is rule 2.** A handler reads the live store (`select(3)` then reading `cursor` gives `3`; today it gives the old value),
  and render reads what the frame committed.
- **Selected values are read-only** (`Readonly<…>` types, and a compile error on a write), as props are.
- **Boilerplate is the cost**: a one-line action for `cursor` or `open`. Hearth and Kite have 8 to 11 actions each, mostly one line.
  If that proves painful after the games move, the first thing to try is an explicit opt-in list of fields components may write
  (`free: ["cursor", "open"]`), so the exceptions are visible in the store file. Not a generated setter per field, which brings back
  `setX` and makes bypassing actions easy, and not an `update((s) => …)` passed in from a component, which is direct writes with one
  extra layer.
- **Lean, not decided:** the `createGameState(data, actions)` shape over Zustand's Immer-style `set((s) => { s.gems++ })`, which is
  the smaller migration but keeps the `set(…)` wrapper, for the same reason `useState` is not kept.

## What changes

- DESIGN.md's decisions table: "State reads in handlers" and "Mutating state in place" are replaced by rules 1, 2 and the list decision;
  "every handler in a frame sees the same state" becomes "every handler sees the latest writes; render sees the frame's committed state".
- The guide documents the update order within a frame.
- REACT_FEEL_PLAN.md: "written like React" becomes "React's model, with state you write directly".
- The guide, the template and the README teach the direct form only.
- Kite, Hearth and Bramble move to it (#121 does `Runner`, `Enemy`, `Tower` and `Play`); the rest can be a codemod, since each
  `useState` maps to a field.

## Open questions

1. The hook's name: `useMutable` is the lean.
2. In-place writes to lists and objects: option 3 (versions) is the lean, pending a measure of its speed.
3. The update order within a frame (needed by "live everywhere"): tree order with parents first is the lean.
4. Whether `useRef` stays separate. Kite's `Runner` renders none of its `useSim` fields, so refs would have done there; a ref is now
   "state that never renders", which may be better said as an option than a second hook.
5. The game state's shape: `createGameState(data, actions)` with actions writing directly and components never writing (lean, see "The game state"), and whether a `free` list is ever needed.

## What #121 built (2026-11-14)

Settled:

- **One hook, `useMutable`, and no `useState`** (open question 1). A `useState` is `RGE1102`, whose message writes the conversion
  out in the author's names (`const s = useMutable({ hp: 3 })`, read as `s.hp`, and `setHp(v)` becomes `s.hp = v`), once: not
  again at the import, nor at each read or setter call. The editor's quick fix converts the whole file, and so does
  `node tools/codemod-mutable.ts <files or folders>`; both are `convertToMutable` (`packages/compiler/src/codemod/mutable.ts`). The
  games, the examples, Bramble and the compiler's tests moved with it.
- **Rule 1 and the handler half of rule 2.** A handler reads its own writes and every earlier handler's, in the order handlers run;
  render sees the frame's committed values. A derived `const` (plain, destructured, or a render block's names) read in a handler
  is worked out from the fields as they are now, under a memo of its own (`spawns@live`) keyed on their pending values, so once
  until a field it reads is written. A callback created under a condition assumes the condition in that same live form, so
  TypeScript narrows what the callback reads.
- **A hook hands its state back as the object** (`return s`): `const counter = useCounter(2)` makes `counter` the hook's fields, and
  the shipped hooks do this (`squash.x = 0.6`; a shake is `strength`, `duration` and `elapsed`). `const t = s` is another name for
  the same fields; `s` read whole anywhere else (`total(s)`, `<Camera shake={shake}>`) is a copy of its fields.
- **From outside**, a compiled component's `component.s.vx` reads the committed value and `component.s.vx = 1` writes through the
  setter, so tests and tools write state the way handlers do. `@rge/testing`'s `state()` shows a mutable as `{ s: { vx } }`.

Still open:

- **In-place writes to lists and objects** (open question 2). `s.list.push(x)` is refused, with the assignment to write instead.
- **Props read live across components** ("Shared lists: live everywhere", option A). Props and context still carry what the
  parent's last render committed; a child's callback writes the parent's pending value, which the parent's own handlers then read.
  So between components the old one-step lag holds.
- **`useRef`** (open question 4) is unchanged; **game-state actions** (open question 5) are proposed in "The game state: actions write, readers read", not built.

Found while building it:

- **TypeScript does not narrow a field in a closure.** `{s.waiting !== null && <Prompt onKey={() => bind(s.waiting)} />}` is a
  type error in the author's editor, where `const waiting = s.waiting` above it is not. It is also a real hazard: the callback
  runs later, as a handler, and the field may have changed by then. The guide teaches the `const`; Bramble's settings needed it.
- **Timing moved by a step in a few places**, as rule 2 says it should: a component that writes a value and then checks it in the
  same handler now acts in that step (an enemy defeated in the step its hp reached 0; a tween started in the step its target
  changed, not the next). The tests that pinned the old timing were updated to the new one, with the reason written beside them.
- **The codemod is mechanical, and `setX(x + 1); use(x + 1)` is the pattern to check after it.** With a snapshot, `use(x + 1)` read
  the old `x`; converted to `s.x += 1; use(s.x + 1)` it adds one twice. One test hit exactly this (`sharing.test.ts`).
- **A hook's internal mutable keeps a call-specific name** where the hook returns fields rather than the object (`useBody` returns
  `{ x, y, move, … }` from `b`): its state is saved as `_useBody1_b.x`. Tests that read a body's position read where the component
  draws instead. Naming it after the hook (`body.x`) would make it readable; not done.
- **The updater paths in the compiler are unreachable now** (`SetState` with an `updater`, `lowerSetState`, `updaterInPlace`), as
  nothing declares a setter binding. Removing them is a cleanup for a later change.

