import { Camera, FLEX_ANCHORS, Flex, type FlexAnchor, type GameObject } from "@rge/runtime";

/**
 * `<Flex>` layout, after Clay (see docs/UI_PLAN.md, "The layout algorithm"). Everything below one layout root (a
 * `Flex` whose parent is not a `Flex`) is laid out together, in this order:
 *
 * 1. widths: fit sizes bottom-up, then sharing out space top-down;
 * 2. (text wrapping would go here: it needs final widths, and changes heights);
 * 3. heights: the same two steps;
 * 4. positions, top-down: each box places its children, writing their `layoutX` / `layoutY`, then its floating children.
 *
 * A floating `Flex` (`float`) is fitted and sized like any other, but counts for nothing in its parent's flow: no space, no
 * gap, no effect on `justifyContent`. A `"grow"` or percentage size is of the parent's inner size. After the parent has
 * placed its flow, each floating child is attached by its `anchor` point to the parent's `to` point, plus its offset.
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
  /**
   * The smallest the thing can be laid out in, when that is less than its size (a wrapping text's is its widest word).
   * Without them a leaf's minimum is its size. A leaf never shrinks itself: the minimum only lets the boxes around it.
   */
  minWidth?: number;
  minHeight?: number;
}

/** What layout needs from the player: the size of what an object draws, and somewhere to complain. */
export interface LayoutHost {
  /** Write the size of what `object` draws into `out` and return true, or return false when it draws nothing (a container). */
  measure(object: GameObject, out: MeasuredSize): boolean;
  /** Say `message` once per `key`. */
  warn(key: string, message: string): void;
}

/** Whether a `<Flex>` has a border in any state (a colour for it in any state), so its room is kept whichever it is in and layout does not move when the mouse does. */
function hasBorder(f: Flex): boolean {
  return f.borderColor !== undefined || f.hoverBorderColor !== undefined || f.focusBorderColor !== undefined || f.pressedBorderColor !== undefined || f.disabledBorderColor !== undefined;
}

/** The pixels of border a `<Flex>` keeps room for on each side: its `borderWidth` when it has a border colour in any state, else 0. A clip stops at the inside of it. */
export function borderRoom(f: Flex): number {
  return f.borderWidth > 0 && Number.isFinite(f.borderWidth) && hasBorder(f) ? f.borderWidth : 0;
}

