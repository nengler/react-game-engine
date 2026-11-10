import { Camera, Flex, type GameObject } from "@rge/runtime";

/**
 * `<Flex>` layout, after Clay (see docs/UI_PLAN.md, "The layout algorithm"). Everything below one layout root (a
 * `Flex` whose parent is not a `Flex`) is laid out together, in this order:
 *
 * 1. widths: fit sizes bottom-up, then sharing out space top-down;
 * 2. (text wrapping would go here: it needs final widths, and changes heights);
 * 3. heights: the same two steps;
 * 4. positions, top-down: each box places its children, writing their `layoutX` / `layoutY`.
 *
 * Steps 1 and 3 are one function parameterised by the axis: what it does to a box depends on whether the axis is the
 * box's direction or across it, and on nothing else. It allocates nothing per box: the working numbers live in each
 * `Flex`'s `FlexBox`, in arrays that grow only when a box gets more children than before.
 */

const X = 0;
const Y = 1;

const FIT = 0;
const GROW = 1;
const FIXED = 2;
const PERCENT = 3;

/** Sizes closer than this are equal, so floating-point dust never makes a loop run on. */
const EPSILON = 1e-9;

/** A size, written into by the measurer so that measuring allocates nothing. */
export interface MeasuredSize {
  width: number;
  height: number;
}

/** What layout needs from the player: the size of what an object draws, and somewhere to complain. */
export interface LayoutHost {
  /** Write the size of what `object` draws into `out` and return true, or return false when it draws nothing (a container). */
  measure(object: GameObject, out: MeasuredSize): boolean;
  /** Say `message` once per `key`. */
  warn(key: string, message: string): void;
}

export class Layouter {
  readonly #host: LayoutHost;
  readonly #measured: MeasuredSize = { width: 0, height: 0 };
  /** minX, minY, maxX, maxY of what a leaf container draws, filled by `#extent`. */
  readonly #extent4 = new Float64Array(4);

  constructor(host: LayoutHost) {
    this.#host = host;
  }

  /** Lay out `root` and everything below it in a box of `availableWidth` × `availableHeight` (what a growing root fills). */
  layout(root: Flex, availableWidth: number, availableHeight: number): void {
    // Widths before heights: a wrapped text's height would depend on its width.
    this.#fit(root, X);
    this.#sizeRoot(root, X, availableWidth);
    this.#distribute(root, X);
    this.#fit(root, Y);
    this.#sizeRoot(root, Y, availableHeight);
    this.#distribute(root, Y);
    this.#position(root);
  }

  // -- reading a box's props, by axis -------------------------------------------------------------------------------

