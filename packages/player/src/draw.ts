import {
  AnimatedSprite,
  Camera,
  Collider,
  composeTransforms,
  IDENTITY_TRANSFORM,
  offsetTransform,
  Pointer,
  Game,
  Hud,
  Screen,
  Shape,
  Sprite,
  Text,
  type GameObject,
  type ScreenFit,
  type ViewTransform,
  type WorldTransform,
} from "@rge/runtime";
import { MAGENTA, parseColor, type PackedColor } from "./color.ts";
import {
  RGE_OP_ELLIPSE,
  RGE_OP_ELLIPSE_LEN,
  RGE_OP_RECT,
  RGE_OP_RECT_LEN,
  RGE_OP_SPRITE,
  RGE_OP_SPRITE_LEN,
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
  visit: (object: GameObject, world: WorldTransform, z: number) => void,
  parentSpace: WorldTransform = IDENTITY_TRANSFORM,
  parentZ = 0,
  intoHuds = false,
): void {
  // The zero test is inline, not left to offsetTransform: QuickJS does not inline calls, and almost nothing has a layout offset.
  const laidOut = root.layoutX === 0 && root.layoutY === 0 ? parentSpace : offsetTransform(parentSpace, root.layoutX, root.layoutY);
  const world = composeTransforms(composeTransforms(laidOut, root.placement), root.transform);
  const transform = root.transform;
  const placement = root.placement;
  // Nearly nothing has a z, and then none of the three terms or the `global` flags matter: the answer is 0.
  const z =
    parentZ === 0 && transform.z === 0 && placement.z === 0 ? 0
    : transform.global ? transform.z
    : placement.global ? placement.z + transform.z
    : parentZ + placement.z + transform.z;
  visit(root, world, z);
  if (!intoHuds && kindOf(root) === KIND_HUD) return;
  const isCamera = root instanceof Camera;
  const childSpace = isCamera ? parentSpace : world;
  const childZ = isCamera ? parentZ : z;
  // Indexed, not `for…of`: QuickJS makes an iterator object for every `for…of`, and this runs for every object every frame.
  const children = root.children;
  for (let i = 0; i < children.length; i++) walkTree(children[i] as GameObject, visit, childSpace, childZ, intoHuds);
}

