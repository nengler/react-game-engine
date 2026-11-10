import { FLEX_ALIGN_ITEMS, FLEX_ANCHORS, FLEX_DIRECTIONS, FLEX_JUSTIFY_CONTENT } from "./components/Flex.ts";
import { TEXT_ALIGNS } from "./components/Text.ts";
import { SCREEN_FITS } from "./components/Screen.ts";
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
   * The fields and methods each intrinsic defines on itself, beyond
   * `GameObject`'s. A component rooted at one extends it, so its state, refs and
   * props may not reuse these names. A runtime test checks the list is exactly
   * what the class defines.
   */
  readonly intrinsicMembers: Readonly<Record<string, readonly string[]>>;
  /**
   * Hooks (`onInput`, `onUpdate`, `onMount`, `onUnmount`) an intrinsic
   * implements itself, by intrinsic (`AnimatedSprite.onUpdate` advances its
   * frame). A component rooted at one that writes the same hook overrides it, so
   * the generated override calls `super` first. A runtime test checks the list
   * is exactly the hooks the classes override.
   */
  readonly intrinsicHooks: Readonly<Record<string, readonly string[]>>;
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
   * Props of an intrinsic that take a size: a number, `"fit"`, `"grow"` or a percentage string such as `"50%"` (`<Flex
   * width>`), by intrinsic. The compiler checks a literal and suggests the nearest keyword for a typo; any other
   * expression is left to the type-check.
   */
  readonly intrinsicSizing: Readonly<Record<string, readonly string[]>>;
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
  intrinsics: ["Entity", "Game", "Sprite", "Collider", "Text", "Shape", "Camera", "AnimatedSprite", "Pointer", "Screen", "Hud", "Flex"],
  hostIntrinsic: "Entity",
  containerIntrinsics: ["Entity", "Game", "Camera", "Screen", "Hud", "Flex"],
  textContent: { Text: "text" },
  intrinsicMembers: {
    Entity: ["name"],
    Game: ["name", "title", "width", "height", "background", "assets", "resizable", "vsync", "smooth", "fullscreenKey", "state"],
    Sprite: ["image"],
    Collider: ["width", "height", "tag", "layer", "hits", "onCollisionEnter", "onCollisionExit", "owner", "hitsLayer"],
    Pointer: ["width", "height", "onPress", "contains"],
    Text: ["text", "size", "color", "width", "align"],
    Shape: ["kind", "width", "height", "color"],
    Camera: ["zoom", "viewTransform", "worldToView", "viewToWorld"],
    AnimatedSprite: ["fps", "playing", "frame", "elapsed", "frames", "image"],
    Screen: ["width", "height", "fit", "pixelPerfect", "border"],
    Hud: [],
    Flex: [
      "direction", "alignItems", "justifyContent", "gap", "padding", "paddingX", "paddingY", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "background", "float", "anchor", "to", "offsetX", "offsetY", "onPress", "contains", "box",
    ],
  },
  intrinsicRequired: {
    Entity: [],
    Game: [],
    Sprite: ["image"],
    Collider: ["width", "height"],
    Pointer: ["width", "height"],
    Text: ["text"],
    Shape: ["kind", "width", "height"],
    Camera: [],
    AnimatedSprite: ["frames"],
    Screen: ["width", "height"],
    Hud: [],
    Flex: [],
  },
  intrinsicHooks: {
    AnimatedSprite: ["onUpdate"],
  },
  intrinsicLiterals: {
    Shape: { kind: SHAPE_KINDS },
    Screen: { fit: SCREEN_FITS },
    Text: { align: TEXT_ALIGNS },
    Flex: { direction: FLEX_DIRECTIONS, alignItems: FLEX_ALIGN_ITEMS, justifyContent: FLEX_JUSTIFY_CONTENT, anchor: FLEX_ANCHORS, to: FLEX_ANCHORS },
  },
  intrinsicSizing: { Flex: ["width", "height"] },
  intrinsicCallbacks: {
    Collider: {
      onCollisionEnter: [{ name: "other", type: "Contact" }],
      onCollisionExit: [{ name: "other", type: "Contact" }],
    },
    Pointer: { onPress: [] },
    Flex: { onPress: [] },
  },
  reservedMembers: [
    // Entity / GameObject instance fields and methods. A test fails if one is missing here.
    // `updateProps` is generated into every component that has props, so a field may not take the name.
    "name", "props", "applyProps", "updateProps", "transform", "placement", "layoutX", "layoutY", "worldTransform", "parent", "children", "world",
    "isDirty", "hasPendingStructure", "gameStateStore", "gameStateKeys",
    "addChild", "removeChild", "queueAddChild", "queueRemoveChild", "queueReorder", "commitStructure", "childSpace",
    "passedChildrenHost", "passedChildrenSlot", "acceptsPassedChildren", "attachPassedChild", "queueAttachPassedChild", "queueDetachPassedChild", "queueReorderPassedChildren",
    "markDirty", "markChanged", "markMoved", "reportsChanges", "selfChangedAt", "subtreeChangedAt", "contentChangedAt", "drawCache", "drawKind", "runRender", "renderInPass", "commitState", "render",
    "onInput", "onUpdate", "onMount", "onUnmount",
    "attachToWorld", "detachFromWorld",
    // Object.prototype
    "constructor", "toString", "valueOf", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  ],
  transformIntrinsics: ["Entity", "Sprite", "Collider", "Text", "Shape", "Camera", "AnimatedSprite", "Pointer", "Hud", "Flex"],
  handleTypes: {
    InputState: {
      methods: { pressed: 1, down: 1, released: 1 },
      properties: ["pointerX", "pointerY"],
    },
    Contact: { methods: {}, properties: ["tag", "owner"] },
  },
  functions: { clamp: 3 },
};
