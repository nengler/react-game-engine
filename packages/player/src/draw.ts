import {
  AnimatedSprite,
  Camera,
  Collider,
  composeTransforms,
  IDENTITY_TRANSFORM,
  offsetTransform,
  Pointer,
  Flex,
  Game,
  GameObject,
  Hud,
  Screen,
  Shape,
  Sprite,
  isStyled,
  Text,
  Tilemap,
  Particles,
  Fade,
  findTilemap,
  TILE_FLIP_D,
  TILE_FLIP_H,
  TILE_FLIP_V,
  type Pressable,
  type ScreenFit,
  type ViewTransform,
  type WorldTransform,
} from "@rge/runtime";
import { MAGENTA, parseColor, type PackedColor } from "./color.ts";
import { Layouter, type MeasuredSize } from "./layout.ts";
import {
  RGE_OP_ELLIPSE,
  RGE_OP_ELLIPSE_LEN,
  RGE_OP_RECT,
  RGE_OP_RECT_LEN,
  RGE_OP_SPRITE,
  RGE_OP_SPRITE_LEN,
  RGE_OP_SPRITE_REGION,
  RGE_OP_SPRITE_REGION_LEN,
  RGE_SPRITE_FLIP_X,
  RGE_SPRITE_FLIP_Y,
  RGE_OP_TEXT,
  RGE_OP_TEXT_LEN,
  RGE_OP_VIEW,
  RGE_OP_VIEW_LEN,
  RGE_OP_SCISSOR,
  RGE_OP_SCISSOR_END,
  RGE_OP_CANVAS,
  RGE_OP_SCISSOR_LEN,
  RGE_OP_SCISSOR_END_LEN,
  RGE_OP_CANVAS_LEN,
} from "./protocol.ts";
import { borderRects, fitScreen, viewToWindow, type ScreenPlacement, type WindowRect } from "./screen.ts";
import { Warner } from "./warn.ts";

/**
 * Visit every object under `root` in draw order (a parent before its children, children in their
 * order), with the world transform `object.worldTransform()` would give it. The transforms are
 * composed on the way down instead of recomputed from the root for each object, and a camera is
 * transparent to its children, as `GameObject.childSpace()` says. `test/draw.test.ts` checks the
 * two agree over a real tree; if a built-in ever overrides `childSpace()` again, change this too.
 *
 * `visit` is also given the object's draw order, `z`: its own `transform.z` and `placement.z` added to its parent's,
 * with `global` cutting the chain as it does for position (see `Transform`). A camera is transparent here too.
 *
 * A `<Hud>` is visited but not entered, because its subtree is drawn in a layer of its own (see `FrameBuilder.build`);
 * `intoHuds` walks it as a plain container instead, which is how that layer is walked.
 */
export function walkTree(
  root: GameObject,
  visit: (object: GameObject, world: WorldTransform, z: number, kind: number) => WorldTransform | void,
  parentSpace: WorldTransform = IDENTITY_TRANSFORM,
  parentZ = 0,
  intoHuds = false,
): void {
  walk(root, visit, parentSpace, parentZ, intoHuds);
}

/**
 * `walkTree` without default parameters, which QuickJS pays for on every call of a recursion that runs once per object.
 * `visit` is also told the object's kind (`KIND_*`), found here once, so it does not look it up again.
 */
function walk(
  root: GameObject,
  visit: (object: GameObject, world: WorldTransform, z: number, kind: number) => WorldTransform | void,
  parentSpace: WorldTransform,
  parentZ: number,
  intoHuds: boolean,
): void {
  const transform = root.transform;
  const placement = root.placement;
  // The zero test is inline, not left to offsetTransform: QuickJS does not inline calls, and almost nothing has a layout offset.
  const laidOut = root.layoutX === 0 && root.layoutY === 0 ? parentSpace : offsetTransform(parentSpace, root.layoutX, root.layoutY);
  // Almost every placement is the identity, and then composing it gives `laidOut` back: skip the call.
  let world = composeTransforms(
    placement.x === 0 && placement.y === 0 && placement.rotation === 0 && placement.scaleX === 1 && placement.scaleY === 1 && !placement.global
      ? laidOut
      : composeTransforms(laidOut, placement),
    transform,
  );
  // Nearly nothing has a z, and then none of the three terms or the `global` flags matter: the answer is 0.
  const z =
    parentZ === 0 && transform.z === 0 && placement.z === 0 ? 0
    : transform.global ? transform.z
    : placement.global ? placement.z + transform.z
    : parentZ + placement.z + transform.z;
  const kind = kindOf(root);
  // A visit may return the world to use for the children instead: a floating layout root is placed by the layout it has just run.
  const replaced = visit(root, world, z, kind);
  if (replaced !== undefined) world = replaced;
  if (!intoHuds && kind === KIND_HUD) return;
  const isCamera = kind === KIND_CAMERA;
  const childSpace = isCamera ? parentSpace : world;
  const childZ = isCamera ? parentZ : z;
  // Indexed, not `for…of`: QuickJS makes an iterator object for every `for…of`, and this runs for every object every frame.
  const children = root.children;
  for (let i = 0; i < children.length; i++) walk(children[i] as GameObject, visit, childSpace, childZ, intoHuds);
}

/** How many doubles the record starting with this op takes. */
function recordLength(op: number): number {
  switch (op) {
    case RGE_OP_VIEW: return RGE_OP_VIEW_LEN;
    case RGE_OP_SPRITE: return RGE_OP_SPRITE_LEN;
    case RGE_OP_SPRITE_REGION: return RGE_OP_SPRITE_REGION_LEN;
    case RGE_OP_RECT: return RGE_OP_RECT_LEN;
    case RGE_OP_ELLIPSE: return RGE_OP_ELLIPSE_LEN;
    case RGE_OP_TEXT: return RGE_OP_TEXT_LEN;
    case RGE_OP_SCISSOR: return RGE_OP_SCISSOR_LEN;
    case RGE_OP_SCISSOR_END: return RGE_OP_SCISSOR_END_LEN;
    case RGE_OP_CANVAS: return RGE_OP_CANVAS_LEN;
    default: throw new Error(`Unknown draw op ${op}.`);
  }
}

/**
 * The order that puts `zs` ascending and keeps the original order among equal values (a stable sort, whatever the
 * engine's own), or null when it is already in that order, which is the usual case once a HUD sits at a high `z`.
 * Every value must be a number, not NaN: a NaN would make the comparison inconsistent.
 */
function orderByZ(zs: readonly number[]): number[] | null {
  let sorted = true;
  for (let i = 1; i < zs.length; i++) {
    if ((zs[i] as number) < (zs[i - 1] as number)) {
      sorted = false;
      break;
    }
  }
  if (sorted) return null;
  const order = Array.from({ length: zs.length }, (_, i) => i);
  order.sort((a, b) => ((zs[a] as number) < (zs[b] as number) ? -1 : (zs[a] as number) > (zs[b] as number) ? 1 : a - b));
  return order;
}

/** A growable frame of draw records (see `native/include/rge.h`) and the strings its text records refer to. */
export class DrawList {
  records = new Float64Array(1024);
  length = 0;
  texts: string[] = [];
  /**
   * Where draw order stops being tree order: `[offset, z, offset, z, …]`, one pair each time `setZ` is given a
   * different value, `offset` being where the next record starts. Empty (and free) for a game that never uses `z`.
   */
  readonly #zRuns: number[] = [];
  #z = 0;
  #scratch = new Float64Array(1024);

  reset(): void {
    this.length = 0;
    this.texts.length = 0;
    this.#zRuns.length = 0;
    this.#z = 0;
  }

  /** The draw order of the records written from now on. Only a change is kept. */
  setZ(z: number): void {
    if (z === this.#z) return;
    this.#z = z;
    this.#zRuns.push(this.length, z);
  }

  /**
   * Put the records from `from` on in `z` order, lowest first, keeping tree order among equal values: what has a
   * higher `z` is drawn later, so on top. The records before `from` (the view) and any written after the sort
   * (the screen's bars) stay where they are. Text records refer to `texts` by index, so they move freely.
   */
  sortByZ(from: number): void {
    if (this.#zRuns.length === 0) return;
    this.#sort(from);
    // The runs belong to the records just sorted; a later layer (the HUD) starts its own.
    this.#zRuns.length = 0;
    this.#z = 0;
  }

  #sort(from: number): void {
    const runs = this.#zRuns;
    const starts: number[] = [];
    const zs: number[] = [];
    let run = 0;
    let z = 0;
    for (let at = from; at < this.length; at += recordLength(this.records[at] as number)) {
      while (run < runs.length && (runs[run] as number) <= at) {
        z = runs[run + 1] as number;
        run += 2;
      }
      starts.push(at);
      zs.push(z);
    }
    const order = orderByZ(zs);
    if (order === null) return;
    const total = this.length - from;
    if (this.#scratch.length < total) this.#scratch = new Float64Array(Math.max(this.#scratch.length * 2, total));
    const scratch = this.#scratch;
    const records = this.records;
    let write = 0;
    for (let i = 0; i < order.length; i++) {
      const start = starts[order[i] as number] as number;
      const length = recordLength(records[start] as number);
      for (let k = 0; k < length; k++) scratch[write + k] = records[start + k] as number;
      write += length;
    }
    for (let k = 0; k < total; k++) records[from + k] = scratch[k] as number;
  }

  #reserve(count: number): number {
    const at = this.length;
    if (at + count > this.records.length) this.grow(count);
    this.length = at + count;
    return at;
  }

  /** Make room for `count` more doubles after `length`, for a caller that writes a record into `records` itself and then moves `length` on. */
  grow(count: number): void {
    const at = this.length;
    if (at + count <= this.records.length) return;
    const grown = new Float64Array(Math.max(this.records.length * 2, at + count));
    grown.set(this.records.subarray(0, at));
    this.records = grown;
  }

  #header(op: number, count: number, world: WorldTransform): number {
    const at = this.#reserve(count);
    const r = this.records;
    r[at] = op;
    r[at + 1] = world.x;
    r[at + 2] = world.y;
    r[at + 3] = world.rotation;
    r[at + 4] = world.scaleX;
    r[at + 5] = world.scaleY;
    return at + 6;
  }

