# Compiler design — first vertical slice

This document describes the architecture of the TSX → TypeScript game-object
compiler, the decisions taken for the first slice, and the alternatives that
were considered. It is the place to push back on a decision before more code is
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

Rules in this slice (anything else is a compiler diagnostic, never silently
ignored):

* A component is a top-level `function` declaration with a capitalised name
  (optionally `export`ed) whose body is: hooks (`useState`, `useRef`, the
  handler hooks), `const name = expression;` derived values, then one
  `return <Entity …>`. A derived `const` (`const hurt = health < 25;`) may read
  anything declared above it; it is inlined where it is used, so JSX that uses
  it updates with the state it reads, and a handler that uses it sees current
  state.
* The root element **must** be `<Entity>`. It describes the component instance
  itself (the generated class extends the runtime `Entity`), so its props are
  applied to `this`, and its children become children of `this`.
* `useState` is a compiler intrinsic. It must be a top-level `const` array
  destructuring. Calls anywhere else, or any other `use*` call, are errors.
  State type is inferred from the initial literal (`number`/`string`/`boolean`).
* Children: elements, `{condition && <Element />}`, or
  `{condition ? <A /> : <B />}` (a branch may be `null`; it lowers to two
  conditional children, on `condition` and `!condition`). Text children,
  fragments, spread attributes and other expression children are rejected.
* Imports: components from `./Name.tsx`, and hooks, built-in elements and
  `clamp` from `@rge/runtime/jsx` (the manifest's `authoringModule`). Named
  imports only; any other import is `RGE1001`, and a name the entry point does
  not export is `RGE1004`. The entry point is a set of declarations (calling
  one throws) typed from the runtime's own classes, with the `JSX` namespace in
  `@rge/runtime/jsx-runtime`, so the TSX itself type-checks: a project uses
  `"jsx": "react-jsx"` and `"jsxImportSource": "@rge/runtime"`
  (`packages/example/tsconfig.json`). `rge-compile` runs this check first
  (`RGE9002`; `--no-check` skips it). Imports are mandatory, as in React: a
  hook, built-in element or runtime function used without being imported is
  `RGE1005` (reported once per name per file, naming the import line to
  add). `Math` is a global and needs none.
* Position is state: `transform={{ x, y: 0, rotation }}` on any built-in
  element (`<Entity>`, `<Sprite>`, `<Collider>`; the root or a child),
  relative to its parent unless
  it sets `global: true`. There is no transform hook. Refs hold values:
  `const timer = useRef(0)`, read and written as `timer.current` in handlers.
  There is no `ref={…}` on elements. See "Transforms and refs".
* Hooks: top-level `useInput((input) => ...)`, `useUpdate((dt) => ...)` and
  `onCollisionEnter((other) => ...)` statements (the last becomes a prop on
  `<Collider>` in M4; `onUpdate`/`onInput` are the old names and report
  `RGE1102` with the new one); each may appear several times
  and runs in source order. See "Handlers" below.
* Element tags are runtime intrinsics (`Entity`, `Sprite`, `Collider`; the list
  comes from the runtime manifest), components declared in the same file, or
  components imported from another `.tsx` file with
  `import { Name } from "./Name.tsx"` (named imports only: no default,
  namespace, `as` or `type` forms). Components take no props yet.
* Expressions: number/string/boolean/null literals, state reads, unary
  `! - +`, binary arithmetic / comparison / logical, `?:`, parentheses.

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
* Props are `StaticProp` (no state dependencies, evaluated once) or
  `DynamicProp` (carries its `dependencies: StateId[]`, re-evaluated on render).
* Children are `StaticChild` (instantiated once, never recreated) or
  `ConditionalChild` (created/destroyed when `condition` flips). The wrapper
  is the extension point for `KeyedListChild` later.
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
| ~~`useUpdate`, `useInput`, `onCollisionEnter`~~ | done: `OnUpdate` / `OnInput` / `OnCollisionEnter` hooks carrying a `FunctionIR` (IR kinds are named after the runtime methods they override); see "Handlers" |
| event props (`<Collider onCollisionEnter={…}>`) | `PropIR` variant for a callback on an intrinsic (M4) |
| ~~transforms, refs~~ | done: `ElementIR.transform` / `HostElementIR.transform`, `ComponentIR.refs` (values), `Assign` to `RefCurrent`, `RefRead`; see "Transforms and refs" |
| props between components | `ComponentIR.props: PropDeclIR[]`; `ExprIR` variant `PropRead`; `ComponentRef` `Local` accepts props |
| keyed lists | `ChildIR` variant `KeyedListChild { items, key, element }` |
| prefabs / scenes | consume `IRModule` / `ComponentIR` directly — the IR is already backend-free |

## Handlers

`useInput`, `useUpdate` and `onCollisionEnter` are hooks whose handlers are
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
`world.reportCollision(a, b)` with two colliders; each side's nearest compiled
component (the first ancestor-or-self that is not a runtime intrinsic, i.e.
without its own `static intrinsic`) receives `onCollisionEnter(otherComponent)`.
Dispatch only; renders happen in the next `tick`.

Input model decision (per the Phase 2 plan): a polled per-frame `useInput` hook,
not JSX event props. Event props can be added later as a `PropIR`
`EventHandlerProp`.

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
takes the attribute (today all of them: `<Entity>`, `<Sprite>`,
`<Collider>`); one left out, such as a future sound with no position, gets
`RGE1207`. On a component element
(`<Enemy transform={…} />`) it would be placement by the parent, which needs
a rule for combining it with the child's own root transform, so it arrives
with props (M4) and is `RGE1207` until then. Malformed objects (spreads,
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
  no slot: appending in source order is already correct. Keyed lists (M5)
  extend the slot with an order within it. The constructor runs `render()`
  then `commitStructure()` so a freshly constructed object is complete.
* The generated class extends the runtime `Entity` (not bare `GameObject`)
  because the root `<Entity>`'s props (e.g. `name`) belong to the instance.

## Runtime manifest

`packages/runtime/src/manifest.ts` exports `runtimeManifest`, the one place
that says what the runtime provides: the intrinsic tag names, the host
intrinsic generated classes extend, the member names of that class that
generated fields must not shadow (`reservedMembers`), the handle types handler
parameters may have (`InputState`, `GameObject`) with their readable members,
and the runtime functions handler code may call (`clamp`). The compiler takes
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
all outputs together, so a broken cross-file reference is caught there.
Cross-file static cycles are not detected yet (the `RGE1205` check is per file).

## Runtime (mock)

`packages/runtime` is deliberately minimal: `GameObject` (tree, dirty flag,
queued structure ops), `World` (dirty queue + flush), and three intrinsics
with public prop fields. It has no rendering backend; the compiler only knows
what the manifest tells it.

`commitStructure()` also settles children it has just attached, so a freshly
constructed object whose nested conditions are true has its whole subtree
attached without a `World`.
