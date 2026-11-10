// The IR of a module and its declarations: components, hooks, state, refs and sounds.
import { type StateId, type RefId, type SoundId, type SourceSpan } from "./ids.ts";
import { type ValueType, type TypeIR, type FunctionIR } from "./values.ts";
import { type HostElementIR, type PropDeclIR } from "./elements.ts";
import { type ExprIR } from "./expressions.ts";



// ---------------------------------------------------------------------------
// Module / component
// ---------------------------------------------------------------------------

export interface IRModule {
  readonly kind: "Module";
  readonly sourceFile: string;
  /**
   * Top-level `interface` / `type` declarations (a component's props type),
   * copied into the generated module as written, so the type-check validates them.
   */
  readonly typeDeclarations: readonly TypeDeclarationIR[];
  readonly components: readonly ComponentIR[];
}

/** A source `interface Name { … }` or `type Name = { … }`, kept as text. */
export interface TypeDeclarationIR {
  readonly kind: "TypeDeclaration";
  readonly name: string;
  /** The declaration's source text, without `export`. */
  readonly text: string;
}

export interface ComponentIR {
  readonly kind: "Component";
  readonly name: string;
  readonly span: SourceSpan;
  /** Hook declarations, in source order. */
  readonly hooks: readonly HookIR[];
  /** Persistent storage slots created by hooks. */
  readonly state: readonly StateIR[];
  /** `useRef` values: mutable fields that never cause a render. */
  readonly refs: readonly RefIR[];
  /** `useSound` bindings: a sound each, played by calling its function in a handler. */
  readonly sounds: readonly SoundIR[];
  /** Declared props, from the destructured parameter. Empty for a component without props. */
  readonly props: readonly PropDeclIR[];
  /** The name of the props type (`EnemyProps`), or null for a component without props. */
  readonly propsType: string | null;
  /** `export default function Enemy() {}` or `export default Enemy;`: the module also exports it as its default. */
  readonly isDefaultExport: boolean;
  /**
   * Exported (`export function`, or the module's default export): a prefab, which
   * scenes can place by name. A component that is not exported is private to its file.
   */
  readonly isExported: boolean;
  /**
   * The props type declares `children: Child` and the JSX has a `{children}`
   * slot: a parent may pass elements, which mount at the slot. Such a
   * component's runtime props are the props type without `children`.
   */
  readonly acceptsChildren: boolean;
  /** The root `<Entity>`: describes the component instance itself. */
  readonly root: HostElementIR;
}

// ---------------------------------------------------------------------------
// Hooks and state
// ---------------------------------------------------------------------------

/** Hook declarations. (`useRef` is not a hook entry: its handle is a `RefIR` in `ComponentIR.refs`.) */
export type HookIR = UseStateHookIR | OnUpdateHookIR | OnInputHookIR | OnMountHookIR | OnUnmountHookIR;

/**
 * The fields of a transform (runtime `Entity.transform`), settable with the
 * `transform={{ x, y }}` attribute. Pixels, y down; `rotation` in radians.
 * Relative to the nearest ancestor `<Entity>` unless `global` is true.
 */
export const TRANSFORM_FIELDS = ["x", "y", "z", "rotation", "scaleX", "scaleY", "global"] as const;

export type TransformField = (typeof TRANSFORM_FIELDS)[number];

/**
 * `const playHit = useSound("hit.wav")`: a sound this component can play. The
 * path is a literal so a missing asset can be reported at build time once
 * there is an asset list. Calling the binding is only valid in a handler.
 */
export interface SoundIR {
  readonly kind: "Sound";
  readonly id: SoundId;
  /** Also the generated field name. */
  readonly name: string;
  readonly path: string;
  readonly span: SourceSpan;
}

/**
 * `const cooldown = useRef(0)`: a value that persists across frames and
 * renders but is not state. Reading or writing `cooldown.current` never marks
 * anything dirty, so it is for bookkeeping nothing on screen depends on
 * (timers, accumulators, previous values). Refs hold values only; there is no
 * `ref={…}` on elements.
 */
export interface RefIR {
  readonly kind: "Ref";
  readonly id: RefId;
  /** Also the generated field name. */
  readonly name: string;
  readonly type: ValueType;
  /** Must not read state. */
  readonly initialValue: ExprIR;
  readonly span: SourceSpan;
}

export interface UseStateHookIR {
  readonly kind: "UseState";
  readonly state: StateId;
  /** Name of the generated setter method, or null if the setter was not bound. */
  readonly setterName: string | null;
  readonly span: SourceSpan;
}

/** `onUpdate((dt) => { ... })`: runs once per `World.tick(dt, input)`, after `onInput`. */
export interface OnUpdateHookIR {
  readonly kind: "OnUpdate";
  readonly handler: FunctionIR;
  readonly span: SourceSpan;
}

/** `onInput((input) => { ... })`: runs once per tick with the polled `InputState`, before `onUpdate`. */
export interface OnInputHookIR {
  readonly kind: "OnInput";
  readonly handler: FunctionIR;
  readonly span: SourceSpan;
}

/**
 * `useMount(() => { ... })`: runs once when the component joins a `World`,
 * after its children have mounted (and its first render, which the
 * constructor runs). Setting state here renders in the same flush.
 */
export interface OnMountHookIR {
  readonly kind: "OnMount";
  readonly handler: FunctionIR;
  readonly span: SourceSpan;
}

/**
 * `useUnmount(() => { ... })`: runs once when the component leaves its
 * `World`. It cannot set state (the component is going away); refs and
 * callback props work.
 */
export interface OnUnmountHookIR {
  readonly kind: "OnUnmount";
  readonly handler: FunctionIR;
  readonly span: SourceSpan;
}

export type HandlerHookIR = OnUpdateHookIR | OnInputHookIR | OnMountHookIR | OnUnmountHookIR;

export function isHandlerHook(hook: HookIR): hook is HandlerHookIR {
  return hook.kind === "OnUpdate" || hook.kind === "OnInput" || hook.kind === "OnMount" || hook.kind === "OnUnmount";
}

export interface StateIR {
  readonly kind: "State";
  readonly id: StateId;
  /** Field name on the generated class. */
  readonly name: string;
  /** A primitive, an array (`useState<EnemyData[]>([])`) or a source type. */
  readonly type: TypeIR;
  /** Must not depend on any state. For a game-state leaf, the value it starts with. */
  readonly initialValue: ExprIR;
  /**
   * Set for `const hp = useGame((s) => s.player.hp)`: the dotted path (`"player.hp"`) of the game-state leaf this state
   * mirrors. The generated field is a snapshot of it, refreshed on render; it has no setter (actions change it).
   * Absent for `useState`.
   */
  readonly globalKey?: string;
}
