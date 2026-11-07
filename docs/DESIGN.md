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
* Handlers: top-level `onUpdate((dt) => ...)` and `onCollisionEnter(() => ...)`
  statements, at most one of each per component. See "Handlers" below.
* Element tags are either runtime intrinsics (`Entity`, `Sprite`, `Collider`)
  or components declared in the same file. Local components take no props yet.
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
| ~~`onUpdate`, `onCollisionEnter`~~ | done: `OnUpdate` / `OnCollisionEnter` hooks carrying `StmtIR[]`; see "Handlers" |
| `onInput` / event props | `PropIR` variant `EventHandlerProp` holding a callback IR |
| `useTransform`, refs | new `HookIR` variants + storage slot kinds |
| props between components | `ComponentIR.props: PropDeclIR[]`; `ExprIR` variant `PropRead`; `ComponentRef` `Local` accepts props |
| keyed lists | `ChildIR` variant `KeyedListChild { items, key, element }` |
| prefabs / scenes | consume `IRModule` / `ComponentIR` directly — the IR is already backend-free |

## Handlers

`onUpdate` and `onCollisionEnter` are hooks whose bodies are lowered to
statement IR (`StmtIR`), the only place statements exist in the IR:

* `SetState { state, setterName, value }` — the only way a handler changes
  anything. Written `setX(expr)` or `setX(prev => expr)`; the updater's
  parameter is lowered as a plain read of that state.
* `If { test, then, else }` and `LocalDecl { name, value }` (`const` only,
  scoped to the enclosing block). Locals and the `dt` parameter are
  `LocalRead` expressions.
* Anything else (loops, other calls, assignment, `let`) is `RGE1402`.

Semantics: state reads in a handler are **live** (not React-style snapshots),
so after `setHealth(...)` a later read sees the new value. Setters call
`markDirty()`, so renders happen in the next `World.flush()`, never mid-handler.

Generated code overrides `onUpdate(dt)` / `onCollisionEnter()` on the class.
Runtime: `World.update(dt)` calls `onUpdate` on every attached object (parents
first, over a per-object snapshot of children) and then flushes;
`World.collide(a, b)` notifies both objects and flushes. The mock runtime has
no physics, so a collision system is expected to call `collide`.

Not yet: event props on elements (`onInput={...}`), handler parameters beyond
`dt`, more than one handler of a kind per component, and `onCollisionEnter`
receiving the other object.

## Code generation

Generated output for the example above (abridged):

```ts
export class Player extends Entity {
  health: number = 100;
  readonly sprite: Sprite = new Sprite({ image: (this.health > 50) ? "normal.png" : "hurt.png" });
  warningIcon: WarningIcon | null = null;
  constructor() {
    super({ name: "Player" });
    this.addChild(this.sprite);
    this.render();
    this.commitStructure();
  }
  setHealth(value: number | ((previous: number) => number)): void { … this.markDirty(); }
  override render(): void {
    this.sprite.image = (this.health > 50) ? "normal.png" : "hurt.png";
    if (this.health < 25) {
      if (this.warningIcon === null) { this.warningIcon = new WarningIcon(); this.queueAddChild(this.warningIcon); }
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
  never mutates the tree it might be iterating. The constructor runs `render()`
  then `commitStructure()` so a freshly constructed object is complete.
* The generated class extends the runtime `Entity` (not bare `GameObject`)
  because the root `<Entity>`'s props (e.g. `name`) belong to the instance.

## Runtime (mock)

`packages/runtime` is deliberately minimal: `GameObject` (tree, dirty flag,
queued structure ops), `World` (dirty queue + flush), and three intrinsics
with public prop fields. It has no rendering backend; the compiler only knows
the runtime's module specifier and the list of intrinsic tag names.