function finiteOr0(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** `object`'s children as a `Flex` lays them out: one that is `layoutContents` stands for its own children. */
function collectKids(object: GameObject, out: GameObject[], at: number): number {
  const children = object.children;
  for (let i = 0; i < children.length; i++) {
    const kid = children[i] as GameObject;
    if (kid.layoutContents) at = collectKids(kid, out, at);
    else out[at++] = kid;
  }
  return at;
}

/** What a child of a `Flex` is, in `FlexBox.childKind`. */
const LEAF = 0;
const IN_FLOW = 1;
const FLOATING = 2;

export class Layouter {
  readonly #host: LayoutHost;
  readonly #measured: MeasuredSize = { width: 0, height: 0 };
  /** minX, minY, maxX, maxY of what a leaf container draws, and the same for its minimum size: filled by `#extentOf`. */
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
    // A floating root has no `Flex` parent: it hangs off the available box (the HUD's, the screen's or the window's).
    if (root.float) this.#attach(root, availableWidth, availableHeight);
  }

  /** Attach a floating box to its parent's box of `width` × `height` (the parent's origin is the corner): its `anchor` on the parent's `to`, plus its offset. */
  #attach(kid: Flex, width: number, height: number): void {
    const x = width * this.#fraction(kid.to, X) - (kid.box.size[X] as number) * this.#fraction(kid.anchor, X) + finiteOr0(kid.offsetX);
    const y = height * this.#fraction(kid.to, Y) - (kid.box.size[Y] as number) * this.#fraction(kid.anchor, Y) + finiteOr0(kid.offsetY);
    kid.layoutX = Math.round(x);
    kid.layoutY = Math.round(y);
  }

  /** How far along the axis a named point is: 0 at the start, 0.5 in the middle, 1 at the end. An unknown name warns once and is the top-left. */
  #fraction(point: FlexAnchor, axis: number): number {
    if (!FLEX_ANCHORS.includes(point)) {
      this.#host.warn(`flex-anchor:${String(point)}`, `A <Flex> anchor must be one of ${FLEX_ANCHORS.join(", ")}, not ${JSON.stringify(point)}: using "top-left".`);
      return 0;
    }
    if (axis === X) return point.endsWith("left") ? 0 : point.endsWith("right") ? 1 : 0.5;
    return point.startsWith("top") ? 0 : point.startsWith("bottom") ? 1 : 0.5;
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

  /**
   * Padding at the start (left, top) or end (right, bottom) of an axis: the side's own prop, else the axis's, else `padding`,
   * and the border's width on top, because a border takes room from the inside. A border that has no colour in any state is not drawn and takes none.
   */
  #pad(f: Flex, axis: number, end: boolean): number {
    const side = axis === X ? (end ? f.paddingRight : f.paddingLeft) : end ? f.paddingBottom : f.paddingTop;
    const both = axis === X ? f.paddingX : f.paddingY;
    const v = side ?? both ?? f.padding;
    const padding = v !== undefined && v > 0 && Number.isFinite(v) ? v : 0;
    return padding + borderRoom(f);
  }

  /** Pixels between neighbouring children along the main axis: `columnGap` for a row, `rowGap` for a column, else `gap`. */
  #gap(f: Flex): number {
    const g = (f.direction === "column" ? f.rowGap : f.columnGap) ?? f.gap;
    return g > 0 && Number.isFinite(g) ? g : 0;
  }

  /** Pixels between the lines of a wrapping row: `rowGap`, else `gap`. */
  #lineGap(f: Flex): number {
    const g = f.rowGap ?? f.gap;
    return g > 0 && Number.isFinite(g) ? g : 0;
  }

  /** Whether `f` wraps: a row with `wrap` (a column that asks to is warned of, and does not). */
  #wraps(f: Flex): boolean {
    return f.wrap === true && f.direction !== "column";
  }

  #direction(f: Flex): number {
    return f.direction === "column" ? Y : X;
  }

  // -- measuring children -------------------------------------------------------------------------------------------

  /** Fill in each child's kind, and for a leaf its size and where its own drawing starts, on both axes. */
  #measureChildren(f: Flex): void {
    const box = f.box;
    if (f.wrap === true && f.direction === "column") this.#host.warn("flex-wrap-column", `A <Flex wrap> must be a row: a column does not wrap, and lays its children out in one line.`);
    let see = false;
    for (let i = 0; i < f.children.length; i++) if ((f.children[i] as GameObject).layoutContents) see = true;
    if (see) {
      const n = collectKids(f, box.flat, 0);
      if (box.flat.length !== n) box.flat.length = n;
      box.kids = box.flat;
    } else box.kids = f.children;
    const kids = box.kids;
    box.ensure(kids.length);
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i] as GameObject;
      if (kid instanceof Flex) {
        box.childKind[i] = kid.float ? FLOATING : IN_FLOW;
        (box.childOrigin[X] as Float64Array)[i] = 0;
        (box.childOrigin[Y] as Float64Array)[i] = 0;
        continue;
      }
      box.childKind[i] = LEAF;
      if (kid instanceof Camera) this.#host.warn("flex-camera", "A <Camera> inside a <Flex> takes no space and is not laid out: it almost certainly belongs outside it.");
      const e = this.#extent4;
      e[0] = Infinity;
      e[1] = Infinity;
      e[2] = -Infinity;
      e[3] = -Infinity;
      this.#measured.minWidth = undefined;
      this.#measured.minHeight = undefined;
      this.#extentOf(kid, 0, 0, e);
      // A leaf with nothing inside it can be laid out smaller than it is (its own minimum); a container cannot.
      const leaf = kid.children.length === 0;
      const any = e[2]! >= e[0]!;
      for (let axis = 0; axis < 2; axis++) {
        (box.childOrigin[axis] as Float64Array)[i] = any ? (e[axis] as number) : 0;
        const size = any ? (e[axis + 2] as number) - (e[axis] as number) : 0;
        const smallest = leaf ? (axis === X ? this.#measured.minWidth : this.#measured.minHeight) : undefined;
        (box.childSize[axis] as Float64Array)[i] = size;
        (box.childMinimum[axis] as Float64Array)[i] = smallest !== undefined && smallest >= 0 && smallest < size ? smallest : size;
      }
    }
  }

  /** Ask the host for a leaf's size, clearing the optional minimums first so a host that has none leaves them unset. */
  #measureLeaf(object: GameObject): boolean {
    this.#measured.minWidth = undefined;
    this.#measured.minHeight = undefined;
    return this.#host.measure(object, this.#measured);
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
    } else if (this.#measureLeaf(object)) {
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
    const kids = f.box.kids;
    const n = kids.length;
    const along = this.#direction(f) === axis;
    const sizes = box.childSize[axis] as Float64Array;
    const minimums = box.childMinimum[axis] as Float64Array;
    let sum = 0;
    let sumMinimum = 0;
    let largest = 0;
    let largestMinimum = 0;
    let flow = 0;
    for (let i = 0; i < n; i++) {
      if (box.childKind[i] !== LEAF) {
        const kid = kids[i] as Flex;
        this.#fit(kid, axis);
        sizes[i] = kid.box.preferred[axis] as number;
        minimums[i] = kid.box.minimum[axis] as number;
      }
      if (box.childKind[i] === FLOATING) continue; // takes no space
      flow++;
      const size = sizes[i] as number;
      const minimum = minimums[i] as number;
      sum += size;
      sumMinimum += minimum;
      if (size > largest) largest = size;
      if (minimum > largestMinimum) largestMinimum = minimum;
    }
    const edges = this.#pad(f, axis, false) + this.#pad(f, axis, true);
    const gaps = along && flow > 1 ? this.#gap(f) * (flow - 1) : 0;
    const wraps = this.#wraps(f);
    // A wrapping row is as tall as its lines one under another (the widths are settled by now), as wide as one line when it can be.
    const stacked = wraps && axis === Y ? this.#stackLines(f, sizes) : largest;
    const content = edges + gaps + (along ? sum : stacked);
    // A box that scrolls can be made as small as its edges: what does not fit is scrolled to, so it asks its parent for no more.
    // A wrapping row can be as narrow as its widest child.
    const contentMinimum = f.overflow === "scroll" ? edges : wraps ? edges + (axis === Y ? stacked : largestMinimum) : edges + gaps + (along ? sumMinimum : largestMinimum);
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
    const kids = f.box.kids;
    const n = kids.length;
    const sizes = box.childSize[axis] as Float64Array;
    const minimums = box.childMinimum[axis] as Float64Array;
    const along = this.#direction(f) === axis;
    const inner = Math.max((box.size[axis] as number) - this.#pad(f, axis, false) - this.#pad(f, axis, true), 0);
    let flow = 0;
    for (let i = 0; i < n; i++) if (box.childKind[i] !== FLOATING) flow++;
    const wraps = this.#wraps(f);
    // (A wrapping row's gaps are between the children of a line, not of all of them.)
    const gaps = along && flow > 1 && !wraps ? this.#gap(f) * (flow - 1) : 0;

    // Each child's starting size: its own, unless it is a fixed or percentage `Flex`.
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (box.childKind[i] === FLOATING) continue;
      if (box.childKind[i] === IN_FLOW) {
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

    if (along) {
      // A wrapping row's children keep their size: what does not fit goes to the next line.
      const free = inner - gaps - total;
      if (wraps) {
        // (nothing to share out)
      } else if (free > EPSILON) this.#grow(f, axis, free);
      else if (free < -EPSILON && f.overflow !== "scroll") this.#shrink(f, axis, -free); // a scroll box's children keep their size, and overflow
    } else if (wraps) {
      this.#sizeLines(f, axis);
    } else {
      for (let i = 0; i < n; i++) {
        if (box.childKind[i] !== IN_FLOW) continue;
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
      if (box.childKind[i] === LEAF) continue;
      const kid = kids[i] as Flex;
      if (box.childKind[i] === FLOATING) {
        // Sized against the parent's whole inner size, as if it were the only child.
        const mode = kid.box.sizingMode[axis] as number;
        if (mode === FIXED) sizes[i] = kid.box.sizingValue[axis] as number;
        else if (mode === PERCENT) sizes[i] = Math.min(Math.max((kid.box.sizingValue[axis] as number) * inner, this.#minProp(kid, axis)), this.#maxProp(kid, axis));
        else if (mode === GROW) sizes[i] = Math.max(Math.min(inner, this.#maxProp(kid, axis)), minimums[i] as number);
      }
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
    const kids = f.box.kids;
    const sizes = box.childSize[axis] as Float64Array;
    const active = box.active;
    let count = 0;
    for (let i = 0; i < kids.length; i++) {
      if (box.childKind[i] !== IN_FLOW) continue;
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

  /**
   * Take `overflow` back along the axis from the children that can give way, largest first: the largest shrinks until it
   * is as small as the next largest, then both do, and so on, each stopping at its minimum, and a box that has reached its
   * minimum drops out. Only a `<Flex>` that is `"fit"` or `"grow"` shrinks; a fixed or percentage one holds, and a leaf
   * keeps its size (it only offers a minimum to the box around it). What still does not fit overflows.
   */
  #shrink(f: Flex, axis: number, overflow: number): void {
    const box = f.box;
    const kids = f.box.kids;
    const sizes = box.childSize[axis] as Float64Array;
    const minimums = box.childMinimum[axis] as Float64Array;
    const active = box.active;
    let count = 0;
    for (let i = 0; i < kids.length; i++) {
      if (box.childKind[i] !== IN_FLOW) continue;
      const mode = (kids[i] as Flex).box.sizingMode[axis];
      if ((mode === FIT || mode === GROW) && (sizes[i] as number) > (minimums[i] as number) + EPSILON) active[count++] = i;
    }
    while (overflow > EPSILON && count > 0) {
      let largest = -Infinity;
      for (let a = 0; a < count; a++) largest = Math.max(largest, sizes[active[a] as number] as number);
      let next = -Infinity;
      let atLargest = 0;
      let room = Infinity;
      for (let a = 0; a < count; a++) {
        const i = active[a] as number;
        const size = sizes[i] as number;
        if (largest - size <= EPSILON) {
          atLargest++;
          room = Math.min(room, size - (minimums[i] as number));
        } else next = Math.max(next, size);
      }
      const delta = Math.min(largest - next, overflow / atLargest, room);
      for (let a = 0; a < count; a++) {
        const i = active[a] as number;
        if (largest - (sizes[i] as number) <= EPSILON) sizes[i] = (sizes[i] as number) - delta;
      }
      overflow -= delta * atLargest;
      let kept = 0;
      for (let a = 0; a < count; a++) {
        const i = active[a] as number;
        if ((sizes[i] as number) > (minimums[i] as number) + EPSILON) active[kept++] = i;
      }
      if (kept === count && !(delta > EPSILON)) break;
      count = kept;
    }
  }

  // -- positions ----------------------------------------------------------------------------------------------------

  /** Step 4: where each child goes inside this box, written to its `layoutX` / `layoutY`; then the same inside each child `Flex`. */
  #position(f: Flex): void {
    if (this.#wraps(f)) {
      this.#positionWrapped(f);
      return;
    }
    const box = f.box;
    const kids = f.box.kids;
    const n = kids.length;
    const main = this.#direction(f);
    const cross = main === X ? Y : X;
    const mainSizes = box.childSize[main] as Float64Array;
    const crossSizes = box.childSize[cross] as Float64Array;
    const gap = this.#gap(f);
    // Each padding once: a call that returns a number allocates when it is not inlined, and this runs for every box every frame.
    const padMainStart = this.#pad(f, main, false);
    const padMainEnd = this.#pad(f, main, true);
    const padCrossStart = this.#pad(f, cross, false);
    const padCrossEnd = this.#pad(f, cross, true);
    const innerMain = Math.max((box.size[main] as number) - padMainStart - padMainEnd, 0);
    const innerCross = Math.max((box.size[cross] as number) - padCrossStart - padCrossEnd, 0);

    let flow = 0;
    for (let i = 0; i < n; i++) if (box.childKind[i] !== FLOATING) flow++;
    let used = flow > 1 ? gap * (flow - 1) : 0;
    for (let i = 0; i < n; i++) if (box.childKind[i] !== FLOATING) used += mainSizes[i] as number;
    const free = innerMain - used;
    let lead = 0;
    let between = 0;
    switch (f.justifyContent) {
      case "center": lead = free / 2; break;
      case "end": lead = free; break;
      case "space-between": if (free > 0 && flow > 1) between = free / (flow - 1); break;
      case "space-around": if (free > 0 && flow > 0) { between = free / flow; lead = between / 2; } break;
      case "space-evenly": if (free > 0 && flow > 0) { between = free / (flow + 1); lead = between; } break;
      default: break;
    }

    let cursor = padMainStart + lead;
    // Where the children end (a floating one is out of the flow and does not count), for how far a scroll box can scroll. Kept in
    // the box's own array, not in locals that the loop carries: those made this recursive pass allocate a number per box.
    const ends = box.contentEnd;
    ends[main] = padMainStart;
    ends[cross] = padCrossStart;
    for (let i = 0; i < n; i++) {
      const kid = kids[i] as GameObject;
      if (box.childKind[i] === FLOATING) {
        this.#attach(kid as Flex, box.size[X] as number, box.size[Y] as number);
        this.#position(kid as Flex);
        continue;
      }
      const crossSize = crossSizes[i] as number;
      let across = 0;
      if (f.alignItems === "center") across = (innerCross - crossSize) / 2;
      else if (f.alignItems === "end") across = innerCross - crossSize;
      const along = cursor - ((box.childOrigin[main] as Float64Array)[i] as number);
      const side = padCrossStart + across - ((box.childOrigin[cross] as Float64Array)[i] as number);
      // Whole pixels, so centred text and edges are not blurred by half a pixel.
      if (main === X) {
        kid.layoutX = Math.round(along);
        kid.layoutY = Math.round(side);
      } else {
        kid.layoutX = Math.round(side);
        kid.layoutY = Math.round(along);
      }
      if (cursor + (mainSizes[i] as number) > (ends[main] as number)) ends[main] = cursor + (mainSizes[i] as number);
      if (padCrossStart + across + crossSize > (ends[cross] as number)) ends[cross] = padCrossStart + across + crossSize;
      cursor += (mainSizes[i] as number) + gap + between;
      if (box.childKind[i] === IN_FLOW) this.#position(kid as Flex);
    }
    ends[main] = (ends[main] as number) + padMainEnd;
    ends[cross] = (ends[cross] as number) + padCrossEnd;
    for (let axis = 0; axis < 2; axis++) {
      const room = (box.contentEnd[axis] as number) - (box.size[axis] as number);
      box.scrollMax[axis] = f.overflow === "scroll" && room > 0 ? room : 0;
    }
    if (f.overflow === "scroll") this.#scroll(f);
  }

  /**
   * Break a wrapping row's children into lines: a child starts a new line when it (and the gap before it) would not fit in what is
   * left of the inner width, except as the first of its line, however wide. Writes `lineEnd` and `lineCount`; a floating child is
   * out of the flow and in no line's way. It depends only on the children's widths and the box's own, so any pass may ask again.
   */
  #breakLines(f: Flex): void {
    const box = f.box;
    const n = box.kids.length;
    const mains = box.childSize[X] as Float64Array;
    const inner = Math.max((box.size[X] as number) - this.#pad(f, X, false) - this.#pad(f, X, true), 0);
    const gap = this.#gap(f);
    let lines = 0;
    let used = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (box.childKind[i] === FLOATING) continue;
      const width = mains[i] as number;
      if (count > 0 && used + gap + width > inner + EPSILON) {
        box.lineEnd[lines++] = i;
        used = 0;
        count = 0;
      }
      used += (count > 0 ? gap : 0) + width;
      count++;
    }
    if (count > 0) box.lineEnd[lines++] = n;
    box.lineCount = lines;
  }

  /** Break `f` into lines and give each the height of its tallest child (`heights` is the children's, in order); returns their total with the gaps between. */
  #stackLines(f: Flex, heights: Float64Array): number {
    const box = f.box;
    this.#breakLines(f);
    let total = 0;
    let start = 0;
    for (let line = 0; line < box.lineCount; line++) {
      const end = box.lineEnd[line] as number;
      let tallest = 0;
      for (let i = start; i < end; i++) if (box.childKind[i] !== FLOATING && (heights[i] as number) > tallest) tallest = heights[i] as number;
      box.lineCross[line] = tallest;
      total += tallest;
      start = end;
    }
    return box.lineCount > 1 ? total + this.#lineGap(f) * (box.lineCount - 1) : total;
  }

  /** The cross sizes of a wrapping row's children: one that stretches or grows fills its line, within its own limits. */
  #sizeLines(f: Flex, axis: number): void {
    const box = f.box;
    const kids = box.kids;
    const sizes = box.childSize[axis] as Float64Array;
    const minimums = box.childMinimum[axis] as Float64Array;
    this.#stackLines(f, sizes);
    let start = 0;
    for (let line = 0; line < box.lineCount; line++) {
      const end = box.lineEnd[line] as number;
      const height = box.lineCross[line] as number;
      for (let i = start; i < end; i++) {
        if (box.childKind[i] !== IN_FLOW) continue;
        const kid = kids[i] as Flex;
        const mode = kid.box.sizingMode[axis] as number;
        if (mode === GROW || (mode === FIT && f.alignItems === "stretch")) sizes[i] = Math.max(Math.min(height, this.#maxProp(kid, axis)), minimums[i] as number);
        else if (mode === FIT) sizes[i] = Math.max(Math.min(sizes[i] as number, height), minimums[i] as number);
      }
      start = end;
    }
  }

  /** `#position` for a wrapping row: each line on its own, one under another, its children placed along it by `justifyContent` and across it by `alignItems`. */
  #positionWrapped(f: Flex): void {
    const box = f.box;
    const kids = box.kids;
    const mains = box.childSize[X] as Float64Array;
    const crosses = box.childSize[Y] as Float64Array;
    const padStart = this.#pad(f, X, false);
    const padTop = this.#pad(f, Y, false);
    const innerMain = Math.max((box.size[X] as number) - padStart - this.#pad(f, X, true), 0);
    const gap = this.#gap(f);
    const lineGap = this.#lineGap(f);
    this.#stackLines(f, crosses); // the lines, now at the children's final heights
    const ends = box.contentEnd;
    ends[X] = padStart;
    ends[Y] = padTop;
    let top = padTop;
    let start = 0;
    for (let line = 0; line < box.lineCount; line++) {
      const end = box.lineEnd[line] as number;
      const height = box.lineCross[line] as number;
      let flow = 0;
      let used = 0;
      for (let i = start; i < end; i++) {
        if (box.childKind[i] === FLOATING) continue;
        flow++;
        used += mains[i] as number;
      }
      if (flow > 1) used += gap * (flow - 1);
      const free = innerMain - used;
      let lead = 0;
      let between = 0;
      switch (f.justifyContent) {
        case "center": lead = free / 2; break;
        case "end": lead = free; break;
        case "space-between": if (free > 0 && flow > 1) between = free / (flow - 1); break;
        case "space-around": if (free > 0 && flow > 0) { between = free / flow; lead = between / 2; } break;
        case "space-evenly": if (free > 0 && flow > 0) { between = free / (flow + 1); lead = between; } break;
        default: break;
      }
      let cursor = padStart + lead;
      for (let i = start; i < end; i++) {
        const kid = kids[i] as GameObject;
        if (box.childKind[i] === FLOATING) {
          this.#attach(kid as Flex, box.size[X] as number, box.size[Y] as number);
          this.#position(kid as Flex);
          continue;
        }
        const crossSize = crosses[i] as number;
        let across = 0;
        if (f.alignItems === "center") across = (height - crossSize) / 2;
        else if (f.alignItems === "end") across = height - crossSize;
        kid.layoutX = Math.round(cursor - ((box.childOrigin[X] as Float64Array)[i] as number));
        kid.layoutY = Math.round(top + across - ((box.childOrigin[Y] as Float64Array)[i] as number));
        if (cursor + (mains[i] as number) > (ends[X] as number)) ends[X] = cursor + (mains[i] as number);
        if (top + across + crossSize > (ends[Y] as number)) ends[Y] = top + across + crossSize;
        cursor += (mains[i] as number) + gap + between;
        if (box.childKind[i] === IN_FLOW) this.#position(kid as Flex);
      }
      top += height + lineGap;
      start = end;
    }
    ends[X] = (ends[X] as number) + this.#pad(f, X, true);
    ends[Y] = (ends[Y] as number) + this.#pad(f, Y, true);
    for (let axis = 0; axis < 2; axis++) {
      const room = (box.contentEnd[axis] as number) - (box.size[axis] as number);
      box.scrollMax[axis] = f.overflow === "scroll" && room > 0 ? room : 0;
    }
    if (f.overflow === "scroll") this.#scroll(f);
  }

  /** Clamp a scroll box's offset to its content and move the children by it (a floating child stays where it is attached). */
  #scroll(f: Flex): void {
    const box = f.box;
    const x = Math.round(Math.min(Math.max(Number.isFinite(f.scrollX) ? f.scrollX : 0, 0), box.scrollMax[X] as number));
    const y = Math.round(Math.min(Math.max(Number.isFinite(f.scrollY) ? f.scrollY : 0, 0), box.scrollMax[Y] as number));
    f.scrollX = x;
    f.scrollY = y;
    if (x === 0 && y === 0) return;
    const kids = box.kids;
    for (let i = 0; i < kids.length; i++) {
      if (box.childKind[i] === FLOATING) continue;
      const kid = kids[i] as GameObject;
      kid.layoutX -= x;
      kid.layoutY -= y;
    }
  }
}
