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
  (optionally `export`ed) whose body is: zero or more
  `const [x, setX] = useState(init)` statements, then one `return <Entity …>`.
* The root element **must** be `<Entity>`. It describes the component instance
  itself (the generated class extends the runtime `Entity`), so its props are
  applied to `this`, and its children become children of `this`.
* `useState` is a compiler intrinsic. It must be a top-level `const` array
  destructuring. Calls anywhere else, or any other `use*` call, are errors.
  State type is inferred from the initial literal (`number`/`string`/`boolean`).
* Children: elements, or `{condition && <Element />}`. Text children,
  fragments, spread attributes and other expression children are rejected.
* `const t = useTransform({ x: 0, y: 0 })` (at most one per component, initial
  values are number literals) and `const r = useRef<Sprite>()` plus
  `ref={r}` on exactly one element of that tag. See "Transforms and refs".
* Hooks: top-level `onInput((input) => ...)`, `onUpdate((dt) => ...)` and
  `onCollisionEnter((other) => ...)` statements; each may appear several times
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
  future hooks (`useTransform`, refs) declare storage that is not
  user-settable state, and because hook order matters while storage does not.

### How future features slot in

| Feature | IR change |
| --- | --- |
| ~~`onUpdate`, `onInput`, `onCollisionEnter`~~ | done: `OnUpdate` / `OnInput` / `OnCollisionEnter` hooks carrying a `FunctionIR`; see "Handlers" |
| `onInput` / event props | `PropIR` variant `EventHandlerProp` holding a callback IR |
| ~~`useTransform`, refs~~ | done: `UseTransform` hook, `ComponentIR.refs`, `Assign`, `TransformRead` / `RefRead` / `RefPropertyRead`; see "Transforms and refs" |
| props between components | `ComponentIR.props: PropDeclIR[]`; `ExprIR` variant `PropRead`; `ComponentRef` `Local` accepts props |
| keyed lists | `ChildIR` variant `KeyedListChild { items, key, element }` |
| prefabs / scenes | consume `IRModule` / `ComponentIR` directly — the IR is already backend-free |

## Handlers

`onInput`, `onUpdate` and `onCollisionEnter` are hooks whose handlers are
lowered to a `FunctionIR { params, body: StatementIR[] }`. Statements exist
only inside functions.

**Statements** (`StatementIR`): `ExpressionStatement` (allowlisted calls),
`LocalConst`, `If`, `Return`, and `SetState`, which is either
`{ state, value }` or `{ state, updater: FunctionIR }` for `setX(prev => …)`.
Parameters are `ParamRead`, locals are `LocalRead`, state is `StateRead`.
`Assign` (`=`, `+=`, `-=`, `*=`, `/=`) writes a transform field or a ref
property; see "Transforms and refs".

**Expressions** added: `ParamRead`, `LocalRead`, `PropertyRead` (only on a
parameter of a runtime handle type, e.g. `input.pointerX`), `Call` and
`TemplateLiteral`. `Call` is limited to an allowlist (`Math.abs/floor/ceil/
round/sign/sqrt/sin/cos/min/max`, `clamp`) and to methods of handle
parameters (`input.pressed/down/released`); the tables live in
`transform/handles.ts`. Everything else (loops, `try`, `let`, assignment,
closures that escape, `this`, `await`, other calls) is a diagnostic
(`RGE1301`/`RGE1401`/`RGE1402`); assignment to anything but a transform field
or ref property is `RGE1402`.

**Scoping**: component scope (state, setters) → function scope (parameters) →
block scope (`const`s). Shadowing any outer binding, or `Math`/`clamp`, is
`RGE1401`.

**Semantics**: state reads are *live* (not React-style snapshots): after
`setHealth(...)`, a later read in the same handler sees the new value.
Setters call `markDirty()`, so any number of setter calls in a frame cause one
render, in the frame's render phase, never mid-handler.

**Generated code**: one override per hook kind. A single handler is inlined:

```ts
override onInput(input: InputState): void { if (input.pressed("Space")) { … } }
```

Several handlers of one kind become private methods called in source order, so
a `return;` in one cannot skip the others:

```ts
override onUpdate(dt: number): void { this.#onUpdate0(dt); this.#onUpdate1(dt); }
```

`SetState` emits `this.setX(…)`, so dirty marking stays in the setter.

**Runtime frame** (`World.tick(dt, input = NO_INPUT)`): `onInput` → `onUpdate`
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

Input model decision (per the Phase 2 plan): a polled per-frame `onInput` hook,
not JSX event props. Event props can be added later as a `PropIR`
`EventHandlerProp`.

## Transforms and refs

Two non-reactive handles. Writing either never marks the object dirty, so
per-frame motion costs no render.

```tsx
function Mover() {
  const transform = useTransform({ x: 0, y: 0 });
  const body = useRef<Sprite>();
  onUpdate((dt) => {
    transform.x += 60 * dt;
    body.current.image = transform.x > 100 ? "run.png" : "idle.png";
  });
  return <Entity name="Mover"><Sprite ref={body} image="idle.png" /></Entity>;
}
```

```ts
export class Mover extends Entity {
  readonly body: Sprite = new Sprite({ image: "idle.png" });
  constructor() {
    super({ name: "Mover" });
    this.transform.x = 0;
    this.transform.y = 0;
    this.addChild(this.body);
  }
  override onUpdate(dt: number): void {
    this.transform.x += 60 * dt;
    this.body.image = (this.transform.x > 100) ? "run.png" : "idle.png";
  }
}
```

**useTransform**: `UseTransformHookIR { slot, name, initial }`. The runtime
`Entity` owns `transform: Transform` (`x, y, rotation, scaleX, scaleY`, default
`0, 0, 0, 1, 1`); the constructor sets only the fields listed. Reads are
`TransformRead`, writes are `Assign` with a `TransformField` target. A second
`useTransform`, an unknown field or a non-literal initial value is `RGE1105`.

**useRef**: `const r = useRef<T>()`, with `T` the tag of the target element
(intrinsic, local or imported), and `ref={r}` on exactly one element of that
tag. `ComponentIR.refs` holds `RefIR { id, name, componentName, target }`,
resolved after the JSX is lowered. There is no runtime ref object: the element
is already a field, so the ref's name *becomes* the element's field name
(`this.body`), which is how authors control field names. `r.current` is
`RefRead`; `r.current.image` is `RefPropertyRead` or an `Assign` to a
`RefProperty` target. Properties come from `elementProperties` in the runtime
manifest (`Sprite`: `image`, ...); refs to compiled components expose only
`.current`. Unattached, doubly attached, wrongly typed or root refs are
`RGE1106`.

**Null safety**: a ref to an element inside `{cond && …}` is a nullable field
(`Sprite | null`), so the generated code only type-checks behind
`if (r.current) { … }`. An unchecked access fails the type-check (`RGE9001`)
rather than being accepted and crashing after the element unmounts.

**Reads only in handlers**: a transform or ref read in JSX or a `useState`
initialiser would be evaluated once or only on render and then go stale, so it
is `RGE1304`.

**Caveat**: a ref write to a property that is also a dynamic prop
(`image={health > 0 ? …}`) is overwritten at the next render of that prop.

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
