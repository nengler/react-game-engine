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
  /** The intrinsic every component root must be; generated classes extend it. */
  readonly hostIntrinsic: string;
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

export interface HandleTypeManifest {
  /** Method name → exact argument count. */
  readonly methods: Readonly<Record<string, number>>;
  readonly properties: readonly string[];
}

export const runtimeManifest: RuntimeManifest = {
  authoringModule: "@rge/runtime/jsx",
  intrinsics: ["Entity", "Sprite", "Collider"],
  hostIntrinsic: "Entity",
  reservedMembers: [
    // Entity / GameObject instance fields and methods. A test fails if one is missing here.
    "name", "transform", "worldTransform", "parent", "children", "world",
    "isDirty", "hasPendingStructure",
    "addChild", "removeChild", "queueAddChild", "queueRemoveChild", "commitStructure",
    "markDirty", "runRender", "commitState", "render",
    "onInput", "onUpdate", "onCollisionEnter",
    "attachToWorld", "detachFromWorld",
    // Object.prototype
    "constructor", "toString", "valueOf", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  ],
  transformIntrinsics: ["Entity", "Sprite", "Collider"],
  handleTypes: {
    InputState: {
      methods: { pressed: 1, down: 1, released: 1 },
      properties: ["pointerX", "pointerY"],
    },
    GameObject: { methods: {}, properties: [] },
  },
  functions: { clamp: 3 },
};