  /**
   * Append the records `[from, to)` of `source`, a copy of an earlier frame's. `textShift` is added to the text index of
   * every text record in them (the strings they refer to are re-added at new positions); pass 0 when there are none.
   */
  appendFrom(source: Float64Array, from: number, to: number, textShift: number, hasText: boolean): void {
    const count = to - from;
    const at = this.#reserve(count);
    const r = this.records;
    r.set(source.subarray(from, to), at);
    if (!hasText) return;
    const end = at + count;
    for (let p = at; p < end; p += recordLength(r[p] as number)) {
      if (r[p] === RGE_OP_TEXT) r[p + 6] = (r[p + 6] as number) + textShift;
    }
  }

  /** The canvas record, which must be first in the frame: draw into a `width` × `height` texture, shown in the window at `dest`. */
  canvas(width: number, height: number, dest: WindowRect, border: PackedColor): void {
    const at = this.#reserve(RGE_OP_CANVAS_LEN);
    const r = this.records;
    r[at] = RGE_OP_CANVAS;
    r[at + 1] = width;
    r[at + 2] = height;
    r[at + 3] = dest.x;
    r[at + 4] = dest.y;
    r[at + 5] = dest.width;
    r[at + 6] = dest.height;
    r[at + 7] = border;
  }

  view(v: ViewTransform): void {
    const at = this.#reserve(RGE_OP_VIEW_LEN);
    this.setView(at, v);
  }

  /** Overwrite the view record at `at` (the first record, written before the camera is known). */
  setView(at: number, v: ViewTransform): void {
    const r = this.records;
    r[at] = RGE_OP_VIEW;
    r[at + 1] = v.a;
    r[at + 2] = v.b;
    r[at + 3] = v.c;
    r[at + 4] = v.d;
    r[at + 5] = v.e;
    r[at + 6] = v.f;
  }

  sprite(world: WorldTransform, texture: number): void {
    // In two steps: `this.records[this.#header(…)] = …` reads `records` before the header is written, so a record that made
    // the buffer grow had its texture written into the old one, and was drawn with texture 0 for that frame.
    const at = this.#header(RGE_OP_SPRITE, RGE_OP_SPRITE_LEN, world);
    this.records[at] = texture;
  }

  /** One region of a texture (a frame of a sheet), with its origin, mirroring and tint: the record `RGE_OP_SPRITE_REGION`. */
  spriteRegion(world: WorldTransform, texture: number, srcX: number, srcY: number, srcW: number, srcH: number, originX: number, originY: number, flags: number, tint: PackedColor): void {
    this.spriteRegionAt(world.x, world.y, world.rotation, world.scaleX, world.scaleY, texture, srcX, srcY, srcW, srcH, originX, originY, flags, tint);
  }

  /** `spriteRegion` with the transform as numbers, for a tilemap's many records (no object per tile). */
  spriteRegionAt(x: number, y: number, rotation: number, scaleX: number, scaleY: number, texture: number, srcX: number, srcY: number, srcW: number, srcH: number, originX: number, originY: number, flags: number, tint: PackedColor): void {
    const base = this.#reserve(RGE_OP_SPRITE_REGION_LEN);
    const r = this.records;
    r[base] = RGE_OP_SPRITE_REGION;
    r[base + 1] = x;
    r[base + 2] = y;
    r[base + 3] = rotation;
    r[base + 4] = scaleX;
    r[base + 5] = scaleY;
    const at = base + 6;
    r[at] = texture;
    r[at + 1] = srcX;
    r[at + 2] = srcY;
    r[at + 3] = srcW;
    r[at + 4] = srcH;
    r[at + 5] = originX;
    r[at + 6] = originY;
    r[at + 7] = flags;
    r[at + 8] = tint;
  }

  rect(world: WorldTransform, width: number, height: number, color: PackedColor): void {
    const at = this.#header(RGE_OP_RECT, RGE_OP_RECT_LEN, world);
    this.records[at] = width;
    this.records[at + 1] = height;
    this.records[at + 2] = color;
  }

  ellipse(world: WorldTransform, width: number, height: number, color: PackedColor): void {
    const at = this.#header(RGE_OP_ELLIPSE, RGE_OP_ELLIPSE_LEN, world);
    this.records[at] = width;
    this.records[at + 1] = height;
    this.records[at + 2] = color;
  }

  text(world: WorldTransform, text: string, size: number, color: PackedColor): void {
    const at = this.#header(RGE_OP_TEXT, RGE_OP_TEXT_LEN, world);
    this.records[at] = this.texts.length;
    this.records[at + 1] = size;
    this.records[at + 2] = color;
    this.texts.push(text);
  }
}

export interface FrameBuilderOptions {
  /** Load a texture through the backend: a handle, or -1 if it could not be loaded. */
  loadTexture(path: string): number;
  /** The width and line height in pixels of `text` drawn at `size`, from the backend. Without it, they are estimated (`estimateTextWidth`, and a line as tall as `size`). */
  measureText?: (text: string, size: number) => Size;
  /** The size in pixels of a loaded texture, from the backend. Without it, every texture measures 0 × 0. */
  textureSize?: (handle: number) => Size;
  /** Folder that image names are relative to. Default `"assets"`. */
  assets?: string;
  /** Where warnings go. Default `console.warn`. */
  warn?: (message: string) => void;
  /**
   * Reuse last frame's draw records for subtrees that have not changed since (see "Reusing draw records" on `FrameBuilder`).
   * `false` rebuilds everything each frame; `"check"` reuses, then builds the frame again from scratch and throws if the two differ,
   * which is how the tests (and a game under development) catch a change that nothing reported. Default `true`.
   */
  retain?: boolean | "check";
}

