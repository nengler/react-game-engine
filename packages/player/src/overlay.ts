/**
 * The development overlay (DESIGN.md, "Seeing inside a running game"), drawn over the game in `tse dev` when its key (F1) is pressed: every `<Flex>`
 * box and its padding, every collider (coloured by layer) and every pointer, and, for the box under the mouse, a label with the
 * components it is in, its size and the props that sized it. It is drawn in window pixels after the game's records, and never
 * in a packaged build (the player is given `devtools` only by `tse dev`).
 */
import { Flex, Pointer, isComponent, type Collider, type GameObject, type ViewTransform, type WorldTransform } from "@tsengine/runtime";

import type { BuiltFrame, DrawList } from "./draw.ts";

const IDENTITY: ViewTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const WINDOW: WorldTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
const FLEX_COLOR = 0x4fc3f7ff;
const PADDING_COLOR = 0x4fc3f766;
const POINTER_COLOR = 0xffd54fff;
const HOVER_COLOR = 0xffffffff;
const LABEL_BACK = 0x000000cc;
const LABEL_TEXT = 0xffffffff;
/** Collider outlines take a colour from their layer, so the layers can be told apart. */
const LAYER_COLORS = [0xef5350ff, 0x66bb6aff, 0xab47bcff, 0xffa726ff, 0x26a69aff, 0xec407aff];

/** A box in window pixels. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The window rectangle that a box of `width` × `height` at `world` covers, through `view` (rotation is ignored: boxes are upright). */
function toWindow(world: WorldTransform, width: number, height: number, view: ViewTransform): Rect {
  const corner = (x: number, y: number): [number, number] => [view.a * x + view.c * y + view.e, view.b * x + view.d * y + view.f];
  const [x0, y0] = corner(world.x, world.y);
  const [x1, y1] = corner(world.x + width * world.scaleX, world.y + height * world.scaleY);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

function outline(list: DrawList, r: Rect, color: number): void {
  if (r.width <= 0 || r.height <= 0) return;
  list.box({ ...WINDOW, x: r.x, y: r.y }, r.width, r.height, 0, color, 1, 0);
}

function layerColor(layer: string): number {
  let hash = 0;
  for (let i = 0; i < layer.length; i++) hash = (hash * 31 + layer.charCodeAt(i)) | 0;
  return LAYER_COLORS[Math.abs(hash) % LAYER_COLORS.length] as number;
}

/** The components an object is in, outermost first (`Play › SidePanel › BuildMenu`). */
function componentPath(object: GameObject): string {
  const names: string[] = [];
  for (let at: GameObject | null = object; at !== null; at = at.parent) if (isComponent(at)) names.unshift(at.constructor.name);
  return names.join(" › ");
}

/** What sized a box, as its props say: `width grow`, `height 40`, `width 50%`. */
function sizing(flex: Flex): string {
  const show = (axis: string, value: unknown): string | null =>
    value === undefined || value === "fit" ? null : `${axis} ${String(value)}`;
  return [show("width", flex.width), show("height", flex.height)].filter((part) => part !== null).join(", ") || "fit";
}

/** Draw the overlay for a built frame into its list, with the mouse at (`mouseX`, `mouseY`) in window pixels. */
export function drawOverlay(
  list: DrawList,
  built: BuiltFrame,
  boxes: readonly { readonly flex: Flex; readonly world: WorldTransform; readonly hud: boolean }[],
  mouseX: number,
  mouseY: number,
  windowWidth: number
): void {
  list.view(IDENTITY);
  let hovered: { readonly flex: Flex; readonly rect: Rect } | null = null;
  for (const { flex, world, hud } of boxes) {
    const width = flex.box.size[0] as number;
    const height = flex.box.size[1] as number;
    const view = hud ? built.hudView : built.view;
    const rect = toWindow(world, width, height, view);
    outline(list, rect, FLEX_COLOR);
    const top = flex.paddingTop ?? flex.paddingY ?? flex.padding ?? 0;
    const right = flex.paddingRight ?? flex.paddingX ?? flex.padding ?? 0;
    const bottom = flex.paddingBottom ?? flex.paddingY ?? flex.padding ?? 0;
    const left = flex.paddingLeft ?? flex.paddingX ?? flex.padding ?? 0;
    if (top + right + bottom + left > 0) {
      outline(
        list,
        toWindow(
          { ...world, x: world.x + left * world.scaleX, y: world.y + top * world.scaleY },
          Math.max(0, width - left - right),
          Math.max(0, height - top - bottom),
          view
        ),
        PADDING_COLOR
      );
    }
    if (mouseX >= rect.x && mouseX < rect.x + rect.width && mouseY >= rect.y && mouseY < rect.y + rect.height) hovered = { flex, rect };
  }
  for (const { collider, world } of built.colliders)
    outline(
      list,
      toWindow(world, (collider as Collider).width, (collider as Collider).height, built.view),
      layerColor((collider as Collider).layer)
    );
  built.pointers.forEach((pointer, i) => {
    if (!(pointer instanceof Pointer)) return;
    const at = pointer.worldTransform();
    const world = { ...at, x: at.x - pointer.originX * at.scaleX, y: at.y - pointer.originY * at.scaleY };
    outline(list, toWindow(world, pointer.width, pointer.height, i >= built.hudPointersFrom ? built.hudView : built.view), POINTER_COLOR);
  });
  if (hovered === null) return;
  outline(list, hovered.rect, HOVER_COLOR);
  const { flex, rect } = hovered;
  const label = `${componentPath(flex) || "Flex"}  ${Math.round(flex.box.size[0] as number)}×${Math.round(flex.box.size[1] as number)}  ${sizing(flex)}`;
  const size = 10;
  const width = label.length * size * 0.6 + 6;
  const x = Math.max(0, Math.min(rect.x, windowWidth - width));
  const y = rect.y >= size + 6 ? rect.y - size - 6 : rect.y + rect.height + 2;
  list.rect({ ...WINDOW, x, y }, width, size + 4, LABEL_BACK);
  list.text({ ...WINDOW, x: x + 3, y: y + 2 }, label, size, LABEL_TEXT);
}
