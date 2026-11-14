# State you write directly: a design note

As of 2026-11-14. **Status: proposed.** Written while reviewing #121 (`useSim`), which adds a second state hook whose fields are
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
other's writes; then the component renders once from what they left. Between components, state is still a snapshot until the next
render: a child sees the prop its parent last rendered.

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
largest piece of work here, and the question to settle before anything else:

- **Lower in-place writes to copies.** `s.enemies.push(e)` becomes `s.enemies = [...s.enemies, e]`, `s.enemies[i].hp -= 1` becomes a
  copy of that item and of the list. Simple, keeps the `===` check every renderer and rewind relies on, but a step that touches many
  items copies the list many times; the compiler could batch the copies within one handler (copy once on the first write, then write
  in place).
- **Track changes in place.** Mark the field dirty on any write through it and keep copy-on-write snapshots for rewind and saves.
  Cheaper per write, but it changes how every consumer of state detects a change.

The first, with per-handler batching, looks like the right start: it changes nothing downstream.

## One hook: `useState` is removed

Leaning (2026-11-14): one state hook, named for what it is (`useMutable` or similar), and `useState` removed. Keeping both leaves a
choice every author has to make between two hooks that hold the same kind of value; renaming the direct hook to `useState` would
give React's name a meaning React code does not expect (`setA(b); setB(a)` and `setX(x + 1)` twice behave differently). A new name
says plainly that this is not React's hook.

`useState` becomes a diagnostic that names the replacement and shows the conversion (`const [hp, setHp] = useState(3)` becomes a
field of `useMutable({ hp: 3 })`, and `setHp(v)` becomes `s.hp = v`). The games move with a codemod.

## What changes

- DESIGN.md's decisions table: "State reads in handlers" and "Mutating state in place" are replaced by rules 1, 2 and the list decision.
- REACT_FEEL_PLAN.md: "written like React" becomes "React's model, with state you write directly".
- The guide, the template and the README teach the direct form only.
- Kite, Hearth and Bramble move to it (#121 does `Runner`, `Enemy`, `Tower` and `Play`); the rest can be a codemod, since each
  `useState` maps to a field.

## Open questions

1. The hook's name: `useMutable` is the lean.
2. In-place writes to lists and objects: copies or tracking (above).
3. Whether `useRef` stays separate. Kite's `Runner` renders none of its `useSim` fields, so refs would have done there; a ref is now
   "state that never renders", which may be better said as an option than a second hook.
4. Whether a game-state action (`useGame`) gets the same direct form, so a store reads like component state.