export interface ColliderEntry {
  readonly collider: Collider;
  readonly world: WorldTransform;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface BuiltFrame {
  readonly list: DrawList;
  /**
   * The world → window map: the camera's view (identity with no camera), then, under a root `<Screen>`, the game's
   * scale and position in the window. This is what the mouse is taken back through; the view the records carry is the
   * same unless the game is pixel-perfect, which is drawn in game pixels and scaled by its canvas record.
   */
  readonly view: ViewTransform;
  /** The same for the `<Hud>` layers: HUD coordinates → window pixels (the screen's placement, or the identity). */
  readonly hudView: ViewTransform;
  /** Where a root `<Screen>` is drawn in the window; null without one, when the game is the window. */
  readonly screen: ScreenPlacement | null;
  readonly camera: Camera | null;
  /** In draw order: the last one is on top. The world's pointers, then (from `hudPointersFrom`) those inside a `<Hud>`. */
  readonly pointers: readonly Pressable[];
  /** Where the HUD's pointers start in `pointers`: they are pressed at `hudView`'s coordinates, not the world's. */
  readonly hudPointersFrom: number;
  readonly colliders: readonly ColliderEntry[];
}

const IDENTITY_VIEW: ViewTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const KIND_NONE = 0;
const KIND_SPRITE = 1;
const KIND_SHAPE = 2;
const KIND_TEXT = 3;
const KIND_CAMERA = 4;
const KIND_POINTER = 5;
const KIND_COLLIDER = 6;
const KIND_SCREEN = 7;
const KIND_HUD = 8;
const KIND_FLEX = 9;
const KIND_TILEMAP = 10;
const KIND_PARTICLES = 11;
const KIND_FADE = 12;
/**
 * What each class is to the frame, found once per class: `instanceof` walks the prototype chain, and the walk asked up to seven
 * times per object. The low four bits are the kind (`KIND_*`); two flags say how the class affects reusing draw records.
 */
const KINDS = new Map<Function, number>();
/** The draw records of a subtree with this object in it are never reused: it is found by the walk each frame (it feeds a list besides the draw records, or is not drawn where it is). */
const FLAG_VOLATILE = 16;
/** Nothing below this object is reused either: what it does to its children is not reported (layout), or it may change itself at any time (a hook of a hand-written class). */
const FLAG_OPAQUE = 32;

function kindCode(object: GameObject): number {
  let code = object.drawKind;
  if (code >= 0) return code;
  code = object.drawKind = classCode(object);
  return code;
}

function classCode(object: GameObject): number {
  let code = KINDS.get(object.constructor);
  if (code === undefined) {
    const kind =
      object instanceof Sprite || object instanceof AnimatedSprite ? KIND_SPRITE
      : object instanceof Shape ? KIND_SHAPE
      : object instanceof Text ? KIND_TEXT
      : object instanceof Camera ? KIND_CAMERA
      : object instanceof Pointer ? KIND_POINTER
      : object instanceof Collider ? KIND_COLLIDER
      : object instanceof Screen ? KIND_SCREEN
      : object instanceof Hud ? KIND_HUD
      : object instanceof Flex ? KIND_FLEX
      : object instanceof Tilemap ? KIND_TILEMAP
      : object instanceof Particles ? KIND_PARTICLES
      : object instanceof Fade ? KIND_FADE
      : KIND_NONE;
    code = kind;
    if (kind === KIND_CAMERA || kind === KIND_POINTER || kind === KIND_HUD || kind === KIND_FLEX) code |= FLAG_VOLATILE;
    if (kind === KIND_FLEX) code |= FLAG_OPAQUE;
    // A class that overrides a per-tick hook may write its own transform or colour from it, which nothing reports, unless it is
    // a built-in or a compiled component (the compiler marks those `managed`; the marker is an own property, so a hand-written subclass of one is not).
    const ownProperty = (name: string): boolean => Object.prototype.hasOwnProperty.call(object.constructor, name);
    const hooked = object.onInput !== GameObjectPrototype.onInput || object.onUpdate !== GameObjectPrototype.onUpdate;
    if (hooked && !ownProperty("intrinsic") && !ownProperty("managed")) code |= FLAG_VOLATILE | FLAG_OPAQUE;
    KINDS.set(object.constructor, code);
  }
  return code;
}

const GameObjectPrototype = GameObject.prototype;

/** `object.worldTransform()` for an object whose parent's child space is `parentSpace`: what the walk works out on its way down. */
function worldIn(parentSpace: WorldTransform, object: GameObject): WorldTransform {
  const placement = object.placement;
  const laidOut = object.layoutX === 0 && object.layoutY === 0 ? parentSpace : offsetTransform(parentSpace, object.layoutX, object.layoutY);
  return composeTransforms(
    placement.x === 0 && placement.y === 0 && placement.rotation === 0 && placement.scaleX === 1 && placement.scaleY === 1 && !placement.global
      ? laidOut
      : composeTransforms(laidOut, placement),
    object.transform,
  );
}

/** A sprite that is drawn as a region of its image, with options, instead of as the whole image at its top left. */
function styledSprite(node: Sprite | AnimatedSprite): boolean {
  return node instanceof AnimatedSprite ? node.styled : node.frameWidth !== undefined || node.frameHeight !== undefined || node.frame !== 0 || isStyled(node);
}

/** A rect and an ellipse are records of one length, which the walk relies on when it writes a shape in place: this line stops compiling if they ever differ. */
const SHAPE_LEN: typeof RGE_OP_RECT_LEN & typeof RGE_OP_ELLIPSE_LEN = RGE_OP_RECT_LEN;

/** What `FrameBuilder`'s world walk says about a subtree (see there). */
const WALK_CLEAN = 0;
const WALK_VOLATILE = 1;
const WALK_OPAQUE = 2;

function kindOf(object: GameObject): number {
  return kindCode(object) & 15;
}

/**
 * The `<Screen>` that sets the game's resolution: `root` itself, or its only child, which is where a `World`
 * keeps the object it mounted (`world.root` is a bare container). Either may be a `<Game>` (the configuration root)
 * whose only child is the `<Screen>`. Null when the game has none.
 */
export function rootScreen(root: GameObject): Screen | null {
  const only = root.children.length === 1 ? root.children[0] : undefined;
  for (const top of [root, only]) {
    const inner = top instanceof Game && top.children.length === 1 ? top.children[0] : top;
    if (inner instanceof Screen) return inner;
  }
  return null;
}

/** A bitmap font sheet holds the characters 32 to 127 in this many columns and rows. */
const FONT_COLUMNS = 16;
const FONT_ROWS = 6;

/** The size of the square drawn where a texture could not be loaded. */
const MISSING_TEXTURE_SIZE = 16;

/** How many measured strings are kept before the cache starts again, so a running timer cannot grow it without end. */
const TEXT_CACHE_LIMIT = 1024;

/**
 * A text width for a backend that cannot measure: 0.6 of the size per character, close to raylib's default font.
 * Layout through such a backend (a test recorder) is approximate but deterministic.
 */
export function estimateTextWidth(text: string, size: number): number {
  let characters = 0;
  for (const _ of text) characters++;
  return characters * size * 0.6;
}

const NO_SIZE: Size = { width: 0, height: 0 };

/**
 * What a `FrameBuilder` remembers about an object so it can reuse the draw records it made for it (kept in `GameObject.drawCache`).
 * Offsets are relative to the parent's own start in the same frame, so that a subtree copied from last frame keeps them all valid
 * without touching them: only the root of a copied run is updated.
 */
class DrawInfo {
  /** The builder's continuity token when this was written: a different one means it belongs to an earlier life of the builder and is ignored. */
  readonly owner: object;
  /** Whether `rel`, `colRel` and `textRel` say where this object's records are in last frame's list. */
  ok = false;
  /** The serial of the frame whose records `len`, `colLen` and `textLen` describe and that are known to be current; -1 when this object's records cannot be reused. */
  built = -1;
  /** Where this object's records start in the draw records, colliders and texts, relative to its parent's start. */
  rel = 0;
  colRel = 0;
  textRel = 0;
  /** How many doubles, collider entries and strings this object and everything under it wrote. */
  len = 0;
  colLen = 0;
  textLen = 0;
  /**
   * Every record and collider this object and everything under it wrote is at this object's own world transform (a component
   * and its plain shapes, sprites and colliders), so when only that transform changes they are last frame's with the new one in each.
   */
  flat = false;

  constructor(owner: object) {
    this.owner = owner;
  }
}

/**
 * Turns an object tree into one frame of draw records. It owns what must persist between frames: the
 * texture handles (each path is loaded once), the colour cache and the warn-once set. It draws
 * nothing itself, so it runs anywhere, with no window.
 *
 * **Reusing draw records.** Most of a game's objects stand still, and a frame spends its time on them: the walk composes a
 * transform and writes a record for each. So the builder keeps last frame's world records and, for a subtree that has not
 * changed, copies the run of records instead of making them again (and its colliders, and its texts). "Changed" is what the
 * world reports: a render, a structural change, an `AnimatedSprite` frame, or `markChanged` (see `GameObject.markChanged`); each
 * stamps the object and its ancestors with the world's serial, and the builder advances the serial once a frame. A subtree is
 * copied when nothing in it was stamped since the frame its records came from, and nothing above it was either (an ancestor's
 * transform moves it). Left out, because the walk must see them each frame: a `<Camera>`, `<Pointer>`, `<Hud>` and `<Flex>`
 * (anything that feeds a list besides the draw records, or lays its children out), anything with a non-zero `z`, and a
 * hand-written class that overrides `onInput` or `onUpdate`, whose subtree is not reused either since it may change itself unseen.
 * The unchanged-object rule is the whole contract: a transform, colour or text written anywhere but a render, with no
 * `markChanged`, is not drawn until something else redraws that object. `retain: "check"` finds that out by rebuilding.
 */
export class FrameBuilder {
  readonly #list = new DrawList();
  readonly #textures = new Map<string, number>();
  readonly #colors = new Map<string, PackedColor>();
  readonly #textureSizes = new Map<number, Size>();
  readonly #textSizes = new Map<string, Size>();
  readonly #loadTexture: (path: string) => number;
  readonly #measureText: ((text: string, size: number) => Size) | undefined;
  readonly #textureSize: ((handle: number) => Size) | undefined;
  readonly #assets: string;
  readonly #warner: Warner;
  readonly #layouter: Layouter;
  readonly #retain: boolean;
  readonly #options: FrameBuilderOptions;
  #reference: FrameBuilder | undefined;
  readonly #particle = { x: 0, y: 0, t: 0 };
  readonly #placed = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  // What reusing needs from the last frame (see `DrawInfo`): its world records in tree order, before the z sort, its texts and colliders.
  #token: object = {};
  #lastRoot: GameObject | null = null;
  #lastWorld: object | null = null;
  #prevTree = new Float64Array(1024);
  #prevTexts: string[] = [];
  #prevColliders: ColliderEntry[] = [];
  #reused = 0;
  #moved = 0;

  /** How many doubles of the last frame's world records were copied from the frame before instead of made again (for tests and benchmarks). */
  get reusedRecords(): number {
    return this.#reused;
  }

