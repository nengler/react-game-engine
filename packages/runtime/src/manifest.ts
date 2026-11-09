import { SHAPE_KINDS } from "./components/Shape.ts";

/**
 * Everything the compiler needs to know about this runtime, in one place.
 * The compiler takes a manifest as config, so adding an intrinsic or a handle
 * type here needs no compiler edit.
 */
export interface RuntimeManifest {
  /**
   * The module component source imports hooks, built-in elements and runtime
   * functions from. The compiler accepts imports from it (and from `.tsx`
   * components) and nothing else.
   */
  readonly authoringModule: string;
  /** Tag names usable in JSX without a declaration. */
  readonly intrinsics: readonly string[];
  /** The intrinsic a fragment root (`<>…</>`) becomes. A component whose root is another built-in extends that one instead. */
  readonly hostIntrinsic: string;
  /** Intrinsics whose JSX may contain children. Others (a `Sprite`, a `Collider`) are leaves. */
  readonly containerIntrinsics: readonly string[];
  /**
   * Intrinsics whose JSX text and expression children are one string prop
   * (`<Text>Score: {score}</Text>` sets `text`), by intrinsic, naming the prop.
   * They are not containers: elements cannot be their children.
   */
  readonly textContent: Readonly<Record<string, string>>;
  /**
   * The fields each intrinsic defines on itself, beyond `GameObject`'s. A
   * component rooted at one extends it, so its state, refs and props may not
   * reuse these names. A runtime test checks each is a real field.
   */
  readonly intrinsicMembers: Readonly<Record<string, readonly string[]>>;
  /**
   * Props each intrinsic's constructor requires. A component rooted at one
   * must pass them to `super()`, before any state exists, so a dynamic value
   * gets a placeholder there and its real value in the first `render()`.
   */
  readonly intrinsicRequired: Readonly<Record<string, readonly string[]>>;
  /**
   * Props of an intrinsic that take one of a fixed set of string values
   * (`<Shape kind="rect">`), by intrinsic then prop name. The compiler checks a
   * literal against the set and says what the choices are; any other
   * expression is left to the type-check.
   */
  readonly intrinsicLiterals: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /**
   * Callback props an intrinsic accepts, by intrinsic then prop name, with
   * the parameters its callback receives (a runtime handle type each).
   */
  readonly intrinsicCallbacks: Readonly<Record<string, Readonly<Record<string, readonly CallbackParamManifest[]>>>>;
  /**
   * Member names of the host class (and `Object.prototype`) that generated
   * fields, setters and handlers must not shadow.
   */
  readonly reservedMembers: readonly string[];
  /**
   * Intrinsics that take the `transform={{ x, y }}` attribute. Every runtime
   * object has a transform; an intrinsic left out here (say, a sound with no
   * position) simply cannot be placed from JSX.
   */
  readonly transformIntrinsics: readonly string[];
  /** Runtime types handler parameters may have, with the members handler code may use. */
  readonly handleTypes: Readonly<Record<string, HandleTypeManifest>>;
  /** Runtime functions handler code may call, imported from the runtime module. Name → argument count. */
  readonly functions: Readonly<Record<string, number>>;
}

export interface CallbackParamManifest {
  readonly name: string;
  /** A key of `handleTypes`. */
  readonly type: string;
}

export interface HandleTypeManifest {
  /** Method name → exact argument count. */
  readonly methods: Readonly<Record<string, number>>;
  readonly properties: readonly string[];
}

export const runtimeManifest: RuntimeManifest = {
  authoringModule: "@rge/runtime/jsx",
  intrinsics: ["Entity", "Sprite", "Collider", "Text", "Shape", "Camera"],
  hostIntrinsic: "Entity",
  containerIntrinsics: ["Entity"],
  textContent: { Text: "text" },
  intrinsicMembers: {
    Entity: ["name"],
    Sprite: ["image"],
    Collider: ["width", "height", "onCollisionEnter"],
    Text: ["text", "size", "color"],
    Shape: ["kind", "width", "height", "color"],
    Camera: ["zoom", "follow"],
  },
  intrinsicRequired: {
    Entity: [],
    Sprite: ["image"],
    Collider: ["width", "height"],
    Text: ["text"],
    Shape: ["kind", "width", "height"],
    Camera: [],
  },
  intrinsicLiterals: {
    Shape: { kind: SHAPE_KINDS },
  },
  intrinsicCallbacks: {
    Collider: { onCollisionEnter: [{ name: "other", type: "GameObject" }] },
  },
  reservedMembers: [
    // Entity / GameObject instance fields and methods. A test fails if one is missing here.
    // `updateProps` is generated into every component that has props, so a field may not take the name.
    "name", "props", "applyProps", "updateProps", "transform", "placement", "worldTransform", "parent", "children", "world",
    "isDirty", "hasPendingStructure",
    "addChild", "removeChild", "queueAddChild", "queueRemoveChild", "queueReorder", "commitStructure",
    "passedChildrenHost", "passedChildrenSlot", "acceptsPassedChildren", "attachPassedChild", "queueAttachPassedChild", "queueDetachPassedChild", "queueReorderPassedChildren",
    "markDirty", "runRender", "commitState", "render",
    "onInput", "onUpdate", "onMount", "onUnmount",
    "attachToWorld", "detachFromWorld",
    // Object.prototype
    "constructor", "toString", "valueOf", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  ],
  transformIntrinsics: ["Entity", "Sprite", "Collider", "Text", "Shape", "Camera"],
  handleTypes: {
    InputState: {
      methods: { pressed: 1, down: 1, released: 1 },
      properties: ["pointerX", "pointerY"],
    },
    GameObject: { methods: {}, properties: [] },
  },
  functions: { clamp: 3 },
};
