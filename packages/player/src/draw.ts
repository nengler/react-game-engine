import {
  AnimatedSprite,
  Camera,
  Collider,
  composeTransforms,
  IDENTITY_TRANSFORM,
  Pointer,
  Shape,
  Sprite,
  Text,
  type GameObject,
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
} from "./protocol.ts";
import { Warner } from "./warn.ts";

/**
 * Visit every object under `root` in draw order (a parent before its children, children in their
 * order), with the world transform `object.worldTransform()` would give it. The transforms are
 * composed on the way down instead of recomputed from the root for each object, and a camera is
 * transparent to its children, as `GameObject.childSpace()` says. `test/draw.test.ts` checks the
 * two agree over a real tree; if a built-in ever overrides `childSpace()` again, change this too.
 */
export function walkTree(root: GameObject, visit: (object: GameObject, world: WorldTransform) => void, parentSpace: WorldTransform = IDENTITY_TRANSFORM): void {
  const world = composeTransforms(composeTransforms(parentSpace, root.placement), root.transform);
  visit(root, world);
  const childSpace = root instanceof Camera ? parentSpace : world;
  // Indexed, not `for…of`: QuickJS makes an iterator object for every `for…of`, and this runs for every object every frame.
  const children = root.children;
  for (let i = 0; i < children.length; i++) walkTree(children[i] as GameObject, visit, childSpace);
}

/** A growable frame of draw records (see `native/include/rge.h`) and the strings its text records refer to. */
export class DrawList {
  records = new Float64Array(1024);
  length = 0;
  texts: string[] = [];

  reset(): void {
    this.length = 0;
    this.texts.length = 0;
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
  /** Folder that image names are relative to. Default `"assets"`. */
  assets?: string;
  /** Where warnings go. Default `console.warn`. */
  warn?: (message: string) => void;
}

export interface ColliderEntry {
  readonly collider: Collider;
  readonly world: WorldTransform;
}

export interface BuiltFrame {
  readonly list: DrawList;
  /** The world → window map the frame is drawn through (identity with no camera), as the first record holds it. */
  readonly view: ViewTransform;
  readonly camera: Camera | null;
  /** In draw order: the last one is on top. */
  readonly pointers: readonly Pointer[];
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
      : KIND_NONE;
    KINDS.set(object.constructor, kind);
  }
  return kind;
}

/** The size of the square drawn where a texture could not be loaded. */
const MISSING_TEXTURE_SIZE = 16;

/**
 * Turns an object tree into one frame of draw records. It owns what must persist between frames: the
 * texture handles (each path is loaded once), the colour cache and the warn-once set. It draws
 * nothing itself, so it runs anywhere, with no window.
 */
export class FrameBuilder {
  readonly #list = new DrawList();
  readonly #textures = new Map<string, number>();
  readonly #colors = new Map<string, PackedColor>();
  readonly #loadTexture: (path: string) => number;
  readonly #assets: string;
  readonly #warner: Warner;

  constructor(options: FrameBuilderOptions) {
    this.#loadTexture = options.loadTexture;
    this.#assets = options.assets ?? "assets";
    this.#warner = new Warner(options.warn);
  }

  /** Build the frame for a window of this size. The returned `list` is reused: copy it to keep it. */
  build(root: GameObject, width: number, height: number): BuiltFrame {
    const list = this.#list;
    list.reset();
    list.view(IDENTITY_VIEW);
    let camera: Camera | null = null;
    const pointers: Pointer[] = [];
    const colliders: ColliderEntry[] = [];

    walkTree(root, (object, world) => {
      switch (kindOf(object)) {
        case KIND_SPRITE:
          this.#sprite((object as Sprite | AnimatedSprite).image, world);
          break;
        case KIND_SHAPE: {
          const shape = object as Shape;
          const color = this.#color(shape.color);
          if (shape.kind === "circle") list.ellipse(world, shape.width, shape.height, color);
          else list.rect(world, shape.width, shape.height, color);
          break;
        }
        case KIND_TEXT: {
          const text = object as Text;
          if (text.text !== "") list.text(world, text.text, text.size, this.#color(text.color));
          break;
        }
        case KIND_CAMERA:
          if (camera === null) camera = object as Camera;
          else this.#warner.once("camera", "More than one <Camera> is mounted: only the first one in draw order is used.");
          break;
        case KIND_POINTER:
          pointers.push(object as Pointer);
          break;
        case KIND_COLLIDER:
          colliders.push({ collider: object as Collider, world });
          break;
      }
    });

    const view = this.#view(camera, width, height);
    list.setView(0, view);
    return { list, view, camera, pointers, colliders };
  }

  /** Window origin at the top-left with no camera; with one, the followed point lands on the window's centre. */
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

  #sprite(image: string, world: WorldTransform): void {
    if (image === "") return;
    const path = `${this.#assets}/${image}`;
    let handle = this.#textures.get(path);
    if (handle === undefined) {
      handle = this.#loadTexture(path);
      this.#textures.set(path, handle);
      if (handle < 0) this.#warner.once(`texture:${path}`, `Could not load the texture '${path}': drawing a magenta square instead.`);
    }
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
