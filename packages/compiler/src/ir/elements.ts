// The IR of the element tree: component references, elements, children, props and their dependencies.
import { type StateId, type ElementId, type SourceSpan } from "./ids.ts";
import { type TransformField } from "./declarations.ts";
import { type ParamIR, type FunctionIR, type PropTypeIR } from "./values.ts";
import { type ExprIR } from "./expressions.ts";



// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** What an element instantiates. */
export type ComponentRef = IntrinsicComponentRef | LocalComponentRef | ImportedComponentRef;

/** A component provided by the runtime package (Entity, Sprite, ...). */
export interface IntrinsicComponentRef {
  readonly kind: "Intrinsic";
  readonly name: string;
}

/** A compiled component declared in the same module. */
export interface LocalComponentRef {
  readonly kind: "Local";
  readonly name: string;
}

/** A compiled component declared in another source file. */
export interface ImportedComponentRef {
  readonly kind: "Imported";
  readonly name: string;
  /** The specifier as written in the source (`./WarningIcon.tsx`); the generator points it at the generated `.ts`. */
  readonly module: string;
  /** `import Enemy from "./Enemy.tsx"`: `name` is the local name of the module's default export. */
  readonly isDefault: boolean;
}

/** The component's root element; it *is* the instance, so it has no field. */
export interface HostElementIR {
  readonly kind: "HostElement";
  readonly component: IntrinsicComponentRef;
  readonly props: readonly PropIR[];
  /** `transform={{ x, y }}`: the instance's own transform. See `ElementIR.transform`. */
  readonly transform: readonly TransformPropIR[];
  readonly children: readonly ChildIR[];
  readonly span: SourceSpan;
}

/** A persistent child instance owned by the component. */
export interface ElementIR {
  readonly kind: "Element";
  readonly id: ElementId;
  /** Unique within the component. */
  readonly fieldName: string;
  readonly component: ComponentRef;
  readonly props: readonly PropIR[];
  /**
   * `transform={{ x: x, y: 0 }}`: writes to the element's runtime `transform`
   * (only `<Entity>` elements have one). Each field is a static or dynamic
   * prop like any other, so position is ordinary state: `setX(...)` moves it.
   */
  readonly transform: readonly TransformPropIR[];
  /**
   * On a built-in, its own children. On a component, the children passed to it
   * (`<Panel><Button /></Panel>`): still owned by this component, which
   * constructs, updates and removes them, while the receiving component says
   * where they mount (its `{children}` slot).
   */
  readonly children: readonly ChildIR[];
  readonly span: SourceSpan;
}

/** How a child exists over time. */
export type ChildIR = StaticChildIR | ConditionalChildIR | KeyedListChildIR | ChildrenSlotChildIR;

/**
 * `{children}`: where the elements a parent passes to this component mount.
 * It takes a position among its siblings (so passed children land between
 * them), but is no element of this component: the parent owns what mounts.
 * Only in a container reachable through static elements, once per component.
 */
export interface ChildrenSlotChildIR {
  readonly kind: "ChildrenSlot";
}

/** Created once with its parent; never recreated. */
export interface StaticChildIR {
  readonly kind: "StaticChild";
  readonly element: ElementIR;
}

/** Created when `condition` becomes truthy, destroyed when it becomes falsy. */
export interface ConditionalChildIR {
  readonly kind: "ConditionalChild";
  readonly condition: ExprIR;
  readonly dependencies: readonly DependencyIR[];
  readonly element: ElementIR;
}

/**
 * `{enemies.map((e) => <Enemy key={e.id} speed={e.speed} />)}`: one instance
 * of `element` per item of `source`, kept by key across renders. A new key
 * constructs an instance, a missing key removes it, and an existing key
 * updates its instance's props in place. The items share their parent slot
 * and are ordered within it by list position.
 */
export interface KeyedListChildIR {
  readonly kind: "KeyedListChild";
  /** A state or prop array, optionally followed by `.filter(…)` calls. */
  readonly source: ExprIR;
  /** The item parameter: read as `ParamRead` in `key` and the element's props. */
  readonly item: ParamIR;
  /** The index parameter, if the callback declares one. Not readable inside callback props (it changes on reorder). */
  readonly index: ParamIR | null;
  readonly key: ExprIR;
  /**
   * The item element. Its props that read the item or index are dynamic
   * with an `Item` dependency; it has no children. Its `fieldName` names the
   * list's generated fields (`enemyItems`, `#enemyOrder`).
   */
  readonly element: ElementIR;
  /** What `source` reads: the list re-renders when one changes. */
  readonly dependencies: readonly DependencyIR[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PropIR = ValuePropIR | CallbackPropIR;

/** A prop that is a value: static (evaluated once) or dynamic (re-evaluated on render). */
export type ValuePropIR = StaticPropIR | DynamicPropIR;

/** A `transform` field; `name` is one of `TRANSFORM_FIELDS`. */
export type TransformPropIR = ValuePropIR & { readonly name: TransformField };

/**
 * What a dynamic value depends on, so a render is only needed when it can
 * have changed: a state slot of this component, or one of its props (which
 * the parent updates through `updateProps`).
 */
export type DependencyIR =
  | { readonly kind: "State"; readonly state: StateId }
  | { readonly kind: "Prop"; readonly name: string }
  /** The item (or index) of the keyed list the element belongs to: re-applied for every item on each render of the list. */
  | { readonly kind: "Item" };

/**
 * A callback passed to a child component: `onDefeated={() => setScore(…)}`.
 * Created once with the child, inline in its constructor call, so it is
 * contextually typed by the child's props type and reads state through
 * `this` (never stale). It is therefore never "dynamic".
 */
export interface CallbackPropIR {
  readonly kind: "CallbackProp";
  readonly name: string;
  /** Parameters are `Contextual`: their types come from the child. */
  readonly handler: FunctionIR;
}

// -- declared props (the receiving side) --------------------------------------

/** A prop a component declares in its destructured parameter. */
export interface PropDeclIR {
  readonly kind: "PropDecl";
  readonly name: string;
  /** `?` in the props type, or a default in the destructuring. */
  readonly optional: boolean;
  /** `= 1` in the destructuring; must not read state or other props. */
  readonly defaultValue: ExprIR | null;
  /** A function type is a callback (called, never read); anything else is a value. */
  readonly role: "value" | "callback";
  readonly type: PropTypeIR;
}

/** Evaluated once at construction. */
export interface StaticPropIR {
  readonly kind: "StaticProp";
  readonly name: string;
  readonly value: ExprIR;
}

/** Re-evaluated on render and written to the existing instance. */
export interface DynamicPropIR {
  readonly kind: "DynamicProp";
  readonly name: string;
  readonly value: ExprIR;
  readonly dependencies: readonly DependencyIR[];
}