  #parse(f: Flex, axis: number): void {
    const box = f.box;
    const raw = axis === X ? f.width : f.height;
    if (raw === box.rawSizing[axis]) return;
    box.rawSizing[axis] = raw;
    if (typeof raw === "number") {
      box.sizingMode[axis] = FIXED;
      box.sizingValue[axis] = raw >= 0 && Number.isFinite(raw) ? raw : 0;
    } else if (raw === "grow") box.sizingMode[axis] = GROW;
    else if (raw === "fit") box.sizingMode[axis] = FIT;
    else {
      const percent = typeof raw === "string" && raw.endsWith("%") ? parseFloat(raw) : NaN;
      if (percent >= 0 && percent <= 100) {
        box.sizingMode[axis] = PERCENT;
        box.sizingValue[axis] = percent / 100;
      } else {
        this.#host.warn(`flex-size:${String(raw)}`, `A <Flex> size must be a number, "fit", "grow" or a percentage such as "50%", not ${JSON.stringify(raw)}: using "fit".`);
        box.sizingMode[axis] = FIT;
      }
    }
  }

  #minProp(f: Flex, axis: number): number {
    const v = axis === X ? f.minWidth : f.minHeight;
    return v !== undefined && v > 0 ? v : 0;
  }

  #maxProp(f: Flex, axis: number): number {
    const v = axis === X ? f.maxWidth : f.maxHeight;
    return v !== undefined && v >= 0 ? v : Infinity;
  }

  /** Padding at the start (left, top) or end (right, bottom) of an axis: the side's own prop, else the axis's, else `padding`. */
  #pad(f: Flex, axis: number, end: boolean): number {
    const side = axis === X ? (end ? f.paddingRight : f.paddingLeft) : end ? f.paddingBottom : f.paddingTop;
    const both = axis === X ? f.paddingX : f.paddingY;
    const v = side ?? both ?? f.padding;
    return v !== undefined && v > 0 && Number.isFinite(v) ? v : 0;
  }

  #gap(f: Flex): number {
    return f.gap > 0 && Number.isFinite(f.gap) ? f.gap : 0;
  }

  #direction(f: Flex): number {
    return f.direction === "column" ? Y : X;
  }

  // -- measuring children -------------------------------------------------------------------------------------------

  /** Fill in each child's kind, and for a leaf its size and where its own drawing starts, on both axes. */
  #measureChildren(f: Flex): void {
    const box = f.box;
    const kids = f.children;
    box.ensure(kids.length);
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i] as GameObject;
      if (kid instanceof Flex) {
        box.childKind[i] = 1;
        (box.childOrigin[X] as Float64Array)[i] = 0;
        (box.childOrigin[Y] as Float64Array)[i] = 0;
        continue;
      }
      box.childKind[i] = 0;
      if (kid instanceof Camera) this.#host.warn("flex-camera", "A <Camera> inside a <Flex> takes no space and is not laid out: it almost certainly belongs outside it.");
      const e = this.#extent4;
      e[0] = Infinity;
      e[1] = Infinity;
      e[2] = -Infinity;
      e[3] = -Infinity;
      this.#extentOf(kid, 0, 0, e);
      const any = e[2]! >= e[0]!;
      for (let axis = 0; axis < 2; axis++) {
        (box.childOrigin[axis] as Float64Array)[i] = any ? (e[axis] as number) : 0;
        const size = any ? (e[axis + 2] as number) - (e[axis] as number) : 0;
        (box.childSize[axis] as Float64Array)[i] = size;
        (box.childMinimum[axis] as Float64Array)[i] = size;
      }
    }
  }

  /**
   * Grow `e` to cover what `object` draws, with `object`'s origin at (ox, oy): its own box, then its children's, each at its
   * own `transform` and `placement` position (rotation and scale are ignored). A `Flex` counts at its fit size.
   */
  #extentOf(object: GameObject, ox: number, oy: number, e: Float64Array): void {
    let width = 0;
    let height = 0;
    let drawn = false;
    if (object instanceof Flex) {
      this.#fit(object, X);
      this.#fit(object, Y);
      width = object.box.preferred[X] as number;
      height = object.box.preferred[Y] as number;
      drawn = true;
    } else if (this.#host.measure(object, this.#measured)) {
      width = this.#measured.width;
      height = this.#measured.height;
      drawn = true;
    }
    if (drawn) {
      if (ox < (e[0] as number)) e[0] = ox;
      if (oy < (e[1] as number)) e[1] = oy;
      if (ox + width > (e[2] as number)) e[2] = ox + width;
      if (oy + height > (e[3] as number)) e[3] = oy + height;
    }
    if (object instanceof Flex) return;
    const kids = object.children;
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i] as GameObject;
      this.#extentOf(kid, ox + kid.transform.x + kid.placement.x, oy + kid.transform.y + kid.placement.y, e);
    }
  }

  // -- sizing, one axis ---------------------------------------------------------------------------------------------

  /** Step A: this box's preferred and minimum size on the axis, from its children's, children first. */
  #fit(f: Flex, axis: number): void {
    const box = f.box;
    if (axis === X) this.#measureChildren(f);
    this.#parse(f, axis);
    const kids = f.children;
    const n = kids.length;
    const along = this.#direction(f) === axis;
    const sizes = box.childSize[axis] as Float64Array;
    const minimums = box.childMinimum[axis] as Float64Array;
    let sum = 0;
    let sumMinimum = 0;
    let largest = 0;
    let largestMinimum = 0;
    for (let i = 0; i < n; i++) {
      if (box.childKind[i] === 1) {
        const kid = kids[i] as Flex;
        this.#fit(kid, axis);
        sizes[i] = kid.box.preferred[axis] as number;
        minimums[i] = kid.box.minimum[axis] as number;
      }
      const size = sizes[i] as number;
      const minimum = minimums[i] as number;
      sum += size;
      sumMinimum += minimum;
      if (size > largest) largest = size;
      if (minimum > largestMinimum) largestMinimum = minimum;
    }
    const edges = this.#pad(f, axis, false) + this.#pad(f, axis, true);
    const gaps = along && n > 1 ? this.#gap(f) * (n - 1) : 0;
    const content = edges + gaps + (along ? sum : largest);
    const contentMinimum = edges + gaps + (along ? sumMinimum : largestMinimum);
    const mode = box.sizingMode[axis] as number;
    if (mode === FIXED) {
      box.preferred[axis] = box.sizingValue[axis] as number;
      box.minimum[axis] = box.sizingValue[axis] as number;
    } else if (mode === PERCENT) {
      // A percentage is a share of the parent, so it counts as nothing when the parent is fitting its children.
      box.preferred[axis] = 0;
      box.minimum[axis] = 0;
    } else {
      const low = this.#minProp(f, axis);
      const high = this.#maxProp(f, axis);
      box.preferred[axis] = Math.min(Math.max(content, low), high);
      box.minimum[axis] = Math.min(Math.max(contentMinimum, low), high);
    }
  }

  /** The root has no parent to share space with: it is as big as it asks, or the available box if it grows. */
  #sizeRoot(root: Flex, axis: number, available: number): void {
    const box = root.box;
    const mode = box.sizingMode[axis] as number;
    let size = box.preferred[axis] as number;
    if (mode === GROW) size = Math.max(box.minimum[axis] as number, Math.min(Math.max(available, 0), this.#maxProp(root, axis)));
    else if (mode === PERCENT) size = Math.min(Math.max(box.sizingValue[axis] as number * available, this.#minProp(root, axis)), this.#maxProp(root, axis));
    box.size[axis] = size;
  }

  /** Step B: given this box's size on the axis, decide each child's size, then do the same inside each child `Flex`. */
  #distribute(f: Flex, axis: number): void {
    const box = f.box;
    const kids = f.children;
    const n = kids.length;
    const sizes = box.childSize[axis] as Float64Array;
    const minimums = box.childMinimum[axis] as Float64Array;
    const along = this.#direction(f) === axis;
    const inner = Math.max((box.size[axis] as number) - this.#pad(f, axis, false) - this.#pad(f, axis, true), 0);
    const gaps = along && n > 1 ? this.#gap(f) * (n - 1) : 0;

    // Each child's starting size: its own, unless it is a fixed or percentage `Flex`.
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (box.childKind[i] === 1) {
        const kid = kids[i] as Flex;
        const mode = kid.box.sizingMode[axis] as number;
        if (mode === FIXED) sizes[i] = kid.box.sizingValue[axis] as number;
        else if (mode === PERCENT) {
          const share = (kid.box.sizingValue[axis] as number) * (along ? Math.max(inner - gaps, 0) : inner);
          sizes[i] = Math.min(Math.max(share, this.#minProp(kid, axis)), this.#maxProp(kid, axis));
        }
      }
      total += sizes[i] as number;
    }

    if (along) this.#grow(f, axis, inner - gaps - total);
    else {
      for (let i = 0; i < n; i++) {
        if (box.childKind[i] !== 1) continue;
        const kid = kids[i] as Flex;
        const mode = kid.box.sizingMode[axis] as number;
        if (mode === GROW || (mode === FIT && f.alignItems === "stretch")) {
          sizes[i] = Math.max(Math.min(inner, this.#maxProp(kid, axis)), minimums[i] as number);
        } else if (mode === FIT) {
          sizes[i] = Math.max(Math.min(sizes[i] as number, inner), minimums[i] as number);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (box.childKind[i] !== 1) continue;
      const kid = kids[i] as Flex;
      kid.box.size[axis] = sizes[i] as number;
      this.#distribute(kid, axis);
    }
  }

  /**
   * Share `free` space along the axis among the growing children, smallest first: the smallest takes space until it is
   * as big as the next smallest, then both do, and so on, each stopping at its maximum. What a capped child cannot take
   * goes to the others.
   */
  #grow(f: Flex, axis: number, free: number): void {
    const box = f.box;
    if (!(free > EPSILON)) return;
    const kids = f.children;
    const sizes = box.childSize[axis] as Float64Array;
    const active = box.active;
    let count = 0;
    for (let i = 0; i < kids.length; i++) {
      if (box.childKind[i] !== 1) continue;
      const kid = kids[i] as Flex;
      if (kid.box.sizingMode[axis] === GROW && (sizes[i] as number) < this.#maxProp(kid, axis) - EPSILON) active[count++] = i;
    }
    while (free > EPSILON && count > 0) {
      let smallest = Infinity;
      for (let a = 0; a < count; a++) smallest = Math.min(smallest, sizes[active[a] as number] as number);
      let next = Infinity;
      let atSmallest = 0;
      let step = Infinity;
      for (let a = 0; a < count; a++) {
        const i = active[a] as number;
        const size = sizes[i] as number;
        if (size - smallest <= EPSILON) {
          atSmallest++;
          step = Math.min(step, this.#maxProp(kids[i] as Flex, axis) - size);
        } else next = Math.min(next, size);
      }
      const delta = Math.min(next - smallest, free / atSmallest, step);
      for (let a = 0; a < count; a++) {
        const i = active[a] as number;
        if ((sizes[i] as number) - smallest <= EPSILON) sizes[i] = (sizes[i] as number) + delta;
      }
      free -= delta * atSmallest;
      // Drop what has reached its maximum.
      let kept = 0;
      for (let a = 0; a < count; a++) {
        const i = active[a] as number;
        if ((sizes[i] as number) < this.#maxProp(kids[i] as Flex, axis) - EPSILON) active[kept++] = i;
      }
      if (kept === count && !(delta > EPSILON)) break;
      count = kept;
    }
  }

  // -- positions ----------------------------------------------------------------------------------------------------

  /** Step 4: where each child goes inside this box, written to its `layoutX` / `layoutY`; then the same inside each child `Flex`. */
  #position(f: Flex): void {
    const box = f.box;
    const kids = f.children;
    const n = kids.length;
    const main = this.#direction(f);
    const cross = main === X ? Y : X;
    const mainSizes = box.childSize[main] as Float64Array;
    const crossSizes = box.childSize[cross] as Float64Array;
    const gap = this.#gap(f);
    const innerMain = Math.max((box.size[main] as number) - this.#pad(f, main, false) - this.#pad(f, main, true), 0);
    const innerCross = Math.max((box.size[cross] as number) - this.#pad(f, cross, false) - this.#pad(f, cross, true), 0);

    let used = n > 1 ? gap * (n - 1) : 0;
    for (let i = 0; i < n; i++) used += mainSizes[i] as number;
    const free = innerMain - used;
    let lead = 0;
    let between = 0;
    switch (f.justifyContent) {
      case "center": lead = free / 2; break;
      case "end": lead = free; break;
      case "space-between": if (free > 0 && n > 1) between = free / (n - 1); break;
      case "space-around": if (free > 0 && n > 0) { between = free / n; lead = between / 2; } break;
      case "space-evenly": if (free > 0 && n > 0) { between = free / (n + 1); lead = between; } break;
      default: break;
    }

    let cursor = this.#pad(f, main, false) + lead;
    for (let i = 0; i < n; i++) {
      const kid = kids[i] as GameObject;
      const crossSize = crossSizes[i] as number;
      let across = 0;
      if (f.alignItems === "center") across = (innerCross - crossSize) / 2;
      else if (f.alignItems === "end") across = innerCross - crossSize;
      const along = cursor - ((box.childOrigin[main] as Float64Array)[i] as number);
      const side = this.#pad(f, cross, false) + across - ((box.childOrigin[cross] as Float64Array)[i] as number);
      if (main === X) {
        kid.layoutX = along;
        kid.layoutY = side;
      } else {
        kid.layoutX = side;
        kid.layoutY = along;
      }
      cursor += (mainSizes[i] as number) + gap + between;
      if (box.childKind[i] === 1) this.#position(kid as Flex);
    }
  }
}
