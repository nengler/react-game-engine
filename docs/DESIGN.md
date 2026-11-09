# Compiler design

This document describes the architecture of the TSX → TypeScript game-object
compiler as it stands after Phase 2 (M0–M15), the decisions taken, and the
alternatives that were considered. It is the place to push back on a decision before more code is
built on top of it.

## Pipeline

```
 .tsx source
     │  parser/      TypeScript 7.1 native parser (typescript/sync API)
     ▼
 TS AST  (remote-backed nodes, typescript/ast)
     │  analyzer/    find components, hook calls, JSX roots, tag usage
     ▼
 SourceAnalysis   (still points at AST nodes)
     │  transform/   lower expressions, classify children, assign identity
     ▼
 IRModule         (plain data, no AST references, JSON-serialisable)
     │  generator/   IR → TypeScript class source
     ▼
 generated .ts
     │  typecheck/   TypeScript 7.1 program over an in-memory FS layer
     ▼
 diagnostics
```

Each stage is a pure function of the previous stage's output. Only the parser
and type checker talk to the TypeScript process.

## TypeScript 7.1 integration

TypeScript 7 is the native (Go) compiler. The npm package ships a JS client
that talks to a `tsc` child process over IPC; there is no in-process
`ts.createSourceFile` any more. What we use, all verified against
`typescript@7.1.0-beta` (the only 7.1 build on npm at the time of writing):

| Need | API |
| --- | --- |
| Start the compiler | `new API({ cwd })` from `typescript/sync` |
| Parse TSX | `api.createSourceFile(fileName, text, { scriptKind: ScriptKind.TSX })` → `RetainedSourceFile` (must be `dispose()`d) |
| Walk the AST | node `.forEachChild`, guards from `typescript/ast/is`, `SyntaxKind` from `typescript/ast` |
| Positions | `sourceFile.getLineAndCharacterOfPosition(pos)` |
| Type-check generated code | `api.createSnapshot({ fileSystem: createFileSystemLayer(files), createPrograms: [...] })` then `program.getSemanticDiagnostics()` |
| In-memory files | `createFileSystemLayer` from `typescript/fs` — layered over the real disk, so generated files can import the runtime package |

Limitations found while integrating:

* `RawCompilerOptions` takes **numeric enums** (`ScriptTarget.ES2022`,
  `ModuleKind.ESNext`, …), not the tsconfig strings. Passing strings panics the
  server process. We import the enums from `typescript/sync` / `typescript/ast`.
* The sync API spawns a process; creating one per file is wasteful, so the
  `Compiler` class owns a single `API` instance and must be `close()`d.
* We only use the AST for reading. We do **not** use `typescript/ast/factory`
  for code generation (see "Code generation" below).

## Authoring model

```tsx
import { useState, Entity, Sprite } from "@rge/runtime/jsx";
import { WarningIcon } from "./WarningIcon.tsx";

function Player() {
  const [health, setHealth] = useState(100);
  return (
    <Entity name="Player">
      <Sprite image={health > 50 ? "normal.png" : "hurt.png"} />
      {health < 25 && <WarningIcon />}
    </Entity>
  );
}
```

Rules (anything else is a compiler diagnostic, never silently
ignored):

* A component is a top-level `function` declaration or `const` arrow function
  with a capitalised name (optionally `export`ed, or the module's default
  export) whose body is: hooks (`useState`, `useRef`, `useSound`, the handler hooks),
  `const name = expression;` derived values, then one `return`. An arrow with
  an expression body (`const Dot = () => <Sprite … />`) is just its return. A derived `const` (`const hurt = health < 25;`) may read
  anything declared above it; it is inlined where it is used, so JSX that uses
  it updates with the state it reads, and a handler that uses it sees current
  state.
* The root is a built-in element or a fragment, never another component. It
  describes the component instance itself (the generated class extends that
  built-in), so its props are applied to `this`, and its children become
  children of `this`. A fragment `<>…</>` is an implicit container, a bare
  `Entity`. See "Roots and component forms".
* `useState` is a compiler intrinsic. It must be a top-level `const` array
  destructuring. Calls anywhere else, or a `use*` call that is not one of the hooks, are errors.
  State type is inferred from the initial literal (`number`/`string`/`boolean`)
  or a prop; an array or record needs its type (`useState<EnemyData[]>([])`,
  with `EnemyData` declared in the file) and is updated immutably. See
  "Arrays and records".
* Children: elements, `{condition && <Element />}`,
  `{condition ? <A /> : <B />}` (a branch may be `null`; it lowers to two
  conditional children, on `condition` and `!condition`), or a keyed list
  `{items.map((item) => <Element key={item.id} … />)}` (see "Keyed lists").
  Text children, fragments, spread attributes and other expression children
  are rejected.
* Imports: components from `./Name.tsx`, and hooks, built-in elements and
  `clamp` and the `Child` type from `@rge/runtime/jsx` (the manifest's
  `authoringModule`; the type is written `import { type Child }`, the one
  place `type` is accepted). Named imports only; any other import is
  `RGE1001`, and a name the entry point does not export, a `type` on a value,
  or a type imported as a value is `RGE1004`. The entry point is a set of declarations (calling
  one throws) typed from the runtime's own classes, with the `JSX` namespace in
  `@rge/runtime/jsx-runtime`, so the TSX itself type-checks: a project uses
  `"jsx": "react-jsx"` and `"jsxImportSource": "@rge/runtime"`
  (`packages/example/tsconfig.json`). `rge-compile` runs this check first
  (`RGE9002`; `--no-check` skips it). Imports are mandatory, as in React: a
  hook, built-in element or runtime function used without being imported is
  `RGE1005` (reported once per name per file, naming the import line to
  add). `Math` is a global and needs none.
* Position is state: `transform={{ x, y: 0, rotation }}` on any built-in
  element (`<Entity>`, `<Sprite>`, `<Collider>`, `<Text>`, `<Shape>`, `<Camera>`,
  `<AnimatedSprite>`, `<Pointer>`; the root or a child),
  relative to its parent unless
  it sets `global: true`. There is no transform hook. Refs hold values:
  `const timer = useRef(0)`, read and written as `timer.current` in handlers.
  There is no `ref={…}` on elements. See "Transforms and refs".
* Hooks: top-level `useInput((input) => ...)`, `useUpdate((dt) => ...)`,
  `useMount(() => ...)` and `useUnmount(() => ...)` statements; each may
  appear several times and runs in source order.
  `onUpdate` / `onInput` (renamed) and `onCollisionEnter` (now a prop on
  `<Collider>`) report `RGE1102` with where they went. See "Handlers" below.
* Element tags are runtime intrinsics (`Entity`, `Sprite`, `Collider`, `Text`,
  `Shape`, `Camera`, `AnimatedSprite`, `Pointer`; the list comes from the runtime manifest), components declared in the same file, or
  components imported from another `.tsx` file with
  `import { Name } from "./Name.tsx"` or `import Name from "./Name.tsx"` (the
  default export, under any local name; no namespace, `as` or `type` forms). A component takes props through a
  destructured parameter annotated with a props type declared in the same
  file, and a parent passes them as attributes; see "Props and callbacks".
* Expressions: number/string/boolean/null literals, state reads, unary
  `! - +`, binary arithmetic / comparison / logical, `?:`, parentheses, array
  and object literals (with spreads), member reads (`e.id`, `items.length`,
  `found?.hp`) and the non-mutating array methods. See "Arrays and records".

## IR

Defined in `packages/compiler/src/ir/types.ts`. Highlights:

* Every union is discriminated by `kind`; consumers `switch` on it with an
  `assertNever` default, so adding a variant is a compile error everywhere it
  must be handled.
* IR is plain data. No AST nodes, so it can be serialised, snapshotted in tests
  and (later) cached or diffed for hot reload.
* `ExprIR` is a small expression tree. State reads are `StateRead { state:
  StateId }`, not identifiers — the generator decides how to access state
  (`this.health`), and dependency analysis is a tree walk, not a string scan.
* `StateId` and `ElementId` are branded strings so they cannot be mixed up with
  arbitrary names.
* Props are `StaticProp` (no dependencies, evaluated once), `DynamicProp`
  (carries its `dependencies`, re-evaluated on render) or, on a component
  element, `CallbackProp` (an inline function, created once). A dependency is
  a state slot of this component or one of its props
  (`{ kind: "State" | "Prop" }`), so JSX that reads a prop updates when the
  parent changes it, or, inside a keyed list, the list's item
  (`{ kind: "Item" }`).
