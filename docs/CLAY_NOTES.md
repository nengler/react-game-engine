# Notes from Clay, for the UI layout work

As of 2026-11-09. A reference log of what was learned from [Clay](https://github.com/nicbarker/clay) (C Layout, by Nic Barker), the library behind the video "How Clay's UI Layout Algorithm Works", for [UI_PLAN.md](UI_PLAN.md) (which says what was *adopted*; this file keeps what was *read*, including what is not used yet, so a later milestone can pull it in without reading Clay again).

**Source and its limits.** Cloned at commit `e6cc369` (2026-05-20). `clay.h` is 5,058 lines, a single header. **The video itself was not available**: YouTube's bot check blocked its captions from the cloud machine, so nothing here comes from it. Each section says whether it was read in the code (`clay.h`, with line numbers at that commit) or from the README only. If the video's transcript is pasted in, compare it with this file and the plan.

**Not read:** the hash-map and ID internals, the memory arena, the text-measurement cache internals (only the wrapping loop), the floating-element positioning code (only its README and where floating roots are sized), the border and image configs, the transition and pointer-hit internals (README only), the debug view, and the bindings and renderers.

## What Clay is

A 2D layout library, not a renderer. A game calls `CLAY(id, config) { children }` every frame to declare a tree, Clay lays it out, and the result is a **sorted list of render commands** (rectangle, border, text, image, scissor start/end, overlay colour start/end, custom), each with a bounding box, an `id` and a `zIndex`. The game draws them. README claims: microsecond layout, no `malloc` (a static arena, about 3.5 MB for 8,192 elements), one header with no dependencies, a 15 KB `.wasm` build, and bindings or ports for Odin, Rust and Go. (Not measured here.)

**Relevance:** the render-command list is the same shape as this engine's draw records, which is why the plan ports the *algorithm* to TypeScript and keeps the native side to drawing.

## The declaration model (README)

- Elements nest like HTML; the macro is plain C, so loops, conditions and functions ("components") are the host language. A style can be a reusable struct. **This engine's TSX already does this**, with `key` for lists and components as functions.
- **IDs.** `CLAY_ID("Name")` is stable; `CLAY_AUTO_ID` is not; `CLAY_IDI("Item", i)` makes `Item0`, `Item1`… in loops. IDs are used to query an element later (hover, size), to attach floating boxes to a specific element, to find it in the debug tools, and are copied into the render commands for retained-mode UIs. Duplicate IDs misbehave. Transitions need stable IDs too. **For this engine:** `key` and the IR's stable element ids play this part; nothing needs a new ID system yet.

## Sizing (README, and code at `clay.h:70–76`, `:302–308`)

Per axis, four types: **FIT** (the default: children plus padding and gaps, clamped to min/max), **GROW** (fills free space, clamped to min/max), **FIXED** (`FIT(n, n)`), **PERCENT** (of the parent's size minus padding and child gaps, `0…1`). Padding is around the outside of the children; `childGap` is between them. Alignment is `x: left | center | right` and `y: top | center | bottom`, for the children as a group on the main axis and per child on the cross axis. There is no `space-between`; a GROW spacer does it. **Adopted** (UI_PLAN: "The model: Clay", "Sizing"), with CSS prop names kept.

## The layout passes (code)

`Clay__CalculateFinalLayout` (`:2573`) runs, for the tree:

1. **While elements close** (`Clay__CloseElement`, `:1867`): each element's size along its direction is the sum of its children plus padding and gaps; across it, the largest child plus padding. It also records a **minimum size** the same way (clip containers ignore their children's minimums, since they can shrink and hide content). Both are clamped to the configured min/max. A PERCENT axis is set to 0 here.
2. **Widths, top-down** (`Clay__SizeContainersAlongAxis(true, …)`, `:2281`), breadth-first from each root. For each parent:
   - The *resizable* children are those that are not PERCENT or FIXED, and, for text, only when it wraps words.
   - PERCENT children get `(parentSize − padding − gaps) × percent`.
   - **Along the layout direction.** If the content is **too large**, shrink: the *largest* resizable children give way first, down to the next largest, and so on, each stopping at its minimum size (not at all if the parent clips). If there is **free space**, only **GROW** children take it, the *smallest* first until it equals the next smallest, each stopping at its maximum. Equal growing siblings end up equal. FIT children never grow.
   - **Across the direction.** A GROW child takes `min(parent's inner size, its max)`; every resizable child is then clamped between its minimum and the parent's inner size (a clip parent allows up to its content size).
3. **Text wrapping** (inside `CalculateFinalLayout`, after the widths): each text element is wrapped word by word against its final width, using a cache of measured words (`Clay__MeasureTextCached`), and its height becomes `lineHeight × lines`. Text with no newline that already fits is one line.
4. **Aspect ratio**: after the widths, `height = width / ratio` for elements that have one; after the heights, the width is set back from the height.
5. **Heights**: a post-order pass recomputes each parent's height from its children (a row takes the tallest child plus padding, a column the sum plus gaps), then the *same* top-down sizing runs on the y axis.
6. **Positions** (depth-first): each element starts its children at its padding. Along the direction, the free space left after the children is added according to the alignment (`left/top` 0, `center` half, `right/bottom` all, never negative); across it, the free space around each child is added per child. Each child advances the offset by its size plus the gap, plus the scroll offset. (Read in outline, from the alignment lines at `:3107–3181`.)

**Adopted** as U2's five passes (UI_PLAN: "The layout algorithm"). **Where this engine differs on purpose:** `alignItems="stretch"` and `justifyContent="space-*"` are CSS vocabulary on top of the same passes; Clay's cross-axis GROW is what `width/height="grow"` is.

## Floating elements (README; sizing in code at `:2287–2320`)

A floating element is a **separate root** attached to a point on its "parent": `attachTo` the parent, a specific element by ID, or the root. It does not affect its parent's size or its siblings, and has a `zIndex` so it can draw over other things (tooltips, modals). Config: `offset`, `expand`, `zIndex`, `parentId`, `attachPoints` (nine points on the element and nine on the parent) and `pointerCaptureMode` (capture, or pass presses through). It is sized like any element, but a GROW or PERCENT floating root is sized against its parent's size. **Adopted** as U5 (attach points, offset, no space, `z`), minus `expand` and `parentId` (attach to any element by ID).

## Clipping and scrolling (README)

`clip = { horizontal, vertical, childOffset }`. A clipped element emits `SCISSOR_START` and `SCISSOR_END` render commands (not subject to culling). `childOffset` shifts the contents; Clay can track the offset itself (`Clay_UpdateScrollContainers` with wheel and drag deltas, before `BeginLayout`, and `Clay_GetScrollOffset`), or the game supplies it. **Partly adopted:** the scissor record goes into ABI v2 (UI_PLAN: U0); scroll state and scrolling containers are in "Not in this plan".

## Pointer interaction (README)

`Clay_SetPointerState` is called each frame before layout. `Clay_Hovered()` works during a declaration, `Clay_OnHover(callback, data)` runs a callback every frame the pointer is over the element (with pressed-this-frame state), and `Clay_PointerOver(id)` queries afterwards. **Hit tests use last frame's boxes**; for fast animation, laying out twice per frame fixes it. **For this engine:** the player already hit-tests a press against last frame's pointers, so this matches; hover is not built (a `Pointer` only has `onPress`) and is the natural next input for a button's look.

## Transitions (README only)

`transition = { handler (an easing function), duration, properties (flags: x, y, width, height, background colour, overlay colour, corner radius, border…), enter, exit }`. Both layout properties (position, size) and paint properties animate; it needs stable IDs; `enter` and `exit` give an initial or final state for elements appearing or disappearing. **Not adopted** (UI_PLAN: "Not in this plan"; a game can animate `transform` today). It is the main reason Clay keeps the previous frame's boxes by ID.

## Other features (README)

- **Aspect ratio** (`aspectRatio`): keeps width/height; mostly for images. Not adopted.
- **Borders, corner radius, image and custom elements:** configs for the render commands; custom elements pass one pointer through to the renderer. Not adopted (needs new draw records).
- **Visibility culling:** on by default; only elements with at least one pixel of their box in the viewport produce render commands. Not adopted; relevant if a UI ever has hundreds of items.
- **Retained mode:** render commands carry the element ID, and are small enough to compare byte-wise between frames to find what changed. Relevant to a web backend, not now.
- **Debug tools:** an inspector (`Clay_SetDebugModeEnabled`) that injects render commands to draw a panel. A layout debug overlay would be a good tool for this engine too (draw every `Flex` box outline); not planned.
- **Multiple instances** (`Clay_SetCurrentContext`): not relevant.

## What this suggests next

Nothing here changes the plan's order. The three items most likely to be pulled in early are **hover state** (for button feedback), **aspect ratio** (for an image or portrait inside a growing box), and a **layout debug overlay** (to check `Flex` results while building U2).
