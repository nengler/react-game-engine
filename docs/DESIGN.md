# Compiler design

This document describes the architecture of the TSX → TypeScript game-object
compiler as it stands after Phase 2 (M0–M15), the decisions taken, and the
alternatives that were considered. It is the place to push back on a decision before more code is
built on top of it.

## Ground rules and settled decisions

A change that breaks one of these rules needs a design note first, as Phase 3's [NATIVE_PLAN.md](NATIVE_PLAN.md) was for the player. That document adds the player's own rules (the runtime stays backend-free; `@rge/player` and `@rge/runtime` import nothing from Node; `rge.h` is the source of truth for the protocol; the C side does no maths): see its [Ground rules](NATIVE_PLAN.md#ground-rules).

- **Feel like ideal React.** A component is a function of state and props, hooks follow React's conventions, and imports, `key`, and callbacks-as-props look like React's. "Ideal" means React's model, not its accidents (stale closures, dependency arrays). A feature that makes authors learn an engine-specific API where a React one exists needs a design note first.
- **IR first.** Each feature starts as new variants in the `packages/compiler/src/ir/` files (`types.ts` re-exports them all). Code is generated only from IR, never from the AST.
- **Exhaustive unions.** Add the variant, then let `assertNever` failures show every place that must handle it. Never add a `default:` that silently passes.
- **No React, no virtual DOM, no signals, no ECS, no generic reconciler.** Updates stay direct: field assignments and queued add/remove on persistent instances.
- **Hooks are compiler intrinsics.** New hooks follow the `useState` rule: top-level statement in the component body, rejected anywhere else.
- **TypeScript 7.1 only through the two adapters.** Only `parser/parser.ts` and `typecheck/typecheck.ts` import `typescript/sync`. Verify any new API against the installed `.d.ts` before use.
- **Unsupported means a diagnostic.** Never silently drop syntax. Diagnostic codes in `diagnostics.ts` are append-only.
- **Generated code must type-check.** Every feature adds a test that runs generated output through `typeCheckFiles` and one that imports and runs it against the runtime.

Decisions taken while building the compiler (Phase 2, M0–M15), each still in force:

| Decision | Choice |
| --- | --- |
| Prop and list types: copy source type text into output, or query the TS 7.1 checker through the API | Copy source text for type-checking, plus a structured `PropTypeIR` (primitives, literal unions, arrays, function, source text) for the prefab schema. A type the compiler cannot describe is a code-only prop (`settable: false`), so the "revisit for prefab schemas" case did not arise and the checker is not queried (settled in M4a/M6) |
| Input model | Per-frame `useInput` hook with polled `InputState` for devices. Events that belong to an element are callback props on that element (`<Collider onCollisionEnter>`, `<Pointer onPress>`), lowered to `CallbackProp` with parameter types from the manifest's `intrinsicCallbacks`; no separate event-prop IR variant |
| Scene format | Support both: JSON scenes validated against the generated schema, and TSX scenes that compose prefabs |
| Hook names | Hooks start with `use`, as in React: `useUpdate`, `useInput` (were `onUpdate`, `onInput`; the old names report `RGE1102`). Collision handling is a prop on `<Collider onCollisionEnter={…}>`, replacing the `onCollisionEnter` hook (decided 2026-11-08, done in M4b) |
| State reads in handlers | React's snapshot semantics: reads see the value from the last render; setters queue, updaters chain on the pending value, and `commitState()` applies them just before the render. Every handler in a frame sees the same state (decided 2026-11-08) |
| Global state | One nested store, shaped like Zustand: `GameState.ts` is real code, `export const useGame = createGameState<State>()((set, get) => ({ coins: 0, collect: () => set(…) }))`. **Access** with a selector that returns the value, `const hp = useGame((s) => s.player.hp)` (a plain path the compiler checks and subscribes to); **update** with actions that call `set` (shallow merge), picked with a selector and called in a handler. Per process, reset by the player. Primitives only for now. See "Global state" (decided 2026-11-09) |
| Refs | Refs hold values only (`const timer = useRef(0)`, or any type given as an argument, `useRef<Point[]>([])`, except one that names an element; plain fields, never render, `.current` readable only in handlers). No `ref={…}` on elements or components: what is on screen is driven by state and props (decided 2026-11-08) |
| Component forms | Arrow-function components and default exports/imports are allowed. A component may return a fragment (an implicit container) or a non-Entity root; a root may have JSX children only if its element type accepts children (decided 2026-11-08) |
| Lifecycle | `useMount(() => …)` and `useUnmount(() => …)`; no `useEffect` (decided 2026-11-08, confirmed 2026-11-12 with what replaces each of its uses: see "Why there is no `useEffect`") |
| Built-in elements | `<Game>` (the optional root carrying window, assets and game state; see "Game"), `<Text>`, `<Shape>`, `<Camera>`, `<AnimatedSprite>`, `<Pointer>`, on top of `<Entity>`, `<Sprite>`, `<Collider>`. Each placed element is listed in the manifest's `transformIntrinsics` (decided 2026-11-08) |
| Camera target | A camera follows its children (`<Camera><Hero /></Camera>`) and is transparent to their transforms (`GameObject.childSpace()`); its own `transform` is an offset from the followed point. Replaces the sketched `follow={hero}`, which needed element refs (removed in M3) (decided 2026-11-09, #21) |
| Mutating state in place | Rejected at compile time: every in-place write is a diagnostic (the mutating array methods, `++` and `delete` are `RGE1301`; assignment to anything but `ref.current`, including `e.hp = 1` and `items.length = 0`, is `RGE1402`), so the setter's `===` check cannot be defeated from source. No dev-mode `Object.freeze` (decided 2026-11-09) |
| Sound | A hook, not an element: `const playSound = useSound("hit.wav")`, then `playSound()` in handlers. Sounds have no position, so they do not take `transform`. Playing is an effect, not state, so it happens immediately rather than at the next render (decided 2026-11-08) |
| Authoring | Source files import hooks and intrinsics from a typed entry point and type-check in editors (decided 2026-11-08) |
| Transforms: a non-reactive `useTransform` handle written imperatively in handlers, or position as state written through a JSX attribute | Position is state, set with `transform={{ x, y }}` on any built-in element (decided 2026-11-08; every runtime object has a transform, and the manifest's `transformIntrinsics` lists which built-ins take the attribute). Transforms nest: relative to the parent by default, `global: true` opts out. Authoring should feel as close to ideal React as possible; a per-frame move costs one render per tick, and dependency-scoped rendering is the optimisation if that ever matters |

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

**Source maps** (`rge-compile --source-maps`, or `compile(name, text, { file, source })`): a version 3 map beside each
generated file. Each generated line maps to the start of the construct it was written for (the component, a hook, an element:
the IR's spans), not to the exact expression, so a stack trace through `node --enable-source-maps` names the right line of
the `.tsx`. Spans already point at the source as written, through the custom-hook inliner's `EditMap`.

**Errors in the source** (2026-11-12, PAIN_POINTS.md and Bramble finding 6). Every `compile` now returns the same line origins
(`origins`), with or without a map. The command line keeps them per generated file, and `mapToSource` moves each type error the
check of the generated code finds (`RGE9001`) to the source line of the construct its generated line was written for, keeping
where it was found: `src/Settings.tsx:9:28 - error RGE9001: TS2345: … (in the generated out/Settings.ts:44:59)`. A line written for
no construct (an import, the class header) keeps its generated position. And when a file fails to compile, the generated code is
not type-checked at all ("skipped type-checking the generated code"), as scenes are not validated: the other files would only
report its module as missing, or check against an old one.

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
  A fragment `<>…</>` may stand for an element anywhere here, as a child or as
  a branch (`{alive && <>…</>}`): it is an implicit `<Entity>` holding its
  children, so they come and go together (decided 2026-11-11). Text children,
  spread attributes and other expression children are rejected.
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

Defined in `packages/compiler/src/ir/` (`types.ts` re-exports them). Highlights:

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
`LocalConst` (`const`, or `let` with `mutable`, either with an optional type
annotation: `let best: Enemy | null = null`), `If` (an `else` holding only an
`if` is written `else if`), `ForOf` (`for (const e of enemies) { … }`; the
`const` may destructure, nested, `for (const [i, { id }] of xs.entries())`),
`Switch` (written as is, falling through as in JS, its cases sharing one
scope), `Block` (`{ … }`), `Break` (inside a `for…of` or `switch`) /
`Continue` (inside a `for…of`), of the same function, `Return`, and `SetState`, which is either
`{ state, value }` or `{ state, updater: FunctionIR }` for `setX(prev => …)`.
Parameters are `ParamRead`, locals are `LocalRead`, state is `StateRead`.
`Assign` (`=`, `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `||=`, `&&=`, `??=`) writes
`ref.current` or a `let` local; `n++` / `--r.current` as a statement is
`+= 1` / `-= 1` on those two. See "Transforms and refs". Position is not
assigned: it is state. There is no `while` or C-style `for`: a `for…of` is
bounded by its array, so a handler cannot hang a frame.

**Expressions** added: `ParamRead`, `LocalRead`, `PropertyRead` (only on a
parameter of a runtime handle type, e.g. `input.pointerX`), `Call` and
`TemplateLiteral`. `Call` is limited to an allowlist (`Math.abs/floor/ceil/
round/sign/sqrt/sin/cos/min/max`, `clamp`) and to methods of handle
parameters (`input.pressed/down/released`); the tables live in
`transform/handles.ts`. Everything else (`while` and C-style `for`, `try`,
`var`, closures that escape (but for an arrow handed to a function, see "A cleanup from `useMount`"), `this`, `await`, other calls) is a diagnostic
(`RGE1301`/`RGE1401`/`RGE1402`); assignment to anything but `ref.current` or a
`let` local is `RGE1402`, and `++` on anything else stays `RGE1301`.

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
(a hitbox and a shield) knows which one was hit. `world.reportCollisionExit(a, b)`
is the same for `onCollisionExit`, when a pair stops touching. Dispatch only;
renders happen in the next `tick`. What a handler can read on `other` is
decided in "Collider callbacks" below.

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
no `useEffect`: reacting to a state change is done where the state changes
(see "Why there is no `useEffect`"). `useMount` may return a cleanup; see "A
cleanup from `useMount`" below.

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

### A cleanup from `useMount` (2026-11-12)

What a `useMount` handler returns is its cleanup, as with a React effect: a function, kept and called once when the component
leaves its world, after its `useUnmount` handlers; anything else is ignored. With it, subscribing to something outside the
game state (`settings`, `controls`) needs no mirror in a module:

```tsx
useMount(() => settings.subscribe(() => setVolume(settings.get().music)));   // the call's result is the cleanup
useMount(() => {
  const stop = controls.subscribe(() => setKeys(controls.toJSON()));
  return () => { stop(); waiting.current = false; };                          // or return an arrow
});
```

**Lowering.** `useMount`'s function is lowered with `returns: "cleanup"` (`FunctionOptions`): `return;` and `return value;` are
both allowed, a returned arrow is a `Callback`, and an expression body that is a call (an `ExpressionStatement`) becomes
`return call;`, as React's `() => store.subscribe(…)`. A setter, an action or a sound played in an expression body stays a
statement. Every other handler keeps `returns: "void"`, so `return value;` in `useUpdate` or `useUnmount` is still `RGE1401`.

**Callbacks as values.** The subscription needs an arrow handed to a function, which handlers could not do before ("closures
that escape" were a diagnostic). Now, in a handler and outside a state updater, an arrow passed to a plain function, a method of
an imported object, a callback prop or a local holding a function is a `CallbackIR` (`{ kind: "Callback", fn: FunctionIR }`):
a handler of its own, lowered like a callback prop (contextual parameters, handler statements, state set through `this`). It
may run later, after the component has left; a setter called then marks a detached object, which never renders, so nothing
breaks, but the cleanup is how to stop it. Outside handlers an arrow is still only a callback prop, an updater or an array
method's argument. A handler's own local may now be called (`stop()`, callee `Local`); the type-check checks it is a function.
`walkExpr` walks a callback's statements, so whatever looks for reads and calls in a handler sees inside it.

**Generated code.** A `useMount` whose statements return a value is a method of its own, typed `(() => void) | void`, and
`onMount` passes its result to `keepCleanup`:

```ts
override onMount(): void {
  this.keepCleanup(this.#onMount0());
  this.#onMount1();
}
#onMount0(): (() => void) | void {
  return settings.subscribe(() => { this.setVolume(settings.get().music); });
}
```

A `useMount` that returns nothing is written as before (inlined when it is the only one).

**Runtime.** `GameObject.keepCleanup(value)` keeps a function in a private list; `detachFromWorld` calls `onUnmount`, then each
kept cleanup once in the order kept, and clears the list, before it detaches the children. So a component's cleanups run before
its children's, and a second stay in a world keeps its own. A hot reload removes the old root, so its cleanups run and the new
tree subscribes again. `keepCleanup` is a reserved member name.

Bramble's settings screen is the first user: it subscribes to `settings` in `useMount` and keeps what it shows as its own state,
which replaced the module-level `settings.subscribe` that mirrored the settings into `useGame`.

## Why there is no `useEffect` (2026-11-12)

`useEffect` is the first hook a React author reaches for, and it stays out on purpose. This section says why, and what
stands in for each thing it is used for. Asked again on 2026-11-12, after the review in [PAIN_POINTS.md](PAIN_POINTS.md):
the worry is not that it cannot be built (the compiler knows what every expression reads, so it could even work out the
dependencies itself) but that it would be used for everything, including what it should not be used for.

**What it would give.** It is familiar, and a few needs have no good answer without something like it: subscribing to
something outside the game state *with a cleanup* (Bramble mirrors `settings` into `useGame` at module level because
`useMount` returns nothing), and a reusable component reacting to a prop changing (a `<HealthBar hp>` that flashes when `hp`
drops, where the rules' events cannot help because the component does not know the game).

**What it would cost, here more than in React.**

- **A frame late, per link.** An effect runs after the render that saw the change; a setter it calls renders next frame,
  and an effect that triggers another adds a frame each. Kite's first version, which compared counters with refs to play
  sounds, was "one step late" for exactly this reason (NEXT_PRIORITIES.md, finding 3 of the first level).
- **The patterns React's own docs warn against** become the easy path: state copied from other state (here a derived
  `const` already does it), chains of effects that set state, and "when X changes, do Y" where Y belongs where X was changed.
- **Game logic leaves the rules.** Both games found that the rules as plain functions returning events, answered by
  effect stores, was the shape that worked: headless tests, replays, the same output under V8 and QuickJS. An effect is
  game logic that runs only in the component tree, at a moment set by renders.
- **It cannot be taken back.** Once games depend on it, removing it is a migration.

**What to write instead.** Each answer covers one legitimate use and no more:

| The need | Instead of `useEffect` | Status |
| --- | --- | --- |
| A sound, a burst or a shake when something happens | Do it where it happens: the rules return events and an action answers them through effect stores (`createSounds`, `createParticles`, `createShake`; see "Effects that happen at a moment"). This is React's own advice: do it in the handler that caused the change. | Built |
| A value computed from state or props | A derived `const`, worked out again when what it reads changes. | Built |
| Something on screen that follows state (music, an emitter, the camera) | A built-in driven by props: `<Music>`, `<Particles emitting>`, `<Camera bounds>`. A wish for an effect here means a built-in is missing. | Built; add built-ins as games ask |
| Run something when the component comes or goes | `useMount` / `useUnmount`. | Built |
| Subscribe to something outside the game state, and stop | A cleanup returned from `useMount` (`useMount(() => settings.subscribe(…))`), with a handler able to hand an arrow to a function. See "A cleanup from `useMount`". A hook that reads an outside store and re-renders when it changes (as React's `useSyncExternalStore`) waits for a game that wants it. | Built (2026-11-12) |
| Start a component's state over when what it shows changes | `key` on any element, not only on a list's items (`<Dialogue key={talk.id} />`), React's own answer. See "Keyed elements". | Built (2026-11-12) |
| A reusable component reacting to a prop changing | Only if a game hits it: `useChange(value, (prev) => …)`, run in the same step as the change (no frame of lag), with no cleanup, and allowed to call only effect stores, sounds, refs, `freeze` and the component's **own** setters. Calling a game-state action in it is a diagnostic, so effects cannot chain through the store. | Not built; waits for a game |

**The diagnostic.** `useEffect` and `useLayoutEffect` are `RGE1102` with a message that names these answers (`REMOVED_HOOKS`
in `analyzer/model.ts`), not a bare "Unknown hook".

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

**Array methods** (`ARRAY_METHODS` in `ir/expressions.ts`): `filter`, `map`,
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

**An updater of one expression, in a hook, is written out in place**, because a
moving object calls a setter or two every frame and the host's interpreter pays
for the arrow and for both calls each time. `setX((x) => x + speed * dt)` in a
`useUpdate` generates what the setter would do with it:

```ts
{
  const x = this.#xNext;
  this.#xNext = x + (this.props.speed * dt);
  if (this.#xNext !== x) this.markDirty();
}
```

The block's only name is the updater's own parameter, so it hides the same outer
names as the arrow did. Everything else still calls the setter: a plain value
(`setX(5)`), an updater with statements, and any setter in a callback handed to
an element (`onPress`, `onCollisionEnter`), which runs on an event.

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
  (Since 2026-11-12, any array: see "Computed lists, and conditions inside
  list items".)
* `map` takes one inline arrow with the item and optionally the index as
  plain names, returning exactly one element: an expression body, or a block
  holding only `return <Element … />`. No conditionals, fragments or children
  inside it; a richer item is a component. (Conditions and children came
  later: see the sections below.)
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

### Conditionals inside the map (2026-11-11)

The callback may return `cond && <El key … />`, `cond ? <El key … /> : null`, or `cond ? <A key={k} … /> : <B key={k} … />`:

```tsx
{pads.map((p) => (p.tower ? <Tower key={p.id} {...p.tower} id={p.id} /> : <EmptyPad key={p.id} {...p} />))}
{shots.map((s) => s.live && <Shot key={s.id} {...s} />)}
```

`KeyedListChildIR` gains `condition` and `alternate`. With no `alternate` the list is the source filtered by the condition
(`source.filter((s) => s.live)`): an item whose condition is false has no instance. With one, the item's instance is `element` while the
condition is true and `alternate` while it is false, and **both branches need the same `key` expression** (otherwise `RGE1209`). The
items map holds the union of the two classes, and a `#<field>Branches` map remembers which each key was built as. On render, a key whose
branch flipped queues removal of the old instance and adds the new one at the same `(slot, position)`, with the item's current props; the
reorder that follows uses the new instance. The branches in the generated code test the condition itself, not a stored flag, so that
TypeScript narrows what it reads (`p.tower ? new Tower({ …p.tower })`). A fragment is still not a branch, and the index parameter cannot
be used when the items are conditional (it would count the items left out). The `&&` form is a filter, which TypeScript does not narrow
through; the generated loop narrows the item with `$assume` (see "Narrowing in the generated code"), so `p.tower && <Tower {...p.tower} />`
type-checks.

### Narrowing in the generated code (2026-11-12)

What TypeScript narrows in the source, the generated code must narrow too, or the check of the generated code fails where the
source passed (Bramble finding 17). Three places lost it:

- **A callback made under a condition** (`{capturing !== null && <KeyPrompt onKey={(key) => bindKey(capturing, key)} />}`). In the
  source the arrow closes over a narrowed `const`; in the generated code it reads `this.capturing`, which TypeScript does not narrow
  inside a function even when the function is made inside `if (this.capturing !== null)`.
- **A memo in such a condition** (`const waiting = pick(id)`): it is generated as a call, `this.$memo(…)`, which is never narrowed.
- **A list's `&&` form**: the generated code filters the items, and TypeScript does not narrow through `filter`.

The generator writes `$assume(condition)`, a function the module declares when it uses it,
`function $assume(_condition: unknown): asserts _condition {}`. An assertion signature narrows what follows; the body checks nothing.
`EmitMode.conditions` holds the conditions an element being made sits under (a `ConditionalChild`'s, and a keyed list's when it does
not read the item, as a keyed element's does), and `callback` starts each callback with `$assume(c1 && c2)`. A memo a condition reads
is first read into a local (`const $m0 = this.$memo(…)`, `EmitMode.memoLocals`) that the callback then reads everywhere, since a local
can be narrowed: within one call it is the same value, because state is a snapshot and props do not change. In a list's loop the
item is narrowed by the list's own condition, after the filter that makes it true.

**It changes no behaviour.** A callback that runs after its condition stopped holding still runs, reading state as it is now: a
`useUnmount` that tells the parent `onGone()` after `label` became `null` sees `null`, as before. (React's closure would see the value
of the render that made it; this engine's callbacks read current state, see "Props and callbacks".) Not narrowed still: a condition
on something that is not a path or a memo, which TypeScript cannot narrow in the source either.

### Children on list items (2026-11-11)

`items.map((d) => <MenuButton key={d.kind}><Icon frame={d.icon} /><Label text={d.name} /></MenuButton>)`. The item's children are plain elements
(no conditions, lists, `{children}` or children of their own) that may read the item and index like its props do (an `Item` dependency). The
list's per-key record, which already held the item's current value for callbacks, also holds the children: `{ current: Item; kids: [Icon, Label] }`.
When a key is new the generator makes the item, then each child (`const $c0 = new Icon(…)`), attaches them (`$item.attachPassedChild($c0, 0)` for a
component item, `$item.addChild($c0, 0)` for a built-in) and stores them; on later renders it applies each child's props (and transform) from the
record, so a child updates when the item's object changes. The children belong to the item's subtree, so they go with it when the item is removed.
Not built: children on an item that switches (`cond ? <A/> : <B/>`), and conditions, lists or nested children inside the children.

### Computed lists, and conditions inside list items (2026-11-12)

Found by Bramble, whose rules had to build every list the screen drew (`viewOf`) and keep it in the game state, because a list's items
could only be a state or prop array (optionally filtered), and whose inventory slot had to be a component only to hold `{filled && …}`.

**Any array is a list's items.** `{spotsOf(run).map(…)}`, `{world.enemies.map(…)}`, `{items.map((e) => ({ … })).map(…)}`, `[a, b].map(…)`:
the source is any expression the component may compute (not through `?.`), and the type-check of the generated code checks it is an
array. A source that is not a named array (state, a prop, an imported constant, each optionally `.filter`ed) is computed by a method
of the class, `$<field>List() { return <source>; }`: `render()` calls it once per render, and the list's record type names its items as
`ReturnType<C["$<field>List"]>[number]`. Its dependencies are what the expression reads, so it follows the state it was computed from,
as a React component's render does. A plain function is assumed pure, as everywhere else.

**An item's children may be nested and conditional.** The item's record keeps one field per element below the item (through static
and conditional children), each `T | null`: `{ current: Item; kids: { shape: Shape | null; text: Text | null } }`. The generator writes
the item's children with the same code as a component's conditional subtree, with the record (`$rec.kids`) where a component has
`this` (`fieldBase`): when the item is made, its static descendants are built and attached at once and its conditions are evaluated;
on each later render, its conditions mount and unmount their elements (queued on the item) and its dynamic props are applied. A
callback on a child made later reads the item through the record, as one made with the item does. Still not built inside an item: a
list, `{children}`, a `<Route>`, and children on an item that switches between two elements.

**`undefined` is a value** (`PlainRef "undefined"`), in render and in handlers: `{gate !== undefined && <Sprite … />}`,
`if (key !== undefined) bindKey(action, key)`.

**Methods of strings and numbers, destructured and memoized derived values, and `useState` from the game state** (also 2026-11-12,
from the second Bramble review). `VALUE_METHODS` lists the string and number methods that change nothing (`padStart`, `startsWith`,
`toUpperCase`, `toFixed`, …), called as written (`CalleeIR` `ValueMethod`); `String`, `Number` and `Boolean` are allowed as
functions; `flatMap`, `join`, `at`, `lastIndexOf` and `flat` joined the array methods, and, once the type-check target moved to ES2023
(QuickJS-ng and Node 22 implement them), the copying forms `toSorted`, `toReversed`, `toSpliced`, `with`, `findLast` and `findLastIndex`. A derived `const` may destructure (`const { x, y: top } = heroOf(run)`, `const [a, , c] = trio`): each
name is a member or index read of the one value. A derived value that calls a function or a method is an `ExprIR` `Memo`: the
generated code is `this.$memo(key, [deps], () => value)` (`GameObject.$memo`), the deps being the state and props it reads, so it
is worked out once per change of them wherever it is used (render, handlers, field initialisers), as React's `useMemo`; in `super(…)`'s
arguments, where `this` is not there yet, it is written in place. A call inside a nested memo does not make a memo of its own.
`useState`'s initial value may read the game state (the component's snapshot of it, already a field above), not the component's
own state.

**A game-state value named like a member of the root** (`const name = useGame((s) => s.speaker)` in an `<Entity>` root) is kept in the
field `$name`; the author's name is unchanged. A `useState` with such a name is still `RGE1103`, since its field and setter are the
component's public API.

**Runtime.** Children are sorted by `(slot, order)`: `addChild(child, slot,
order = 0)` and `queueAddChild(child, slot, order)` insert after every sibling
with a lower slot, or the same slot and a lower or equal order.
`queueReorder(slot, children)` queues a new order: at commit each child's
order becomes its index in `children` and the children are re-sorted (stably,
so only that slot's range moves). Static siblings before and after the list
keep their places because they have their own slots. Generated code queues
removals and adds before the reorder.

### Keyed elements (2026-11-12)

`key` on an element outside a list starts it over when the key changes, React's way to reset a component: the old instance
unmounts and a new one mounts with fresh state. While the key stays the same, changed props update it in place.

```tsx
<Dialogue key={talk.id} lines={talk.lines} />
{open && <Menu key={screen} rows={rowsOf(screen)} />}
{left ? <Sprite key={page} image="left.png" /> : <Sprite key={page} image="right.png" />}
```

**Lowering.** A keyed element is a keyed list of one item, the key itself: `lowerKeyedElement` builds a `KeyedListChild` whose
source is `[key]` (an `ArrayLiteral`), whose item is a parameter named `$keyed` (a name source code cannot write) and whose key
reads it. A keyed branch of `cond && …` or `cond ? … : …` is the same list with the branch's condition. So nothing new was
needed in the IR, the generator or the runtime: a new key is a new item, which the list mounts while it removes the old one.
As with list items, the new instance is added before the old one is removed, so its `useMount` runs before the old one's
`useUnmount`. The list's dependencies are the key's and the condition's; props that read state are applied as on any list item.

**Limits.** `key` on a component's root is `RGE1203` (it goes where the component is used). A keyed element inside a list
item's children, or beside other children passed to a component, is `RGE1209` with the same wording as a list there (wrap it
in an `<Entity>`, or make the item a component), since it is one. A key that never changes (`key="x"`) compiles and does
nothing.

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

function Scoreboard() {
  const [score, setScore] = useState(0);
  return (
    <Entity name="Scoreboard">
      <Panel title="hud">
        <Coin value={score} />
        {score > 10 && <Sprite image="star.png" />}
      </Panel>
    </Entity>
  );
}
```

**The parent owns what it passes.** The elements are fields of `Scoreboard`, built
from `Scoreboard`'s state and props and updated in `Scoreboard`'s `render()`, exactly as if
they were `Scoreboard`'s own children: `<Coin value={score} />` follows `score`
without `Panel` knowing, and `{score > 10 && …}` is a conditional child of
`Scoreboard`. `Panel` only says where they mount, so a passed child's `transform` is
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
  rendered is an error. `{children}` may also be the whole of the children
  passed to another component (`<Box title={title}>{children}</Box>`), which
  is "Forwarding" below.
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

### Forwarding `{children}` (2026-11-11)

```tsx
function Modal({ title, children }: ModalProps) {
  return <Flex float anchor="center" to="center"><Panel title={title}>{children}</Panel></Flex>;
}
```

`Modal` does not hold what it is given: it hands each passed child to `Panel`, which holds it in its own slot (or hands it on again, so
Modal → Panel → Flex resolves in a chain). The generated constructor says `this.passedChildrenForward = this.panel;` where it would
say `passedChildrenHost` / `passedChildrenSlot`, and `GameObject`'s four passed-children methods delegate to the forward target when
it is set (`acceptsPassedChildren` is true for either). The parent's `attachPassedChild`, queued adds, removals and reorders all end up
in the innermost container, so static, conditional and list children all work through it.

**The forwarded `{children}` must be the only child passed to the inner component** (decided 2026-11-11, option A of the plan's
"Forwarded `{children}` beside other passed children"). `<Panel title={title}>{children}</Panel>` is allowed;
`<Panel><Title/>{children}<Footer/></Panel>` is `RGE1202` ("must be the only child passed to it"). Why: all of a receiver's passed
children share one slot and are sorted by one number (`order`), so a whole forwarded list cannot sit between two siblings. If a game
needs it: first, allow `{children}` inside a wrapper `<Flex>` that is passed (a compiler-only change, no runtime cost), then order
ranges (`position × 2²⁰ + i`) in `GameObject`. A forwarding component must itself be always present (not in a condition or a list or
another component's children): otherwise `RGE1202`, as before.

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
  `x`, `y`, `z` (draw order), `rotation` (radians), `scaleX`, `scaleY`, `global`.

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
shift its objects, because Tiled shows them there. A layer or group hidden in Tiled, and an object with `visible: false`,
are not placed (priority 7). Flip bits in an object's `gid` do not move its anchor, so they need no handling. Not handled:
whether an `int` property is whole, and properties inherited from object templates.

**Tile layers** (priority 7) are a second import, `importTilemap`, of the same `.tmj` into `generated/tilemaps.ts`, a table of
`TilemapData` by file name (see `NATIVE_PLAN.md`, "Tilemap"): the layers' ids with flip bits split off, each layer's `visible`
(a hidden group hides its layers), the first embedded tileset's `firstgid` and its tiles with the property `solid`. It is written
**before** the sources are type-checked, because a game's own code (its rules) imports it. A map with no tile data (an objects-only
map) writes nothing.

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

## Game

`<Game>` is the root of a game and where its configuration lives (decided 2026-11-09): the window (`title`, `width`,
`height`, `resizable`, `vsync`, `smooth`), the `background` colour, the `assets` folder, and the game state. It is a
built-in container, an `<Entity>` with those props (and `name`), so a component whose root is `<Game …>` extends it, as
any component extends its root. **Its `width` and `height` are the window's size; a `<Screen width height>` inside it
is the game's resolution**, the size everything is drawn at before it is scaled to fit the window:

```tsx
// Main.tsx
export default function Main() {
  return (
    <Game title="rge demo" width={960} height={540} background="#10131c" assets="assets">
      <Screen width={320} height={180}>
        <Ground />
        <Camera><Player /></Camera>
        <CoinCounter />
      </Screen>
    </Game>
  );
}
```
```ts
// game.ts: nothing but the root
export const gameConfig: PlayerConfig = { root: () => new Main() };
```

**With a `<Screen>`.** Both are roots, so they nest: the `<Screen>` is the `<Game>`'s only child, and the player looks
through the `<Game>` for it (`rootScreen`), as it does for a `<Screen>` that is the root itself. Either is optional
without the other.

**Optional.** A game with an `<Entity>` or fragment root, or any root object, works as before: the player's own config and
the defaults apply. A `<Game>` root overrides them, each prop only where it is written; a field it does not write is
`undefined` on the object, which is how the player knows to fall back.

**Literals, and only a root.** The player reads these settings before the tree is built, so each is a literal
(`width={640}`, `smooth`, `resizable={false}`), never state or props: anything else is `RGE1210`. `<Game>` is only ever a
component's root: as a child it is `RGE1003`. It is not placed, so it takes no `transform`. A prop it does not have is
`RGE1203`, listing the ones it does. Its members are reserved names for a component that is rooted at it, like any
built-in's.

**No `state` prop** (retired 2026-11-11). It used to hand the game state to the runtime, which never needed it: the player
starts every game state in the process from its initial values (`resetGameState`), and components read it with selectors,
with or without a `<Game>`, so `state` is simply not one of its props.

A user component cannot be called `Game`: it is an intrinsic like `Entity` (`RGE1206`). The demo's root is `Main`.

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
object literal whose keys are transform fields (`x`, `y`, `z`, `rotation`,
`scaleX`, `scaleY`, `global`; plain or shorthand properties). Each field lowers exactly
like a prop: a field that reads no state is a `StaticProp`, set once right
after the element is constructed (and, for a child, before it is attached);
one that reads state is a `DynamicProp`, re-applied in `render()`. Fields not
listed keep the runtime defaults (`x`, `y`, `z` and `rotation` 0, scales 1, not global). The runtime
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

## Global state (`createGameState`)

`useState` is one component's own state. The **game state** belongs to the game: a score, hit points, a mute switch,
shared by every component. It is one nested object, shaped like a **Zustand store**: you read it with a selector that
returns the value, and you change it with actions that call `set` (decided 2026-11-09, after two attempts that
were not Zustand's own way).

```ts
// GameState.ts, in the source directory. An ordinary module: the game runs it.
import { createGameState } from "@rge/runtime";

interface State {
  coins: number;
  player: { hp: number; name: string };
  collect: () => void;
  hurt: () => void;
}

export const useGame = createGameState<State>()((set, get) => ({
  coins: 0,
  player: { hp: 10, name: "Ada" },
  collect: () => set((s) => ({ coins: s.coins + 1 })),
  hurt: () => set((s) => ({ player: { ...s.player, hp: s.player.hp - 1 } })),
}));
```

```tsx
// CoinCounter.tsx: access                    // Player.tsx: update
import { useGame } from "./GameState.ts";
const hp = useGame((s) => s.player.hp);          const hurt = useGame((s) => s.hurt);
                                                  useUpdate(() => { if (hit) hurt(); });
```

**Access.** `const hp = useGame((s) => s.player.hp)` returns the value, exactly as in Zustand. A component imports the
store (`import { useGame } from "./GameState.ts"`; the only thing it may import from a relative `.ts` module,
`RGE1108` otherwise) and calls it at the top level, bound with `const` to one name. A **plain path** from its parameter
subscribes to exactly that path; any other expression is a computed selector (below). A typo is `RGE1108`
with the nearest key at the level it went wrong (`'player.hpp' … did you mean "player.hp"? 'player' has: hp, name`).
`hp` then behaves as `useState` state does: a snapshot of the last render, usable in JSX and handlers, with the leaf's
type.

**Computed selectors** (2026-11-11, second-game finding 7). The selector may be any expression of the state:
`const selected = useGame((s) => s.cursor === id)`, `const focus = useGame((s) => focusOf(s.battle, s.cursor))`,
`useGame((s) => s.battle.pads[s.cursor]?.tower != null)`. Each path it reads (`s.cursor`, `s.battle`) becomes a snapshot of its
own, `$cursor`, `$battle` (one per path, shared with a plain selector of the same path in the component), and the expression is
a derived value over them, inlined where it is read like any `const` in the body. So the component re-renders when one of the paths
it reads changes, and works the value out again then: coarser than Zustand, which compares the selector's result, but the same
answer. A trailing `.length` (`s.enemies.length`) reads the array's snapshot, since the store reports an array's items, not its
length; before this, `useGame((s) => s.enemies.length)` subscribed to a path nothing ever reported. An action read inside a
computed selector is `RGE1301` ("select it by itself"), and `(s) => s` alone is still `RGE1103`.

**Several values at once** (2026-11-11), as Zustand allows: `const { originX, room } = useGame((s) => s.run)` (a path,
destructured), `const { a, b: c } = useGame((s) => ({ a: s.x, b: s.y.z }))` (an object literal of paths) and
`const [a, b] = useGame((s) => [s.x, s.y])` (an array). Before compiling, each picked value becomes its own selector
(`const originX = useGame((s) => s.run.originX)`), so its own subscription: the component re-renders only for the values it
reads, which is finer than Zustand's `useShallow`.

**Objects and arrays** (decided 2026-11-11). A path may name an object or an array as well as a leaf:
`const player = useGame((s) => s.player)` and then `player.hp` in JSX or a handler, or
`const enemies = useGame((s) => s.enemies)` and `{enemies.map((e) => <Enemy key={e.id} … />)}`. Its type is TypeScript's,
written into the generated code as `ReturnType<typeof useGame.getState>["player"]`, so a wrong member is a type error.
The component re-renders when **any value under the path** changes (the store tells the reader of `player` when
`player.hp` changes), and not when an equal copy is set: values are still compared leaf by leaf, arrays by index.
Treat what you select as read-only, and change it with `set`, as with `useState`.

**Update.** The way Zustand updates is `set`, inside the store: `set(partial)` or `set((state) => partial)`, and, as in
Zustand, the partial is **shallow-merged**, so a nested object is replaced as a whole (spread the rest, as `hurt`
does). A component picks an action with a selector, `const hurt = useGame((s) => s.hurt)`, and calls it as a statement
in a handler, like a sound's play function: not in JSX or a derived value (it would run on every render), not in a
state updater, not as a value. The compiler lowers `hurt(1)` to `useGame.getState().hurt(1)`, so TypeScript checks the
arguments in the generated code as well as in your source. The action's body is plain TypeScript that the game runs;
the compiler never lowers it. `get` is Zustand's too. `useGame.getState()` and `useGame.setState(partial | updater)`
exist, as in Zustand, for code that is not a compiled component (tests, tools).

**The schema is real code.** `GameState.ts` is imported by the generated files and runs in the game, under Node and
under QuickJS, so TypeScript infers every type from it, and there is no separate declaration to keep in step. Both
`createGameState<State>()(creator)` (as Zustand recommends with TypeScript) and `createGameState(creator)` work. The
compiler also *reads* it (it never runs it) to know the state tree and the action names. For that, the creator must be
an arrow function or function that returns an object literal, whose entries are number, string or boolean literals
(a negative number is fine; a leaf's type is its literal's, so `0` is a `number`), nested objects of those, and, at the
top level, functions (the actions). Any other value (an array, `newRun()`, a constant) is kept as a *value*: the
compiler checks paths down to it and leaves the rest to TypeScript. Spreads and computed keys are `RGE1109`. Keys have
no dots.

**Semantics.** Every `set` compares the old and new state leaf by leaf (a function is not a leaf) and marks dirty every
mounted component that reads a leaf that changed, and only those: a replaced `player` object does not re-render the
reader of `player.name` when only `hp` differs. Those components copy the new value into their own field in
`commitState`, in the same flush, so a HUD shows a coin on the frame it was picked up, while every handler in that
frame still saw the old snapshot. A `set` that changes no leaf renders nothing. A component joins the subscribers when it
joins a world and leaves when it leaves, and is refreshed once on joining, so it cannot miss a change made between its
construction and its mounting. A component that only binds actions reads nothing, so it keeps no copy and is never
told of a change.

**Where it lives.** `createGameState` makes a `GameStore` (also `useGame.store`); calling `useGame(...)` itself is
compile-time only and throws, like the authoring hooks. `createPlayer` calls `resetGameState()`, which puts every store
in the process back to the state its creator returned, so each game starts fresh; tests that build components without a
player call it between cases. Generated output for a reader and an action:

```ts
import { useGame } from "../src/GameState.ts";          // relative to the generated file; the CLI computes it
export class CoinCounter extends Text {
  hp: number = useGame.store.get<number>("player.hp");
  override readonly gameStateStore = useGame.store;
  override readonly gameStateKeys: readonly string[] = ["player.hp"];
  override commitState(): void { this.hp = useGame.store.get<number>("player.hp"); }
  …
}
// in a handler:  useGame.getState().hurt();
```

The IR marks such a state `globalKey` (the dotted path) and has a `CallAction` statement. `gameStateStore` and
`gameStateKeys` are reserved member names, like the other `GameObject` fields.

**Not yet.** Zustand's `subscribe`, middleware and `replace`; `setState` inside a compiled handler (writes go through
actions, which keeps what the compiler must understand small); save and restore of the store; arrays in the state;
and more than one store per project (one store per process, one `createGameState` call per project).

## Plain functions in components (priority 7)

A component may import functions from a relative `.ts` file (`import { fadeThrough } from "./transitions.ts"`) and **call them in any expression** (a prop, a derived value, a handler) or **pass them as values** (`transition={fadeThrough}`). The compiler does not look inside them: TypeScript checks the call, the function is assumed pure, and a dynamic prop that calls one depends on the state in its arguments, so it is re-evaluated when those change. The function body is plain TypeScript with loops, arrays and anything else. This is the escape hatch from the restricted handler language: the logic goes in a `.ts` file, the component only wires it up.

**Constants too** (decided 2026-11-11). Anything else a `.ts` file exports is used the same way: `import { ROOM_LIST } from "./rules/rooms.ts"` and `{ROOM_LIST.filter((r) => Math.abs(r.index - room) <= 1).map((r) => <Tilemap key={r.map} … />)}` (an imported array is a list's items, as a state or prop array is; the filter's callback reads state, so the list follows it), `transform={{ x: GEM_AT.x }}`, and a **method of an imported object** called in a handler or an expression (`fx.burst("dust", x, y)`, `sfx.play("start")`): opaque like a plain function (`CalleeIR` `Plain` with a dotted name), its arguments are all it depends on. An array method on an imported array (`ROOM_LIST.filter`) stays an array method, so its callback is lowered. An imported constant is a constant: nothing re-renders when code changes it, which is right for data and for the effect stores below, and wrong for game state (that is `useGame`).

Rules: the name must not look like a hook (`use…`; those are the game state's store, which is the only hook-named import from a `.ts` file); a function that is a prop of a component (a callback) is still lowered as a handler as before. The generator imports the function from where it is (`../src/transitions.ts` from the generated file, through `rge-compile`'s knowledge of where it reads and writes), only if the component uses it. In the IR: `CalleeIR` kind `Plain`, `ExprIR` kind `PlainRef`, and `IRModule.plainImports`.

**`useUpdate` takes the input.** `useUpdate((dt, input) => { step(input, dt); })`: the polled input of that step (under a fixed timestep, the per-step copy with exactly-once key edges), the same object `useInput` gets, and it can be handed to a game-state action or a plain function, which reads the keys with loops and tables (Kite's `rules/controls.ts`). A canonical `onUpdate` override (several handlers, or a root that implements the hook) declares `input` only when it passes it on.

## Named input actions (2026-11-11)

A game names its actions once, in a module, and hands them to `<Game>`:

```ts
// rules/controls.ts
export const controls = createControls({ jump: ["Z", "Space", "PadA"], left: ["ArrowLeft", "A", "PadLeft"], confirm: ["Enter", "PadStart"] });
```

```tsx
<Game controls={controls}>…</Game>
useInput((input) => { if (input.pressed("confirm")) begin(); });
```

Each binding is a `KeyName`, the union of the names in `KEY_NAMES` (the player's `KEYS` is that list), so a misspelt key is a
type error where the controls are written: `Type '"Spcae"' is not assignable to type … Did you mean '"Space"'?` (priority 5,
2026-11-11). Action names in `input.pressed("…")` are not checked by type; an unknown name is a warning at run time.

Every `InputState` question (`pressed`, `down`, `released`) then takes an action name as well as a key name: `down` is any of
its keys held, `pressed` is one of them going down this step, `released` is one going up with none still held. Rules in plain
TypeScript read the same names (`input.down("left")`). `<Game controls>` must be an identifier imported from a `.ts` module
(`RGE1210` otherwise), since the player reads it before the tree is built; `PlayerConfig.controls` does the same for a game
without a `<Game>`. `createInputState(snapshot, controls)` gives tests the same answers, and `controls.bindings` is the shape
an input script's `bindings` takes, so a script's `jump` can hold the game's own keys. An unknown name warns once and lists
the actions. Not built: rebinding at run time, and axes (a stick's value rather than four directions).

## Effects that happen at a moment (priority 7, 2026-11-11)

Not everything a game shows is state. A burst of dust where the character landed, a sound, a shake of the view: each
happens at a moment and then plays out on its own, after whatever caused it has moved on. React has no `useEffect`
here (and this compiler will not grow one: an effect that watches state to fire an event is the pattern React's own docs
warn against); the answer is the one toast libraries use. **An effect store** is made once in a `.ts` module, **its
renderer is mounted once**, and **anything calls it**: a game-state action (plain TypeScript, where events are known), a
plain function, or a component's handler.

```ts
// effects.ts
export const fx = createParticles({ dust: { burst: 9, lifetime: 0.4, speed: 55, angle: 270, spread: 75, gravity: 160, fade: true } });
export const sfx = createSounds({ land: { src: "land.wav", volume: 0.5 }, start: "start.wav" });
```

```tsx
<ParticleLayer particles={fx} />     {/* like <Toaster />: where bursts are drawn, in the world */}
```

```ts
// called with what a step reports, by the component that runs it
for (const e of events) if (e.type === "land") { sfx.play("land"); fx.burst("dust", e.x, e.y); }
```

- **`createParticles(presets)`** → `ParticleStore`: `burst(name, x, y, { angle?, count? })`, and `bursts` (counts by name,
  for tests). A preset is `<Particles>`'s props less `rate`, `emitting` and `space`. **`<ParticleLayer particles={fx}>`** holds
  one emitter per preset and attaches itself to the store while mounted (the last mounted wins); a burst's point is in the
  layer's space. It follows the world: frozen with it, gone with it. With no layer mounted a burst is counted, not drawn.
  Put the layer **next to** a `<Camera>`, not inside it, since a camera follows its children.
- **`createSounds(entries)`** → `SoundStore`: `play(name, volume?)` plays at the entry's volume times `volume`, and `plays(name)`.
  Every file is loaded when a sound sink is installed (`addSoundPreload`), so the first play does not hitch. Asset names in
  a `.ts` file are not checked at build time (only literals in components are).
- **Time since mount is state: `const time = useTime()`** (2026-11-11). An engine-shipped hook like `useSquash`: a `useState(0)` that
  a `useUpdate` adds `dt` to, so the component renders each update. For a blink or a bob (`time % 1 < 0.66`), where a game wrote
  the clock out by hand.
- **A shake is state: `const [shake, setShake] = useShake()`** (2026-11-11, replacing a `createShake()` object). The value is
  `{ strength, duration, elapsed? }`; `setShake({ strength: 3, duration: 0.25 })` in a handler starts one, the hook's own update
  runs it down (`shakeOn`, the same object once over), and `<Camera shake={shake}>` draws it: the camera's offset is a pure
  function of the value (whole pixels from a fixed sequence, so runs repeat). The component that owns the camera owns the
  shake; a child that knows when to shake tells it with a callback prop (Kite: `<Player onDie={() => setShake(…)} />`).
- **Squash and stretch is state: `const [squash, setSquash] = useSquash(1.75)`** (decided 2026-11-11, replacing a
  `createSquash()` object with a `start` method, which was the imperative shape). `setSquash({ x: 0.6, y: 1.4 })` (a `Vector2`) in a
  handler, and `transform={{ scaleX: squash.x, scaleY: squash.y }}` on the sprite, which scales about its origin. It
  springs back to 1 at `recover` a second in the component's own `useUpdate` (`springBack`, a runtime function that returns
  the same object at rest, so the state stops changing). `useSquash` is an **engine-shipped custom hook**: ordinary source
  (`useState` + `useUpdate`, in `compiler/src/hooks/library.ts`, with `useShake`), inlined like any custom hook when a component imports it
  from `@rge/runtime/jsx`, where it is declared for TypeScript.
- **Per-instance objects.** A store in a module is global; an object that belongs to one entity is that component's own,
  made with React's lazy initializer: `const [tally] = useState(() => makeTally())`. The arrow's body is the initial value
  (the generated field is evaluated once per instance anyway), typed `ReturnType<typeof makeTally>`, and a handler may call
  its methods (`tally.add(1)`, `CalleeIR` `ValueMethod`): only for state a factory made (a runtime `create…` function from
  the manifest, or a function from a `.ts` file), so arrays and records keep their messages. This is for objects that are
  not values; a value that changes over time is state (`useSquash`, `useShake`). The manifest's `functions` table includes
  `springBack` and `shakeOn`, which the shipped hooks call.
- **Reacting to what happened: call, and use the result.** No event emitter (one was tried, 2026-11-11, and removed as a
  workaround): the component that runs a step answers it. A handler may use a game-state action's result,
  `const events = step(input, dt)` (`CalleeIR` `Action`, only as a handler's `const`; in JSX or a derived value it would run
  on every render), and then call plain functions and setters with it. Kite's character runs the step in its own
  `useUpdate`, plays the effects (`playEvents`) and sets its squash (`squashFor(events)`).
- **Effects a game makes from the basics.** Afterimages (copies of a sprite left behind, fading) were an engine feature
  briefly and are now Kite's own `<DashTrail>`: a list of ghosts in state, drawn as `<Sprite>`s with falling `opacity`. The
  engine keeps what a game cannot build from the rest.
- **`moveActorX` / `moveActorY`** (runtime `move.ts`, for a game's rules): move any `{ x, y, rx, ry }` a pixel at a time
  against a `blocked(x, y)` test, carrying the sub-pixel remainder; on a block the remainder is dropped, `onBlocked(direction)`
  is called (it may move the actor, which is how a game adds corner rules) and the move stops. Kite's body uses it, with its
  corner corrections as the callbacks.
- **Continuous effects stay JSX.** A trail "while dashing" is state, so it is `<Particles emitting={dashing}>` in the component.
  The stores are for moments.
- **Rules stay pure.** Kite's `stepRun` reports events and never calls a store, so the solver and the tests step it with no
  side effects; the game state turns events into effects (`effects.ts`, `playEvents`).

## Custom hooks (priority 7)

"Hooks are compiler intrinsics" extends to the ones an author writes. A function named `use…` (not a built-in hook, not the
game state's store) whose body is what a component body may hold is a **custom hook**, and a call to it that is a statement of a
component body is replaced, before the file is compiled, by the hook's own statements (`hooks/inline.ts`; text to text, so the
rest of the compiler is unchanged and every rule and diagnostic applies to the expanded component):

```tsx
function usePlatformerBody() { const step = useGame((s) => s.step); const buttons = useRef(0); useInput(…); useUpdate((dt) => { step(buttons.current, dt); }); }
export function Player() { usePlatformerBody(); … }
```

- **Names.** What the hook declares at its top level (its `const`s, its `[x, setX]` state, its parameters) is given a prefix unique to the call, `_useName3_x`, so two calls make two separate states and nothing clashes with the component's own names. Properties, keys and JSX attribute names are left alone; `{ x }` becomes `{ x: _useName3_x }`.
- **Parameters.** A literal argument (a string, number or boolean) is written into the hook where the parameter is used, so a parameter can be a `useSound` path; any other argument is bound with `const _useName3_p = (argument);`. A missing argument takes the parameter's default. A destructured parameter is a diagnostic.
- **Results.** `const v = useX()`, `const { a, b } = useX()` (the hook returns an object literal) and `const [a, b] = useX()` (an array literal) become `const` declarations of the returned expressions. A name the hook declares and returns as it is (`return [count, setCount]`, `return { on, toggle: setOn }`) is not copied: the hook's own declaration takes the caller's name, so a hook can return a setter, as in React (decided 2026-11-11). Anything else returned is a value (a state-derived expression); refs cannot be returned (they are not readable outside handlers).
- **Where.** In the component's file, or imported from a relative `.tsx` (`import { useClock } from "./hooks.tsx"`, read by the CLI; the hook's imports from the authoring module are added to the file that uses it). Hooks may call hooks, to a depth of six, which also stops recursion. A call anywhere but as a statement of the component body (in a condition, a callback, an expression) is `RGE1101` with the hook's name.
- **What is left.** After expansion the hook's declaration and its import are removed, so a hooks-only file compiles to an empty module. Positions in later diagnostics are those of the expanded text. An unknown `use…` name is left alone, so the retired hooks keep their messages.

The author's editor still sees ordinary typed functions: the file type-checks as written (the hook calls `useState` and friends, which throw only if actually run).

## Tilemap, assets and the other built-ins (priority 7)

`<Tilemap>`, `<Particles>`, `<Fade>`, `<Music>`, the new `<Camera>`, `<Sprite>`, `<AnimatedSprite>` and `<Text>` props, `fixedStep` and `gamepadDeadzone` on `<Game>`, and `freeze()` are described where they act, in [NATIVE_PLAN.md](NATIVE_PLAN.md) ("Priority 7 additions"). On the compiler side each is a manifest entry (`intrinsics`, `intrinsicMembers`, `intrinsicRequired`, `intrinsicHooks` for those that override `onUpdate`, `intrinsicLiterals` for `Particles.space`, `functions` for `freeze`) plus `jsx.ts` declarations; no compiler code was needed for them. A `useSound` play function takes an optional volume, lowered to `.play(volume)`.

**Build-time asset check.** `rge-compile --assets <dir>` (`checkAssets`, `RGE1211`) reports every literal image, font, music file and `useSound` path that is not a file in the folder, with the nearest file name; literals inside conditionals and arrays are found (`frames={on ? [...] : [...]}`), computed paths are not. The files of a `createSounds({ … })` (a plain `.ts` module, found by scanning the source folder; `checkSoundStores`) are checked the same way, as a name or `{ src }` written as a literal. `npm run check:<game>` passes `--assets` when the package has an `assets/` folder.

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

**Layout offset.** A third writer comes before both: `layoutX` and `layoutY`,
a position the player's layout pass writes into an object a layout container
places (`world = parent × layout × placement × transform`). Nothing writes it
yet; `<Flex>` will (see [UI_PLAN.md](UI_PLAN.md)). Like placement, it cannot
conflict: layout decides the slot, and the object's own `transform` nudges it
within the slot, as CSS's `transform` does. Both names are reserved members.

`children` is passed between elements, `<Panel>…</Panel>`: see "Children".

### Spread props (2026-11-11)

`<Enemy key={e.id} {...e} />` and `<Box {...o} x={9} />`: on a **component** element an attribute may be a spread of any expression the
compiler can read (state, a prop, the list item, a game-state selection). `PropIR` gains `SpreadPropIR { value, dependencies }`; the order
among the props is kept, so a later prop wins, as in React. The generated code spreads for real: `new Enemy({ ...(e) })`, and a render
sends `updateProps({ ...(e) })`. TypeScript checks the object against the props type, the source type-check reports a missing prop at the
author's line, and the runtime's `applyProps` compares key by key, so a render marks the child dirty only when a value changed: in a list,
only the items whose object was replaced (an immutable update) re-render. A spread that reads nothing is applied at construction only. When
a spread is among the props, `updateProps` carries every value prop, in order, so a named prop after the spread still wins on update
(callbacks are made once and are not re-sent). A spread in a list item reads the item and gets the `Item` dependency.

Not supported: a spread onto a **built-in** (`<Shape {...p} />`): its render writes each prop to a field one by one, so a spread needs the
keys, from the manifest's `intrinsicMembers`. It is `RGE1203` with that reason, until a game spreads onto a built-in (Hearth does not).
`<Box x={5} {...o} />` is TypeScript's own error (`x` is overwritten) when `o` always has `x`.

### Constants, helpers and index reads beside components (2026-11-11)

Second-game finding 7. A component file may hold top-level `const` values and lower-case `function` helpers, as a React file
does: `const ROW = { bolt: 0, mortar: 1, frost: 2 } as const;`, `function labelOf(kind, n) { … }`. The analyzer keeps each as a
`ModuleDeclaration` (its text and the names it mentions), the generator copies it into the module before the components (importing
what it reads from a `.ts` file or the runtime), and components read it like a plain import, in JSX, lists, derived values and
handlers. One that holds JSX or reads the game state is `RGE1001` (that belongs in a component); `let` is `RGE1001` (a value that
changes belongs in state). Render expressions may index (`ROW[kind] * 3 + level`, `pads[cursor]`, `found?.[i]`; `IndexRead`) and
use TypeScript's `!` (`NonNull`, so the generated code type-checks as the source did). `Math.PI`, `Math.E` and `Math.SQRT2` are
values, and `atan2`, `atan`, `tan`, `pow`, `hypot` and `trunc` join the allowed `Math` calls.

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
  those names (`image` for a Sprite root, `width`/`height`/`tag`/`layer`/`hits`/`onCollisionEnter`/`onCollisionExit`/`owner`/`hitsLayer`
  for a Collider root, `width`/`height`/`onPress`/`contains` for a Pointer root, `name` for an Entity root; the other
  built-ins' sections list theirs): the manifest's `intrinsicMembers`, `RGE1103`.
* Only containers (the manifest's `containerIntrinsics`, today `Entity` and `Camera`) may
  have JSX children; a child under a leaf such as a `Sprite`, `Collider` or `Pointer`, at the root or
  anywhere, is `RGE1202`. A fragment nested as a child is an implicit `<Entity>`. A component, a condition or `null` as the
  root is "Component, condition and null roots" below.

### Component, condition and null roots (2026-11-11)

`return <Panel title="BUILD">…</Panel>`, `return on ? <Sprite …/> : null`, `return open && <Menu />` and `return null` are
accepted (they were `RGE1003` / `RGE1002`; found by Hearth, second-game finding 8). The component's class extends the host
intrinsic (`Entity`), holds that one child (or the condition's children, as `{…}` children are), and sets
`override readonly layoutContents = true`. `GameObject.layoutContents` is CSS's `display: contents` for `<Flex>` layout: a
`Flex` lays out such a child's children as its own (`FlexBox.kids`, flattened in `#measureChildren`; when no child is see-through,
`kids` is `children` itself, so the no-allocation path is unchanged), and a `Flex` under one is not a layout root. So
`BuildMenu` returning `<Panel>` inside the side panel's column still grows to the column's width. The wrapper sits at its
parent's origin; a `transform` passed to such a component moves what it holds.

**Element callbacks.** `<Pointer onPress={() => …} />` is the same mechanism with no parameters.

**Keys that press things** (2026-11-11, from the second review of Hearth). `pressKey="wave"` on a `<Pointer>` or a `<Flex>` presses it
(calls `onPress`) when that key or action is pressed, while it is mounted and not inert: the DOM's `accessKey`, so a button owns its
shortcut and a key and a click take one path. `World.tick` does it before any `onInput`, over every `Pointer` and `Flex` in the world
(scratch lists, so nothing is allocated per tick once warm). Every mounted pressable with that key is pressed.

**Focus** (same day). `focusable` makes a pressable take the focus, as a DOM button does; `autoFocus` takes it on mount when nothing has
it; `onFocus` / `onBlur` say so. Each tick the direction actions `left` `right` `up` `down` (the arrows and the d-pad when the controls
have no such action: `InputState.isAction` tells) move it to the nearest focusable that way, measured from `focusPoint()` (a Pointer's or
a laid-out box's middle; along the direction, plus twice the distance across, so a row before the next row), and `confirm` (Enter and PadA
without one) presses the focused one. A click on a focusable one focuses it before pressing it. `World.focus(p)` / `World.focused` for
code. One focused or removed, inert or no longer focusable, loses it; the next tick an `autoFocus` one may take it.

**Inert and modal** (2026-11-12, from PAIN_POINTS.md: "nothing lets a component own or consume the keys"). Input stays polled;
what changed is who hears it, decided by subtree as in HTML. `inert` and `modal` are accessors on `GameObject` and props of
`<Entity>`, `<Flex>` and `<Hud>` (`InputScopeProps`), so a component puts them on its root (`<Entity inert={disabled}>`) and they
follow state like any prop. `inert` was already the router's mechanism (`World.setInert`, used on a screen being left); the prop
calls it when set and when the object joins or leaves a world. `modal` calls `World.setModal`, which keeps a stack in mount order;
the last modal still in the world is `World.modal`. `World.isInert(object)` is now: in an inert subtree, or a modal exists and the
object is not inside it (ancestors included, as a dialog's page is). Everything that already asked `isInert` follows: `onInput` and
`onUpdate` get `NO_INPUT`, presses and hover skip it, `pressKey` and the focus look only at pressables that are not inert, so the
focus stays inside a modal and leaves what it made inert. A modal is pushed before its children attach, so an inner modal is above
an outer one. `inert` and `modal` are reserved member names; they are not in `intrinsicMembers`, which lists what an intrinsic
adds to `GameObject`.

Bramble is the first user: the pause screen is a `modal` component that closes itself on Escape (the play screen behind it no
longer hears the keys, so its `if (paused) return` in `useInput` went), and a settings row waiting for a key mounts `KeyPrompt`, a
modal with no children, so `Menu` lost its `disabled` prop. Not done: a per-key "consume" (`input.consume("confirm")`) inside one
subtree, which no game has needed beside these two.

**Small things the same review found.** `<Pointer originX originY>` places the area's origin as a Sprite's does (a pad's 10 × 10 area
centred on it). A bitmap-font `<Text>` without a `size` is drawn at the font's own cell height (`Text.sized`; setting `size` to
`undefined` goes back to that). `controls.label(action)` names the first key for a label (`"Space"`, `"Esc"`, `"Left"`). The generated
`tilemaps.ts` registers its maps as it loads, and a component module that draws a `<Tilemap>` imports it, so a game needs no
`registerTilemaps` call. A component may import types from a `.ts` file (`import type { Tower as TowerData } from "./rules/battle.ts"`,
`import { type Kind }`); the generated module imports the ones it mentions as types.

**Hover** (2026-11-11, second-game finding 11). `<Pointer>` and `<Flex>` take `onPointerEnter` and `onPointerLeave`, the DOM's
`pointerenter` / `pointerleave`: each frame the player finds the topmost pressable under the mouse (last frame's draw order,
the same search a press makes) and `World.reportHover` tells the one before it left and the new one it was entered; an inert one
counts as none, and a mouse off the screen is over nothing. A `<Flex>` with only hover callbacks is collected for the mouse but
lets a press through to what is under it. State is the component's: `onPointerEnter={() => setHovered(true)}`.

**Functions passed whole** (2026-11-11, second-game finding 9). `onPress={resume}` where `resume` is a game-state action, and
`<Flex onPress={onPress}>` where `onPress` is the component's own callback prop (or `props.onPress`): to a built-in, the
compiler writes the arrow the author would have (`() => useGame.getState().resume()`, `() => this.props.onPress?.()`), with the
parameters the manifest lists; to a component, an action is the store's own function (`ActionRef`), a static prop, since an action
never changes. A sound or a setter is still not a value.

**Collider callbacks.** `<Collider width={16} height={24} onCollisionEnter={(other) => …} />`
is a callback prop on a built-in, which the manifest lists in
`intrinsicCallbacks` along with its parameters (`other: Contact`, a handle
type; see below). It lowers to the same `CallbackProp` a component receives, with
annotated rather than contextual parameters, and the runtime calls the
collider's own callback (see "Collisions"). On a child element it is created in
the field initialiser. On a root it is assigned after `super()`
(`this.onCollisionEnter = …`), because an arrow that uses `this` cannot be made
inside the call to `super`. A function on any other built-in, or an unknown
callback name, is `RGE1203`.

**What `other` exposes** (decided 2026-11-09). `other` is a `Contact`: handler
code may read `other.tag` and `other.owner`, both strings, and nothing else
(`'Contact' has no readable property 'width'`, `RGE1301`). The compiler checks
the comparison like any other string.

* `tag` is the `tag` prop of the other `<Collider>` (`""` when it has none).
  It tells two colliders on one prefab apart, which the owner cannot.
* `owner` is the `name` of the nearest `<Entity name>` at or above the other
  collider, or, when none is named, its class name. It needs no prop, so a game
  can start with it, but renaming an entity changes game logic.
* A `<Collider>` also takes `layer` (a string, default `""`) and `hits` (a list
  of layers, default: every layer). A pair is tested only when **each** side's
  `hits` allows the other's `layer`, so a bullet that hits only enemies ignores
  other bullets, and an enemy that left `hits` out still cannot touch a bullet
  that does not hit enemies. Filtering happens in the tracker before a pair is
  recorded, so a skipped pair costs no callbacks and no exit events.
* `onCollisionExit(other)` takes the same `Contact`. It fires once when a pair
  stops touching, because the boxes moved apart, a collider left the world, a
  collider lost its area, or the two layers stopped matching. The collider that
  itself left the world is not called (it is gone); the one still mounted is.
  Exits are reported before enters in the same frame.
* The members are the manifest's `Contact` handle type, `intrinsicMembers.Collider`
  lists the new fields, and the runtime's manifest test keeps both honest.

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
run(hostBackend(), { root: () => new Main() });   // a root that is a <Game> carries its own window settings
run(hostBackend(), { width: 800, height: 600, title: "My game", root: () => new Level() });  // any other root, configured here
```

**Startup.** The root is built first, with the window still closed, because a root that is a `<Game>` says what window to
open (see "Game"). Sounds made while it is built only record their paths; once the window is open they are preloaded
through the backend, so a sound still never hitches on its first play. Then the window opens, the tree is mounted
and the first frame is drawn. A root that throws opens no window, unless errors are shown in the window (below). Each setting
is the `<Game>` prop where it is written, else the `PlayerConfig` field, else the default (640 × 360, title
`"react-game-engine"`, background black, assets `"assets"`); `hidden` is the player's alone.

**Errors in the window** (priority 5, 2026-11-11). With `showErrors`, an error thrown while building the root, mounting it or in
a step does not close the window: the player stops stepping the world and draws the error instead, on a dark red background in
window pixels: a heading, `Name: message`, the stack (dimmer, wrapped to the window, cut with a line that says so), and a note
at the bottom ("Close the window to quit."). `player.failure` holds the error while it is shown. `run` turns this on for a
visible window and, once the window is closed, throws the error, so both hosts still print it and exit with status 1. A
`hidden` window, and `createPlayer` unless asked, throw at once as before, which is what tests, tools, the parity runs and CI
want. Because the error screen is drawn by the TypeScript player through the ordinary draw records, the Rust host needs no
change. A host can also show its own error (`player.showError(error, note)`): the Node launcher shows a compile error this way.

**Hot reload** (priority 5, 2026-11-11). `player.reload(config)` builds `config.root` again, from a newer build of the game's
classes, and puts it in place of the current root in the same window and world. What carries over:

- **Each component's own state.** The compiler gives a component with `useState` or `useRef` a `saveHotState()` (its values by
  their IR ids, `"Coin.taken"`, the pending value a setter wrote included) and a `loadHotState(saved)` that writes them back as a
  setter would and marks the component dirty. `captureHotState(root)` collects them by **tree path**: each object is named by its
  class and its index among its siblings of that class (`Main/Level:0/Player:0`), so a component keeps its state when the code
  around it changes, as long as it is still the n-th of its kind under the same parent. `restoreHotState(world, root, saved)` goes
  parents first and flushes the world after each level, so a child that exists only because of its parent's state (a condition
  that was true, a list) is built before it is looked for. A value whose kind changed (a number that became a string), a game
  object, and a function are not kept (`hotFits`): the new initial value stands.
- **The game state**, by the host: `GameStore.carryFrom(older)` takes the older store's values where they still fit (a key that
  is gone is dropped, a new key keeps its initial value, a leaf whose type changed keeps the new one) and the new build's
  actions, before any component reads it.
- **Not kept:** a built-in's internal state (an animation's frame, a camera's slide, particles in flight), and module-level
  variables in plain `.ts` files. The window's settings stay as they were opened; the controls come from the new root.

A reload that fails (the new root throws while it is built or mounted) shows the error and keeps the state of the last good tree
for the next try, so fixing the bug brings the game back where it was. A crash in a step leaves the world as the error found it,
and the next reload takes its state from there. How the Node launcher gets a newer build is in NATIVE_PLAN.md
(`packages/player-node`).

**Reusing draw records** (decided and built 2026-11-10). Most objects stand still in a given frame, and walking them is most
of a frame's script time. So `FrameBuilder` keeps last frame's world records and, for a subtree that has not changed since,
copies the run of records (with its colliders and texts) instead of making them again. The signal is what the world already
knows, not a watch on `Transform`'s fields (plain fields are kept, because accessors made every moving scene slower under
QuickJS): a render (`runRender`), a structural change and an `AnimatedSprite` frame call `markChanged()`, which stamps the object
and its ancestors with the world's `serial`, and the builder advances the serial once a frame. A subtree is copied when nothing
in it, and no ancestor's own transform, was stamped since the frame the records came from. The contract that follows:

- **A compiled component needs nothing.** Its draw state changes only in its constructor and `render()`, and its hooks only
  call setters, so the compiler marks every class it generates `static readonly managed = true`. Its `render()` writes only what
  differs and reports it (`markMoved` for a transform, `markChanged` for anything else), and it declares `reportsChanges`, so a
  render that changes nothing keeps what was drawn, and one that only moves it lets the player move its records as a block.
- **A hand-written class** that overrides `onInput` or `onUpdate` and is not marked is redrawn every frame, with everything under
  it, because it may write a transform or a colour from the hook and nothing would report it. The same write with no hook (from a
  collision callback, a test, a script holding a reference) is not seen: call `object.markChanged()` after it.
- **What the walk must see every frame is never reused**: a `<Camera>`, `<Pointer>`, `<Hud>`, `<Flex>` (they feed lists besides the
  draw records, or lay out their children) and anything with a non-zero `z`. A subtree containing one is rebuilt, and so are its
  ancestors, though their other children are still copied.
- **Collisions follow it.** A collider in a reused subtree comes with the same `ColliderEntry` object as last frame, and one that is
  not gets a new one, so `CollisionTracker` tests again only the colliders whose entry is new (see its doc comment). An entry must not be
  changed after it is handed over.
- **Which boxes overlap is the host's to find, when it can.** A backend may implement `overlaps` (both native hosts do, with
  `rge_overlaps` in `librge`); the tracker then hands it the boxes and applies the rules to the pairs that come back. Without
  it the tracker sweeps in script. The two find the same pairs, so a game cannot tell which ran.
- **What changed is drawn the short way.** Under an object that changed this frame, a `<Shape>`, `<Sprite>` or `<Collider>` with no
  children, z, layout offset or placement is written by its parent's loop, not by a call of its own (most of a moving component is
  such leaves). It draws exactly what the general walk draws; the tests compare the two.
- `retain: false` (on `PlayerConfig` or `FrameBuilderOptions`) turns it off; `retain: "check"` also rebuilds each frame and
  throws when the two differ, which is how an unreported change is found. The player's tests run reuse against a full rebuild
  over random changes.

**A frame** (`createPlayer(...).step()`), in a fixed order:

1. A new **left press** goes to the topmost `Pointer` that was under the mouse in the frame last
   drawn (`world.reportPress`). One press, one pointer; if the topmost misses, the one below is tried.
2. `world.tick(dt, input)`: `useInput`, `useUpdate`, renders, structure (as in "Handlers"). `dt` is
   what the backend measured, clamped to `[0, 0.1]` seconds so a stall cannot teleport things; the
   first frame's `dt` is 0. With a fixed step, as many ticks as the frame holds (`FixedDriver`).
3. After **each** tick, its collisions: the tree is walked (`walkTree`, depth first) into draw records,
   which is where colliders get their world boxes; contacts that started or ended are reported with
   `world.reportCollision` / `reportCollisionExit` (see "Collisions" below); and if any callback ran,
   `world.flush()` renders what it changed. The walk composes world transforms on the way down and treats
   a `Camera` as transparent to its children, exactly as `GameObject.worldTransform()` and `childSpace()`
   do, and a test holds the two equal over a real tree.
4. The last step's walk is the frame's, unless a collision callback changed something after it; then the
   tree is walked again (cheap: only what changed is rebuilt, see "Reusing draw records").
5. The backend draws and presents the frame, then writes the next frame's input.

**Why collisions are per step** (2026-11-12). They used to be found once a frame, after the walk, and their
callbacks' effects rendered by the next tick. That had three costs: the frame that showed a contact did not
show what it caused (a spike touched but the character still standing); with a fixed step, a contact that
began and ended inside one frame's steps was missed; and the step a contact was seen in depended on the frame
rate, so a replay could play differently on a slower machine. Now a contact is found in the step that made it,
the next step's `useUpdate` sees its effects, the frame draws them, and a run collides at the same steps at
any frame rate (`test/collide-timing.test.ts`). **What it costs:** a frame of one step walks the tree as before
(plus a cheap second walk only when a callback ran); a frame that catches up with k steps walks it k times:
2,000 moving colliders under Node went from 3.9 to 5.8 ms for a two-step frame. A walk that places only the
colliders would remove that if it matters. **What it does not change:** a callback runs after the step's
`useUpdate`, not inside it, so movement code that must stop at a wall reads tiles; and nothing sweeps a
collider's path, so a very fast, thin one can pass through another between two steps.
   `step()` returns false once that input says the window was closed (the frame is still drawn).

**What is drawn.**

* *Order:* tree order, a parent before its children, children in their order (source order, then
  keyed-list order), unless `z` says otherwise. Later is on top. **`z`** is a `transform` field beside `x`
  and `y` (`<Sprite transform={{ x: 10, z: 2 }} />`; scenes take it too): what has a higher `z` is drawn
  later, so on top, negative is behind, and 0 is the default. Like position it adds to the parent's
  (`placement.z + transform.z`, on top of the parent's), so raising a component raises everything in it as
  one, and `global` cuts the chain (a global `transform` is just its own `z`; a global `placement`
  ignores the parent's). A camera is transparent to it, as to position. Objects with equal `z` keep
  tree order, and the order is global across the tree, not within one parent: a child at an effective
  `z` of 6 is above an unrelated sibling of its parent at 5.5. Pointers follow the same order, so the
  pointer drawn on top is pressed first. It is not a record field: the format is unchanged. The frame
  builder notes where `z` changes as it writes records and, if it ever did, sorts them once after the walk
  (`DrawList.sortByZ`, a stable sort by `(z, record order)`; skipped when they are already in order, as
  when a HUD sits at the top); the view stays first and a screen's border bars stay last. A `z` that is
  not a number (NaN) is 0, with one warning; an infinite one is the extreme of the order. Why it is a
  transform field and not a `z=` attribute: `z` is a common prop name (a coordinate, a layer), and an
  attribute would reserve it on every component. The cost is a read of two fields per object in the tree
  walk: about 10% of the script time of the 2,000 and 5,000 moving-rect bench scenes under QuickJS
  (median of interleaved runs, noisy to about the same size). Priority 4's setters on `Transform` would let
  a game that never sets `z` skip it.
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
warning). The point it follows (the middle of its children, or where it is) lands on the centre of the window
(of the game's screen, under a `<Screen>`). With no camera the world
origin is the window's top-left corner. An unusable camera (zoom 0) is dropped for the frame, with one
warning.

**The game's screen.** A `<Screen width={320} height={180}>` at the root of the game (the object mounted, or the
root `build` is given) sets the game's resolution: everything inside is in game pixels, and the player scales it
into the window. `fit` picks the scale: `"integer"` (the default) is the largest whole number that fits, with the
game's corner on a whole window pixel, falling back to `"contain"` for a window smaller than the game;
`"contain"` is the largest scale that fits; `"stretch"` fills each axis. The game is centred, and the window
outside it is covered with `border`. `pixelPerfect` (the default) draws the game into a texture of the game's own
size, through views in game pixels, and the first record of the frame, `RGE_OP_CANVAS`, says where in the window
the texture is shown and what colour is around it, so a game pixel is a whole block of window pixels whatever is
turned or scaled inside. `pixelPerfect={false}` draws at the window's resolution: the camera's view in game pixels,
then the screen's scale and position (`viewToWindow`), in one view, and the bars last as four rectangles through a
view in window pixels. In both modes a press on the bars reaches no `Pointer`, and `input.pointerX/pointerY` come
back through the window's map (`BuiltFrame.view`, which is the same in both modes), so handlers see game positions.
A `<Screen>` anywhere else is a plain container, with one warning; one whose
size is not positive is ignored, with one warning. Without a `<Screen>` the frame is exactly what it was
before: the game is the window.

**The HUD.** A `<Hud>` is a layer drawn after the world through a second `RGE_OP_VIEW` that ignores the camera:
its contents are in game pixels under a `<Screen>` and in window pixels without one. The tree walk records each
`Hud` and does not enter it; each is then walked on its own after the world, in tree order, from its own world
transform, with `z` ordering the contents of that layer only (a high `z` inside one layer never lifts it over the
next layer, or the world). Inside a `Hud`, sprites, shapes and text are drawn, `Pointer`s are collected, and a
`Camera` is ignored with one warning; a `Collider` takes no part in collisions; a `Hud` inside a `Hud` is a plain
container. The HUD's pointers are listed after the world's, so they are pressed first, and a press reaches them at
HUD coordinates: the window point taken back through `BuiltFrame.hudView` (the screen's placement, or the
identity), not through the camera.

**Layout (`<Flex>`).** A `Flex` is a container that places its children in a row or a column; the algorithm is in
`packages/player/src/layout.ts` and is Clay's, ported (docs/UI_PLAN.md has the rules and the reasons). The walk
reaches a layout root (a `Flex` whose parent is not a `Flex`) and lays out everything under it before descending:
fit sizes bottom-up, then sharing out space top-down, widths first and then heights, then positions, each child's
`layoutX` / `layoutY` (composed before `placement` and `transform`, so a child's own `transform` moves it within its
slot). Sizing is per axis: `"fit"`, `"grow"`, a number or a percentage, with min and max; free space goes to the
smallest growing child first and stops at each maximum. Only a `Flex` is resized by layout; a `Shape`, `Sprite` or
`Text` keeps its own size. An `Entity` or component child is sized by the bounding box of what it draws. A root that
grows fills the game's area (the canvas, else the window). Layout runs every frame, so conditional children and keyed
lists reflow with no extra work, and in steady state it allocates nothing. `background` is a rectangle drawn first,
behind the children, at the box's size. Each child's offset is rounded to a whole pixel (sizes stay exact), so centred
text is not blurred. A `Flex` with an `onPress` is pressable over its laid-out box, in the same draw-order list as
`Pointer`s (both are a `Pressable`). A `<Text width={80} align="center">` is laid out as an 80-wide box and drawn
centred in it. When children overflow a row or column, boxes that are `"fit"` or `"grow"` shrink largest first down to their
minimums; a leaf's minimum is its size unless the measurer reports a smaller one (`minWidth` / `minHeight`, for
wrapping text), so in a real game nothing shrinks yet and overflow is visible. Not built yet: floating boxes (U5), text wrapping.

**Measuring.** `FrameBuilder.measure(object)` is the size layout will place an object by: a `Shape`'s,
`Pointer`'s or `Collider`'s `width × height`, a `Text`'s measured width × its measured line height, a `Sprite`'s texture size
(an `AnimatedSprite`'s first frame, so the size does not jitter; a texture that will not load measures as the
16×16 square drawn instead), and null for containers. It asks the backend's optional `measureText` and
`textureSize` once per string and once per texture and keeps the answers (text widths up to 1,024 strings,
then the cache starts again). Both native hosts answer from librge (ABI v2). A backend without them gets text
widths estimated (`estimateTextWidth`: 0.6 × size per character, a line as tall as `size`) and textures that measure
0 × 0, with one warning; `RecordingBackend` implements both deterministically for tests.

**Input.** `input.pressed/down/released(key)` read the backend's key flags. Keys are `"A"`–`"Z"`,
`"0"`–`"9"`, `"Space"`, `"Enter"`, `"Escape"`, `"Tab"`, `"Backspace"`, `"Shift"`, `"Control"`,
`"Alt"`, `"ArrowUp"`/`"ArrowDown"`/`"ArrowLeft"`/`"ArrowRight"`, `"F1"`–`"F12"` and the mouse buttons
`"MouseLeft"`, `"MouseRight"`, `"MouseMiddle"`; any other name is never pressed and warns once.
`input.pointerX/pointerY` are the mouse **in world space**: the window position taken back through the
view of the frame last drawn, so a handler never needs the camera. A pointer or collider mounted this
frame is not clickable until it has been drawn once.

**Collisions.** `CollisionTracker` (called by the player after every step) finds the moment two colliders
*start* touching and calls `world.reportCollision(a, b)`, which calls each collider's own `onCollisionEnter`
with the other. A collider is the box `width × height` with its **top-left corner at the object's position**
(like a `Sprite`), scaled and turned by its world transform; a rotated collider is approximated by the smallest
upright box around it (a quarter turn is exact). Boxes that only share an edge do not touch, and a collider
with no area (zero or negative size, zero scale) never collides. A pair that keeps overlapping is reported
once; one that separates and touches again is reported again; a collider that leaves the world is forgotten,
so one that returns already touching is a new contact (and its old partner hears `onCollisionExit`). **Colliders with the same parent never collide with each
other**, so a component with a hitbox and a shield does not hit itself. Pairs are found with a sweep over x, which keeps it cheap
(a whole frame with 2,000 moving colliders is about 0.9 ms in Node and 16 ms in the embedded interpreter; testing
every pair cost 465 ms there). A pair is skipped unless each collider's `hits` allows the other's `layer`. When a pair that touched last frame does not now,
`world.reportCollisionExit(a, b)` is called (before the frame's enters): the tracker keeps last frame's colliders by id for that, one
array entry per collider, because a `Map` entry per touching pair doubled the cost of a pile of 300 colliders under QuickJS. There is no
physics: nothing is pushed apart, and a handler reads `other.tag` and `other.owner` only.

**Sound.** `Sound` reports to a `SoundSink` (`setSoundSink`, one at a time). The player installs one
that loads each file through the backend once (when a component creates its `Sound`, so it is ready by
the time it plays) and plays by handle. A sound that cannot be loaded warns once and is silent; the
runtime still counts the play. Closing the player removes the sink.

**Hosts.** A game's entry file calls `run(hostBackend(), config)`. A host sets
`globalThis.__rgeBackend` before it loads the game, so the same file runs under every host:

* **Node** (`@rge/player-node`, for development): koffi loads `librge`; `npm run play:demo`.
* **The Rust host** (`host/`, what ships): QuickJS-ng (an interpreter: no JIT, so it can go where a JIT is
  banned) embedded with rquickjs, with `librge` and raylib linked in statically. `npm run bundle` turns the
  entry into one ES module (esbuild, `platform: neutral`, ES2022) and refuses one that imports from Node or
  koffi; `rge-host game.js [--root <dir>]` runs it, resolving the game's relative `assets/` against the root.
  With no arguments it runs the `game.js` next to the executable in that folder, which is how
  `npm run package` ships a game: `dist/<name>/` holds the executable, `game.js` and `assets/`. The host
  provides `console` (QuickJS has none) and the backend; nothing else of Node is needed. An uncaught
  exception prints its stack and exits with status 1.
* **`RecordingBackend`** is the backend for tests: it keeps every frame decoded and plays scripted input back
  one frame at a time. The demo's 60-frame parity script runs under Node and under the Rust host and the two
  outputs must be byte-identical.