* Children are `StaticChild` (instantiated once, never recreated),
  `ConditionalChild` (created/destroyed when `condition` flips),
  `KeyedListChild` (one instance per item, kept by key) or `ChildrenSlot`
  (where a parent's passed children mount).
* The root is a distinct `HostElementIR` (no field name, it *is* `this`), so
  "root element stored in a field" is unrepresentable.
* Each `ElementIR` has a stable `id` (structural path, e.g. `Player/1`) and a
  unique `fieldName`. The id is what future hot-reload / scene serialisation
  keys on; the field name is a codegen detail chosen once in the transform.
* `hooks: HookIR[]` lists hook declarations in source order; `state: StateIR[]`
  lists the persistent storage slots they create. They are separate because
  hook order matters while storage does not. Refs are not hooks in the IR:
  they live in `ComponentIR.refs` as typed values with an initial value.
* `transform` is not a prop: elements carry `transform: TransformPropIR[]`,
  the same static/dynamic props, restricted to the transform fields and
  written to the element's runtime `transform`.

### How future features slot in

| Feature | IR change |
| --- | --- |
| ~~`useUpdate`, `useInput`~~ | done: `OnUpdate` / `OnInput` hooks carrying a `FunctionIR` (IR kinds are named after the runtime methods they override); see "Handlers" |
| ~~event props (`<Collider onCollisionEnter={…}>`)~~ | done: the same `CallbackProp` a component receives, with parameter types from the runtime manifest; see "Roots and component forms" |
| ~~transforms, refs~~ | done: `ElementIR.transform` / `HostElementIR.transform`, `ComponentIR.refs` (values), `Assign` to `RefCurrent`, `RefRead`; see "Transforms and refs" |
| ~~props between components~~ | done: `ComponentIR.props: PropDeclIR[]` and `propsType`, `IRModule.typeDeclarations`, `ExprIR` `PropRead`, `CalleeIR` `Prop`, `PropIR` `CallbackProp`, `DependencyIR`; see "Props and callbacks" |
| ~~arrays and records in handlers (M5a)~~ | done: `TypeIR` `Array` / `SourceType` for state, `ExprIR` `ArrayLiteral`, `ObjectLiteral`, `MemberRead`, `Arrow`, `CalleeIR` `ArrayMethod`; see "Arrays and records" |
| ~~prefabs / scenes (M6)~~ | done: `ComponentIR.isExported`, a generated `prefabs` registry per module, project-level `prefabs.ts` / `prefabs.json`, scene validation (`RGE15xx`), `loadScene` in the runtime, a Tiled importer; see "Prefabs and scenes" |
| ~~children (M8)~~ | done: `ChildIR` `ChildrenSlot`, `ComponentIR.acceptsChildren`, `ElementIR.children` on a component element are the children passed to it; runtime `attachPassedChild` and friends; see "Children" |
| ~~keyed lists (M5b)~~ | done: `ChildIR` `KeyedListChild { source, item, index, key, element, dependencies }`, `DependencyIR` `Item`; runtime `(slot, order)` and `queueReorder`; see "Keyed lists" |
| ~~mount and unmount (M9)~~ | done: `OnMount` / `OnUnmount` hooks carrying a `FunctionIR`; see "Mount and unmount" |
| ~~built-in elements (M10–M14)~~ | none: `<Text>`, `<Shape>`, `<Camera>`, `<AnimatedSprite>` and `<Pointer>` are runtime classes plus manifest entries (`textContent`, `intrinsicLiterals`, `intrinsicHooks`, `intrinsicCallbacks`); see their sections |
| ~~`useSound` (M15)~~ | done: `ComponentIR.sounds: SoundIR[]` and a `PlaySound` statement; see "Transforms and refs" |

## Handlers

`useInput` and `useUpdate` are hooks whose handlers are
lowered to a `FunctionIR { params, body: StatementIR[] }`. Statements exist
only inside functions.

**Statements** (`StatementIR`): `ExpressionStatement` (allowlisted calls),
`LocalConst`, `If`, `Return`, and `SetState`, which is either
`{ state, value }` or `{ state, updater: FunctionIR }` for `setX(prev => …)`.
Parameters are `ParamRead`, locals are `LocalRead`, state is `StateRead`.
`Assign` (`=`, `+=`, `-=`, `*=`, `/=`) writes `ref.current`; see
"Transforms and refs". Position is not assigned: it is state.

**Expressions** added: `ParamRead`, `LocalRead`, `PropertyRead` (only on a
parameter of a runtime handle type, e.g. `input.pointerX`), `Call` and
`TemplateLiteral`. `Call` is limited to an allowlist (`Math.abs/floor/ceil/
round/sign/sqrt/sin/cos/min/max`, `clamp`) and to methods of handle
parameters (`input.pressed/down/released`); the tables live in
`transform/handles.ts`. Everything else (loops, `try`, `let`, assignment,
closures that escape, `this`, `await`, other calls) is a diagnostic
(`RGE1301`/`RGE1401`/`RGE1402`); assignment to anything but `ref.current` is `RGE1402`.

**Scoping**: component scope (state, setters) → function scope (parameters) →
block scope (`const`s). Shadowing follows JS, so the React idiom
`setCount((count) => count + 1)` works: state is emitted as `this.count`, so a
parameter or local of the same name cannot be confused with it. Only a
redeclaration in the same scope (the function body shares its parameters'
scope, as in JS) or rebinding `Math`/`clamp` is `RGE1401`.

**Semantics** (React's): state is a snapshot. A setter records the next value
in a private pending field (`#healthNext`) and calls `markDirty()`; reads
(`this.health`) keep the value from the last render until the component
renders again, when `commitState()` (run by `runRender()` just before
`render()`) copies pending into current. So `setN(n + 1); setN(n + 1)` adds 1,
`setN((n) => n + 1)` twice adds 2 (updaters chain on the pending value), and
every handler in a frame sees the same state whichever runs first. Any number
of setter calls in a frame cause one render, in the frame's render phase.
Refs are the deliberate exception: `ref.current` is a plain field, read and
written immediately.

**Generated code**: one override per hook kind. A single handler is inlined:

```ts
override onInput(input: InputState): void { if (input.pressed("Space")) { … } }   // from useInput
```

Several handlers of one kind become private methods called in source order, so
a `return;` in one cannot skip the others:

```ts
override onUpdate(dt: number): void { this.#onUpdate0(dt); this.#onUpdate1(dt); }
```

`SetState` emits `this.setX(…)`, so dirty marking stays in the setter.

**Runtime frame** (`World.tick(dt, input = NO_INPUT)`): `onInput` → `onUpdate` (the methods `useInput` / `useUpdate` compile to)
→ render dirty objects → commit structure. Objects register on attach only if
they override a hook (compared against `GameObject.prototype`), and the visit
lists are snapshotted at the start of the tick, so objects attached during a
frame start receiving hooks next frame and detached ones are skipped.
`InputState` is a plain interface (`pressed`, `down`, `released`, `pointerX`,
`pointerY`); the mock builds it with `createInputState({ pressed: [...], … })`.

**Collisions**: the mock has no physics. A collision system calls
`world.reportCollision(a, b)` with two colliders; each collider's own
`onCollisionEnter` callback (the `<Collider onCollisionEnter>` prop) is called
with the other collider, if it is mounted in this world. Because it is the
collider's callback and not the component's, a component with several colliders
(a hitbox and a shield) knows which one was hit. Dispatch only; renders happen
in the next `tick`.

**Presses**: like collisions, the mock has no input device. An input system calls
`world.reportPress(pointer, x, y)` with a world-space point; the pointer's own
`onPress` is called if the point is inside its area, and the call returns whether
it hit. Choosing which pointers to test, and in what order for overlaps, is the
input system's job.

Input model decision (per the Phase 2 plan): a polled per-frame `useInput` hook,
not JSX event props. Element-level events are callback props on the element
(`<Collider onCollisionEnter>`, `<Pointer onPress>`).

## Mount and unmount

`useMount(() => …)` and `useUnmount(() => …)` (M9) are handler hooks like
`useUpdate`, lowered to a `FunctionIR` with no parameters (`OnMountHookIR`,
`OnUnmountHookIR`; the overrides are `onMount()` and `onUnmount()`). There is
no `useEffect` and no cleanup function to return: reacting to a state change
is done where the state changes.

```tsx
function Banner({ text, onDone }: BannerProps) {
  const [shown, setShown] = useState(false);
  useMount(() => setShown(true));        // once, when it joins the world
  useUnmount(() => onDone?.());          // once, when it leaves
  return <Sprite image={shown ? `banner-${text}.png` : "banner-hidden.png"} />;
}
```

**When.** A component mounts when it is attached to a `World` (`World.mount`,
a parent's `addChild`, or a queued add committing: a condition turning on, a
list item added, children passed to a component) and unmounts when it is
detached (a condition turning off, an item removed, an enclosing component
leaving). Constructing an object does not mount it, so a component never put
in a world runs neither. Its first render has already committed, since the
constructor runs it. Each hook runs once per stay in a world.

**Order.** For a subtree, mounting is children first (a parent's `useMount`
sees its children mounted) and unmounting is parent first (the parent's
`useUnmount` runs while its children are still attached). Each object is still
in its world when its own hook runs.

**State.** `useMount` may set state: the setter schedules a render, which runs
in the same `World.flush()` that mounted it. `useUnmount` may not (`RGE1402`):
the component is going away, so the update could never render. It may read
state, write refs, and call callback props, which is how the parent finds out
(`onDone?.()`). A callback created for a list item can still read its item
there (see "Keyed lists").

**Rules.** Top-level only, imported from the authoring module (`RGE1005`),
one arrow function with no parameters (`RGE1401`), several of a kind allowed
and run in source order.

## Arrays and records

State can hold an array or a record (M5a), so a component can keep a list of
things and change it from handlers:

```tsx
interface EnemyData { id: string; hp: number }

function Swarm() {
  const [enemies, setEnemies] = useState<EnemyData[]>([]);
  useUpdate((dt) => {
    setEnemies(enemies.map((e) => ({ ...e, hp: e.hp - dt })).filter((e) => e.hp > 0));
  });
  return <Entity name="Swarm"><Sprite image={enemies.length > 3 ? "busy.png" : "calm.png"} /></Entity>;
}
```

**State types.** `StateIR.type` is a `TypeIR`: a `Primitive`, an `Array` of
an element type, or a `SourceType { text }` (a type written in the file:
`EnemyData`, `Item | null`), copied into the generated code as written, next
to the file's copied type declarations, so the type-check resolves it. A
primitive is inferred from the initial value as before; state initialised
from a prop takes the prop's type; an array or object literal needs the type
argument (`useState([])` is `RGE1104`, as `[]` alone would be `never[]` in
TypeScript). Refs stay primitive (`RGE1106`). The authoring `useState<T>`
accepts any `T` and widens only primitives.

**Expressions.**

| Source | IR |
| --- | --- |
| `[a, ...rest]` | `ArrayLiteral { elements: { spread, value }[] }` |
| `{ id, hp: 2, ...e }` | `ObjectLiteral { properties: (Property \| Spread)[] }`; no methods, getters or computed names |
| `e.id`, `items.length`, `found?.hp` | `MemberRead { object, name, optional }` |
| `items.filter((e) => e.hp > 0)` | `Call` with `CalleeIR` `ArrayMethod { receiver, name }`; the callback is an `Arrow { params, body }` |

`MemberRead` is a member of any value: the compiler does not know the value's
type, and the type-check of the generated code (or of the source) validates
it. Members of a number or boolean parameter or state are still rejected
early. Members of a runtime handle parameter (`input.pointerX`) remain
`PropertyRead`, checked against the manifest.

**Array methods** (`ARRAY_METHODS` in `ir/types.ts`): `filter`, `map`,
`some`, `every`, `find`, `findIndex` (each takes a callback), `includes`,
`indexOf`, `slice` and `concat`. None changes its receiver. The mutating ones
(`push`, `splice`, `sort`, `forEach`, …) are `RGE1301` with the immutable
alternative (`setItems([...items, item])`). A callback is an inline,
expression-bodied arrow: it is consumed synchronously by the method, so it
never escapes (a deliberate, narrow exception to "no closures"), and with no
block body it cannot set state or call callbacks while the array is walked.
Its parameters are `Contextual`: the array's element type provides them, so
`(e) => e.hp > 0` needs no annotation. An arrow anywhere else (other than a
callback prop or a state updater) is `RGE1301`.

**Dependencies.** A JSX value that reads an array, including inside a
callback (`items.some((e) => e.hp < 1)`), depends on that state, so it
re-renders when the array changes.

**Immutable updates.** A setter renders only when it gets a new value (the
`===` check in the generated setter), so changing an array in place would
never render; that is why the mutating methods are rejected. `setItems(items)`
and `setItems((list) => list)` are no-ops; `setItems([...items])` renders. The
generated code is ordinary TypeScript:

```ts
enemies: EnemyData[] = [];
#enemiesNext: EnemyData[] = this.enemies;
setEnemies(value: EnemyData[] | ((previous: EnemyData[]) => EnemyData[])): void { … }

override onUpdate(dt: number): void {
  this.setEnemies(this.enemies.map((e) => ({ ...e, hp: e.hp - dt })).filter((e) => e.hp > 0));
}
```

An arrow whose body is an object literal is parenthesised, in callbacks and in
updaters (`setP((p: P) => ({ ...p, x: 1 }))`).

## Keyed lists

`{items.map((item) => <Element key={…} … />)}` keeps one instance of the
element per item of an array, by key (M5b):

```tsx
const [enemies, setEnemies] = useState<EnemyData[]>([]);
return (
  <Entity name="Pack">
    <Sprite image="bg.png" />
    {enemies.map((e) => <Enemy key={e.id} speed={e.speed} onDefeated={() => remove(e.id)} />)}
    <Sprite image="fg.png" />
  </Entity>
);
```

**Rules** (each `RGE1209` otherwise):

* The source is a state or prop array, optionally followed by
  `.filter((e) => …)` (a derived `const` that inlines to one counts).
* `map` takes one inline arrow with the item and optionally the index as
  plain names, returning exactly one element: an expression body, or a block
  holding only `return <Element … />`. No conditionals, fragments or children
  inside it; a richer item is a component.
* The element has a `key` that reads the item. A key that reads only the
  index compiles with a warning (instances then follow positions, not
  identities); a key that reads neither is an error, since every item would
  share it. `key` anywhere else is `RGE1203`.
* A callback prop on the item may read the item but not the index, which
  changes when items move.

**IR.** `KeyedListChild { source, item, index, key, element, dependencies }`.
`item` and `index` are `ParamIR`s with `Contextual` types (the array gives
them), read as `ParamRead`, so `e.speed` is a `MemberRead` the type-check
validates. The element's props and transform fields that read the item or
index are `DynamicProp`s with an `Item` dependency; `dependencies` are what
`source` reads. The element's `fieldName` names the list's fields.

**Generated code.** Fields `enemyItems: Map<string | number, Enemy>` (public,
by key) and `#enemyOrder` (the key order of the last render), plus
`#enemyRecords` (a `{ current }` holder per key, the key's current item) when
a callback reads the item.
`render()` handles the list in its own block, with `$`-prefixed temporaries
(author names may not start with `$`):

```ts
{
  const $parent = this;
  const $list = this.enemies;
  const $keys = $list.map((e) => e.id);
  const $seen = new Set<string | number>();
  for (const $key of $keys) {                       // 1. every key first: a duplicate throws before anything changes
    if ($seen.has($key)) throw new Error("Duplicate key " + JSON.stringify($key) + " in the <Enemy> list of Pack.");
    $seen.add($key);
  }
  for (const [$n, e] of $list.entries()) {
    const $key = $keys[$n]!;
    let $item = this.enemyItems.get($key);
    if ($item === undefined) {                      // 2. a new key: construct, queue at (slot, position)
      const $rec = { current: e };
      $item = new Enemy({ speed: e.speed, onDefeated: () => { this.remove($rec.current.id); } });
      this.enemyItems.set($key, $item);
      this.#enemyRecords.set($key, $rec);
      $parent.queueAddChild($item, 1, $n);
    } else {                                        // 3. an existing key: update in place
      this.#enemyRecords.get($key)!.current = e;
      $item.updateProps({ speed: e.speed });
    }
  }
  for (const [$key, $item] of this.enemyItems) {    // 4. keys that are gone
    if (!$seen.has($key)) { $parent.queueRemoveChild($item); this.enemyItems.delete($key); this.#enemyRecords.delete($key); }
  }
  if ($keys.length !== this.#enemyOrder.length || $keys.some(($k, $i) => $k !== this.#enemyOrder[$i])) {
    $parent.queueReorder(1, $keys.map(($k) => this.enemyItems.get($k)!));   // 5. only if the key sequence changed
    this.#enemyOrder = $keys;
  }
}
```

* **Identity and renders.** An existing item gets `updateProps` with its
  dynamic props; `applyProps` compares with `===`, so an item whose values did
  not change is not marked dirty and does not render.
* **Callbacks see the current item.** A callback prop is created once, with
  the item's first value. Inside it, item reads go through a `{ current }`
  holder (`$rec.current`) that every render refreshes, so after `setEnemies`
  replaces a record under the same key the callback reads the new one (as of
  the last render, like any state read). The callback keeps its holder after
  the item is removed, so `useUnmount` can still call it (it runs when the
  removal commits, after the render that dropped the key).
* **In a conditional subtree** the list's fields are emptied when the subtree
  unmounts, so it is built afresh when it mounts again.
* **Immutable updates** are what make the list re-render: see "Arrays and
  records".

**Runtime.** Children are sorted by `(slot, order)`: `addChild(child, slot,
order = 0)` and `queueAddChild(child, slot, order)` insert after every sibling
with a lower slot, or the same slot and a lower or equal order.
`queueReorder(slot, children)` queues a new order: at commit each child's
order becomes its index in `children` and the children are re-sorted (stably,
so only that slot's range moves). Static siblings before and after the list
keep their places because they have their own slots. Generated code queues
removals and adds before the reorder.

## Children

A parent passes elements to a component between its tags, and the component
decides where they mount (M8):

```tsx
import { type Child, Entity, Sprite } from "@rge/runtime/jsx";

interface PanelProps {
  title: string;
  children: Child;
}

function Panel({ title, children }: PanelProps) {
  return (
    <Entity name="Panel">
      <Sprite image={title + ".png"} />
      <Entity name="Content">{children}</Entity>
    </Entity>
  );
}

function Hud() {
  const [score, setScore] = useState(0);
  return (
    <Entity name="Hud">
      <Panel title="hud">
        <Coin value={score} />
        {score > 10 && <Sprite image="star.png" />}
      </Panel>
    </Entity>
  );
}
```

**The parent owns what it passes.** The elements are fields of `Hud`, built
from `Hud`'s state and props and updated in `Hud`'s `render()`, exactly as if
they were `Hud`'s own children: `<Coin value={score} />` follows `score`
without `Panel` knowing, and `{score > 10 && …}` is a conditional child of
`Hud`. `Panel` only says where they mount, so a passed child's `transform` is
relative to the container that holds `{children}`.

**Receiving** (`RGE1208`/`RGE1202` otherwise):

* The props type declares `children: Child` (`import { type Child }`).
  `children` is not a value prop: it has no `PropDeclIR`, and cannot have a
  default or be read as a value (`RGE1301`). `ComponentIR.acceptsChildren` is
  set, and the runtime props type becomes `Omit<PanelProps, "children">`, so
  `new Panel({ title })` needs no `children`.
* `{children}` (or `{props.children}`) is a direct child of a container, once.
  The container is the root, a fragment, or a static `<Entity>` below it:
  not inside a condition, a list, a block passed to another component, or a
  built-in that cannot have children. A declared `children` that is never
  rendered is an error. Forwarding to another component
  (`<Box>{children}</Box>`) is not supported yet.
* IR: a `ChildrenSlot` child takes the slot's position among its siblings, so
  the siblings are attached with explicit slots (`addChild(child, 0)`,
  `addChild(footer, 2)`).

**Passing.** The children of a component element are lowered into its
`ElementIR.children` as static children, conditional children, or a keyed
list, owned by the parent. A list must be the only child of the block (its
items and other children would share positions); children on a list item are
not supported yet, and `children={…}` as an attribute is `RGE1203`. Whether
the receiver renders `{children}` is its own file's business: the source
type-check catches `<Leaf>…</Leaf>` for a props type without `children`
(`RGE9002`), and the runtime throws a clear error if a component that does not
render `{children}` is given some.

**Generated code.** The receiver records where passed children mount, in its
constructor, after its own children are wired:

```ts
export class Panel extends Entity<Omit<PanelProps, "children">> {
  constructor(props: Omit<PanelProps, "children">) {
    super({ name: "Panel" }, props);
    this.addChild(this.sprite, 0);
    this.addChild(this.entity, 1);
    this.passedChildrenHost = this.entity;   // the container holding {children}
    this.passedChildrenSlot = 0;             // the slot's position among its children
    …
```

and the parent mounts into it by order (the child's position in the block):

```ts
this.panel.attachPassedChild(this.coin, 0);                // static, in the constructor
this.panel.queueAttachPassedChild(this.sprite, 1);         // a condition turning on
this.panel.queueDetachPassedChild(this.sprite);            // and off
```

A list passed as the children uses `queueAttachPassedChild(item, position)`,
`queueDetachPassedChild` and `queueReorderPassedChildren`. When a conditional
`<Panel>` unmounts, its passed children go with it and the parent's fields
reset, so remounting builds them afresh.

**Runtime.** `GameObject` has `passedChildrenHost` / `passedChildrenSlot`
(protected, set by the generated receiver) and `attachPassedChild`,
`queueAttachPassedChild`, `queueDetachPassedChild` and
`queueReorderPassedChildren`, which add to the host at `(slot, order)` (see
"Keyed lists"). The parent never needs the receiver's slot index, so a
component from another file works.

## Prefabs and scenes

A prefab is an exported component plus a description of its props, so data
files (not only TSX) can place components in a world (M6). Three pieces:

* **Registry.** Every module that exports a component gets, after its classes
  (`ComponentIR.isExported`: `export function`, or the default export):

  ```ts
  export const prefabs = {
    Enemy: {
      create: (props: ConstructorParameters<typeof Enemy>[0]) => new Enemy(props),
      props: [
        {"name":"speed","type":{"kind":"Primitive","name":"number"},"optional":false,"settable":true},
        {"name":"tint","type":{"kind":"Literals","values":["red","blue"]},"optional":true,"settable":true,"default":"red"},
      ],
    },
  } satisfies Record<string, PrefabDefinition>;
  ```

  `ConstructorParameters` types `create`, so the props interface need not be
  exported; a component without props gets `create: () => new X()`. `props` is
  built from `PropDeclIR` / `PropTypeIR`: value props only (a callback cannot
  come from data, and `children` is passed, not set). A prop whose type the
  compiler cannot describe as data (`SourceText`) is listed with
  `settable: false`: it is code-only. A default is included when it is a
  constant the compiler can evaluate (`constantValue`).
* **Project outputs.** Next to the per-file outputs, the CLI writes
  `prefabs.ts` (every module's `prefabs`, merged, for `loadScene`) and
  `prefabs.json` (`{ version, prefabs: { Name: { module, props } } }`, for
  editors and validators). Both are written only when every file compiled: with a
  failure they would silently leave a component out, so the CLI skips them and
  says so (the files that did compile are still written, as before). It also
  checks the whole project: an exported name used in two files is `RGE1206`
  (scenes refer to prefabs by name), and a static cycle through several files is
  `RGE1205`. A flag that needs a value (`--scenes`, `--runtime`) without one, an
  unknown option, and a source or scenes directory that does not exist are usage
  errors (exit 2), not silent no-ops: CI must not pass without having checked the
  scenes it was told to check.
* **Scenes.** JSON: `{ "version": 1, "entities": [{ "id", "prefab", "props"?,
  "transform"?, "children"? }] }`. `id` is author-assigned, unique in the
  scene and stable across edits (for diffing and hot reload). `transform` is
  `x`, `y`, `rotation` (radians), `scaleX`, `scaleY`, `global`.

**Validation.** `rge-compile <src> <out> --scenes <dir>` validates every
`.json` in the directory against the compiled prefabs, after the project
compiles (a broken project would only produce unknown-prefab noise). The scene
is parsed into an AST (the JSON `ScriptKind`), so every diagnostic carries the
file, line and column of the offending value, and its JSON path in the message
(`entities[1].props.speed: Expected a number, got the string "fast"`):

| Code | Meaning |
| --- | --- |
| `RGE1501` | not valid JSON (with the parser's position) |
| `RGE1502` | not the scene format: version, missing or unknown keys, wrong container, no `id` or `prefab` |
| `RGE1503` | unknown prefab (lists the known ones) |
| `RGE1504` | unknown prop (says callbacks cannot be set) |
| `RGE1505` | missing required prop |
| `RGE1506` | wrong type: a prop value, an array element, a literal not in the union, a transform field |
| `RGE1507` | a prop data cannot express |
| `RGE1508` | duplicate `id` (nested entities included) |
| `RGE1509` | Tiled import: an unreadable map, or an object or property it cannot turn into an entity |

A problem does not stop the walk, so one run reports them all.

**Tiled.** A `.tmj` in the scenes directory is imported to
`<out>/scenes/<name>.scene.json`, which is then validated like any scene
(positions in those diagnostics point at the generated file). Object layers
only; tile layers are a renderer concern. Each object becomes an entity whose
prefab is its `class` (older Tiled: `type`) and whose props are its custom
properties (`bool`, `int`, `float`, `string`, `file`, `color`; `object` and
`class` properties are `RGE1509`). Ids are `"<layer name>/<object id>"`, stable
across edits in Tiled; group layers flatten. `rotation` is converted from
degrees to radians. A tile object (one with a `gid`) is anchored at its bottom
left in Tiled, an entity at its top left, so the importer moves the anchor
along the object's own rotated up axis. An object with no class is skipped
with a warning. A layer's `offsetx` / `offsety`, and those of every group it is in,
shift its objects, because Tiled shows them there. Not handled: Tiled's `visible` flag (a hidden object is still an
entity), tile flip flags in a `gid`, whether an `int` property is whole, and
properties inherited from object templates.

**Runtime.** `loadScene(world, scene, prefabs)` builds each entity with
`create(props)`, copies `transform` onto its **`placement`** (so the component's
own state-driven `transform` composes on top: a placed `Mover` still moves
relative to its spawn point), and gives it its `children` *before* anything is
mounted, so every object mounts once, children first. A child goes to the
`{children}` slot of a component that renders one (`acceptsPassedChildren`),
and is otherwise appended after the component's own children. It returns a
`Map` of every object, nested ones included, by scene id; an editor or hot
reload can key on that. It checks only that a prefab exists and an id is not
repeated: validating props is a build step, so the runtime stays small.

**Two ways to the same tree.** A scene is data; a component that composes
prefabs is code. Both build the same objects, and a test compares the tree a
scene builds with the one the equivalent TSX builds (type, props, placement,
transform, children).

## Text

`<Text>` (M10) is a leaf built-in for HUDs, labels and menus. Its content is
the text between its tags or its `text` prop, which are the same thing:

```tsx
<Text size={12} color="gold" transform={{ x: 8, y: 8 }}>Score: {score}</Text>
<Text text={`Score: ${score}`} size={12} />
```

**Runtime.** `Text extends GameObject` with `text`, `size` (default 16) and
`color` (default `"white"`) as fields. The mock draws nothing: a renderer reads
the fields and `worldTransform()`. It is listed in the manifest's `intrinsics`
and `transformIntrinsics`, requires `text` (`intrinsicRequired`), and names the
prop its children become in the new `textContent` entry (`{ Text: "text" }`),
which is what makes an intrinsic take JSX text instead of elements.

**Compiler.** JSX text is not supported anywhere else, so the transform folds
a `Text`'s children into one string prop (`#lowerTextContent`): text and
`{expressions}` become a `TemplateLiteral`, a `StaticProp` when nothing in it
varies and a `DynamicProp` (with its dependencies) when it reads state or
props. A lone `{`template`}` is used as it is; string and number literals fold
into the surrounding text; comments are ignored. Whitespace follows React: each
line is trimmed, blank lines are dropped and lines join with one space, so
whitespace containing a line break disappears (`{n}` then `points` on the next
line is `5points`; write `{n}{" "}` or keep them on one line for a space).
HTML entities (`&amp;`) are `RGE1202`, since JSX would decode them and the
compiler does not. Elements inside a `Text`, both forms at once, and neither
form are errors (`RGE1202`, `RGE1203`, `RGE1202`). The generator needs
nothing special: the content is an ordinary prop, so
`this.text.text = \`Score: ${this.score}\`` is a plain assignment in
`render()`, the `Text` keeps its identity, and a change costs the component's
one render.

**Authoring types.** `Text` takes either `text: string` or `children: string |
number | (string | number)[]` (`TextAttributes`), so the source type-check
rejects a `<Text />`, both forms, an element child, a boolean child and a
non-string `text`.

**As a root.** A component may be a `Text`
(`const Badge = ({ points }) => <Text>+{points}</Text>`): the class extends
`Text`, `text` is a required constructor prop that a dynamic root gets a
placeholder for (as `Sprite.image` does), and `text`, `size` and `color` become
names a state, ref or prop may not use.

## Shape

`<Shape>` (M11) is a filled rectangle or circle, for debugging colliders and
prototyping before art exists:

```tsx
<Collider width={20} height={20} />
<Shape kind="rect" width={20} height={20} color={hp <= 0 ? "gray" : "red"} />
```

**Runtime.** `Shape extends GameObject` with `kind` (`"rect" | "circle"`),
`width`, `height` and `color` (default `"white"`) as fields. The mock draws
nothing: a renderer reads the fields and `worldTransform()`; the origin is the
top-left corner, as for a `Sprite`, and a circle's `width` and `height` are the
diameters across (an ellipse when they differ). `kind`, `width` and `height` are
required (`intrinsicRequired`), and the shape is in `transformIntrinsics`, so
it follows its parent like any object. Every field updates in place.

**A fixed set of values, from the manifest.** The kinds come from the runtime
(`SHAPE_KINDS`), and the manifest's `intrinsicLiterals`
(`{ Shape: { kind: SHAPE_KINDS } }`) tells the compiler which built-in props
take one of a fixed set of strings. A *literal* for such a prop is checked in
the transform, so a misspelt kind is a compiler diagnostic that names the
choices rather than a type error in generated code:

```
<Shape kind> must be one of "rect", "circle", not 'rectangle' (did you mean "rect"?).   RGE1210
```

The suggestion appears for a plausible typo: a prefix either way (`rectangle`,
`circ`) or at most two edits (`circel`), case ignored. A non-string literal
(`kind={3}`, a bare `kind`) is the same error. Any other expression
(`kind={big ? "circle" : "rect"}`) is left to the type-check: `ShapeProps` types
`kind` as the union, so a bad literal inside an expression is `RGE9002` in the
source and `RGE9001` in generated code. The rule is not specific to `Shape`:
restricting another built-in's prop is a manifest edit (a test does it to
`Sprite.image`).

**As a root.** A component may be a `Shape`
(`const Dot = ({ size }) => <Shape kind="circle" width={size} height={size} />`):
the class extends `Shape`, the required props that vary get the usual
constructor placeholders, and `kind`, `width`, `height` and `color` become names
a state, ref or prop may not use.

## Pointer

`<Pointer>` (M14) is a hit area for presses, positioned with `transform`:

```tsx
<Shape kind="rect" width={48} height={16} color="gray" />
<Pointer width={48} height={16} onPress={() => setOpen(!open)} />
```

`Pointer extends GameObject` with `width`, `height` (both required) and
`onPress`. It draws nothing, and its origin is the top-left corner. `contains(x, y)`
takes a world-space point back through the pointer's world position, rotation
and scale, so a moved, turned or scaled pointer is hit where it is drawn; a zero
scale is never hit, and neither is an area with no size (`width` or `height` of 0, or not a number), so a button
that collapses to nothing stops firing. The test assumes the usual composition of scales and rotations; a rotated
object under a non-uniformly scaled ancestor is sheared by a renderer that applies transforms one by one (see
`composeTransforms`), and is only approximated. `onPress` takes no parameters, and the manifest says so
(`intrinsicCallbacks`). It is a leaf.

**Cameras.** `reportPress` takes a **world-space** point. A pointer drawn through a `<Camera>` is on screen where
the camera's view puts it, so an input system converts a screen point first: `camera.viewToWorld(x, y)`.

## Camera

`<Camera>` (M12) is the viewport. Its own transform is the view, `zoom`
(default 1, must be positive) magnifies, and **it follows its children**:

```tsx
<Camera zoom={wave > 5 ? 2 : 1}>
  <Player />
</Camera>
```

**The view.** A renderer draws the world through the inverse of the camera's
world transform, so moving the camera pans the view, turning it turns the view
the other way, and scaling it up shows more of the world; `zoom` then magnifies.
`viewTransform()` returns that map as a canvas-style matrix (`x' = a·x + c·y +
e`, `y' = b·x + d·y + f`), and `worldToView` / `viewToWorld` apply it and its
inverse (the second turns a click into a world position). The point the camera
is at lands on the centre of the viewport: the renderer knows the viewport's
size, the camera does not. Moving a camera never changes any object's
`worldTransform()`: the view is applied on top of the world, not into it.
Reading the view with a zoom that is not positive, a scale of 0, or a position,
rotation or scale that is not finite throws a `RangeError` (the view would be
singular or NaN). Assigning one does not throw: a prop that varies with state can
pass through such a value, and throwing inside `render()` would abort a flush
partway through the tree, so the error surfaces where the view is read, which is
the renderer. `viewTransform()` recomputes from the tree each call, so it is
never stale; a renderer should fetch it once per frame and apply it to
everything, rather than call `worldToView` per point.

**Following its children.** The camera is a container (`containerIntrinsics`),
and the view is centred on its children: on the player in `<Camera><Player
/></Camera>`, wherever the player's own state moves it. With several children it
centres on the middle of their world positions; conditional children and a
list (`<Camera>{units.map(…)}</Camera>`) work as anywhere, and the view moves as
they come and go. This replaces what the plan sketched, `<Camera follow={hero} />`:
that needed a way for a component to name another object, which nothing in the
language provides (element refs were removed in M3 and state holds data, not
objects), and wrapping the target says the same thing with nothing new.

**The camera is transparent to its children.** Following a child that the camera
also moves would be circular (the child's position would depend on a camera that
depends on it), so the camera does not move its children: they are placed in the
camera's *parent's* space, exactly as if the camera were not there. This is one
runtime hook, `GameObject.childSpace()` (the space an object's children are
placed in; its own world transform by default), which `worldTransform()` uses
and `Camera` overrides. So `<Entity transform={{ x: 100 }}><Camera><Player
transform={{ x: 10 }} /></Camera></Entity>` puts the player at 110, and the
camera's own `transform`, `placement`, `zoom` and `global` never touch it.

**The camera's own transform** is an offset from the followed point: the
camera's anchor (its parent's position, or the origin when it has no parent or is
`global`) moves to the children's centre, and the camera keeps its own offset from
that anchor, transformed as usual by its parent. So the offset means the same
thing with or without children, and adding a child at the parent's own position
changes nothing. The camera's rotation, scale and zoom stay its own. With no
children it is simply where its transform puts it, as before, and a camera
*inside* an entity (`<Entity><Camera /></Entity>`) still moves with it by
ordinary transform nesting.

**Through `{children}`.** A component can wrap its children in a camera
(`const Rig = ({ children }) => <Camera zoom={3}>{children}</Camera>`), and
`<Rig><Runner /></Rig>` follows the runner: passed children mount in the camera
(M8).

**As a root.** A component may be a `Camera`
(`const View = ({ zoom }) => <Camera zoom={zoom} />`): the class extends
`Camera`, and `zoom`, `viewTransform`, `worldToView`, `viewToWorld` and
`childSpace` become names a state, ref or prop may not use.

## AnimatedSprite

`<AnimatedSprite>` (M13) is a sprite that cycles through a list of images:

```tsx
<AnimatedSprite frames={running ? ["run1.png", "run2.png", "run3.png"] : ["idle1.png"]} fps={8} playing={running} />
```

**Runtime.** `AnimatedSprite extends GameObject` with `frames`, `fps` (default
10), `playing` (default true), and the current `frame` index and `elapsed`
time. A renderer reads `image`, the current frame, as it reads a `Sprite`'s. It
advances in its own `onUpdate(dt)`, which the `World` calls every tick because
the class overrides it (the existing registration rule); it loops, carries the
remainder of a step, and takes several frames from one long `dt`. A non-positive
or non-finite `fps`, and an empty `frames`, freeze it rather than throw, since
this runs inside `World.tick`. **Playing is not state**: advancing a frame
re-renders nothing, so an animation costs no renders.

**Frames.** `frames` is an array prop. The array literals M5a added make it
writable in source, and it follows the usual rule: a fixed list is built once
(a `StaticProp`), a list that reads state or props is re-assigned in `render()`
(a `DynamicProp`). A dynamic list is a *new array every render*, so `frames` is
an accessor that compares contents: **different contents restart at the first
frame** (and clear the carried time); **equal contents change nothing**, so an
unrelated state change that makes the component render again does not restart the
animation. It keeps its own copy, so mutating the caller's array later changes
nothing. `playing={false}` freezes on the current frame, saves up no time, and
resumes from there.

**A built-in that implements a hook.** This is the first built-in with an
`onUpdate` of its own, which exposed a hazard: a component *rooted* at an
`AnimatedSprite` that writes its own `useUpdate` generates `override
onUpdate(dt)`, which would replace the sprite's and silently stop the animation.
The manifest's `intrinsicHooks` (`{ AnimatedSprite: ["onUpdate"] }`) lists the
hooks a built-in implements itself, and the generated override calls `super`
first, with the hook's own parameters:

```ts
override onUpdate(dt: number): void {
  super.onUpdate(dt);          // the sprite advances its frame
  this.#onUpdate0();           // then the component's own handlers, in order
}
```

A hook the root does not implement is generated as before (no `super`, no
churn in existing output), and a runtime test checks the list is exactly the hooks
the intrinsic classes override, so a new one cannot be forgotten. A component
rooted at the sprite also cannot name state `frames`, `fps`, `playing`, `frame`,
`elapsed` or `image`.

## Transforms and refs

Components should read like React: what is on screen, position included, is a
function of state. So there is no transform hook: position is ordinary state,
written with a `transform` attribute on a built-in element.

```tsx
function Mover() {
  const [x, setX] = useState(0);
  useUpdate((dt) => {
    setX((previous) => previous + 60 * dt);
  });
  return (
    <Entity name="Mover" transform={{ x, y: 0 }}>
      <Sprite image={x > 100 ? "run.png" : "idle.png"} />
    </Entity>
  );
}
```

```ts
export class Mover extends Entity {
  x: number = 0;
  #xNext: number = this.x;       // pending value written by setX
  readonly sprite: Sprite = new Sprite({ image: (this.x > 100) ? "run.png" : "idle.png" });
  constructor() {
    super({ name: "Mover" });
    this.transform.y = 0;          // static fields: set once
    this.addChild(this.sprite);
    this.render();
    this.commitStructure();
  }
  override commitState(): void { this.x = this.#xNext; }
  override onUpdate(dt: number): void { this.setX((previous: number) => previous + (60 * dt)); }
  override render(): void {
    this.transform.x = this.x;     // dynamic fields: re-applied on render
    this.sprite.image = (this.x > 100) ? "run.png" : "idle.png";
  }
}
```

**The transform attribute**: `transform={{ x, y: 0, rotation: angle }}` is an
object literal whose keys are transform fields (`x`, `y`, `rotation`,
`scaleX`, `scaleY`, `global`; plain or shorthand properties). Each field lowers exactly
like a prop: a field that reads no state is a `StaticProp`, set once right
after the element is constructed (and, for a child, before it is attached);
one that reads state is a `DynamicProp`, re-applied in `render()`. Fields not
listed keep the runtime defaults (`0, 0, 0, 1, 1`, not global). The runtime
`transform` object is never replaced. Units: pixels with y down,
rotation in radians.

**Relative by default**: every runtime object (`GameObject`) has a transform,
relative to its parent's (the World's root is the identity). A
child at `{ x: 10 }` inside a parent at `{ x: 100 }` is at 110, and it turns
and scales with the parent: the child's position is scaled, then rotated, by
the parent and added to the parent's position; rotations add, scales
multiply per axis. `global: true` (default `false`) puts the transform in
world space, ignoring every ancestor; its own children are relative to it as
usual. `global` is an ordinary field, so it can come from state
(`transform={{ x, global: pinned }}`). The runtime resolves this in
`GameObject.worldTransform()`, which is what a renderer reads; the compiler only
writes local fields.

Every built-in element the runtime manifest lists in `transformIntrinsics`
takes the attribute (today all eight); one left out gets `RGE1207`. On a
component element (`<Enemy transform={…} />`) it is placement by the parent,
which composes with the child's own root transform (see "Placement" under
"Props and callbacks"). Malformed objects (spreads,
computed keys, unknown or duplicate fields) are `RGE1207`. `useTransform` was
removed; calling it reports `RGE1102` with a pointer to the attribute
(`RGE1105` is retired).

**Cost**: moving every frame is a state change every frame, so the component
renders once per tick (one render however many setters ran). `render()`
re-evaluates all of the component's dynamic props; the IR already records each
prop's `dependencies`, so a later optimisation can re-evaluate only the props
whose state changed.

**useRef** (values that never render): `const cooldown = useRef(0)` (or
`useRef<number>(0)`; types as for `useState`) is a value that persists across
frames but is not state. `RefIR { id, name, type, initialValue }` in
`ComponentIR.refs` compiles to a plain field (`cooldown: number = 0`);
`cooldown.current` reads it (`RefRead`) and `cooldown.current -= dt` writes it
(`Assign` with a `RefCurrent` target). Neither marks anything dirty, so a ref
is for bookkeeping nothing on screen depends on: timers, accumulators,
previous values. Refs do not point at elements or components: what is on
screen is driven by state and props, so `ref={…}` on any element is `RGE1106`
(`RGE1404`, which guarded writes through element refs, is retired). The
initial value must not read state, and a ref name must not clash with state
(`RGE1106`).

**Reads only in handlers**: `ref.current` in JSX, a `useState` initialiser or
a derived `const` would be evaluated at render and then go stale, because
changing a ref never renders. That is `RGE1304`. Use state for anything JSX
depends on.

**useSound** (M15): `const playHit = useSound("hit.wav")` binds a sound, and
`playHit()` as a statement in a handler (`useUpdate`, `useInput`, `useMount`,
`onCollisionEnter`, `onPress`, a callback inside an `if`) plays it. It is a
top-level hook like `useRef`, with one binding per call, so two bindings of the
same path are independent. The path is a string literal (`RGE1107` otherwise),
so a missing asset can be reported at build time once there is an asset list.
`SoundIR { id, name, path }` in `ComponentIR.sounds` compiles to a field
(`readonly playHit: Sound = new Sound("hit.wav")`), and the call is a
`PlaySound` statement, emitted as `this.playHit.play()`. Playing is an effect,
not state: it happens at once, not at the next render, and marks nothing
dirty. Because it would play on every render, the function may only be called
as a statement in a handler: in JSX, a derived `const`, an expression, as a
value (`onCollisionEnter={play}`) or with arguments it is `RGE1305`. Sounds
are not placed, so they do not take `transform`. `Sound` has no
audio of its own: `play()` counts calls in `plays`, so game logic can be tested, and reports to the
`SoundSink` a player installs with `setSoundSink` (see "Player").
Options such as `volume` come later.

## Props and callbacks

A parent passes values and callbacks to a local or imported component. A changed
value updates the existing child instance in place; the child is never recreated.

```tsx
interface EnemyProps {
  speed: number;
  tint?: "red" | "blue";
  onDefeated?: () => void;
}

function Enemy({ speed, tint = "red", onDefeated }: EnemyProps) {
  useUpdate(() => { if (hp <= 0) onDefeated?.(); });
  return <Entity name="Enemy"><Sprite image={tint === "red" ? "red.png" : "blue.png"} /></Entity>;
}

function Level() {
  const [score, setScore] = useState(0);
  return (
    <Entity name="Level">
      <Enemy speed={score > 10 ? 2 : 1} onDefeated={() => setScore((score) => score + 1)} transform={{ x: 40 }} />
    </Entity>
  );
}
```

**Declaring props.** One parameter, destructured, annotated with the name of
an `interface` or `type` object type in the same file (`RGE1208` otherwise: no
rest, renaming, generics or `extends`). Defaults in the destructuring make a
prop optional and must be constants. `key`, `ref`, `transform` and `children`
are reserved and cannot be prop names. The declaration is copied into the
generated module as written (exported), so the type-check validates it. Each
member is also described structurally (`PropDeclIR`: name, optional, default,
role, and a `PropTypeIR` of number/string/boolean, literal unions, arrays,
function or source text) so a scene schema (M6) needs no type checker.

**Value or callback** is decided by the type: a function type or method
signature is a callback, anything else a value. A value reads as `this.props.x`
(`PropRead`). A callback is only called (`onDefeated?.()`, `CalleeIR` `Prop`)
or forwarded whole (`onDone={onDone}`); reading it as a value, or calling a
value, is `RGE1301`.

**The child's class** extends `Entity<EnemyProps>`, so `this.props` is
available to field initialisers, which run right after `super()` returns:

```ts
export class Enemy extends Entity<EnemyProps> {
  constructor(props: EnemyProps) {
    super({ name: "Enemy" }, props, { tint: "red" });   // props and defaults, copied by the runtime
    …
  }
  updateProps(next: Partial<EnemyProps>): void {
    if (this.applyProps(next, { tint: "red" })) this.markDirty();   // === per key; an undefined update restores the default
  }
}
```

When every prop is optional the constructor parameter defaults to `{}`, so a
parent may write `<Badge />`.

**The parent** builds the child with every value prop (static or dynamic) and
its callbacks in the constructor call, and re-sends only the dynamic ones, in
one call, from `render()`:

```ts
readonly enemy: Enemy = new Enemy({ speed: (this.score > 10) ? 2 : 1, onDefeated: () => { this.setScore(…); } });
…
this.enemy.updateProps({ speed: (this.score > 10) ? 2 : 1 });
```

A changed prop marks the child dirty, and it renders in the same `World.flush()`
as the parent: one render each, same instance. A callback is an arrow created
once in the field initialiser, so it reads state through `this` and never goes
stale; it is therefore never re-sent. Its parameters are unannotated
(`Contextual`), so TypeScript types them from the child's props type, which the
parent (compiling one file at a time) cannot see. A function passed to a
built-in, `key` and `children` are errors (`RGE1203`, `RGE1202`).

**Reads.** A prop may be read in JSX, conditions, derived values, handlers,
`transform` fields, and the initial value of `useState` / `useRef` (read once,
at construction, as in React); a `useState` initial that is a primitive prop
takes its type from the prop's declaration. State and refs are unchanged.

**Placement.** `transform` on a component element sets the child's
`placement`, which composes under the child's own `transform`
(`world = parent × placement × transform`). `<Mover transform={{ x: 200 }} />`
starts at 200 and moves from there; nothing can conflict, because the parent
and the child write different transforms. `global` works at either level. The
attribute is reserved like `key`, so the component's props type never declares
it; the JSX types accept it on every element.

`children` is passed between elements, `<Panel>…</Panel>`: see "Children".

## Roots and component forms

**Forms.** A component is a `function` declaration or a `const` arrow
function; either may be `export`ed, and one per module may be the default
export (`export default function Enemy() {}`, or `export default Enemy;`
after the declaration). A default export needs a name, because the generated
class has one. The importer picks the local name: `import Monster from
"./Enemy.tsx"` (alone or with `{ Boss }`) puts `Monster` in the generated
import and in `new Monster(…)`, and the generated module ends with
`export default Enemy;`. An arrow with an expression body is just its return.

**Props as an object.** `function Enemy(props: EnemyProps)` reads each prop as
`props.speed` and calls callbacks as `props.onDefeated?.()`; the bare `props`
cannot be used (no passing it on, no spreading). It lowers exactly like
destructuring, but there is nowhere to write a default, so none is applied.
Every member of the props type is a prop.

**Roots.** The root is a built-in element, and the generated class extends it:

```tsx
const Coin = ({ value }: CoinProps) => <Sprite image={value >= 5 ? "gold.png" : "coin.png"} />;
```

```ts
export class Coin extends Sprite<CoinProps> {
  constructor(props: CoinProps) {
    super({ image: undefined as never }, props);   // a dynamic required prop: a placeholder here,
    this.render();                                  // its real value in the first render
    …
```

so a coin is a `Sprite`, with no container around it, and a parent places it
like any component. Details:

* A fragment root `<>…</>` is an implicit `Entity` with no props, and needs no
  `Entity` import because the author never wrote it.
* Every built-in passes `(hostProps, props, defaults)` up to `GameObject`,
  which owns `props` and `applyProps`, so any of them can be a root with props.
* A built-in constructor may require a prop (for example `Sprite.image`, `Collider`
  `width`/`height`; the manifest's `intrinsicRequired`). `super()` runs before
  state exists, so when such a root prop is dynamic it gets `undefined as never`
  there and its real value in the first `render()`, which the constructor runs.
* The class gains the root's own fields, so a state, ref or prop may not take
  those names (`image` for a Sprite root, `width`/`height`/`onCollisionEnter`
  for a Collider root, `width`/`height`/`onPress`/`contains` for a Pointer root, `name` for an Entity root; the other
  built-ins' sections list theirs): the manifest's `intrinsicMembers`, `RGE1103`.
* Only containers (the manifest's `containerIntrinsics`, today `Entity` and `Camera`) may
  have JSX children; a child under a leaf such as a `Sprite`, `Collider` or `Pointer`, at the root or
  anywhere, is `RGE1202`. A component as a root (`return <Other />`) is
  `RGE1003`; a fragment nested as a child is `RGE1202`.

**Element callbacks.** `<Pointer onPress={() => …} />` is the same mechanism with no parameters.

**Collider callbacks.** `<Collider width={16} height={24} onCollisionEnter={(other) => …} />`
is a callback prop on a built-in, which the manifest lists in
`intrinsicCallbacks` along with its parameters (`other: GameObject`, a handle
type). It lowers to the same `CallbackProp` a component receives, with
annotated rather than contextual parameters, and the runtime calls the
collider's own callback (see "Collisions"). On a child element it is created in
the field initialiser. On a root it is assigned after `super()`
(`this.onCollisionEnter = …`), because an arrow that uses `this` cannot be made
inside the call to `super`. A function on any other built-in, or an unknown
callback name, is `RGE1203`.

## Code generation

Generated output for the example above (abridged):

```ts
export class Player extends Entity {
  health: number = 100;
  readonly sprite: Sprite = new Sprite({ image: (this.health > 50) ? "normal.png" : "hurt.png" });
  warningIcon: WarningIcon | null = null;
  constructor() {
    super({ name: "Player" });
    this.addChild(this.sprite, 0);
    this.render();
    this.commitStructure();
  }
  setHealth(value: number | ((previous: number) => number)): void { … this.markDirty(); }
  override render(): void {
    this.sprite.image = (this.health > 50) ? "normal.png" : "hurt.png";
    if (this.health < 25) {
      if (this.warningIcon === null) { this.warningIcon = new WarningIcon(); this.queueAddChild(this.warningIcon, 1); }
    } else if (this.warningIcon !== null) {
      this.queueRemoveChild(this.warningIcon);
      this.warningIcon = null;
    }
  }
}
```

Decisions:

* **String emission via a small indenting writer, not `typescript/ast/factory`.**
  The factory builds nodes locally but printing goes through the remote
  printer, and the factory API is large and still moving in 7.x betas. A writer
  keeps the generator synchronous, dependency-free and easy to read. Every
  compound sub-expression is parenthesised when emitted from `ExprIR`, so
  precedence can never be wrong. Correctness is enforced by type-checking the output with the
  real compiler. Revisit if we need source maps (the factory/printer route
  would give them for free).
* **Static children are `readonly` field initialisers**, so "never recreated"
  is enforced by the type system, not just by convention.
* **Conditional children are nullable fields**; descendants of a conditional
  are nullable too and are created together when it mounts and nulled when it
  unmounts.
* **Dynamic props are plain assignments** to the existing instance
  (`this.sprite.image = …`). The runtime's intrinsics expose their props as
  public fields, and the type checker validates prop names and types.
* **Structural changes are queued** (`queueAddChild` / `queueRemoveChild`) and
  applied by `World.flush()` after all dirty objects have rendered, so render
  never mutates the tree it might be iterating.
* **Children keep source order.** Child order is draw order. When a parent has
  a conditional child, every child is attached with its *slot* (its index in
  the parent's JSX children: `addChild(child, 0)`, `queueAddChild(child, 1)`),
  and the runtime inserts after every sibling with a lower or equal slot, so a
  conditional that mounts later lands between its source siblings instead of
  at the end. Children attached without a slot (`World.mount`, later scene
  loading) go after all slotted ones. Parents with only static children pass
  no slot: appending in source order is already correct. A keyed list's
  items share the list's slot and are ordered within it (`(slot, order)`, see
  "Keyed lists"). The constructor runs `render()`
  then `commitStructure()` so a freshly constructed object is complete.
* The generated class extends the root element's runtime class (`Entity` for
  an `<Entity>` or fragment root, `Sprite` for a `<Sprite>` root, …), not bare
  `GameObject`, because the root's props (e.g. `name`) belong to the instance.

## Runtime manifest

`packages/runtime/src/manifest.ts` exports `runtimeManifest`, the one place
that says what the runtime provides: the intrinsic tag names, the host
intrinsic generated classes extend, the member names of that class that
generated fields must not shadow (`reservedMembers`), the handle types handler
parameters may have (`InputState`, `GameObject`) with their readable members,
the runtime functions handler code may call (`clamp`), and which built-ins take
their JSX text as a prop (`textContent`), which of their props take one of a
fixed set of strings (`intrinsicLiterals`), and which hooks they implement
themselves (`intrinsicHooks`, so a component rooted at one calls `super`). The compiler takes
it as `CompilerConfig.manifest` (default: the runtime's own), so adding an
intrinsic or a handle type is a runtime-only edit. A runtime test fails if a
member inherited from `Entity` is missing from `reservedMembers`. The `Math.*`
allowlist is language-level and stays in the compiler (`transform/handles.ts`).

## Components across files

The analyzer records relative `.tsx` named imports; the transform resolves a
tag to `Intrinsic`, `Local` or `Imported { name, module }` (name clashes between
the three are `RGE1206`). The generator imports each name once per module and
rewrites the specifier to the generated file (`./WarningIcon.tsx` →
`./WarningIcon.ts`). The CLI compiles every file in a directory and type-checks
all outputs together, so a broken cross-file reference is caught there. A
parent needs nothing about an imported child's props: it passes what it writes,
and the project type-check validates it against the child's own props type (a
missing or mistyped prop is `TS2741` / `TS2322` in the generated parent).
Static cycles through several files (`A` contains `B` contains `A`) are found
by the CLI's whole-project check, which follows imports (`RGE1205`); the
transform still reports the ones inside a file. Only static containment
counts: a component that mounts the other conditionally is fine.

## Runtime (mock)

`packages/runtime` is deliberately minimal: `GameObject` (tree, transforms,
dirty flag, queued structure ops, passed-children slots, hook methods), `World`
(dirty queue, `flush`, `tick`, `reportCollision`, `reportPress`), the eight
intrinsics with public prop fields, the `Sound` mock, `loadScene`, input
helpers and the manifest. It has no rendering, physics, input or audio
backend; the compiler only knows what the manifest tells it.

`commitStructure()` also settles children it has just attached, so a freshly
constructed object whose nested conditions are true has its whole subtree
attached without a `World`.

## Player

`@rge/player` (Phase 3, [NATIVE_PLAN.md](NATIVE_PLAN.md)) is the pure-TypeScript half of the native
player. It draws nothing itself: it turns the object tree into one flat buffer of draw records per
frame, hands it to a `Backend` (a window, or a test recorder) and feeds the backend's input back to the
game. It imports nothing from Node, so it also runs in the embedded JavaScript engine of the shipped
executable. The record layout and the input buffers are `native/include/rge.h`; `protocol.ts` mirrors
it and a test keeps them equal.

```ts
run(hostBackend(), { width: 800, height: 600, title: "My game", root: () => new Level() });
```

**A frame** (`createPlayer(...).step()`), in a fixed order:

1. A new **left press** goes to the topmost `Pointer` that was under the mouse in the frame last
   drawn (`world.reportPress`). One press, one pointer; if the topmost misses, the one below is tried.
2. `world.tick(dt, input)`: `useInput`, `useUpdate`, renders, structure (as in "Handlers"). `dt` is
   what the backend measured, clamped to `[0, 0.1]` seconds so a stall cannot teleport things; the
   first frame's `dt` is 0.
3. The tree is walked once (`walkTree`, depth first) into draw records. The walk composes world
   transforms on the way down and treats a `Camera` as transparent to its children, exactly as
   `GameObject.worldTransform()` and `childSpace()` do, and a test holds the two equal over a real tree.
4. The backend draws and presents the frame, then writes the next frame's input.
   `step()` returns false once that input says the window was closed (the frame is still drawn).

**What is drawn.**

* *Order:* tree order, a parent before its children, children in their order (source order, then
  keyed-list order). Later is on top. There is no `z`.
* *Origin:* top-left, for `Sprite`, `AnimatedSprite`, `Shape` and `Text`, rotated and scaled about it.
  A negative scale flips.
* `Sprite` and `AnimatedSprite` draw `image` (the current frame) from `<assets>/<image>`; an empty
  image draws nothing. `Shape` draws a rectangle, or an ellipse filling its `width × height` box.
  `Text` draws one line with the default font at `size` pixels; empty text draws nothing.
  `Entity`, `Collider`, `Pointer` and `Camera` draw nothing.
* *Colours* are CSS: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, the named colours and
  `transparent`.
* *Never throws for art:* a texture that will not load is drawn as a magenta 16×16 square, and a
  colour that cannot be read is magenta, each with one warning. Each texture is loaded once.

**The camera.** The first `Camera` in draw order is the view (a second one is ignored, with one
warning). The point it follows (the middle of its children, or where it is) lands on the centre of the window. With no camera the world
origin is the window's top-left corner. An unusable camera (zoom 0) is dropped for the frame, with one
warning.

**Input.** `input.pressed/down/released(key)` read the backend's key flags. Keys are `"A"`–`"Z"`,
`"0"`–`"9"`, `"Space"`, `"Enter"`, `"Escape"`, `"Tab"`, `"Backspace"`, `"Shift"`, `"Control"`,
`"Alt"`, `"ArrowUp"`/`"ArrowDown"`/`"ArrowLeft"`/`"ArrowRight"`, `"F1"`–`"F12"` and the mouse buttons
`"MouseLeft"`, `"MouseRight"`, `"MouseMiddle"`; any other name is never pressed and warns once.
`input.pointerX/pointerY` are the mouse **in world space**: the window position taken back through the
view of the frame last drawn, so a handler never needs the camera. A pointer or collider mounted this
frame is not clickable until it has been drawn once.

**Sound.** `Sound` reports to a `SoundSink` (`setSoundSink`, one at a time). The player installs one
that loads each file through the backend once (when a component creates its `Sound`, so it is ready by
the time it plays) and plays by handle. A sound that cannot be loaded warns once and is silent; the
runtime still counts the play. Closing the player removes the sink.

**Hosts.** A game's entry file calls `run(hostBackend(), config)`. A host sets
`globalThis.__rgeBackend` before it loads the game, so the same file runs under Node and under the
native executable. `RecordingBackend` is the backend for tests: it keeps every frame decoded and plays
scripted input back one frame at a time.
