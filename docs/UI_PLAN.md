# react-game-engine: UI layout plan

As of 2026-11-09, revised the same day after studying Clay's layout algorithm (see "The model: Clay"). U1 and C1 are built; the rest is a proposal, written to sit next to priority 3 in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md) (the screen-space HUD layer). Push back on any decision below before work starts, as [DESIGN.md](DESIGN.md) asks.

The plan has two parts that are designed together:

1. **Layout** (milestones U0–U5): a `<Flex>` built-in that places its children in a row or a column, with the props of CSS flexbox and the sizing algorithm of Clay.
2. **A fixed game resolution** (milestones C1–C3, [Part 2](#part-2-a-fixed-game-resolution-screen)): a `<Screen width={320} height={180}>` inside the game's `<Game>` root, so the game is drawn at 320 × 180 whatever size the window is, and scaled up to fit.

They meet at one point: everything that today means "the window" (the box `<Hud>` gives layout, the point the camera centres on, the mouse position) means the game's own 320 × 180 area once a `<Screen>` exists (called "the canvas" below: the surface the game is drawn on before it is scaled into the window). A HUD designed for 320 × 180 then looks the same in a 640 × 360 window as in a full-screen 4K one.

## Summary of part 1

Games need UI: a score in a corner, a health bar, a pause menu, a row of buttons. Today every one of those is placed by hand with `transform={{ x, y }}`. The demo's click button is a `Shape`, a `Pointer` and a `Text`, each given its own coordinates, and the label is centred by guessing (`x: 92` inside a box at `x: 80`). Change the label and the guess is wrong.

This plan adds **layout**: a `<Flex>` built-in that places its children in a row or a column.

```tsx
<Flex direction="row" alignItems="center" gap={8} padding={12} background="#0008">
  <Sprite image="coin.png" />
  <Text size={20}>{coins}</Text>
</Flex>
```

It takes the props a web developer expects (`direction`, `alignItems`, `justifyContent`, `gap`, `padding`), with CSS's meanings, and sizes boxes the way Clay does: each axis is `"fit"` (the default), `"grow"`, a fixed number of pixels, or a percentage of the parent, with optional minimum and maximum sizes. It is a container, like `<Entity>`, and it works anywhere in the tree, in the world or on priority 3's `<Hud>`. In practice almost all of it will live on the HUD, which is why it goes alongside priority 3.

What has to exist first, and why priority 3 comes before or with this:

- **Sizes.** Layout needs to know how big each child is. `Shape`, `Pointer` and `Collider` already have `width` and `height`. A `Text` and a `Sprite` do not: the size of text depends on the font, and the size of a sprite on the image file. Both are known only to librge. So the native library must answer two new questions, "how big is this text at this size?" and "how big is this texture?", which is an ABI change. Priority 3 already bumps the ABI to version 2 for `<Hud>`; these functions go into the **same** version 2, so the ABI moves once.
- **A box to lay out in.** A HUD laid out in world space still drifts with the camera. `<Hud>` gives layout a fixed box: the canvas (or the window, with no `<Screen>`).

So the order is: priority 3 (with U0's additions in ABI v2), then U2–U5. U1 is done. The full order, interleaving these milestones with C2, C3 and the other priorities, is "Order of work" in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md#order-of-work).

| Milestone | What | Size (estimate) |
| --- | --- | --- |
| U0 | ABI v2 also carries `rge_measure_text` (width and line height), `rge_texture_size`, and a scissor record (done as part of priority 3) | \~2 days on top of priority 3 |
| U1 | A layout offset on every object, and a measuring interface in the player | **Done** |
| U2 | `<Flex>`: the built-in, the sizing modes, the four passes, alignment, `background` | \~1–1.5 weeks |
| U3 | The HUD box, shrinking to minimum sizes, and the demo's HUD rewritten with it | \~3–4 days |
| U4 | Polish: pixel snapping, text alignment inside a box, `<Flex onPress>` | \~3–4 days |
| U5 | Floating boxes: anchored to a point of their parent, outside the flow (tooltips, corner badges, HUD corners) | \~3–4 days |

Sizes are rough, for one engineer, in the style of the other plans.

## The model: Clay

The layout algorithm follows Clay (C Layout, by Nic Barker: [github.com/nicbarker/clay](https://github.com/nicbarker/clay)), a single-header flexbox-like layout library whose author explains it in the video "How Clay's UI Layout Algorithm Works". This plan was revised from Clay's own README and `clay.h` (the layout passes are `Clay__CloseElement`, `Clay__SizeContainersAlongAxis` and `Clay__CalculateFinalLayout`), and then checked against the video's transcript (pasted in by the user on 2026-11-10; the video could not be fetched from the cloud machine). The transcript agrees with the code on every rule below, and changed how the passes are structured (see "The layout algorithm"). What was read in Clay and in the video, including what this plan does not use yet, is logged in [CLAY_NOTES.md](CLAY_NOTES.md). What it takes from Clay:

- **Sizing is per axis, with four modes.** `fit` (the default) is the size of the children plus padding and gaps; `grow` takes free space in the parent; `fixed` is a number; `percent` is a share of the parent's inner size. `fit` and `grow` take a minimum and a maximum. This replaces the earlier draft's `width`/`height`/`fill`/weighted `grow`.
- **Sizes first, then positions; widths before heights.** An element's position cannot be known until every size is (a wider item further along pushes everything after it), so sizing and positioning are separate passes and positions come last. Sizing is itself one pair of passes per axis, fit bottom-up then grow/shrink top-down, widths first: a wrapped text's height depends on its width, so heights wait until after wrapping. Ordering the passes this way from the start means wrapping can be added later without redesigning anything. The video's way to say it: UI layout is mostly a one-dimensional problem, so the two axes share one function.
- **Grow is not weighted.** Free space goes to the smallest growing child first, until it matches the next smallest, and so on, each child stopping at its maximum. Equal growing siblings end up equal, which is what a row of buttons wants.
- **Overflow shrinks, down to minimums.** When children do not fit, the largest shrinkable child gives way first, down to its minimum size (by default, its own content's minimum). Leaves never shrink.
- **Floating boxes are separate.** A floating box is laid out like any other but attached to a point of its parent with an offset, takes no space, and draws above according to `z`. That is how tooltips, badges and HUD corners are placed (U5).
- **No allocation per frame.** Clay lays out thousands of elements in microseconds with no `malloc`. Under QuickJS the equivalent is no new objects per node per frame: layout keeps its numbers in fields on the `Flex` objects and in arrays reused between frames.

It keeps the CSS vocabulary already decided (`direction`, `alignItems`, `justifyContent`, `gap`, `padding`): Clay's alignment is start, centre or end on each axis, which `alignItems` and `justifyContent` cover, and `justifyContent`'s `space-*` values only add ways to share free space.

## What an author writes

### The props

| Prop | Values | Default | Meaning |
| --- | --- | --- | --- |
| `direction` | `"row"`, `"column"` | `"row"` | The main axis: children go left to right, or top to bottom |
| `alignItems` | `"start"`, `"center"`, `"end"`, `"stretch"` | `"stretch"` | Where children sit on the cross axis. `stretch` makes a child `Flex` whose cross size is `"fit"` take the whole cross size, as in CSS; anything else keeps its size and sits at the start |
| `justifyContent` | `"start"`, `"center"`, `"end"`, `"space-between"`, `"space-around"`, `"space-evenly"` | `"start"` | How children and free space share the main axis |
| `gap` | pixels | `0` | Space between neighbouring children |
| `padding` | pixels | `0` | Space inside the edge, on all four sides |
| `paddingX`, `paddingY` | pixels | `padding` | Left and right, or top and bottom; override `padding` |
| `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | pixels | the axis value | One side; overrides the two above |
| `width`, `height` | `"fit"`, `"grow"`, a number, or a percentage such as `"50%"` | `"fit"` | How big the box is on that axis (see "Sizing") |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | pixels | none | Bounds for `"fit"` and `"grow"` |
| `background` | a CSS colour | none | Draw a filled rectangle behind the children, the size of the box |
| `onPress` | a callback | none | Pressable over the laid-out box (U4) |

Every one is a plain string, number or boolean, so each is a field on the object, set in place by `render()` like `Shape.width` is. There are no object-valued props (`padding={{ x: 8 }}`): an object would be allocated on every render, which the performance work in priority 4 is trying to remove, and the compiler today only special-cases `transform` as an object. That is why padding is spelled out as separate props.

The keyword props (`direction`, `alignItems`, `justifyContent`) go in the manifest's `intrinsicLiterals`, exactly like `<Shape kind>`. A typo is a compile error with the choices and a suggestion. CSS also spells `start` as `flex-start`, so that typo gets its own hint: `<Flex alignItems> must be one of "start", "center", "end", "stretch", not 'flex-start' (did you mean "start"?)`.

### Sizing

| Value | The box is | Like |
| --- | --- | --- |
| `"fit"` (default) | As big as its children, plus padding and gaps, clamped to `min`/`max` | CSS `auto`, Clay `CLAY_SIZING_FIT` |
| `"grow"` | Its fit size, plus a share of the parent's free space on that axis, up to `max`; across the parent's main axis, the parent's whole inner size | CSS `flex: 1` / `align-self: stretch`, Clay `CLAY_SIZING_GROW` |
| `120` | Exactly 120 pixels | Clay `CLAY_SIZING_FIXED` |
| `"50%"` | Half the parent's inner size on that axis (minus its gaps, on the main axis) | Clay `CLAY_SIZING_PERCENT` |

`width` and `height` mix numbers and keywords, which `intrinsicLiterals` cannot express today: it rejects any literal not in its list, numbers included. So the compiler gains one check, a "sizing" kind of prop in the manifest that accepts a number literal, `"fit"`, `"grow"`, or a string literal of the form `"<number>%"` between 0 and 100, with the usual did-you-mean for a near miss (`"grwo"`). Any other expression is left to the type-check, whose type is `number | "fit" | "grow" | `${number}%``.

A spacer is `<Flex width="grow" />` in a row (`height="grow"` in a column): a fit-sized empty box that takes the free space, as `flex: 1` on an empty `div` does in CSS.

### An example HUD

Coins at the top left, a health bar pushed to the top right, a pause button centred at the bottom. The coin count can grow from `9` to `10` and the row stays right; the label can change and the button resizes around it.

```tsx
import { useState, Flex, Hud, Sprite, Text } from "@rge/runtime/jsx";
import { HealthBar } from "./HealthBar.tsx";
import { Button } from "./Button.tsx";

export function PlayerHud({ coins, health }: { coins: number; health: number }) {
  const [paused, setPaused] = useState(false);
  return (
    <Hud>
      <Flex width="grow" height="grow" direction="column" justifyContent="space-between" padding={16}>
        <Flex direction="row" alignItems="center" gap={8}>
          <Sprite image="coin.png" />
          <Text size={20}>{coins}</Text>
          <Flex width="grow" />
          <HealthBar value={health} />
        </Flex>
        <Flex direction="row" justifyContent="center">
          <Button label={paused ? "Resume" : "Pause"} onPress={() => setPaused((p) => !p)} />
        </Flex>
      </Flex>
    </Hud>
  );
}
```

The outer column grows to the HUD's box. The top row needs no `width`: the column's default `alignItems="stretch"` makes it as wide as the column, and its spacer pushes the health bar to the right edge.

The component is called `PlayerHud`, not `Hud`, because `Hud` is the built-in: the compiler rejects a component that takes a built-in's name ("Component 'Hud' conflicts with a runtime intrinsic"). Adding `Hud` and `Flex` as built-ins takes those names away from games, so the work renames the places that use one today: the demo's `Hud` component (`packages/demo/src/Hud.tsx`), the `Hud` test components in `packages/compiler/test/m10.test.ts` and `gamestate.test.ts`, and the `Hud` example in DESIGN.md's "Children" section.

A button is an ordinary component. This one takes a `label` string; a `Panel` that wraps `{children}` in a `Flex` works too, since `{children}` may sit inside any container built-in (the manifest's `containerIntrinsics`, which `Flex` joins).

```tsx
export function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Flex paddingX={16} paddingY={8} background="slategray" alignItems="center" onPress={onPress}>
      <Text>{label}</Text>
    </Flex>
  );
}
```

The pressable area is the laid-out box (U4), so the button needs no hand-sized `Pointer`, and it grows with its label.

### Rules an author can rely on

- **Children are laid out in tree order.** That is the order of `children`, which already follows the JSX: a conditional child that turns on takes its position among its siblings, and a keyed list keeps its items' order. When a conditional child turns off, the ones after it close up, as they would in the DOM.
- **A child's own `transform` does not move its slot; it moves the child within it.** This is CSS's rule for `transform` and `position: relative`: layout decides where the box goes, and `transform={{ y: -4 }}` nudges it from there without pushing its neighbours. So a button can bounce on press, or a HUD element can slide in, without disturbing the row. Rotation and scale work the same way: they do not change the space a child takes.
- **Leaves keep their size.** `grow`, `stretch`, percentages and shrinking resize only a child that is itself a `Flex`; a `Shape`, `Sprite` or `Text` keeps the size its own props give it, as an element with a fixed width does in CSS. Resizing a `Shape` from layout would fight its `render()`, which sets `width` every time it runs. To stretch a coloured box, use a `Flex` with a `background`.
- **Overflow is visible.** When children cannot shrink enough, they overflow the box, as in CSS without `overflow: hidden`. Clipping will use the scissor record U0 adds.
- **Layout runs every frame, before drawing.** What a handler reads from `worldTransform()` (or a `Pointer` hit-tests against) is where the object was drawn last frame. That matches the player's existing rule that a press uses last frame's pointers, and Clay's: its hover test also uses the previous layout's boxes.

## How each kind of child is measured

Layout asks each child for a box: a width and a height, and where its top-left corner is relative to its origin. Every drawable built-in already uses its top-left corner as its origin, which keeps this simple. A leaf's minimum size is its size: leaves never shrink.

| Child | Box |
| --- | --- |
| `Shape`, `Pointer`, `Collider` | `width` × `height` |
| `Text` | The measured width × the measured line height, from librge (raylib's `MeasureTextEx`, which is what `DrawTextEx` draws). One line until wrapping exists |
| `Sprite` | The texture's size, from librge. A texture that failed to load is the 16 × 16 magenta square that is drawn instead |
| `AnimatedSprite` | The size of its first frame, so the layout does not jitter if frames differ |
| `Flex` | Its sizing on each axis (see "Sizing"), worked out by the passes below |
| `Entity` or a component | The bounding box of its children, each at its own `transform` position, ignoring rotation. A `Flex` inside it counts at its fit size. The demo's old button (a 96 × 32 `Shape` with a `Text` inside it) is 96 × 32 |
| `Camera` | Nothing; a warning once, because a camera inside a layout is almost certainly a mistake |
| `Hud`, `Screen` or `Game` (inside a `Flex`) | A compile error: a HUD layer goes directly inside the game's root, and `Screen` and `Game` are the root |

The `Entity` rule is what makes ordinary components work as layout children with no extra annotation. If the bounding box starts above or left of the origin (a sprite drawn centred on its position, say), layout shifts the child so the box, not the origin, sits in the slot.

## The layout algorithm

A **layout root** is a `Flex` whose parent is not a `Flex`. Its available box is the `<Hud>`'s (the canvas, or the window with no `<Screen>`) when it grows on an axis, and otherwise its own fit, fixed or percentage size; a percentage of a non-`Flex` parent is a percentage of the HUD box. Everything below one layout root is laid out together, over its `Flex` subtree, in the order the video teaches and Clay's code follows. Sizing is **one function, `sizeAlongAxis(axis)`**, run for the x axis and later the y axis; it reads width fields or height fields and is otherwise the same, and what it does to a box depends only on whether the axis is the box's direction or across it. Each run has two steps, A and B:

**A. Fit sizes, bottom-up** (children before their parent, which a recursive post-order walk gives for free; Clay gets the same order because its close-element step runs after a box's children). Each box's *preferred* size on the axis: along its direction, the padding at both ends plus `gap × (children − 1)` plus the sum of its children's sizes (the gap count is the fence-post rule: five children have four gaps); across it, the padding plus the largest child. Its *minimum* size is worked out the same way from its children's minimums (a leaf's minimum is its own size, so a fixed or leaf box has the same preferred and minimum size; later, a wrapping text's is its widest word). Both are clamped to `min…`/`max…`; a percentage child counts as 0 here.

**B. Distribute, top-down.** For each box, from the root down, on the axis:
   - percentage children take their share of the inner size (minus gaps, along the direction);
   - **along the box's direction** (the width in a row, the height in a column): the free space is the inner size minus the children's sizes and gaps. If it is positive and some children grow, it goes to the smallest growing child until it is as big as the next smallest, then to both, and so on, each stopping at its maximum. If it is negative, the largest shrinkable child (a `Flex` that is `"fit"` or `"grow"`) gives way first, until it is as small as the next largest, each stopping at its minimum, and a box that has reached its minimum is dropped from the list of shrinkers (the video's two loops, grow and shrink, are the same loop with the comparison reversed);
   - **across the direction**: a growing child (or a fit child under `alignItems="stretch"`) takes the box's inner size minus its own padding; every child is clamped between its minimum size and the inner size.

The steps run in this order, and the order matters:

1. `sizeAlongAxis("x")`: fit widths (A), then distribute widths (B).
2. **Text wrapping**, using the final widths. Not in this plan (see the table at the end); this slot is what makes it cheap to add. It comes here because a wrapped text is taller than it was, and heights must be fitted after that is known, which is why the y axis is not sized in step 1.
3. `sizeAlongAxis("y")`: fit heights (A), then distribute heights (B).
4. **Positions, top-down.** Each box starts its children inside its padding. Along its direction, the free space left after the sizes is shared by `justifyContent`; across it, each child is placed by `alignItems`. Each child's `layoutX`/`layoutY` is written, and advances the next by its size plus the gap. Offsets are rounded to whole pixels (U4).

The free-space sharing in step B is Clay's: unweighted, smallest first. It makes equal growing siblings equal, it never grows a child past its maximum, and it hands what a capped child could not take to the others.

## How it fits the engine

### Where the position goes: a layout offset

**Built in U1.** `GameObject` already composes two transforms: `placement`, set by the parent's `transform` attribute on a component element, and `transform`, the object's own. Layout must not write into either. Writing into `transform` would fight `render()`, and writing into `placement` would erase what the parent set.

So layout has its own slot: two numbers, `layoutX` and `layoutY`, on every `GameObject`, composed first.

```
world = parent × layout × placement × transform
```

They are zero for anything not inside a `Flex`. `worldTransform()` and the player's `walkTree` both apply them, and `test/draw.test.ts` checks the two agree. Only x and y: layout never rotates or scales anything. `layoutX` and `layoutY` are in `reservedMembers`, so a component's state cannot take those names.

### Where layout runs: inside the frame builder's walk

The player's `FrameBuilder.build` walks the tree once per frame, a parent before its children. Layout fits in that walk:

1. When the walk reaches a layout root, it runs the layout steps over that root's `Flex` subtree, measuring leaves through the measurer, and writes every child's `layoutX`/`layoutY` and every `Flex`'s final size.
2. It emits each `background` rectangle as it reaches its `Flex`, then continues into the children, whose world transforms now include their layout offsets.

A game with no `Flex` pays nothing beyond one more `kindOf` case. A HUD is tens of objects, so laying it out every frame is cheap. Caching layout for an unchanged subtree can come later if a menu with hundreds of items ever shows up in the bench.

The algorithm lives in a new `packages/player/src/layout.ts`, as a function of a layout root and a measurer. It needs no window, so it is unit-tested like the collision tracker is. Following Clay's "no allocation" rule, a `Flex` keeps its working numbers (fit size, minimum size, final size) in fields that the passes overwrite, and the passes reuse arrays kept between frames, so laying out allocates nothing per node. `FrameBuilder.measure()` (U1) returns a new `{ width, height }` today; U2 changes it to write into fields or a reused result, for the same reason.

### The measurer, and the ABI change (U0)

The runtime stays backend-free (a Phase 3 ground rule), and only the backend can measure text and textures. U1 gave the player an optional measuring interface on `Backend`, implemented by the recording backend and estimated for the others. U0 makes it real, with a change from the first draft: text measures its **height** too, because a line's height is not exactly its font size, and the layout needs both.

```ts
// packages/player/src/backend.ts
interface Backend {
  …
  /** The size in pixels of one line of `text` drawn at `size` with the default font: its width and line height. */
  measureText?(text: string, size: number): { width: number; height: number };
  /** The size in pixels of a loaded texture (a handle from `loadTexture`). */
  textureSize?(handle: number): { width: number; height: number };
}
```

In `native/include/rge.h`, as part of ABI v2:

```c
void rge_measure_text(const char *text, float size, float *out); /* out[0] width, out[1] line height: raylib MeasureTextEx, as DrawTextEx draws */
void rge_texture_size(int32_t handle, int32_t *width, int32_t *height); /* 0 × 0 for -1 */
```

`rge_measure_text` measures any string, so it also serves wrapping later: Clay wraps by measuring each word once, caching the widths, and adding them up against the available width, and the player can do the same in TypeScript with this one call.

Each function needs: the header, `protocol.ts` (the parity test reads the header), librge's implementation and `smoke.c`, the Node host's koffi binding, the Rust host's `ffi.rs` and its QuickJS binding in `backend.rs`, and the recording backend. `FrameBuilder` caches both answers (U1 already does): texture sizes per handle; text sizes per `(text, size)`, cleared after 1,024 strings so a running timer does not grow the cache without end. A changing score costs one native call per new value, not one per frame.

**A scissor record (decided: in ABI v2).** Clay's renderer needs only rectangles, borders, text, images and scissor regions. This engine's records already cover rectangles, text and images. A scissor (clip) record is what scroll containers, and `overflow: hidden`-style boxes, need:

```
RGE_OP_SCISSOR      op, x, y, width, height   (window pixels; the player maps the box through the view)
RGE_OP_SCISSOR_END  op
```

It is small in librge (raylib's `BeginScissorMode`/`EndScissorMode`), and putting it in ABI v2 avoids a version 3 just for it. Nothing in U2–U5 uses it yet; the first user would be a scrolling list. Borders and rounded corners (Clay's other render commands) wait for a real menu design (see the table at the end).

### What the compiler needs

Little, because the compiler is driven by the runtime manifest. `Flex` is added to `intrinsics`, `containerIntrinsics`, `transformIntrinsics`, `intrinsicMembers`, `intrinsicLiterals` and `intrinsicCallbacks` (`onPress`), and `@rge/runtime/jsx` exports its props type. The runtime test that checks `intrinsicMembers` against the class catches a field left out. `<Flex>{children}</Flex>` in a receiving component works because `{children}` is allowed inside any container intrinsic.

The compiler additions are the sizing check (see "Sizing") and the `flex-start` hint, both in the existing literal-choice diagnostic.

### `<Hud>` and layout together

`<Hud>` (priority 3) is drawn through a view in canvas pixels that ignores the camera. For layout it also defines a box: the canvas, or with no `<Screen>` the window, read every frame, so a resized window lays out again. A `Flex` with `width="grow" height="grow"` directly under `<Hud>` takes that box. That is one way to pin things to corners and edges: a full-HUD column with `justifyContent="space-between"`, holding rows with spacers. U5's floating boxes are the other, and lighter for a single corner.

Pointers inside a laid-out `<Hud>` need nothing new. A `Pointer` hit-tests through `worldTransform()`, which includes the layout offset, and priority 3 already has HUD pointers hit-tested in canvas coordinates.

## Why write the algorithm, not use a library

Two libraries were considered:

- **Yoga** (the flexbox engine React Native uses) ships as C++ or as WebAssembly. QuickJS-ng has no WebAssembly, and linking C++ into librge breaks its "C + raylib, the C side does no maths" rule from NATIVE_PLAN.
- **Clay** is a single C header with no dependencies, so it would link into librge. Its author says its layout code is three functions of about 800 lines, which is also why porting the subset this engine needs is reasonable. But it would put layout maths on the C side, it lays out its own element tree rather than the engine's `GameObject`s, and byte-identical output between Node and QuickJS is easy to keep with one pure TypeScript function, while a native layout engine would be a second thing to verify.

So the engine **ports Clay's algorithm** to TypeScript, for the subset a game UI needs (rows and columns, the four sizing modes, alignment, floating boxes), and keeps Clay as the reference: when a question comes up about an edge case (a percentage child in a fit parent, shrinking below a minimum), Clay's answer is the default one.

## Milestones

### U0: measuring in ABI v2 (with priority 3)

**Done when**

**Done 2026-11-10**, together with ABI v2's second view record and `RGE_OP_CANVAS`. `Backend.measureText` now returns `{ width, height }`. Scissor rectangles are in target pixels (the canvas's when there is one) and ignore the view; a second `RGE_OP_SCISSOR` replaces the first, they do not nest. The software renderer takes scissor rectangles top-left while OpenGL's origin is bottom-left, so librge flips for OpenGL only (through raylib's `BeginScissorMode`); the OpenGL path is untested in CI, which runs the software renderer, so check clipping in the Linux playtest.

- [x] `rge_measure_text` (width and line height) and `rge_texture_size` are in `rge.h` as part of ABI v2, and `protocol.ts` and the header-parity test agree
- [x] `smoke.c` measures a string and a loaded texture
- [x] Both hosts and the recording backend implement `measureText` and `textureSize`, and `FrameBuilder` uses the measured line height
- [x] `RGE_OP_SCISSOR`/`RGE_OP_SCISSOR_END` are in `rge.h`, `smoke.c` checks a clipped rectangle, and the recording backend decodes them
- [x] The parity test still passes byte for byte

### U1: the layout offset and the measurer

**Done 2026-11-09.** Nothing writes the offset yet (that is U2's `<Flex>`), and no native backend measures yet (U0): until then text widths are estimated (0.6 × size per character) and textures measure 0 × 0, with one warning. `RecordingBackend` measures deterministically, so layout tests can start now. The QuickJS bench is unchanged within its noise; the tree walk tests for a zero offset inline, because QuickJS does not inline calls.

**Done when**

- [x] `GameObject` has `layoutX`/`layoutY`, composed before `placement` in `worldTransform()` and in `walkTree`, and the draw test still finds them in agreement
- [x] The two names are in `reservedMembers`, with a compiler test that a state named `layoutX` is rejected
- [x] `FrameBuilder` measures `Text` and `Sprite` through the backend, with caching, and a test counts the native calls

### U2: `<Flex>`

**Done 2026-11-10**, with these differences from the text above:

- **`onPress` was added in U4**; every other prop in the table was there in U2.
- **Shrinking came in U3** (below). Until text wraps nothing can shrink in a real game, so a row or label past its box overflows it, as this plan says it should: the context menu's long-label case overflows, and a growing child across the axis never goes below its minimum.
- **A growing root takes the game's area**: the canvas under a `<Screen>`, else the window, whether it is under a `<Hud>` or in the world. That is U3's "HUD box" in effect; U3 adds the resize tests and the demo.
- **The working numbers are one field**, `box` (a `FlexBox`), so a component rooted at a `Flex` reserves one name for them, not a dozen. `box.size` is the size the box was laid out at, last frame.
- **The leaf rule for an `Entity`**: its extent is the union of its own measurable box (if it is a leaf) and its children at their `transform` + `placement` positions; layout puts the extent's top-left in the slot. A `Flex` inside one counts at its fit size, then is laid out for real when the walk reaches it, as a layout root of its own.
- **Allocation:** laying out allocates nothing in steady state (`layout-allocation.test.ts` counts garbage collections over 20,000 layouts of a 50-box tree; it is its own file because other tests' varied inputs deoptimise the passes). A `Flex`'s `justifyContent` `space-*` values fall back to `"start"` when there is no free space; `"center"` and `"end"` overflow on both sides or one, as CSS does.

- [x] `Flex` is a runtime class with the props above, and in the manifest; the compiler adds only the sizing check and the `flex-start` hint (`intrinsicSizing` in the manifest names the size props)
- [x] `layout.ts` runs the steps above with one axis-parameterized sizing function, not one copy per axis; each sizing mode (`"fit"`, `"grow"`, fixed, percentage) and each bound is tested on both axes, with a fake measurer, against hand-computed sizes
- [x] Growing children share free space smallest first and stop at their maximum, and what a capped child cannot take goes to the others
- [x] Every `direction` × `alignItems` × `justifyContent` combination, `gap` and every padding prop place children where hand-computed positions say
- [x] Nested `Flex`es, and component and `Entity` children sized by their bounding box, are tested
- [x] A child's own `transform` moves it within its slot without moving its neighbours (a test)
- [x] `background` draws a rectangle behind the children; a recording test and a pixel test (real library) show it
- [x] Conditional children and keyed lists inside a `Flex` reflow when they change (compiled components, in `packages/compiler/test/flex.test.ts`)
- [x] The video's final example, a context menu, lays out as it does there (see below)
- [x] Laying out allocates no object per node per frame

**The acceptance test: the video's context menu.** The video ends by building a right-click menu from nothing but the features above, and explains how every element lands where it does. U2 is done when the same menu, written as TSX, comes out as the video says, with a recording test checking the positions and sizes:

```tsx
<Flex direction="column" minWidth={...} maxWidth={...} background="purple">     {/* fit, with a minimum and a maximum width */}
  {items.map((item) => (
    <Flex key={item.id} width="grow" minHeight={80} paddingX={...} gap={32} alignItems="center">   {/* grow across the column; centred vertically */}
      <Flex width="grow"><Text>{item.label}</Text></Flex>                      {/* the invisible container that pushes the icon right */}
      <Sprite image={item.icon} />
    </Flex>
  ))}
</Flex>
```

The test covers: the menu fitting its widest row; the minimum width holding when the labels are short; every row growing to the same width; the icon at the right edge while the label sits at the left; rows of equal minimum height with their contents centred vertically (the video uses a minimum height instead of vertical padding, so rows stay equal); and the gap between label and icon. The video's last step, a label wrapping when it reaches the maximum width, needs text wrapping and is tested when that arrives; until then a label past the maximum overflows (a test checks that it does).

### U3: the HUD box, shrinking, and the demo

**Done 2026-11-10.** The HUD's box needed no new code after U2 (a growing root fills the game's area, which is the canvas or the window), so its checkbox is tests. Shrinking is `Layouter.#shrink`, the grow loop turned around. One thing to know: **nothing shrinks yet in a real game.** A `<Flex>`'s minimum comes from its children's, a leaf's minimum is its size, and so a box can only get smaller than it asked to be once a leaf can report a smaller minimum: a wrapping text's widest word. `MeasuredSize` has optional `minWidth` / `minHeight` for that (tests use a `Squishy` shape that sets them), and the frame builder sets none until text wrapping exists. The demo's HUD, a column with the coin count and a button whose label is centred by layout, is in `Main.tsx`; the button is an `Entity` holding a `Flex` (the look) and a `Pointer` (the click) until U4 gives `Flex` an `onPress`.

- [x] A `Flex` growing under `<Hud>` takes the HUD's box, and a resize lays out again (`hud.test.ts`: two window sizes, and the canvas under a `<Screen>`)
- [x] Children that overflow a row or column shrink largest first, down to their minimum sizes; leaves never shrink, and what still does not fit overflows
- [x] The demo's click counter and button are a `Flex` row inside `<Hud>`, with the label centred by layout instead of by a guessed `x`
- [x] The parity run covers the demo's HUD under QuickJS

### U4: polish

**Done 2026-11-10**, with these decisions:

- **Rounding** is of each child's `layoutX` / `layoutY`, from the exact running position (so a row of odd widths does not drift), never of sizes: three equal growing children in 11 pixels are each 3⅔ wide, and sit at 0, 4 and 7. Parents' offsets are whole, so every descendant's world position is too (until something with a fractional `transform` moves it).
- **`<Text align>` is relative to the text's own `width`**, a new optional prop: `<Text width={80} align="center">`. The box layout uses is that `width` (else the measured one), and the text is drawn shifted inside it, by whole pixels, along its own axis; a text wider than its box overflows it, from the start for `"left"` and by the excess for the others. Without a `width` the box is the text, so `align` has nothing to move. Single-line only, until wrapping.
- **`Flex.onPress`** makes the laid-out box pressable, last frame's box as for any pointer. It joins the same list as `Pointer`s, in draw order (so `z` and tree order decide which is on top), and works inside a `<Hud>` at the HUD's coordinates. Both are now a `Pressable` (`World.reportPress` takes one); a `Flex` without `onPress` is not in the list.

- [x] Layout positions are rounded to whole pixels, so centred text is not blurry
- [x] `<Text align="center">` inside a box: the second half of "text measuring and alignment"
- [x] `<Flex onPress>` is pressable over its laid-out box, and the demo's button uses it
- [x] DESIGN.md has a "Layout" section and README shows the HUD example

### U5: floating boxes

A floating `Flex` is laid out like any other (it fits its children, it can grow to its parent's size) but takes no space in its parent and does not move its siblings. It is attached by one of its nine points (`"top-left"` … `"bottom-right"`) to one of its parent's nine points, plus an offset, and drawn above its neighbours by `z` (already built). The proposed props:

```tsx
<Flex float anchor="top-right" to="top-right" offsetX={-8} offsetY={8}>   {/* a badge in a button's corner */}
```

**Done when**

- [ ] `float`, `anchor`, `to`, `offsetX`, `offsetY` on `Flex`, the two anchors checked as literals
- [ ] A floating box takes no space and is placed at its anchor (tests for all nine points), including under a `<Hud>`, where its parent's box is the HUD's
- [ ] A floating box's pointers are pressed before what it covers, through `z`

## Decisions

Decided on 2026-11-09:

1. ~~**Default `direction`.**~~ `"row"`, as in CSS.
2. ~~**Pixel snapping.**~~ Layout offsets are rounded to whole pixels by default, so centred text is not blurry. No switch until someone asks for one.
3. ~~**Name.**~~ `Flex`. `Row` and `Column` may come later as TSX components on top of it.
4. ~~**Whether `onPress` belongs on `Flex`.**~~ Yes: `<Flex onPress>` is pressable over its laid-out box (U4), so a button needs no hand-sized `Pointer`.
5. ~~**How layout sizes things.**~~ Clay's algorithm, with the CSS prop names kept (see "The model: Clay").

Also decided on 2026-11-09, each as recommended:

6. ~~**One prop per axis, or separate props.**~~ One prop: `width={120}`, `width="grow"`, `width="50%"`, as in CSS and Clay, with the compiler's sizing check. Separate props (`growX`, `percentX`) were the alternative.
7. ~~**Grow weights.**~~ Clay's way only: growing siblings share free space equally, smallest first. A `growWeight` prop can come if a game asks for one.
8. ~~**Scissor in ABI v2.**~~ Yes: `RGE_OP_SCISSOR` and `RGE_OP_SCISSOR_END` go into ABI v2 with U0, so clipping needs no ABI v3 later.
9. ~~**Floating props (U5).**~~ Props on `Flex` (`float`, `anchor`, `to`, `offsetX`, `offsetY`), so a floating box is still a `Flex` with all its sizing; no separate `<Float>` built-in.

## Not in this plan, and what would pull it in

| Item | Why it waits | What would pull it in |
| --- | --- | --- |
| Text wrapping inside a box | One-line text covers a HUD; the steps already leave its slot (step 2), and `rge_measure_text` already measures words | A dialogue box, or any text longer than its box |
| Wrapping rows (`flex-wrap`) | A HUD row rarely wraps | An inventory grid; or a separate `Grid` built-in |
| Aspect-ratio boxes | Nothing in a HUD needs one | A portrait or a minimap frame that must keep its shape while growing |
| Borders and rounded corners on `background` | Needs new draw records (outline, rounded rectangle), as Clay's renderer has | The first real menu design |
| Scrolling containers | Needs scroll state, on top of the scissor record U0 adds | A long settings menu or a chat log |
| Layout transitions (animating size and position changes) | Clay has them; a game can animate `transform` today | A menu that should slide or resize smoothly |
| Caching layout of unchanged subtrees | A HUD is small enough to lay out every frame | A menu of hundreds of items showing up in the bench |
| Focus and keyboard or gamepad navigation between buttons | Needs gamepads first (a "Not now" item in NEXT_PRIORITIES) | A console-style menu |

# Part 2: a fixed game resolution (`<Screen>`)

## Summary

Today a game is drawn at the window's size, one game pixel to one window pixel. A pixel-art game at 320 × 180 in a 1280 × 720 window is drawn in the top-left quarter. A resized window shows more of the world, not a bigger one. HUD positions written for one window size are wrong at another.

This part adds a root built-in that separates the two sizes:

```tsx
export default function Main() {
  return (
    <Game title="My game" width={1280} height={720}>
      <Screen width={320} height={180} fit="integer" border="black">
        <World />
        <Hud>
          <PlayerHud />
        </Hud>
      </Screen>
    </Game>
  );
}
```

`<Game>` (#37) is the optional root that carries the game's configuration, the window among it; `<Screen>` is its only child.

- **The game size** is the `<Screen>`'s `width` and `height`: 320 × 180. Everything inside is written in those units: transforms, the camera's view, `<Hud>` and the layout inside it, the mouse position. The game never needs to know the window's size.
- **The window size** is `<Game width height>` (1280 × 720 here; else `PlayerConfig`, else 640 × 360) to start, and then whatever the player resizes it to, or the monitor's size when full screen comes. The player scales the canvas to fit it each frame, and fills the leftover space with `border`.

| Milestone | What | Size (estimate) |
| --- | --- | --- |
| C1 | `<Screen>` with `pixelPerfect={false}`: drawn at window resolution through a scale. No ABI change | \~3–4 days |
| C2 | `pixelPerfect`: drawn into a 320 × 180 texture, then scaled up. One ABI op, in ABI v2 | \~3–4 days |
| C3 | The demo on a canvas; `fit="expand"`; full screen on a key | \~2–3 days |

C1 can be done before priority 3, because it needs no ABI change. C2 goes in ABI v2 with priority 3's `<Hud>` and U0's measuring functions, so the version still moves only once.

## The two sizes

| | Game size | Window size |
| --- | --- | --- |
| Set by | `<Screen width height>` in the game's TSX | `<Game width height>` (else `PlayerConfig`, else 640 × 360) to start; the window's real size after that |
| Changes when | The game changes the props (a settings menu could) | The player resizes the window, or goes full screen |
| What uses it | Everything inside the game: transforms, the camera, `<Hud>` and its layout, `input.pointerX` | Only the player: to scale the canvas and place the borders, and to map the mouse back |
| Without a `<Screen>` | The same as the window size, as today | |

**Why two components, `<Game>` and `<Screen>`.** They hold different sizes. `<Game width height>` is the window the game opens, which the user can then resize; `<Screen width height>` is the resolution the game is drawn at, whatever the window does. The player builds the root before it opens the window (#37), so it reads `<Game>`'s settings first; sounds made in constructors are recorded and preloaded once the window is open. Because the root is built first, the window can also default from the `<Screen>`: when neither `<Game>` nor `PlayerConfig` gives a size, the window could open at 3 × the canvas (960 × 540 for 320 × 180). That default is not built yet (C3).

## Props

| Prop | Values | Default | Meaning |
| --- | --- | --- | --- |
| `width`, `height` | pixels | required | The game's resolution |
| `fit` | `"integer"`, `"contain"`, `"stretch"` | `"integer"` | How the canvas is scaled into the window (below) |
| `pixelPerfect` | boolean | `true` | Draw at the game's resolution and scale the finished frame up (chunky), or draw at the window's resolution through a scale (smooth) |
| `border` | a CSS colour | `"black"` | The bars around the canvas when it does not fill the window |

The canvas's own background is `<Game background>` (else `PlayerConfig.background`): inside the canvas it is the clear colour, and outside it, `border`.

### `fit`: how the canvas is scaled

For a 320 × 180 canvas in a window of a given size:

| `fit` | Scale | 1280 × 720 window | 1000 × 600 window | Use |
| --- | --- | --- | --- | --- |
| `"integer"` | The largest whole number that fits | ×4, no bars | ×3 (960 × 540), bars of 20 px left and right, 30 px top and bottom | Pixel art: every game pixel is the same number of screen pixels, so nothing shimmers |
| `"contain"` | The largest scale that fits, any number | ×4 | ×3.125 (1000 × 562.5), bars top and bottom | Smooth art, or pixel art where filling the window matters more |
| `"stretch"` | Each axis on its own | ×4 | ×3.125 by ×3.33: distorted, no bars | Rarely; for completeness |

The canvas is centred, and the bars are drawn in `border`. `"integer"` falls back to `"contain"` when the window is smaller than the canvas (a scale below 1), so the game is never cut off.

A later fourth mode, `"expand"`, keeps the height at 180 game pixels and widens the canvas to the window's shape (320 × 180 at 16:9, 384 × 180 at a 21:9 monitor), so there are no bars and a wide screen shows more of the world. It is in C3, because then the game size is no longer fixed, and the HUD's layout must cope with a canvas width that changes.

### `pixelPerfect`: two ways to draw

| | `pixelPerfect={true}` (default) | `pixelPerfect={false}` |
| --- | --- | --- |
| How | Every record is drawn into a 320 × 180 texture, which is then drawn scaled up into the window with nearest-neighbour filtering | Every record is drawn straight into the window, through a view that scales by the fit's factor |
| A sprite turned 10° | Stays made of big, square game pixels | Is turned smoothly at the window's resolution, so its pixels become small diamonds ("mixels") |
| Moving half a pixel | Snaps to the next game pixel | Moves smoothly at screen resolution |
| Text | At 320 × 180, raylib's default font is big and blocky | Sharp at any size |
| Needs | A new draw op in ABI v2, and a render texture in librge | Nothing new in the ABI: it is only a different view matrix |

Most pixel-art games want `true`. Games with drawn or vector art, or with lots of small text, want `false`. A HUD with sharp text over chunky pixel art (drawing `<Hud>` at window resolution over a pixel-perfect world) is a reasonable later option; see "Not in this plan".

## How it fits the engine

### The runtime: a container built-in that must be the root

`Screen` is a runtime class with the fields above, a container like `Entity` and `Camera`, added to the manifest in the same places `Flex` is. A component whose root element is `<Screen>` extends `Screen` (that is how components work already), so the player finds it once per frame at the root of the tree: the root it is given, or that root's only child (a `World` keeps what it mounted under a bare root object), or, through either, a `<Game>`'s only child (#37). Reading its fields every frame means a game can change its resolution or `fit` from state, for example in a settings menu.

A `<Screen>` anywhere but the root (or directly inside a `<Game>` root) has nothing sensible to mean, so it draws its children as an `Entity` would, with a warning once: "A `<Screen>` only sets the game's resolution as the root of the game." The compiler cannot catch this on its own, because whether a component ends up at the root depends on another file (`PlayerConfig.root`).

`Screen` does not move its children: it has no transform of its own to apply, and a `transform` on it is rejected (it is left out of `transformIntrinsics`), like a sound would be.

### The player: one canvas-to-window map

All the work is in the player, in TypeScript, keeping NATIVE_PLAN's "the C side does no maths" rule. Each frame, `FrameBuilder.build` works out, from the canvas's props and the window's size:

- `scale` (or `scaleX` and `scaleY` for `"stretch"`), and
- `dest`: the rectangle in the window the canvas is drawn into.

It then uses them in four places:

1. **The camera's view.** `#view` centres the followed point on the canvas's centre (160, 90), not the window's. Today it adds `width / 2` and `height / 2` of the window; with a canvas, it adds the canvas's.
2. **`<Hud>`.** Its view is the identity in canvas units (so a HUD at `x: 8` is 8 game pixels in), and its layout box, which a growing `Flex` takes, is 320 × 180.
3. **Drawing.** With `pixelPerfect={false}`, each `RGE_OP_VIEW` record is multiplied by the canvas-to-window map (`a, b, c, d` by the scale; `e, f` scaled, then offset by `dest`). Then the bars are drawn as up to four rectangle records. C1 places them in world space through the inverse of that one view, since ABI v1 allows only one view record; after priority 3 they can go through a last identity view in window pixels instead. With `pixelPerfect={true}`, the views stay in canvas units, and the frame starts with the new `RGE_OP_CANVAS` record instead (next section).
4. **The mouse.** `PlayerInput` takes the window position back through the same map: `canvasX = (mouseX − dest.x) / scale`. `input.pointerX` (world) and the press dispatch (`Pointer`s) start from that point. Handlers never see the window's size (`InputState` has none), so it stays the player's business. A press in the border bars is outside the canvas and reaches no `Pointer`.

Without a `<Screen>`, the map is the identity and `dest` is the whole window, so everything behaves exactly as today. That is the test that C1 changes nothing for existing games: every recording test still passes untouched.

### The ABI (C2 only): `RGE_OP_CANVAS`

`pixelPerfect` needs librge to draw into an off-screen texture and then draw that texture into the window. raylib does both (`LoadRenderTexture`, `BeginTextureMode`, `DrawTexturePro`). The proposal is a new record, which must be the first in a frame when present:

```
RGE_OP_CANVAS   op, width, height, destX, destY, destW, destH, borderColor
```

When librge sees it:

1. It makes sure it has a render texture of `width` × `height`, with point filtering, (re)creating it only when the size changes.
2. It draws every following record into that texture, cleared to the frame's clear colour.
3. It clears the window to `borderColor` and draws the texture into `dest`, flipped the right way up (raylib render textures are upside down).

The player computes `dest`, so librge does no layout maths: it only copies a rectangle where it is told. Both hosts pass records through without reading them, so neither host changes. The work is in `rge.h`, `protocol.ts` (and its parity test), `rge.c`, `smoke.c` (draw a 32 × 18 canvas into a 128 × 72 hidden window and check a pixel is 4 × 4), and the recording backend's decoder.

This is the third addition to ABI v2, after priority 3's second `RGE_OP_VIEW` and U0's two measuring functions. All three should land together.

### Where things interact

- **Camera zoom** still works inside the canvas: `zoom={2}` on a 320 × 180 canvas shows 160 × 90 of the world, drawn at 320 × 180, then scaled to the window.
- **`Flex` under `<Hud>`** lays out in game pixels: a `Flex` growing under it takes the 320 × 180 box. A 16 px padding is 16 game pixels, which is 64 screen pixels at ×4. That is the point: the HUD scales with the game.
- **Text measuring** (U0) is in game pixels too. With `pixelPerfect={true}`, text at size 8 is 8 game pixels tall, as drawn.
- **Pixel snapping** (U4) rounds layout offsets to whole game pixels, which with `pixelPerfect={true}` is exactly the grid things are drawn on.
- **High DPI** ("Not now" in NEXT_PRIORITIES) gets easier: the canvas is already a "logical resolution", so a Retina window only changes the window side of the map.
- **Collisions** are in world units and are untouched.

## Milestones

### C1: `<Screen>`, drawn smooth

**Done 2026-11-09**, with three differences from the text above, all recorded in DESIGN.md's "The game's screen":

- **The bars** are not drawn through a last window-space view, because librge v1 refuses a second view record. Each bar is a rectangle placed in world space by taking its window rectangle back through the frame's one view. Every view the player makes is a scale after a rotation, so a record's rotate-then-scale says it exactly; a pixel test under a turned, zoomed camera checks the border stays solid. Priority 3 can switch to a window-space view.
- **`input.width`/`height` still report the window.** Handlers never see either size (`InputState` has no size), so the question did not arise; the player keeps the window's size for itself.
- **Where the root is.** A `World` keeps what it mounted under a bare root object, so the player looks for the `<Screen>` at the root it builds from or as that root's only child.

`pixelPerfect` is accepted, and defaults to true, but until C2 the game is drawn at the window's resolution either way.

**Done when**

- [x] `Screen` is a runtime class and in the manifest; `<Screen transform>` is a compile error
- [x] `fit` is checked at compile time, like `<Shape kind>`
- [x] The player computes scale and `dest` for each `fit`, tested at several window sizes, including one smaller than the canvas
- [x] The camera centres on the canvas's centre (done); `<Hud>` is in canvas units (done 2026-11-10)
- [x] The mouse maps back through the canvas: a `Pointer` is pressed in the right place in a resized, letterboxed window, and a press in the bars hits nothing
- [x] ~~`input.width`/`height` report the canvas's size~~ (see above: not needed)
- [x] Bars are drawn in `border`; a pixel test checks one
- [x] A game with no `<Screen>` produces byte-identical records to today (the existing recording tests and the Node↔QuickJS parity test pass unchanged)
- [x] A `<Screen>` that is not the root warns once and behaves as an `Entity`

### C2: `pixelPerfect`

**Done when**

**Done 2026-11-10.** The native half landed with ABI v2; the player writes `RGE_OP_CANVAS` first when the root `<Screen>` is pixel-perfect (the default), draws the world and `<Hud>` through views in game pixels, and leaves the border to the canvas record. `BuiltFrame.view` stays the world → window map for the mouse, so input is unchanged. Without pixel-perfect, the border bars are drawn through a last view in window pixels, replacing the inverse-through-the-camera trick.

- [x] `RGE_OP_CANVAS` is in `rge.h` (ABI v2) and `protocol.ts`, and the header-parity test agrees
- [x] librge draws into a render texture, recreated only when the size changes, and scales it with point filtering
- [x] `smoke.c` checks that one canvas pixel becomes a 4 × 4 block of window pixels
- [x] A turned shape stays on the game's pixel grid (a pixel test in `native.test.ts`)
- [x] The parity test passes byte for byte under both hosts

### C3: the demo, `expand` and full screen

**Done when**

- [ ] The demo's `<Game>` holds a `<Screen>` (320 × 180 or 640 × 360), and its HUD (from U3) is laid out in canvas units
- [ ] `fit="expand"` widens the canvas to the window's shape; the HUD's layout and the camera follow the changing width
- [ ] When neither `<Game>` nor `PlayerConfig` sets the window's size, the window opens at 3 × the `<Screen>` (#37 left this open)
- [ ] A full-screen toggle exists (a key set on `<Game>` or in `PlayerConfig`, or `useWindow().setFullscreen()`; see the decisions)

## Decisions

Decided on 2026-11-09:

- ~~**Default for `pixelPerfect`.**~~ `true`.
- ~~**Full screen.**~~ In, as part of C3. Unless decided otherwise, it is a key the player handles (F11 or Alt+Enter, configurable as a `<Game>` prop or in `PlayerConfig`); a `useWindow()` hook for a settings menu would need its own design note under the "hooks are compiler intrinsics" rule.

- ~~**One component or two.**~~ Two, renamed: the sized root is `<Screen width height>` (called `Canvas` in earlier drafts), and priority 3's camera-ignoring layer is `<Hud>` (called `Screen` in earlier drafts). They do different jobs: the root sets the game's resolution and how it is scaled into the window, and there is one; `<Hud>` is a layer inside it that does not move with the camera, and there may be several. They cannot be one component, because the world must be inside the sized root but outside the camera-ignoring layer.
- ~~**Where the window's starting size lives.**~~ On the `<Game>` root (#37): `<Game width height>`, else `PlayerConfig`, else 640 × 360. The player builds the root before the window opens, so it can read it. `<Game>` holds the `<Screen>`, which keeps the resolution.

## Not in this part, and what would pull it in

| Item | Why it waits | What would pull it in |
| --- | --- | --- |
| A sharp HUD over a pixel-perfect world (`<Hud pixelPerfect={false}>`) | Two render paths in one frame; it needs `<Hud>` and C2 both working first | Small text in a pixel-art HUD that is hard to read |
| Several canvases (split screen, a minimap) | Needs render targets as a general feature, not one canvas | A local multiplayer or minimap game |
| Post-processing (CRT filter, palette shaders) | Needs shaders in the ABI | An art direction that asks for it |
| Sub-pixel camera smoothing in `pixelPerfect` mode (drawing one pixel larger and offsetting the blit) | A refinement; slow pans may look a little steppy without it | A slow-scrolling game where the camera's steps show |