  /** How many doubles of the last frame's world records were the frame before's with a new transform written in: what an object that only moved had drawn (for tests and benchmarks). */
  get movedRecords(): number {
    return this.#moved;
  }

  constructor(options: FrameBuilderOptions) {
    this.#options = options;
    this.#retain = options.retain !== false;
    this.#loadTexture = options.loadTexture;
    this.#measureText = options.measureText;
    this.#textureSize = options.textureSize;
    this.#assets = options.assets ?? "assets";
    this.#warner = new Warner(options.warn);
    this.#layouter = new Layouter({
      measure: (object, out) => this.#measureInto(object, out),
      warn: (key, message) => this.#warner.once(key, message),
    });
  }

  /**
   * Build the frame for a window of this size. The returned `list` is reused: copy it to keep it.
   *
   * The records are, in order: the canvas (under a pixel-perfect `<Screen>`), the world's view and the world, then
   * for the `<Hud>` layers a second view (the camera ignored) and their contents, then, under a `<Screen>` that is
   * not pixel-perfect, a last view in window pixels and the border bars. A pixel-perfect game is drawn in game pixels
   * and scaled by the canvas record; any other game is drawn through views that scale to the window themselves.
   */
  build(root: GameObject, width: number, height: number): BuiltFrame {
    const list = this.#list;
    list.reset();
    const gameRoot = rootScreen(root);
    const screen = gameRoot === null ? null : this.#usableScreen(gameRoot);
    // The size of the area the game is laid out and centred in: the game's resolution, or the window.
    const placement = screen === null ? null : fitScreen(screen.width, screen.height, width, height, this.#fit(screen));
    // (`fit="expand"` makes the game wider than the `<Screen>`'s `width`, so the placement says how wide it is.)
    const gameWidth = placement === null ? width : placement.width;
    const gameHeight = placement === null ? height : placement.height;
    const pixelPerfect = screen !== null && placement !== null && screen.pixelPerfect !== false;
    const borderColor = screen === null ? 0 : this.#color(screen.border);
    if (screen !== null && placement !== null && pixelPerfect) {
      list.canvas(placement.width, placement.height, { x: placement.left, y: placement.top, width: placement.width * placement.scaleX, height: screen.height * placement.scaleY }, borderColor);
    }
    const worldStart = list.length;
    list.view(IDENTITY_VIEW);
    // Reuse needs a world to read changes from, and the same root and world as last frame to have last frame's records to copy.
    const world = root.world;
    const reuse = this.#retain && world !== null;
    const continued = reuse && this.#lastRoot === root && this.#lastWorld === world;
    if (!continued) this.#token = {};
    this.#lastRoot = null; // until this frame is done, a failure leaves nothing to reuse
    this.#reused = 0;
    const token = this.#token;
    const serial = world !== null && reuse ? ++world.serial : 0;
    const lastSerial = serial - 1;
    const prevTree = this.#prevTree;
    const prevTexts = this.#prevTexts;
    const prevColliders = this.#prevColliders;
    const region = list.length;
    let reused = 0;
    let camera: Camera | null = null;
    let pointers: Pressable[] = [];
    const pointerZs: number[] = [];
    const colliders: ColliderEntry[] = [];
    const huds: { readonly world: WorldTransform; readonly object: GameObject }[] = [];
    let anyZ = false;
    // The z of the records being written, kept here so a frame with no z makes no call per record.
    let listZ = 0;
    const colors = this.#colors;
    const textures = this.#textures;
    // What the `walk` that just returned says about `DrawInfo.flat` for the object it was given.
    let flatWalk = false;
    let moved = 0;

    /**
     * Copy last frame's records for `children[first]` and the siblings after it that can be copied in the same run (they were
     * adjacent last frame too), then return the index of the last one. Colliders and texts go with them; each member's offsets
     * are moved to where it now starts, which leaves everything inside it valid.
     */
    const copyRun = (children: GameObject[], first: number, info: DrawInfo, anc: number, oldStart: number, oldCol: number, oldText: number, startRel: number, colStart: number, textStart: number): number => {
      const count = children.length;
      let end = info.rel + info.len;
      let colEnd = info.colRel + info.colLen;
      let textEnd = info.textRel + info.textLen;
      let last = first;
      while (last + 1 < count) {
        const next = children[last + 1] as GameObject;
        const nextInfo = next.drawCache as DrawInfo | null;
        if (nextInfo === null || nextInfo.owner !== token || !nextInfo.ok || !(nextInfo.built > anc) || next.subtreeChangedAt >= nextInfo.built) break;
        if (nextInfo.rel !== end || nextInfo.colRel !== colEnd || nextInfo.textRel !== textEnd) break;
        end += nextInfo.len;
        colEnd += nextInfo.colLen;
        textEnd += nextInfo.textLen;
        last++;
      }
      const from = oldStart + info.rel;
      const colFrom = oldCol + info.colRel;
      const textFrom = oldText + info.textRel;
      const destRel = list.length - region - startRel;
      const destColRel = colliders.length - colStart;
      const destTextRel = list.texts.length - textStart;
      const records = end - info.rel;
      if (records > 0) {
        reused += records;
        if (listZ !== 0) list.setZ((listZ = 0)); // reused records have no z: what they were drawn at is not what the list is at now
        list.appendFrom(prevTree, from, from + records, list.texts.length - textFrom, textEnd > info.textRel);
      }
      for (let k = colFrom, stop = oldCol + colEnd; k < stop; k++) colliders.push(prevColliders[k] as ColliderEntry);
      const texts = list.texts;
      for (let k = textFrom, stop = oldText + textEnd; k < stop; k++) texts.push(prevTexts[k] as string);
      const rel0 = info.rel;
      const col0 = info.colRel;
      const text0 = info.textRel;
      for (let k = first; k <= last; k++) {
        const member = (children[k] as GameObject).drawCache as DrawInfo;
        member.rel = destRel + (member.rel - rel0);
        member.colRel = destColRel + (member.colRel - col0);
        member.textRel = destTextRel + (member.textRel - text0);
      }
      return last;
    };

    /**
     * The world walk: `walkTree` and the visit in one, because it also decides, for each child, whether to copy its records
     * from last frame. Returns `WALK_CLEAN`, `WALK_VOLATILE` (something in this subtree must be found by the walk every frame:
     * `FLAG_VOLATILE`, a z, or a descendant like that, which is what keeps its records from being reused) or `WALK_OPAQUE`
     * (this object is `FLAG_OPAQUE`, so nothing under it is ever reused and its own position is not worth keeping).
     *
     * `anc` is the newest stamp on an ancestor's own transform (`Infinity` under something opaque): a child's records are
     * current only if they were made after it. `oldStart`, `oldCol` and `oldText` say where this object's records, colliders and
     * texts were in last frame's lists, or -1 when they are not known. (A closure, not a method: QuickJS makes a private-method call slow, and this runs per object.)
     */
    const walk = (node: GameObject, parentSpace: WorldTransform, parentZ: number, anc: number, oldStart: number, oldCol: number, oldText: number): number => {
      const transform = node.transform;
      const placement = node.placement;
      const laidOut = node.layoutX === 0 && node.layoutY === 0 ? parentSpace : offsetTransform(parentSpace, node.layoutX, node.layoutY);
      let at = composeTransforms(
        placement.x === 0 && placement.y === 0 && placement.rotation === 0 && placement.scaleX === 1 && placement.scaleY === 1 && !placement.global
          ? laidOut
          : composeTransforms(laidOut, placement),
        transform,
      );
      const z =
        parentZ === 0 && transform.z === 0 && placement.z === 0 ? 0
        : transform.global ? transform.z
        : placement.global ? placement.z + transform.z
        : parentZ + placement.z + transform.z;
      const code = node.drawKind >= 0 ? node.drawKind : kindCode(node);
      const kind = code & 15;
      const children = node.children;
      const count = children.length;
      // Where this object's records start, for its children's offsets (a leaf has none).
      const startRel = count > 0 ? list.length - region : 0;
      const colStart = count > 0 ? colliders.length : 0;
      const textStart = count > 0 ? list.texts.length : 0;

      let drawZ = z;
      if (drawZ !== 0) {
        if (drawZ !== drawZ) {
          this.#warner.once("z-nan", "A transform's z is not a number: it is drawn at z 0.");
          drawZ = 0;
        } else anyZ = true;
      }
      switch (kind) {
        case KIND_SPRITE:
          if (drawZ !== listZ) list.setZ((listZ = drawZ));
          this.#spriteNode(node as Sprite | AnimatedSprite, at);
          break;
        case KIND_SHAPE:
          if (drawZ !== listZ) list.setZ((listZ = drawZ));
          this.#shape(node as Shape, at);
          break;
        case KIND_TEXT:
          if ((node as Text).text !== "") {
            if (drawZ !== listZ) list.setZ((listZ = drawZ));
            this.#text(node as Text, at);
          }
          break;
        case KIND_TILEMAP:
          if (drawZ !== listZ) list.setZ((listZ = drawZ));
          this.#tilemap(node as Tilemap, at);
          break;
        case KIND_PARTICLES:
          if (drawZ !== listZ) list.setZ((listZ = drawZ));
          this.#particles(node as Particles, at);
          break;
        case KIND_FADE:
          this.#warner.once("fade-world", "A <Fade> only draws inside a <Hud>: this one, in the world, does nothing.");
          break;
        case KIND_CAMERA:
          if (camera === null) camera = node as Camera;
          else this.#warner.once("camera", "More than one <Camera> is mounted: only the first one in draw order is used.");
          break;
        case KIND_POINTER:
          pointers.push(node as Pointer);
          pointerZs.push(drawZ);
          break;
        case KIND_COLLIDER:
          colliders.push({ collider: node as Collider, world: at });
          break;
        case KIND_SCREEN:
          if (node !== gameRoot) this.#warner.once("screen-not-root", "A <Screen> only sets the game's resolution as the root of the game: this one is drawn as a plain container.");
          break;
        case KIND_HUD:
          huds.push({ world: at, object: node });
          return WALK_VOLATILE; // drawn in a layer of its own, and not entered here
        case KIND_FLEX: {
          if (drawZ !== listZ && (node as Flex).background !== undefined) list.setZ((listZ = drawZ));
          const placed = this.#flex(node as Flex, at, gameWidth, gameHeight);
          if ((node as Flex).onPress !== undefined) {
            pointers.push(node as Flex);
            pointerZs.push(drawZ);
          }
          if (placed !== undefined) at = placed;
          break;
        }
      }

      // An entity, sprite, shape or collider writes what it writes at `at`; a text may shift it, and the rest are not plain drawing.
      const plainKind = (kind < KIND_TEXT && !(kind === KIND_SPRITE && styledSprite(node as Sprite | AnimatedSprite))) || kind === KIND_COLLIDER;
      if (count === 0) {
        flatWalk = plainKind;
        return (code & FLAG_OPAQUE) !== 0 ? WALK_OPAQUE : z !== 0 || code >= FLAG_VOLATILE ? WALK_VOLATILE : WALK_CLEAN;
      }
      const childAnc = (code & FLAG_OPAQUE) !== 0 ? Infinity : node.selfChangedAt > anc ? node.selfChangedAt : anc;
      // Nothing above changed this frame: what is under is worth copying from last frame, and worth writing down for the next.
      if (reuse && childAnc < lastSerial) {
        const result = walkChildren(children, count, kind, code, at, z, parentSpace, parentZ, childAnc, oldStart, oldCol, oldText, startRel, colStart, textStart);
        flatWalk = false; // not looked into: its children may have been copied
        return result;
      }

      // This object changed this frame, or something above it did (or nothing is reused at all): everything under it is made
      // again, and nothing is written down; a child that was is told its place is no longer known.
      let volatile = z !== 0 || code >= FLAG_VOLATILE;
      const isCamera = kind === KIND_CAMERA;
      const childSpace = isCamera ? parentSpace : at;
      const childZ = isCamera ? parentZ : z;
      let flat = plainKind; // so far, everything written under this object is at `at`
      for (let i = 0; i < count; i++) {
        const child = children[i] as GameObject;
        let result = -1;
        // A leaf that draws or collides where its parent put it (the `<Shape>`, `<Sprite>` and `<Collider>` of a component that
        // moves) is most of what is here, so it is dealt with in place: what `walk` would do for it, without the call.
        if (childZ === 0 && child.children.length === 0 && child.layoutX === 0 && child.layoutY === 0) {
          const leaf = child.drawKind >= 0 ? child.drawKind : kindCode(child);
          if (leaf === KIND_SHAPE || leaf === KIND_COLLIDER || (leaf === KIND_SPRITE && !styledSprite(child as Sprite | AnimatedSprite))) {
            const own = child.transform;
            const placed = child.placement;
            if (own.z === 0 && placed.z === 0 && placed.x === 0 && placed.y === 0 && placed.rotation === 0 && placed.scaleX === 1 && placed.scaleY === 1 && !placed.global) {
              const world = own.x === 0 && own.y === 0 && own.rotation === 0 && own.scaleX === 1 && own.scaleY === 1 && !own.global ? childSpace : composeTransforms(childSpace, own);
              if (world !== childSpace) flat = false;
              if (leaf === KIND_COLLIDER) colliders.push({ collider: child as Collider, world });
              else {
                if (listZ !== 0) list.setZ((listZ = 0));
                // `#sprite` and `#shape`, and the `DrawList` calls under them, written out.
                const o = list.length;
                if (leaf === KIND_SPRITE) {
                  const image = (child as Sprite | AnimatedSprite).image;
                  const handle = image === "" ? undefined : textures.get(image);
                  // Nothing to draw, a texture not asked for yet, or one that could not be loaded: the general way.
                  if (handle === undefined || handle < 0) this.#sprite(image, world);
                  else {
                    if (o + RGE_OP_SPRITE_LEN > list.records.length) list.grow(RGE_OP_SPRITE_LEN);
                    const r = list.records;
                    r[o] = RGE_OP_SPRITE;
                    r[o + 1] = world.x;
                    r[o + 2] = world.y;
                    r[o + 3] = world.rotation;
                    r[o + 4] = world.scaleX;
                    r[o + 5] = world.scaleY;
                    r[o + 6] = handle;
                    list.length = o + RGE_OP_SPRITE_LEN;
                  }
                } else {
                  const css = (child as Shape).color;
                  let color = colors.get(css);
                  if (color === undefined) color = this.#color(css);
                  if (o + SHAPE_LEN > list.records.length) list.grow(SHAPE_LEN);
                  const r = list.records;
                  r[o] = (child as Shape).kind === "circle" ? RGE_OP_ELLIPSE : RGE_OP_RECT;
                  r[o + 1] = world.x;
                  r[o + 2] = world.y;
                  r[o + 3] = world.rotation;
                  r[o + 4] = world.scaleX;
                  r[o + 5] = world.scaleY;
                  r[o + 6] = (child as Shape).width;
                  r[o + 7] = (child as Shape).height;
                  r[o + 8] = color;
                  list.length = o + SHAPE_LEN;
                }
              }
              result = WALK_CLEAN;
            }
          }
        }
        if (result < 0) {
          result = walk(child, childSpace, childZ, childAnc, -1, -1, -1);
          flat = false;
        }
        if (result !== WALK_CLEAN) volatile = true;
        if (reuse) {
          const info = child.drawCache as DrawInfo | null;
          if (info !== null) info.ok = false;
        }
      }
      flatWalk = flat;
      return (code & FLAG_OPAQUE) !== 0 ? WALK_OPAQUE : volatile ? WALK_VOLATILE : WALK_CLEAN;
    };

    /**
     * The part of `walk` for an object whose children may be copied from last frame (nothing above them changed this frame),
     * apart so that the other objects do not pay for its many locals (QuickJS sets up every local of a function at each call).
     * `childAnc` is `anc` for the children: the newest stamp on this object or above it.
     */
    const walkChildren = (children: GameObject[], count: number, kind: number, code: number, at: WorldTransform, z: number, parentSpace: WorldTransform, parentZ: number, childAnc: number, oldStart: number, oldCol: number, oldText: number, startRel: number, colStart: number, textStart: number): number => {
      let volatile = z !== 0 || code >= FLAG_VOLATILE;
      const own = (code & FLAG_OPAQUE) !== 0 ? WALK_OPAQUE : volatile ? WALK_VOLATILE : WALK_CLEAN;
      const isCamera = kind === KIND_CAMERA;
      const childSpace = isCamera ? parentSpace : at;
      const childZ = isCamera ? parentZ : z;
      const canCopy = oldStart >= 0;
      for (let i = 0; i < count; i++) {
        const child = children[i] as GameObject;
        const info = child.drawCache as DrawInfo | null;
        const known = info !== null && info.owner === token;
        // Where this child's records were last frame, when known, so that what is under it can be copied too.
        let childOld = -1;
        let childOldCol = -1;
        let childOldText = -1;
        if (canCopy && known && info.ok) {
          if (info.built > childAnc) {
            if (child.subtreeChangedAt < info.built) {
              i = copyRun(children, i, info, childAnc, oldStart, oldCol, oldText, startRel, colStart, textStart);
              continue;
            }
            // It only moved since (nothing else of it, and nothing under it, changed), and everything it wrote is at its own
            // world transform: last frame's records with the new transform in each, and its colliders at the new transform.
            if (info.flat && child.contentChangedAt < info.built && childZ === 0 && child.transform.z === 0 && child.placement.z === 0) {
              const world = worldIn(childSpace, child);
              const destRel = list.length - region - startRel;
              const destColRel = colliders.length - colStart;
              const size = info.len;
              if (size > 0) {
                if (listZ !== 0) list.setZ((listZ = 0));
                list.grow(size);
                const r = list.records;
                let to = list.length;
                for (let from = oldStart + info.rel, end = from + size; from < end; ) {
                  // Only sprites and shapes are in such a run: a header, then a texture, or a width, a height and a colour.
                  const op = prevTree[from] as number;
                  r[to] = op;
                  r[to + 1] = world.x;
                  r[to + 2] = world.y;
                  r[to + 3] = world.rotation;
                  r[to + 4] = world.scaleX;
                  r[to + 5] = world.scaleY;
                  r[to + 6] = prevTree[from + 6] as number;
                  if (op === RGE_OP_SPRITE) {
                    to += RGE_OP_SPRITE_LEN;
                    from += RGE_OP_SPRITE_LEN;
                  } else {
                    r[to + 7] = prevTree[from + 7] as number;
                    r[to + 8] = prevTree[from + 8] as number;
                    to += SHAPE_LEN;
                    from += SHAPE_LEN;
                  }
                }
                list.length = to;
                moved += size;
              }
              for (let k = oldCol + info.colRel, stop = k + info.colLen; k < stop; k++) colliders.push({ collider: (prevColliders[k] as ColliderEntry).collider, world });
              info.rel = destRel;
              info.colRel = destColRel;
              info.textRel = list.texts.length - textStart;
              info.built = serial;
              continue;
            }
          }
          childOld = oldStart + info.rel;
          childOldCol = oldCol + info.colRel;
          childOldText = oldText + info.textRel;
        }
        const before = list.length - region;
        const colBefore = colliders.length;
        const textBefore = list.texts.length;
        const result = walk(child, childSpace, childZ, childAnc, childOld, childOldCol, childOldText);
        if (result !== WALK_CLEAN) volatile = true;
        // What a later frame can use of this: all of it if it stands still, and, when it is flat, all of it with a new transform if it only moves.
        const flat = flatWalk && result === WALK_CLEAN;
        if (result === WALK_OPAQUE || (child.selfChangedAt >= lastSerial && !flat)) {
          // This object changes (or something above it does): it, and what is under it, is rebuilt now and likely next frame, so it is not written down.
          if (known) info.ok = false;
          continue;
        }
        const record = known ? info : (child.drawCache = new DrawInfo(token));
        record.ok = true;
        record.rel = before - startRel;
        record.colRel = colBefore - colStart;
        record.textRel = textBefore - textStart;
        record.flat = flat;
        // Only what stood still this frame, or only moved, can be copied next frame, so only that is written down.
        if (result === WALK_CLEAN && (flat || child.subtreeChangedAt < lastSerial)) {
          record.len = list.length - region - before;
          record.colLen = colliders.length - colBefore;
          record.textLen = list.texts.length - textBefore;
          record.built = serial;
        } else record.built = -1;
      }
      return own === WALK_OPAQUE ? WALK_OPAQUE : volatile ? WALK_VOLATILE : WALK_CLEAN;
    };

    walk(root, IDENTITY_TRANSFORM, 0, 0, continued ? 0 : -1, 0, 0);
    this.#reused = reused;
    this.#moved = moved;

    if (reuse) {
      // Next frame copies from this one's records in tree order, so take them before the z sort moves them.
      const count = list.length - region;
      if (this.#prevTree.length < count) this.#prevTree = new Float64Array(Math.max(this.#prevTree.length * 2, count));
      this.#prevTree.set(list.records.subarray(region, list.length));
      this.#prevTexts = list.texts.slice();
      this.#prevColliders = colliders;
      this.#lastRoot = root;
      this.#lastWorld = world;
    }

    // Draw order: by z, tree order among equals. A pointer that is drawn on top is pressed first, so the pointers move with it.
    list.sortByZ(worldStart + RGE_OP_VIEW_LEN);
    if (anyZ) {
      const order = orderByZ(pointerZs);
      if (order !== null) pointers = order.map((i) => pointers[i] as Pressable);
    }

    // The camera centres on the middle of the game's area; a screen's placement then takes game pixels to the window.
    if (camera !== null) {
      (camera as Camera).viewWidth = gameWidth;
      (camera as Camera).viewHeight = gameHeight;
    }
    const cameraView = this.#view(camera, gameWidth, gameHeight);
    const view = placement === null ? cameraView : viewToWindow(cameraView, placement);
    const hudView = placement === null ? IDENTITY_VIEW : viewToWindow(IDENTITY_VIEW, placement);
    list.setView(worldStart, pixelPerfect ? cameraView : view);

    // The HUD layers, after the world, each through a view the camera does not touch.
    const hudPointersFrom = pointers.length;
    if (huds.length > 0) {
      list.view(pixelPerfect ? IDENTITY_VIEW : hudView);
      for (const { world: hudWorld, object: hud } of huds) {
        // Each layer is ordered by its own z, so a high z inside one layer never lifts it over the next.
        const layerStart = list.length;
        let hudAnyZ = false;
        const hudPointerZs: number[] = [];
        const hudPointers: Pressable[] = [];
        listZ = 0;
        for (const child of hud.children) {
          walkTree(
            child,
            (object, world, objectZ, kind) => {
              let z = objectZ;
              if (z !== 0) {
                if (z !== z) z = 0;
                else hudAnyZ = true;
              }
              switch (kind) {
                case KIND_SPRITE:
                  if (z !== listZ) list.setZ((listZ = z));
                  this.#spriteNode(object as Sprite | AnimatedSprite, world);
                  break;
                case KIND_SHAPE:
                  if (z !== listZ) list.setZ((listZ = z));
                  this.#shape(object as Shape, world);
                  break;
                case KIND_TILEMAP:
                  if (z !== listZ) list.setZ((listZ = z));
                  this.#tilemap(object as Tilemap, world);
                  break;
                case KIND_PARTICLES:
                  if (z !== listZ) list.setZ((listZ = z));
                  this.#particles(object as Particles, world);
                  break;
                case KIND_FADE:
                  if (z !== listZ) list.setZ((listZ = z));
                  this.#fade(object as Fade, gameWidth, gameHeight);
                  break;
                case KIND_TEXT:
                  if ((object as Text).text !== "") {
                    if (z !== listZ) list.setZ((listZ = z));
                    this.#text(object as Text, world);
                  }
                  break;
                case KIND_FLEX: {
                  if (z !== listZ && (object as Flex).background !== undefined) list.setZ((listZ = z));
                  const placed = this.#flex(object as Flex, world, gameWidth, gameHeight);
                  if ((object as Flex).onPress !== undefined) {
                    hudPointers.push(object as Flex);
                    hudPointerZs.push(z);
                  }
                  return placed;
                }
                case KIND_POINTER:
                  hudPointers.push(object as Pointer);
                  hudPointerZs.push(z);
                  break;
                case KIND_CAMERA:
                  this.#warner.once("hud-camera", "A <Camera> inside a <Hud> does nothing: the HUD is drawn through no camera.");
                  break;
              }
            },
            hudWorld,
            0,
            true,
          );
        }
        list.sortByZ(layerStart);
        let ordered: Pressable[] = hudPointers;
        if (hudAnyZ) {
          const order = orderByZ(hudPointerZs);
          if (order !== null) ordered = order.map((i) => hudPointers[i] as Pressable);
        }
        for (const pointer of ordered) pointers.push(pointer);
      }
    }

    // Bars around a game that is not pixel-perfect: window pixels, drawn last. (A pixel-perfect game's canvas record clears them.)
    if (placement !== null && !pixelPerfect) this.#borders(placement, width, height, borderColor);
    const built: BuiltFrame = { list, view, hudView, screen: placement, camera, pointers, hudPointersFrom, colliders };
    if (this.#options.retain === "check" && reuse) this.#check(root, width, height, built);
    return built;
  }

  /** `retain: "check"`: build the frame again without reusing anything, and throw if it is not the frame just built. */
  #check(root: GameObject, width: number, height: number, built: BuiltFrame): void {
    this.#reference ??= new FrameBuilder({ ...this.#options, retain: false, warn: () => {} });
    const expected = this.#reference.build(root, width, height);
    const fail = (what: string): never => {
      throw new Error(`Reused draw records differ from a full rebuild (${what}): something changed an object without reporting it (see GameObject.markChanged).`);
    };
    const a = built.list;
    const b = expected.list;
    if (a.length !== b.length) fail(`${a.length} doubles against ${b.length}`);
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a.records[i], b.records[i])) fail(`record double ${i} is ${a.records[i]}, not ${b.records[i]}`);
    }
    if (a.texts.length !== b.texts.length || a.texts.some((text, i) => text !== b.texts[i])) fail("texts");
    if (built.colliders.length !== expected.colliders.length) fail("colliders");
    for (let i = 0; i < built.colliders.length; i++) {
      const x = built.colliders[i] as ColliderEntry;
      const y = expected.colliders[i] as ColliderEntry;
      if (x.collider !== y.collider || x.world.x !== y.world.x || x.world.y !== y.world.y || x.world.rotation !== y.world.rotation || x.world.scaleX !== y.world.scaleX || x.world.scaleY !== y.world.scaleY) fail(`collider ${i}`);
    }
    if (built.pointers.length !== expected.pointers.length || built.pointers.some((pointer, i) => pointer !== expected.pointers[i])) fail("pointers");
  }

  /**
   * The size of what an object draws, for layout: a shape's, pointer's or collider's `width` × `height`, a text's
   * measured width × its measured line height, a sprite's texture size (an animated sprite's first frame, so layout does not
   * jitter as frames change; a texture that cannot be loaded is the 16 × 16 square drawn in its place). Null for
   * anything else: containers are sized by layout itself. Texture sizes and text widths are asked of the backend
   * once each and kept.
   */
  measure(object: GameObject): Size | null {
    const out = { width: 0, height: 0 };
    return this.#measureInto(object, out) ? out : null;
  }

  /** `measure`, written into `out` instead of a new object, for layout, which asks about every leaf every frame. Returns false for anything that draws nothing. */
  #measureInto(object: GameObject, out: MeasuredSize): boolean {
    let size: Size;
    if (object instanceof Shape || object instanceof Pointer || object instanceof Collider) {
      out.width = object.width;
      out.height = object.height;
      return true;
    }
    if (object instanceof Text) {
      if (object.text === "") {
        out.width = object.width ?? 0;
        out.height = object.size;
        return true;
      }
      size = object.font === undefined ? this.#textSize(object.text, object.size) : this.#bitmapSize(object.font, object.text, object.size);
      if (object.width !== undefined) {
        out.width = object.width;
        out.height = size.height;
        return true;
      }
    } else if (object instanceof AnimatedSprite) {
      // A sheet measures as one frame, a set of files as the first of them (so layout does not jitter as frames change).
      if (object.isSheet) size = object.frameWidth !== undefined && object.frameHeight !== undefined ? { width: object.frameWidth, height: object.frameHeight } : this.#imageSize(object.image);
      else size = this.#imageSize(object.frames[0] ?? "");
    } else if (object instanceof Sprite) size = object.frameWidth !== undefined && object.frameHeight !== undefined ? { width: object.frameWidth, height: object.frameHeight } : this.#imageSize(object.image);
    else return false;
    out.width = size.width;
    out.height = size.height;
    return true;
  }

  /** A `<Flex>` the walk has reached: lay it out if it is a layout root, then draw its background behind its children. */
  #flex(flex: Flex, world: WorldTransform, availableWidth: number, availableHeight: number): WorldTransform | undefined {
    let placed: WorldTransform | undefined;
    if (!(flex.parent instanceof Flex)) {
      this.#layouter.layout(flex, availableWidth, availableHeight);
      // The world was worked out before layout; a floating root's own offset is only known now.
      if (flex.float) world = placed = flex.worldTransform();
    }
    if (flex.background !== undefined) this.#list.rect(world, flex.box.size[0] as number, flex.box.size[1] as number, this.#color(flex.background));
    return placed;
  }

  #textSize(text: string, size: number): Size {
    const key = `${size}:${text}`;
    let measured = this.#textSizes.get(key);
    if (measured === undefined) {
      measured = this.#measureText ? this.#measureText(text, size) : { width: estimateTextWidth(text, size), height: size };
      if (this.#textSizes.size >= TEXT_CACHE_LIMIT) this.#textSizes.clear();
      this.#textSizes.set(key, measured);
    }
    return measured;
  }

  #imageSize(image: string): Size {
    if (image === "") return NO_SIZE;
    const handle = this.#texture(image);
    if (handle < 0) return { width: MISSING_TEXTURE_SIZE, height: MISSING_TEXTURE_SIZE };
    let size = this.#textureSizes.get(handle);
    if (size === undefined) {
      if (this.#textureSize) size = this.#textureSize(handle);
      else {
        this.#warner.once("texture-size", "This backend cannot report texture sizes: sprites measure 0 × 0 for layout.");
        size = NO_SIZE;
      }
      this.#textureSizes.set(handle, size);
    }
    return size;
  }

  /** A root `<Screen>` with a size it can be drawn at, or null (warning once) to draw the game at the window's size. */
  #usableScreen(screen: Screen): Screen | null {
    if (screen.width > 0 && screen.height > 0 && Number.isFinite(screen.width) && Number.isFinite(screen.height)) return screen;
    this.#warner.once(`screen-size:${screen.width}x${screen.height}`, `A <Screen> needs a positive width and height, not ${screen.width} × ${screen.height}: drawing at the window's size instead.`);
    return null;
  }

  #fit(screen: Screen): ScreenFit {
    const fit = screen.fit;
    if (fit === "integer" || fit === "contain" || fit === "stretch" || fit === "expand") return fit;
    this.#warner.once(`screen-fit:${String(fit)}`, `Unknown <Screen fit> '${String(fit)}': using "integer". The choices are "integer", "contain", "stretch" and "expand".`);
    return "integer";
  }

  /** Cover the window outside the game with `color`: a view in window pixels, then up to four rectangles. */
  #borders(placement: ScreenPlacement, width: number, height: number, color: PackedColor): void {
    const rects = borderRects(placement, width, height);
    if (rects.length === 0) return;
    this.#list.view(IDENTITY_VIEW);
    for (const rect of rects) this.#list.rect({ x: rect.x, y: rect.y, rotation: 0, scaleX: 1, scaleY: 1 }, rect.width, rect.height, color);
  }

  #shape(shape: Shape, world: WorldTransform): void {
    const color = this.#color(shape.color);
    if (shape.kind === "circle") this.#list.ellipse(world, shape.width, shape.height, color);
    else this.#list.rect(world, shape.width, shape.height, color);
  }

  /** The size of a text drawn with a bitmap font: a cell's width for each character, the size as its height. */
  #bitmapSize(font: string, text: string, size: number): Size {
    const sheet = this.#imageSize(font);
    if (sheet.width === 0 || sheet.height === 0) return { width: estimateTextWidth(text, size), height: size };
    const scale = size / (sheet.height / FONT_ROWS);
    let characters = 0;
    for (const _ of text) characters++;
    return { width: characters * (sheet.width / FONT_COLUMNS) * scale, height: size };
  }

  /** Text drawn from a bitmap font: one region of the font sheet for each character, in the text's colour. */
  #bitmapText(text: Text, at: WorldTransform): void {
    const font = text.font as string;
    const handle = this.#texture(font);
    const sheet = this.#imageSize(font);
    if (handle < 0 || sheet.width === 0 || sheet.height === 0) {
      if (handle >= 0) this.#warner.once(`font-size:${font}`, `The font '${font}' has no known size (this backend cannot report texture sizes): its text is not drawn.`);
      return;
    }
    const cellW = sheet.width / FONT_COLUMNS;
    const cellH = sheet.height / FONT_ROWS;
    const scale = text.size / cellH;
    const color = this.#color(text.color);
    const cos = Math.cos(at.rotation);
    const sin = Math.sin(at.rotation);
    let x = 0;
    if (text.width !== undefined && text.align !== "left") {
      const room = text.width - this.#bitmapSize(font, text.text, text.size).width;
      x = text.align === "center" ? Math.round(room / 2) : Math.round(room);
    }
    for (const ch of text.text) {
      const code = ch.codePointAt(0) as number;
      const glyph = code >= 32 && code < 128 ? code - 32 : 63 - 32; // anything else is a "?"
      if (glyph !== 0) {
        const lx = x * at.scaleX;
        this.#list.spriteRegionAt(at.x + cos * lx, at.y + sin * lx, at.rotation, at.scaleX * scale, at.scaleY * scale, handle, (glyph % FONT_COLUMNS) * cellW, Math.floor(glyph / FONT_COLUMNS) * cellH, cellW, cellH, 0, 0, 0, color);
      }
      x += cellW * scale;
    }
  }

  #text(text: Text, world: WorldTransform): void {
    if (text.font !== undefined) {
      this.#bitmapText(text, world);
      return;
    }
    let at = world;
    if (text.width !== undefined && text.align !== "left") {
      // Aligned inside its own width: shift along the text's own x axis, by whole pixels.
      const room = text.width - this.#textSize(text.text, text.size).width;
      const shift = text.align === "center" ? Math.round(room / 2) : text.align === "right" ? Math.round(room) : 0;
      if (shift !== 0) {
        const along = shift * world.scaleX;
        at = { x: world.x + Math.cos(world.rotation) * along, y: world.y + Math.sin(world.rotation) * along, rotation: world.rotation, scaleX: world.scaleX, scaleY: world.scaleY };
      }
    }
    this.#list.text(at, text.text, text.size, this.#color(text.color));
  }

  /** Window origin at the top-left with no camera; with one, the followed point lands on the centre of a `width` × `height` view (the window, or the game's screen). */
  #view(camera: Camera | null, width: number, height: number): ViewTransform {
    if (camera === null) return IDENTITY_VIEW;
    try {
      const v = camera.viewTransform();
      return { a: v.a, b: v.b, c: v.c, d: v.d, e: v.e + width / 2, f: v.f + height / 2 };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      this.#warner.once("camera-range", `The camera is unusable, so the frame is drawn without it: ${error.message}`);
      return IDENTITY_VIEW;
    }
  }

  /** The texture handle for an image name, loading it the first time (-1, warned about once, if it cannot be loaded). */
  #texture(image: string): number {
    // By image name, not by path: the path would be put together again for every sprite of every frame.
    let handle = this.#textures.get(image);
    if (handle === undefined) {
      const path = `${this.#assets}/${image}`;
      handle = this.#loadTexture(path);
      this.#textures.set(image, handle);
      if (handle < 0) this.#warner.once(`texture:${path}`, `Could not load the texture '${path}': drawing a magenta square instead.`);
    }
    return handle;
  }

  /** A sprite or animated sprite: the whole image, or, when it has a sheet frame or options, a region of it. */
  #spriteNode(node: Sprite | AnimatedSprite, world: WorldTransform): void {
    if (!styledSprite(node)) {
      this.#sprite(node.image, world);
      return;
    }
    const image = node.image;
    if (image === "") return;
    const handle = this.#texture(image);
    if (handle < 0) {
      this.#list.rect(world, MISSING_TEXTURE_SIZE, MISSING_TEXTURE_SIZE, MAGENTA);
      return;
    }
    const texture = this.#imageSize(image);
    const sheet = node instanceof AnimatedSprite ? node.isSheet : node.frameWidth !== undefined || node.frameHeight !== undefined;
    const frameWidth = sheet ? (node.frameWidth ?? texture.width) : texture.width;
    const frameHeight = sheet ? (node.frameHeight ?? texture.height) : texture.height;
    const frame = node instanceof AnimatedSprite ? node.sheetFrame : node.frame;
    let srcX = 0;
    let srcY = 0;
    if (sheet && frame > 0 && frameWidth > 0) {
      const columns = Math.max(1, Math.floor(texture.width / frameWidth));
      srcX = (frame % columns) * frameWidth;
      srcY = Math.floor(frame / columns) * frameHeight;
    }
    if (!(frameWidth > 0 && frameHeight > 0)) {
      this.#warner.once(`sprite-size:${image}`, `The sprite '${image}' has no known size (this backend cannot report texture sizes and no frameWidth and frameHeight are set): it is not drawn.`);
      return;
    }
    let tint = node.tint === undefined ? 0xffffffff : this.#color(node.tint);
    const opacity = node.opacity;
    if (opacity !== 1) {
      const alpha = Math.round(((tint & 255) * Math.min(1, Math.max(0, opacity !== opacity ? 1 : opacity))));
      tint = ((tint & 0xffffff00) | alpha) >>> 0;
    }
    this.#list.spriteRegion(world, handle, srcX, srcY, frameWidth, frameHeight, node.originX, node.originY, (node.flipX ? RGE_SPRITE_FLIP_X : 0) | (node.flipY ? RGE_SPRITE_FLIP_Y : 0), tint);
  }

  /** A `<Tilemap>`: one sprite-region record for each filled cell of each visible layer, culled to none (a map is a room, not a world). */
  #tilemap(node: Tilemap, at: WorldTransform): void {
    const grid = findTilemap(node.map);
    if (grid === undefined) {
      this.#warner.once(`tilemap:${node.map}`, `<Tilemap map="${node.map}">: no map of that name is registered (registerTilemaps(tilemaps) with the compiler's generated table, before the game starts).`);
      return;
    }
    if (node.image === "") return;
    const handle = this.#texture(node.image);
    if (handle < 0) return;
    const sheet = this.#imageSize(node.image);
    const tw = grid.tileWidth;
    const th = grid.tileHeight;
    if (!(sheet.width >= tw && tw > 0 && th > 0)) {
      this.#warner.once(`tilemap-sheet:${node.image}`, `The tile sheet '${node.image}' (${sheet.width} × ${sheet.height}) is smaller than one ${tw} × ${th} tile (or this backend cannot report texture sizes): the map is not drawn.`);
      return;
    }
    const columns = Math.floor(sheet.width / tw);
    const cos = Math.cos(at.rotation);
    const sin = Math.sin(at.rotation);
    const sx = at.scaleX;
    const sy = at.scaleY;
    let tint = 0xffffffff;
    if (node.opacity !== 1) tint = ((tint & 0xffffff00) | Math.round(255 * Math.min(1, Math.max(0, node.opacity)))) >>> 0;
    const firstGid = grid.data.firstGid;
    const width = grid.width;
    for (const layer of grid.data.layers) {
      if (!layer.visible || (node.layer !== undefined && layer.name !== node.layer)) continue;
      const data = layer.data;
      const flips = layer.flips;
      for (let i = 0; i < data.length; i++) {
        const gid = data[i] as number;
        if (gid === 0) continue;
        const frame = gid - firstGid;
        if (frame < 0) continue;
        const col = i % width;
        const row = (i - col) / width;
        const srcX = (frame % columns) * tw;
        const srcY = Math.floor(frame / columns) * th;
        const flip = flips === undefined ? 0 : (flips[i] as number);
        let lx = col * tw;
        let ly = row * th;
        let rotation = at.rotation;
        let flags = 0;
        let ox = 0;
        let oy = 0;
        if (flip !== 0) {
          // Mirrored tiles turn about their middle. Tiled applies the diagonal flip first, then horizontal, then vertical; each
          // combination is a quarter turn and at most one mirror, which is what a record can say.
          lx += tw / 2;
          ly += th / 2;
          ox = tw / 2;
          oy = th / 2;
          const h = (flip & TILE_FLIP_H) !== 0;
          const v = (flip & TILE_FLIP_V) !== 0;
          if ((flip & TILE_FLIP_D) === 0) flags = (h ? RGE_SPRITE_FLIP_X : 0) | (v ? RGE_SPRITE_FLIP_Y : 0);
          else if (!h && !v) {
            rotation += Math.PI / 2;
            flags = RGE_SPRITE_FLIP_Y;
          } else if (h && !v) rotation += Math.PI / 2;
          else if (!h && v) rotation += (3 * Math.PI) / 2;
          else {
            rotation += (3 * Math.PI) / 2;
            flags = RGE_SPRITE_FLIP_Y;
          }
        }
        const px = at.x + cos * lx * sx - sin * ly * sy;
        const py = at.y + sin * lx * sx + cos * ly * sy;
        this.#list.spriteRegionAt(px, py, rotation, sx, sy, handle, srcX, srcY, tw, th, ox, oy, flags, tint);
      }
    }
  }

  /** A `<Particles>`: a small filled square for each live particle, aged toward its end colour, smaller or fainter. */
  #particles(node: Particles, at: WorldTransform): void {
    const count = node.count;
    if (count === 0) return;
    const start = this.#color(node.color);
    const end = node.endColor === undefined ? start : this.#color(node.endColor);
    const scratch = this.#particle;
    const place = this.#placed;
    const world = node.space === "world";
    for (let i = 0; i < count; i++) {
      node.read(i, scratch);
      const t = scratch.t;
      const size = node.shrink ? node.size * (1 - t) : node.size;
      if (!(size > 0.01)) continue;
      let color = start;
      if (end !== start) color = mixColors(start, end, t);
      if (node.fade) color = ((color & 0xffffff00) | Math.round((color & 255) * (1 - t))) >>> 0;
      if ((color & 255) === 0) continue;
      // Whole pixels, so particles stay crisp under a pixel-perfect screen.
      place.x = Math.round((world ? scratch.x : at.x + scratch.x * at.scaleX) - size / 2);
      place.y = Math.round((world ? scratch.y : at.y + scratch.y * at.scaleY) - size / 2);
      this.#list.rect(place, Math.max(1, Math.round(size)), Math.max(1, Math.round(size)), color);
    }
  }

  /** A `<Fade>` in a `<Hud>`: the colour, as faint as the fade is far along, over the whole screen. */
  #fade(node: Fade, width: number, height: number): void {
    if (!(node.amount > 0)) return;
    const color = this.#color(node.color);
    const alpha = Math.round((color & 255) * Math.min(1, node.amount));
    if (alpha === 0) return;
    const place = this.#placed;
    place.x = 0;
    place.y = 0;
    this.#list.rect(place, width, height, ((color & 0xffffff00) | alpha) >>> 0);
  }

  #sprite(image: string, world: WorldTransform): void {
    if (image === "") return;
    const handle = this.#texture(image);
    if (handle < 0) this.#list.rect(world, MISSING_TEXTURE_SIZE, MISSING_TEXTURE_SIZE, MAGENTA);
    else this.#list.sprite(world, handle);
  }

  #color(css: string): PackedColor {
    let color = this.#colors.get(css);
    if (color === undefined) {
      const parsed = parseColor(css);
      if (parsed === null) this.#warner.once(`color:${css}`, `Cannot read the colour '${css}': using magenta.`);
      color = parsed ?? MAGENTA;
      this.#colors.set(css, color);
    }
    return color;
  }
}

/** The colour `t` of the way (0 to 1) from `a` to `b`, channel by channel. */
function mixColors(a: PackedColor, b: PackedColor, t: number): PackedColor {
  const mix = (shift: number): number => Math.round(((a >>> shift) & 255) * (1 - t) + ((b >>> shift) & 255) * t);
  return (((mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0);
}
