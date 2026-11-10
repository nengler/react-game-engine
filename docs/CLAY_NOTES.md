# Notes from Clay, for the UI layout work

As of 2026-11-10 (first written 2026-11-09, updated with the video). A reference log of what was learned from [Clay](https://github.com/nicbarker/clay) (C Layout, by Nic Barker), the library behind the video "How Clay's UI Layout Algorithm Works", for [UI_PLAN.md](UI_PLAN.md) (which says what was *adopted*; this file keeps what was *read*, including what is not used yet, so a later milestone can pull it in without reading Clay again).

**Sources and their limits.** (1) The repository, cloned at commit `e6cc369` (2026-05-20); `clay.h` is 5,058 lines, a single header. Each section says whether it was read in the code (`clay.h`, with line numbers at that commit) or from the README only. (2) **The video's transcript**, pasted in by the user on 2026-11-10. The cloud machine could not fetch the video: YouTube's bot check blocked its captions. The transcript is auto-generated captions (it mishears a few words, such as "IC cons" for icons), has no timestamps, and the video's page, upload date and length were never seen; only its title and author came from YouTube's oEmbed. See "What the video teaches" for what it adds to the code reading.

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

**Adopted** as U2's steps (UI_PLAN: "The layout algorithm"), structured as the video presents them (next section). **Where this engine differs on purpose:** `alignItems="stretch"` and `justifyContent="space-*"` are CSS vocabulary on top of the same passes; Clay's cross-axis GROW is what `width/height="grow"` is.

## What the video teaches (transcript)

The video explains only the core layout algorithm, in the order it would be written by hand, and says so: "this of course is just a small window into how clay works". It does not cover floating elements, clipping, pointers, transitions or percent sizing. Its claims, in the order it makes them:

1. **The core is small.** The layout code is "only three functions for a total of about 800 lines of code" (the transcript does not name them; from the code they are `Clay__CloseElement`, `Clay__SizeContainersAlongAxis` and `Clay__CalculateFinalLayout`, as read above). The author's point: UI layout is not extremely complicated; the hard part is avoiding ideas that look good and then hit unfixable edge cases or do redundant work, and "a couple of simple insights" avoid that.
2. **Insight 1: a position is relative to the container it is inside.** So a menu is drawn from one target position (its top-left), and the y axis points down, as in most graphics systems. *This engine already works this way: `transform` is relative to the parent, and `layoutX`/`layoutY` are in the parent's space.*
3. **Insight 2: a container's size depends on its contents.** Position depends on the parent, and size depends on the children, which is a **tree**: the root has no parent, leaves have no children. UI is declared as a tree of elements.
4. **The tree is built by open and close calls.** The `CLAY()` macro is only `OpenElement` before the children and `CloseElement` after, for convenience. Because a close happens after all the element's children have closed, close-element is naturally called in **reverse breadth-first order**, which is exactly the order bottom-up sizing needs. *For this engine: a recursive walk that sizes children before the parent gives the same order.*
5. **Layout and drawing cannot be one pass,** because a container's size is not known until its children are measured, and drawing the parent first would cover them. "Mentally acknowledging that handling UI requires multiple passes over the data is an incredibly important realization."
6. **Fit sizing** (the default): padding at both ends, plus `childGap × (children − 1)` (the fence-post rule: five children have four gaps), plus the sum of the children, **along** the layout direction; padding plus the largest child **across** it. The gap is added only along the direction.
7. **Sizes and positions are separate passes, sizes first.** With flexible sizes, "you can't actually know the final position of an element until you've completely finished calculating all the sizes": a wider fourth menu item pushes the earlier icons over. Splitting them "completely eliminates an entire class of layout bugs", and sizes can be computed without knowing where anything is on screen.
8. **UI is "mostly a one-dimensional problem".** Both axes behave the same except for which direction the layout runs, so there is **one function that computes widths or heights** depending on a parameter (`SizeContainersAlongAxis`'s `xAxis`). *The plan now says the same (UI_PLAN: `sizeAlongAxis(axis)`).*
9. **Grow is an extension of fit:** a growing box still fits its contents at the minimum, then takes extra space. It needs **its own top-down, breadth-first pass**, because the free space is not known until the whole tree is sized (growing a middle child in the same pass as fit would leave no room for a sibling not yet reached). Free space along the direction is `parent size − padding − children's sizes − gaps`, added to the growing child; across the direction it is `parent size − padding − the child's own size`.
10. **Several growing children end up the same size,** and the author is explicit that this is a taste decision with "no correct answer": the smallest grows first until it equals the next smallest, then both, up to the largest, then all together. The loop finds the smallest and second smallest sizes among the growing children, adds `second − smallest` (capped at `remaining ÷ count`) to every child at the smallest size, subtracts it from the free space, and repeats. It cannot always equalise (a large child already past its share).
11. **Text** is a leaf with a measured size, so fit works for labels. It breaks for long text (a huge width pushes siblings off screen) because there was no way to *shrink*. For shrinking, each element needs a **preferred size and a minimum size**; text's preferred size is its full width and its minimum is its **widest single word**; a fixed element's two are equal; minimums are summed up the tree in the same close-element pass.
12. **Shrinking is the grow loop reversed:** shrink the largest down to the second largest, and so on, and **drop an element from the list when it reaches its minimum**. The video's worked example (three children, one a fixed box that cannot shrink) goes through four iterations; the text shrinks, the fixed box is skipped at its minimum.
13. **Text wrapping comes after the widths are final.** The method described: find the character that crosses the element's edge, **search backwards for a space**, slice there, add one line's height to the element, and repeat to the end. (The code does it a different way, see below.)
14. **Heights are sized after wrapping,** so the single sizing pass splits into widths first and heights second, with wrapping between. At the wrapping step a fit-height box still has height 0, because heights are not fitted yet.
15. **Min and max sizes:** the minimum is the same one used for shrinking, now configurable; the maximum caps a parent's fit size, and a growing element that reaches it is removed from the growing list, as one at its minimum is removed from the shrinking list.
16. **Alignment is position only,** so it is done in the last pass. Along the direction: `parent − padding − content (with gaps)`, halved for centre, added to the offset of **every** child. Across it: the same per child, `parent − padding − that child's size`, so children of different sizes get different offsets. Right and bottom use the whole difference instead of half.
17. **The worked example** (a right-click menu): a fit column of rows; each row `grow` across the column with a **minimum height of 80** (instead of vertical padding, so rows stay equal), vertical centre alignment, horizontal padding and a child gap of 32; an **invisible container with `grow` width** around each label to push its icon to the right; a minimum width on the menu so short labels do not make it skinny, and a maximum width so a long label wraps. *UI_PLAN's U2 now uses this as its acceptance test.*

**Where the video and the code differ** (neither is wrong; the video teaches, the code optimises):

- **Order of fit and height.** The video ends with fit widths, grow/shrink widths, wrap, fit heights, grow/shrink heights. The code computes both fit dimensions while an element closes, and after wrapping a post-order pass recomputes heights. The result is the same; the video's is the cleaner way to state it, and the plan follows it.
- **How a parent collects its children's sizes.** The video adds each child's size into the parent as the child closes; the code loops over the children when the parent closes. Same totals.
- **Text wrapping.** The video describes a character search backwards to a space; the code walks a cache of measured words and starts a new line when the next word would pass the width. The cache means each word is measured once.
- **Percent sizing, floating, clipping, aspect ratio:** in the code and README, not in the video.

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

The video changed the plan's *structure* (sizing per axis in one function, heights after wrapping, positions last, and the context menu as the acceptance test) and left its order alone. The three items most likely to be pulled in early are **hover state** (for button feedback), **aspect ratio** (for an image or portrait inside a growing box), and a **layout debug overlay** (to check `Flex` results while building U2).
