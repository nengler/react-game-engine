# M3 review and M4–M6 investigation

Written 2026-11-08 against `main` at `b53b55a`. Part 1 reviews the M3 work in progress, part 2 is one runtime fix that M5 needs and that ships with this document, and part 3 works out how to build M4, M5 and M6 in this codebase. Where this document disagrees with [PHASE2_PLAN.md](PHASE2_PLAN.md), it says so and gives the reason. Changes to settled decisions are listed together in [Proposed plan changes](#proposed-plan-changes).

## 1. M3 review (work in progress)

**What was reviewed.** The M3 agent is working on the local branch `claude/hopeful-euler-2dv4xe`, which is not pushed yet. This review covers its edits up to about 05:35 UTC: the runtime `Transform`, the IR types, the diagnostics, the analyzer, `scope.ts`, and `Assign` lowering in `statements.ts`. Transform lowering, codegen, tests and docs were not written yet.

### In line with the plan and the ground rules

- **Runtime.** `Transform` (`x`, `y`, `rotation`, `scaleX`, `scaleY`) is a plain class that `Entity` owns as a `readonly transform` field. Writing to it marks nothing dirty. `transform` is added to `reservedMembers`.
- **IR first.**
  - New variants: `UseTransformHookIR`, `RefIR` in `ComponentIR.refs`, `AssignStmtIR` with targets `TransformField | RefProperty`, and `TransformRead`, `RefRead` and `RefPropertyRead` expressions.
  - `childExpressions` handles the new leaves.
  - Separate read variants are the right choice: `PropertyReadIR.object` is typed `ParamReadIR`, so reusing it would have meant loosening that type.
- **Branded ids.** `TransformId` and `RefId` follow the pattern of `StateId` and `ElementId`.
- **Diagnostics.**
  - New codes are appended (`RGE1105`, `RGE1106`, `RGE1304`), never renumbered.
  - Unsupported compound operators (`%=`, `||=`, `??=`, …) get their own diagnostic instead of falling through to "unsupported expression".
- **Refs are not a `HookIR`.** The plan defines `RefIR { id, name, target }` and leaves its location open, so keeping refs in `ComponentIR.refs` is fine. `useTransform` remains a hook because it carries initial values.

### Issues to resolve before the M3 PR merges

| # | Issue | Why it matters | Suggested fix |
| --- | --- | --- | --- |
| 1 | **A ref property write can fight a JSX prop.** With `<Sprite ref={body} image={hurt ? "a" : "b"} />` and `body.current.image = "run.png"` in `onUpdate`, the next `render()` overwrites the write. | There would be two writers and a silent last-write-wins. That breaks the rule that unsupported means a diagnostic. | Report a diagnostic when an `Assign` targets a `RefProperty` that is a `DynamicProp` on the ref's element. Assigning over a `StaticProp` is fine: it is an imperative override after construction. |
| 2 | **Nullability of a ref must follow the element's presence, not its own child kind.** A static `<Sprite ref={s}/>` inside a `{cond && <Entity>…</Entity>}` subtree is also nullable. | If the ref is typed non-null, the generated code fails to type-check, or worse, type-checks with the wrong type. | Use the generator's existing `Presence` (`persistent` / `conditional`) logic, which already types such descendant fields as `T \| null`. |
| 3 | **`ref={…}` must not become a `PropIR`**, and `ref` on the root `<Entity>` needs a rule. | `ref` would otherwise reach `new Sprite({ ref: … })`, and the root element has no field to name. | Remove `ref` in `#lowerProps`. Make `ref` on the root a diagnostic that points to `useTransform` (the root *is* `this`). M4 should also reserve `ref` and `key` as attribute names on components. |
| 4 | **Ref names compete with automatically chosen field names.** | `const sprite = useRef<Sprite>()` on the second `<Sprite>` collides with the automatic name `sprite` of the first one. | Claim every ref name during `#lowerHooks`, which runs before `#lowerRoot`, so `#allocateFieldName` skips them. Add a test with this exact case. |
| 5 | **The new `elementProperties` manifest table can drift from the runtime classes.** | `Sprite: ["image"]` is a hand-written list. | Add a runtime test, like the one for `reservedMembers`, that checks every listed property is an own field of a constructed instance of that intrinsic. |
| 6 | **Transform units are not specified.** | M6 imports Tiled maps, which store rotation in degrees clockwise with y pointing down. Renderers need to know the convention. | Write the convention down in `Transform.ts` and DESIGN.md: radians (to match the allowlisted `Math.sin`/`Math.cos`), y down, pixels. M6 converts on import. |
| 7 | **`useTransform` initial values.** | The plan says `{ x?, y?, rotation?, scaleX?, scaleY? }`. | Accept only number literals (including unary minus) in M3. Report unknown keys and spreads as `RGE1105`. After M4, prop reads can be allowed (`useTransform({ x: props.spawnX })`), but scenes (M6) set transforms directly, so this is optional. |
| 8 | **DESIGN.md is now out of date.** | It says "`Assign` is not here yet" (Handlers section) and lists useTransform/refs under "How future features slot in". | This is already on the M3 checklist; listed here so it is not missed. |

### Merge note

Part 2 below changes `#emitStaticWiring`, `#emitMountStatics` and the conditional mount in `generator.ts`, and regenerates `packages/example/generated`. M3 will touch nearby code, because ref names become field names. Whichever PR merges second has to rebase, rerun `npm run example`, and commit the regenerated output (CI checks this).

## 2. Fix shipped with this document: children keep source order

**The bug, confirmed on `main`.** A conditional child mounted after construction was appended to the end of its parent:

```tsx
<Entity><Sprite image="a" />{show && <Sprite image="b" />}<Sprite image="c" /></Entity>
// children after show → true:  a, c, b   (expected a, b, c)
```

Child order is draw order, so this already affects what is drawn today. The plan scheduled ordered inserts for M5, but M5's acceptance test "static siblings before and after the list keep their positions" depends on them, and the bug exists for conditionals now.

**The fix.**

- `GameObject.addChild(child, slot?)` and `queueAddChild(child, slot?)` take an optional *slot*: the child's index in its parent's JSX children. A child is inserted after every sibling whose slot is lower or equal. A child without a slot uses `Infinity`, so it is appended.
- The generator passes slots only for parents that have a conditional child. Output for components with only static children is unchanged.
- Children added from outside the component (`World.mount`, M6 scene children) carry no slot, so they stay after the component's own children.

Tests:

- `packages/runtime/test/order.test.ts` covers the runtime rule.
- A behaviour test in `behavior.test.ts` mounts, unmounts and remounts conditionals between static siblings, including a nested conditional.

**How M5 extends it.** A keyed list takes one slot and orders its items inside that slot (see 3.2).

## 3. How to build M4–M6

### 3.1 M4: props and callbacks

#### a. Top-level `interface` and `type` declarations (analyzer)

Today any top-level statement that is not an import or a component is `RGE1001`, so `interface EnemyProps {…}` does not compile at all.

- The analyzer accepts `interface` and `type` declarations, exported or not, and records each declaration's node.
- The transform stores them on `IRModule.typeDeclarations: { name; text; exported }[]`. The text is the declaration's source text, following the "copy source text" decision.
- The generator emits them verbatim at the top of the module.
- Type-only imports from `.tsx` files (`import type { EnemyProps } from "./Enemy.tsx"`) must stop being rejected. Pass them through as `import type { … } from "./Enemy.ts"`.

#### b. Prop declarations

- Accept exactly one parameter: an object binding pattern annotated with a type reference to one of those declarations, local or imported. Defaults in the pattern are allowed.
- IR: `ComponentIR.props: PropDeclIR[]`, each `{ name, optional, defaultValue: ExprIR | null, kind: "value" | "callback", type: PropTypeIR }`.
  - `optional` and the member type come from the interface when it is local. For an imported interface, the transform cannot see the members, because it compiles one file at a time. In that case it records only the destructured names and relies on the type-check.
  - **Callback or value is decided by syntax:** a member whose type node is a function type (`() => void`, or such a type with `?`) is a callback. Nothing else is.
- **Structured prop types (proposed change).** Also lower the member's type node into a small structured `PropTypeIR`:
  - `number`, `string` and `boolean`
  - unions of string or number literals
  - `T[]` of those
  - `Function`
  - `SourceText { text }` as the fallback.

  Type-checking still uses the copied text. The structured form exists so that M6 can build a data schema without asking the TypeScript checker for types. A prop whose type is `SourceText` is "code-only": a scene may not set it. This keeps the settled decision ("copy text") for type-checking and avoids the "revisit for prefab schemas" case it anticipated.

#### c. Construction order (the main codegen problem)

Generated classes build children in **field initialisers**, and with `target: ES2022` those run right after `super()` returns, before the rest of the constructor body. So `this.props = props` in the constructor body is too late for `readonly sprite = new Sprite({ image: this.props.skin })`. Parameter properties (`constructor(readonly props: P)`) are not an option either, because `erasableSyntaxOnly` is on and Node's type stripping rejects them.

Two options:

- **Option A (recommended): make props available from `super`.** Make the runtime host generic, `class Entity<P extends object = {}>`, with `props: P`, and give its constructor a second argument: `constructor(hostProps: EntityProps = {}, props?: P)`. Generated code becomes `export class Enemy extends Entity<EnemyProps>` and calls `super({ name: "Enemy" }, { ...props, speed: props.speed ?? 1 })`. Field initialisers can then read `this.props`.
  - This adds one runtime member (`props`, which goes into `reservedMembers`; the manifest test enforces it).
  - Existing output only changes for components that declare props.
  - `useState(props.initialHealth)` works, with React semantics: the prop is read at construction only.
- **Option B:** move all field initialisation into the constructor body, after the props assignment. This changes the shape of every generated class and makes field types and initialisation harder to read. Not recommended.

#### d. Dependencies must include props

Today a prop or condition is dynamic only if it reads **state** (`collectDependencies` collects `StateRead` only). A child prop such as `image={props.skin}` would be classified `StaticProp`, evaluated once, and would never update.

- Generalise `dependencies: StateId[]` to `DependencyIR[] = { kind: "State"; state } | { kind: "Prop"; name }` in `DynamicPropIR` and `ConditionalChildIR`.
- `PropRead { name }` is a new `ExprIR` leaf.
- The generator only needs to know whether there is any dependency at all: `render()` already re-evaluates every dynamic prop.

#### e. Child side

- **`updateProps`.** Generate `updateProps(next: Partial<P>): void`. It compares each key with `===`, applies defaults again for keys that are now `undefined`, and calls `markDirty()` once if anything changed.
- **Reserved names.** Reserve `props` and `updateProps` in the component's `#usedNames`.
- **Renders in one flush.** A child that `updateProps` marks dirty during its parent's `render()` renders in the same `World.flush()`, because `flush` loops until the dirty set is empty. That gives the plan's "one render of the child", which a test should check.
- **Calling a callback prop.** `onDefeated?.()` and `onHit(5)` lower to a new `CalleeIR` variant `{ kind: "Prop"; name; optional }`. They are allowed as an `ExpressionStatement` and inside expressions. Argument counts are not checked in the transform; the type-check checks them.

#### f. Parent side

- **Static props** go into the `new Enemy({ … })` call.
- **Dynamic props** become `this.enemy.updateProps({ speed: … })` in `render()`. The instance is never recreated.
- **Callback props** are a new `PropIR` variant, `CallbackProp { name; handler: FunctionIR }`. It replaces the "EventHandlerProp" placeholder in the IR comments. Generate it **inline in the constructor's object literal**: `new Enemy({ onDefeated: () => { this.setScore(…) } })`.
  - Inline arrows are **contextually typed**. The parent does not know the parameter types of an imported child's callbacks (it compiles one file at a time), so callback parameters get a new `TypeIR` `{ kind: "Contextual" }` and are emitted without an annotation. A separate field holding the arrow would lose that context and fail `noImplicitAny`.
  - Arrows in a class-field initialiser capture the instance's `this`, so they read live state and are created once per child instance. That is the plan's "created once".
- **Forwarding.** `onX={onX}` is a `PropRead`, so it is classified as a dynamic prop. That is harmless, because the forwarded callback never changes identity.
- **Diagnostics.**
  - Callback values on intrinsics.
  - `children`.
  - `key` outside a list (reserved for M5).
  - `ref` used as a prop name.
  - Retire `RGE1204` with a "Retired" comment, as was done for `RGE1403`.

**Suggested split:**

- **M4a:** type declarations, `PropDeclIR`, `PropRead`, dependencies, and the runtime `Entity<P>`.
- **M4b:** parent-side props, callbacks, and `updateProps`.

### 3.2 M5: keyed dynamic lists

**The plan underestimates one part: handlers cannot build arrays.** Handler code allows literals, state and parameter reads, arithmetic, and allowlisted calls. There is no array or object literal, no spread, and no `filter`/`map`. Because a setter only re-renders when it receives a *new* array (an `===` check), `const [enemies, setEnemies] = useState<EnemyData[]>([])` could only ever be filled from props. Split the milestone:

**M5a: records and arrays in handler code.**

- New `ExprIR` variants:
  - `ArrayLiteral` with spread elements
  - `ObjectLiteral` with plain `key: value` and shorthand properties (no spread at first)
  - `MemberRead { object: ExprIR; name }` on values whose type is a record (`e.id`, `prev.length`). `PropertyRead` stays for handle types, which the manifest checks.
- New array methods in the allowlist: `filter`, `map`, `some`, `find`, `slice`, `concat` and `length`.
- **Non-escaping inline arrows** as their arguments, lowered as `FunctionIR` with `Contextual` parameter types. This is a deliberate, narrow widening of M1's "no closures that escape" rule: the arrow is consumed synchronously by an allowlisted method.
- **State types.** `StateIR.type` changes from `ValueType` to `TypeIR`, adding `{ kind: "Array"; element: TypeIR }` and `SourceType { text }`. `useState<EnemyData[]>([])` needs the type argument; `useState([])` without one is a diagnostic. The generated setter (`value: T | ((previous: T) => T)`) works unchanged for arrays.

**M5b: `KeyedListChild`.**

- **IR.** `{ source: ExprIR; item: ParamIR; index: ParamIR | null; key: ExprIR; element: ElementIR; dependencies }`, as in the plan. The source is a state or prop read. The item's member reads are `MemberRead`, so the type-check validates them.
- **Restrictions**, each a diagnostic:
  - a single element with `key`
  - no children, conditionals or `ref` inside the callback
  - the source is a state or prop.
- **Generated code.** Fields `enemyItems: Map<string | number, Enemy>` and `#enemyOrder: (string | number)[]`. `render()` does the following:
  1. Loops `for (const e of this.enemies)`, so `e` is typed from the array with no annotation.
  2. Computes the key. A duplicate key throws, always: there is no separate development build, and the check costs one `Map` lookup.
  3. For an existing key, calls `updateProps` (or assigns the props directly on an intrinsic).
  4. For a new key, constructs the item and calls `queueAddChild(item, slot, order)`.
  5. Afterwards, queues removal for keys that are gone, and calls `queueReorder` only if the key sequence differs from `#enemyOrder`.
- **Runtime.** Extend part 2's slot to `(slot, order)`: `addChild(child, slot, order = 0)` sorts by slot, then by order. `queueReorder(slot, children)` reassigns the order values and re-sorts that slot's range when it commits. Static siblings before and after the list keep their positions, because they have different slots.
- **Docs.** Document immutable updates, as the plan already says. An optional development mode could `Object.freeze` array state in the setter.

### 3.3 M6: prefabs and scenes

**Prefab registry**

- For each *exported* component, emit:

  ```ts
  export const prefabs = { Enemy: { create: (props: ConstructorParameters<typeof Enemy>[0]) => new Enemy(props), props: [...] } };
  ```

  Using `ConstructorParameters` means the props interface does not have to be exported or imported. Components without props get `create: () => new X()`.
- `props` is generated from `PropDeclIR` and `PropTypeIR` (see 3.1b), with fields `{ name, type, optional, default }`. Callback props are left out. `SourceText` props are listed with `settable: false`.

**CLI**

- The CLI already compiles a whole directory. Add:
  - `prefabs.ts`, which imports and merges every module's `prefabs`
  - `prefabs.json`, the data schema.
- Two exported components with the same name in different files are a diagnostic, because scenes refer to prefabs by name.
- The CLI sees every module's IR, so this is also the place to add the cross-file static cycle check that M0 deferred.

**Scene validation (`rge-compile --scenes <dir>`)**

- Parse scene JSON through the parser adapter (`createSourceFile` with the JSON script kind; verify the name in the 7.1 `.d.ts` first, as the ground rules require). This gives a node for every value, so diagnostics carry the real line and column, plus the JSON path in the message.
- Add a new code range, `RGE15xx`, covering: unknown prefab, unknown prop, missing required prop, wrong type, a non-settable prop, and duplicate `id`.

**Runtime `loadScene(world, scene, prefabs)`**

1. For each entity: `create(props)`.
2. Copy `transform` fields onto `object.transform`. This overrides `useTransform` initial values; document that.
3. Mount: top-level entities with `world.mount`; `children` with `parent.addChild(child)` and no slot, so they come after the prefab's own children (see part 2).
4. Return `Map<id, GameObject>`. Hot reload and editors can key on that map, so no new `GameObject` field is needed.

The runtime stays a mock: no rendering or asset loading.

**Tiled importer (`.tmj` → scene JSON)**

- **Object layers only.** For each object:
  - The prefab name comes from `type`; read `class` too, because Tiled 1.9 saved the field under that name.
  - Custom `properties: [{ name, type, value }]` become props: `bool` → boolean, `int`/`float` → number, `string`/`file`/`color` → string. `object` and `class` properties are diagnostics in v1.
- **Coordinates.** `x` and `y` are pixels with y pointing down. Tile objects (those with a `gid`) are anchored at the bottom left. `rotation` is in degrees clockwise and is converted to the M3 convention (radians).
- **Ids.** Group layers flatten. Scene ids are `"<layer name>/<object id>"`, which stay stable across edits in Tiled.
- **Validation.** The importer emits scene JSON, so it goes through the same validation as a hand-written scene.

**Code-first scenes** need nothing new after M4: a TSX component that composes prefabs.

**The equivalence test** the plan asks for: build the same level from TSX and from JSON, and compare the trees by tag, props and transform.

## Proposed plan changes

| Change | Where | Reason |
| --- | --- | --- |
| Children keep source order via slots (**done in this PR**) | Runtime, generator | A live draw-order bug, and a prerequisite for M5 |
| `Entity<P>` with `props` set through `super` | M4 runtime | Field initialisers run before the constructor body, and parameter properties are not erasable |
| `DependencyIR` includes props | M4 IR | Without it, prop-derived child props are static and never update |
| Callback props inline, with `Contextual` parameter types | M4 codegen | Imported children's callback types are not visible to a per-file compiler |
| Structured `PropTypeIR` alongside the copied text | M4 IR, used by M6 | Lets M6 build a data schema without the TypeScript checker; unrepresentable types become code-only props |
| Split M5 into M5a (records and arrays in handlers) and M5b (keyed list) | Plan | Array state cannot be updated with today's handler language |
| `(slot, order)` child ordering and `queueReorder` in place of `queueInsertChild` / `queueMoveChild` | M5 runtime | Extends part 2's slot instead of adding a second ordering mechanism |
| Registry types via `ConstructorParameters<typeof X>[0]` | M6 codegen | Props interfaces do not need to be exported |
| Transform units: radians, y down | M3 docs | Needed for M6's Tiled conversion and for renderers |
