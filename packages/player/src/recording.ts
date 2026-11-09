import type { Backend, WindowConfig } from "./backend.ts";
import { colorToHex } from "./color.ts";
import { estimateTextWidth } from "./draw.ts";
import {
  KEYS,
  KEY_INDEX,
  RGE_IN_DT,
  RGE_IN_HEIGHT,
  RGE_IN_LEN,
  RGE_IN_MOUSE_X,
  RGE_IN_MOUSE_Y,
  RGE_IN_QUIT,
  RGE_IN_WHEEL,
  RGE_IN_WIDTH,
  RGE_KEY_DOWN,
  RGE_KEY_PRESSED,
  RGE_KEY_RELEASED,
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

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** A draw record in readable form; colours are `#rrggbbaa` and textures are the path they were loaded from. */
export type DecodedRecord =
  | { readonly op: "view"; readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number }
  | ({ readonly op: "sprite"; readonly texture: string } & Placed)
  | ({ readonly op: "rect"; readonly width: number; readonly height: number; readonly color: string } & Placed)
  | ({ readonly op: "ellipse"; readonly width: number; readonly height: number; readonly color: string } & Placed)
  | ({ readonly op: "text"; readonly text: string; readonly size: number; readonly color: string } & Placed);

export interface RecordedFrame {
  readonly clearColor: string;
  readonly records: readonly DecodedRecord[];
}

/** What the fake devices report for one frame. Anything left out is zero, except `dt` (1/60) and the window size. */
export interface InputFrame {
  readonly dt?: number;
  readonly width?: number;
  readonly height?: number;
  readonly mouse?: { readonly x: number; readonly y: number };
  readonly wheel?: number;
  readonly quit?: boolean;
  /** Went down this frame (so it is also down). */
  readonly pressed?: readonly string[];
  /** Held. */
  readonly down?: readonly string[];
  /** Went up this frame. */
  readonly released?: readonly string[];
}

export interface RecordingOptions {
  /** Texture paths that fail to load (handle -1), as a missing file would. */
  readonly missingTextures?: Iterable<string>;
  /** Sound paths that fail to load (handle -1). */
  readonly missingSounds?: Iterable<string>;
  /** The size `textureSize` reports for a texture path. Default 16 × 16. */
  readonly textureSizes?: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
}

/**
 * A backend that draws nothing and remembers everything: for tests of the player, with no window.
 * Input is scripted a frame at a time with `queueInput`; when the queue is empty a frame is
 * idle (dt 1/60, nothing pressed).
 */
export class RecordingBackend implements Backend {
  config: WindowConfig | null = null;
  opened = false;
  closed = false;
  readonly frames: RecordedFrame[] = [];
  /** Every `loadTexture` call, repeats included: the player should load a path once. */
  readonly textureLoads: string[] = [];
  readonly soundLoads: string[] = [];
  /** The path of each sound played, in order. */
  readonly plays: string[] = [];
  /** Every `measureText` call, as `size:text`: the player should measure a string once, not every frame. */
  readonly textMeasures: string[] = [];
  /** Every `textureSize` call, by path. */
  readonly textureSizeQueries: string[] = [];
  readonly #textures: string[] = [];
  readonly #sounds: string[] = [];
  readonly #missing: Set<string>;
  readonly #missingSounds: Set<string>;
  readonly #textureSizes: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
  readonly #queue: InputFrame[] = [];

  constructor(options: RecordingOptions = {}) {
    this.#missing = new Set(options.missingTextures);
    this.#missingSounds = new Set(options.missingSounds);
    this.#textureSizes = options.textureSizes ?? {};
  }

  queueInput(frame: InputFrame): void {
    this.#queue.push(frame);
  }

  get lastFrame(): RecordedFrame {
    const frame = this.frames.at(-1);
    if (frame === undefined) throw new Error("No frame has been drawn yet.");
    return frame;
  }

  open(config: WindowConfig): void {
    this.config = config;
    this.opened = true;
  }

  close(): void {
    this.closed = true;
  }

  loadTexture(path: string): number {
    this.textureLoads.push(path);
    if (this.#missing.has(path)) return -1;
    return handleFor(this.#textures, path);
  }

  loadSound(path: string): number {
    this.soundLoads.push(path);
    if (this.#missingSounds.has(path)) return -1;
    return handleFor(this.#sounds, path);
  }

  /** The player's own estimate (`estimateTextWidth`), so layout tests have stable numbers without a font. */
  measureText(text: string, size: number): number {
    this.textMeasures.push(`${size}:${text}`);
    return estimateTextWidth(text, size);
  }

  textureSize(handle: number): { width: number; height: number } {
    const path = this.#textures[handle];
    if (path === undefined) throw new Error(`textureSize: no texture has handle ${handle}.`);
    this.textureSizeQueries.push(path);
    return { ...(this.#textureSizes[path] ?? { width: 16, height: 16 }) };
  }

  playSound(handle: number): void {
    const path = this.#sounds[handle];
    if (path === undefined) throw new Error(`playSound: no sound has handle ${handle}.`);
    this.plays.push(path);
  }

  frame(clearColor: number, records: Float64Array, length: number, texts: readonly string[], input: Float64Array, keys: Uint8Array): void {
    if (input.length < RGE_IN_LEN) throw new Error(`The input buffer needs ${RGE_IN_LEN} entries, not ${input.length}.`);
    if (keys.length < KEYS.length) throw new Error(`The keys buffer needs ${KEYS.length} entries, not ${keys.length}.`);
    this.frames.push({ clearColor: colorToHex(clearColor), records: this.#decode(records, length, texts) });

    const next = this.#queue.shift() ?? {};
    input[RGE_IN_DT] = next.dt ?? 1 / 60;
    input[RGE_IN_WIDTH] = next.width ?? this.config?.width ?? 0;
    input[RGE_IN_HEIGHT] = next.height ?? this.config?.height ?? 0;
    input[RGE_IN_MOUSE_X] = next.mouse?.x ?? 0;
    input[RGE_IN_MOUSE_Y] = next.mouse?.y ?? 0;
    input[RGE_IN_WHEEL] = next.wheel ?? 0;
    input[RGE_IN_QUIT] = next.quit ? 1 : 0;
    keys.fill(0);
    for (const name of next.down ?? []) keys[keyIndex(name)]! |= RGE_KEY_DOWN;
    for (const name of next.pressed ?? []) keys[keyIndex(name)]! |= RGE_KEY_DOWN | RGE_KEY_PRESSED;
    for (const name of next.released ?? []) keys[keyIndex(name)]! |= RGE_KEY_RELEASED;
  }

  #decode(records: Float64Array, length: number, texts: readonly string[]): DecodedRecord[] {
    const out: DecodedRecord[] = [];
    for (let at = 0; at < length; ) {
      const op = records[at] as number;
      const placed = (): Placed => ({ x: records[at + 1] as number, y: records[at + 2] as number, rotation: records[at + 3] as number, scaleX: records[at + 4] as number, scaleY: records[at + 5] as number });
      const need = (count: number): void => {
        if (at + count > length) throw new Error(`Record at ${at} (op ${op}) runs past the end of the buffer.`);
      };
      switch (op) {
        case RGE_OP_VIEW:
          need(RGE_OP_VIEW_LEN);
          out.push({ op: "view", a: records[at + 1]!, b: records[at + 2]!, c: records[at + 3]!, d: records[at + 4]!, e: records[at + 5]!, f: records[at + 6]! });
          at += RGE_OP_VIEW_LEN;
          break;
        case RGE_OP_SPRITE: {
          need(RGE_OP_SPRITE_LEN);
          const handle = records[at + 6] as number;
          const texture = this.#textures[handle];
          if (texture === undefined) throw new Error(`Sprite record uses texture handle ${handle}, which was never loaded.`);
          out.push({ op: "sprite", ...placed(), texture });
          at += RGE_OP_SPRITE_LEN;
          break;
        }
        case RGE_OP_RECT:
        case RGE_OP_ELLIPSE: {
          need(RGE_OP_RECT_LEN);
          out.push({ op: op === RGE_OP_RECT ? "rect" : "ellipse", ...placed(), width: records[at + 6]!, height: records[at + 7]!, color: colorToHex(records[at + 8]!) });
          at += op === RGE_OP_RECT ? RGE_OP_RECT_LEN : RGE_OP_ELLIPSE_LEN;
          break;
        }
        case RGE_OP_TEXT: {
          need(RGE_OP_TEXT_LEN);
          const index = records[at + 6] as number;
          const text = texts[index];
          if (text === undefined) throw new Error(`Text record uses string ${index}, but the frame has ${texts.length}.`);
          out.push({ op: "text", ...placed(), text, size: records[at + 7]!, color: colorToHex(records[at + 8]!) });
          at += RGE_OP_TEXT_LEN;
          break;
        }
        default:
          throw new Error(`Unknown draw op ${op} at record offset ${at}.`);
      }
    }
    return out;
  }
}

function handleFor(paths: string[], path: string): number {
  const existing = paths.indexOf(path);
  if (existing >= 0) return existing;
  paths.push(path);
  return paths.length - 1;
}

function keyIndex(name: string): number {
  const index = KEY_INDEX.get(name);
  if (index === undefined) throw new Error(`Unknown key '${name}' (known: ${KEYS.join(", ")}).`);
  return index;
}