/** How many doubles the record starting with this op takes. */
function recordLength(op: number): number {
  switch (op) {
    case RGE_OP_VIEW: return RGE_OP_VIEW_LEN;
    case RGE_OP_SPRITE: return RGE_OP_SPRITE_LEN;
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
    if (at + count > this.records.length) {
      const grown = new Float64Array(Math.max(this.records.length * 2, at + count));
      grown.set(this.records.subarray(0, at));
      this.records = grown;
    }
    this.length = at + count;
    return at;
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
    this.records[this.#header(RGE_OP_SPRITE, RGE_OP_SPRITE_LEN, world)] = texture;
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
  readonly pointers: readonly Pointer[];
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
/** What each class is to the frame, found once per class: `instanceof` walks the prototype chain, and the walk asked up to seven times per object. */
const KINDS = new Map<Function, number>();

function kindOf(object: GameObject): number {
  let kind = KINDS.get(object.constructor);
  if (kind === undefined) {
    kind =
      object instanceof Sprite || object instanceof AnimatedSprite ? KIND_SPRITE
      : object instanceof Shape ? KIND_SHAPE
      : object instanceof Text ? KIND_TEXT
      : object instanceof Camera ? KIND_CAMERA
      : object instanceof Pointer ? KIND_POINTER
      : object instanceof Collider ? KIND_COLLIDER
      : object instanceof Screen ? KIND_SCREEN
      : object instanceof Hud ? KIND_HUD
      : KIND_NONE;
    KINDS.set(object.constructor, kind);
  }
  return kind;
}

/**
 * The `<Screen>` that sets the game's resolution: `root` itself, or its only child, which is where a `World`
 * keeps the object it mounted (`world.root` is a bare container). Either may be a `<Game>` (the configuration root)
 * whose only child is the `<Screen>`. Null when the game has none.
 */
function rootScreen(root: GameObject): Screen | null {
  const only = root.children.length === 1 ? root.children[0] : undefined;
  for (const top of [root, only]) {
    const inner = top instanceof Game && top.children.length === 1 ? top.children[0] : top;
    if (inner instanceof Screen) return inner;
  }
  return null;
}

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
 * Turns an object tree into one frame of draw records. It owns what must persist between frames: the
 * texture handles (each path is loaded once), the colour cache and the warn-once set. It draws
 * nothing itself, so it runs anywhere, with no window.
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

  constructor(options: FrameBuilderOptions) {
    this.#loadTexture = options.loadTexture;
    this.#measureText = options.measureText;
    this.#textureSize = options.textureSize;
    this.#assets = options.assets ?? "assets";
    this.#warner = new Warner(options.warn);
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
    const gameWidth = screen === null ? width : screen.width;
    const gameHeight = screen === null ? height : screen.height;
    const placement = screen === null ? null : fitScreen(screen.width, screen.height, width, height, this.#fit(screen));
    const pixelPerfect = screen !== null && placement !== null && screen.pixelPerfect !== false;
    const borderColor = screen === null ? 0 : this.#color(screen.border);
    if (screen !== null && placement !== null && pixelPerfect) {
      list.canvas(screen.width, screen.height, { x: placement.left, y: placement.top, width: screen.width * placement.scaleX, height: screen.height * placement.scaleY }, borderColor);
    }
    const worldStart = list.length;
    list.view(IDENTITY_VIEW);
    let camera: Camera | null = null;
    let pointers: Pointer[] = [];
    const pointerZs: number[] = [];
    const colliders: ColliderEntry[] = [];
    const huds: { readonly world: WorldTransform; readonly object: GameObject }[] = [];
    let anyZ = false;
    // The z of the records being written, kept here so a frame with no z makes no call per record.
    let listZ = 0;

    walkTree(root, (object, world, objectZ) => {
      let z = objectZ;
      if (z !== 0) {
        if (z !== z) {
          this.#warner.once("z-nan", "A transform's z is not a number: it is drawn at z 0.");
          z = 0;
        } else anyZ = true;
      }
      switch (kindOf(object)) {
        case KIND_SPRITE:
          if (z !== listZ) list.setZ((listZ = z));
          this.#sprite((object as Sprite | AnimatedSprite).image, world);
          break;
        case KIND_SHAPE:
          if (z !== listZ) list.setZ((listZ = z));
          this.#shape(object as Shape, world);
          break;
        case KIND_TEXT:
          if ((object as Text).text !== "") {
            if (z !== listZ) list.setZ((listZ = z));
            this.#text(object as Text, world);
          }
          break;
        case KIND_CAMERA:
          if (camera === null) camera = object as Camera;
          else this.#warner.once("camera", "More than one <Camera> is mounted: only the first one in draw order is used.");
          break;
        case KIND_POINTER:
          pointers.push(object as Pointer);
          pointerZs.push(z);
          break;
        case KIND_COLLIDER:
          colliders.push({ collider: object as Collider, world });
          break;
        case KIND_SCREEN:
          if (object !== gameRoot) this.#warner.once("screen-not-root", "A <Screen> only sets the game's resolution as the root of the game: this one is drawn as a plain container.");
          break;
        case KIND_HUD:
          huds.push({ world, object });
          break;
      }
    });

    // Draw order: by z, tree order among equals. A pointer that is drawn on top is pressed first, so the pointers move with it.
    list.sortByZ(worldStart + RGE_OP_VIEW_LEN);
    if (anyZ) {
      const order = orderByZ(pointerZs);
      if (order !== null) pointers = order.map((i) => pointers[i] as Pointer);
    }

    // The camera centres on the middle of the game's area; a screen's placement then takes game pixels to the window.
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
        const hudPointers: Pointer[] = [];
        listZ = 0;
        for (const child of hud.children) {
          walkTree(
            child,
            (object, world, objectZ) => {
              let z = objectZ;
              if (z !== 0) {
                if (z !== z) z = 0;
                else hudAnyZ = true;
              }
              switch (kindOf(object)) {
                case KIND_SPRITE:
                  if (z !== listZ) list.setZ((listZ = z));
                  this.#sprite((object as Sprite | AnimatedSprite).image, world);
                  break;
                case KIND_SHAPE:
                  if (z !== listZ) list.setZ((listZ = z));
                  this.#shape(object as Shape, world);
                  break;
                case KIND_TEXT:
                  if ((object as Text).text !== "") {
                    if (z !== listZ) list.setZ((listZ = z));
                    this.#text(object as Text, world);
                  }
                  break;
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
        let ordered = hudPointers;
        if (hudAnyZ) {
          const order = orderByZ(hudPointerZs);
          if (order !== null) ordered = order.map((i) => hudPointers[i] as Pointer);
        }
        for (const pointer of ordered) pointers.push(pointer);
      }
    }

    // Bars around a game that is not pixel-perfect: window pixels, drawn last. (A pixel-perfect game's canvas record clears them.)
    if (placement !== null && !pixelPerfect) this.#borders(placement, width, height, borderColor);
    return { list, view, hudView, screen: placement, camera, pointers, hudPointersFrom, colliders };
  }

  /**
   * The size of what an object draws, for layout: a shape's, pointer's or collider's `width` × `height`, a text's
   * measured width × its measured line height, a sprite's texture size (an animated sprite's first frame, so layout does not
   * jitter as frames change; a texture that cannot be loaded is the 16 × 16 square drawn in its place). Null for
   * anything else: containers are sized by layout itself. Texture sizes and text widths are asked of the backend
   * once each and kept.
   */
  measure(object: GameObject): Size | null {
    if (object instanceof Shape || object instanceof Pointer || object instanceof Collider) return { width: object.width, height: object.height };
    if (object instanceof Text) {
      if (object.text === "") return { width: 0, height: object.size };
      return this.#textSize(object.text, object.size);
    }
    if (object instanceof AnimatedSprite) return this.#imageSize(object.frames[0] ?? "");
    if (object instanceof Sprite) return this.#imageSize(object.image);
    return null;
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
    if (fit === "integer" || fit === "contain" || fit === "stretch") return fit;
    this.#warner.once(`screen-fit:${String(fit)}`, `Unknown <Screen fit> '${String(fit)}': using "integer". The choices are "integer", "contain" and "stretch".`);
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

  #text(text: Text, world: WorldTransform): void {
    this.#list.text(world, text.text, text.size, this.#color(text.color));
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
    const path = `${this.#assets}/${image}`;
    let handle = this.#textures.get(path);
    if (handle === undefined) {
      handle = this.#loadTexture(path);
      this.#textures.set(path, handle);
      if (handle < 0) this.#warner.once(`texture:${path}`, `Could not load the texture '${path}': drawing a magenta square instead.`);
    }
    return handle;
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
