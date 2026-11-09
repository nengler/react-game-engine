# react-game-engine: UI layout plan

As of 2026-11-09. A proposal, written to sit next to priority 3 in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md) (the screen-space HUD layer). Nothing here is built yet. Push back on any decision below before work starts, as [DESIGN.md](DESIGN.md) asks.

## Summary

Games need UI: a score in a corner, a health bar, a pause menu, a row of buttons. Today every one of those is placed by hand with `transform={{ x, y }}`. The demo's click button is a `Shape`, a `Pointer` and a `Text`, each given its own coordinates, and the label is centred by guessing (`x: 92` inside a box at `x: 80`). Change the label and the guess is wrong.

This plan adds **layout**: a `<Flex>` built-in that places its children in a row or a column, the way CSS flexbox does.

```tsx
<Flex direction="row" alignItems="center" gap={8} padding={12} background="#0008">
  <Sprite image="coin.png" />
  <Text size={20}>{coins}</Text>
</Flex>
```

It takes the props a web developer expects (`direction`, `alignItems`, `justifyContent`, `gap`, `padding`), with CSS's meanings. It is a container, like `<Entity>`, and it works anywhere in the tree, in the world or on priority 3's `<Screen>`. In practice almost all of it will live on the screen, which is why it goes alongside priority 3.

What has to exist first, and why priority 3 comes before or with this:

- **Sizes.** Layout needs to know how big each child is. `Shape`, `Pointer` and `Collider` already have `width` and `height`. A `Text` and a `Sprite` do not: the size of text depends on the font, and the size of a sprite on the image file. Both are known only to librge. So the native library must answer two new questions, "how wide is this text at this size?" and "how big is this texture?", which is an ABI change. Priority 3 already bumps the ABI to version 2 for `<Screen>`; these two functions should go into the **same** version 2, so the ABI moves once.
- **A screen to lay out on.** A HUD laid out in world space still drifts with the camera. `<Screen>` gives layout a fixed box: the window.

So the order is: priority 3 (with the two measuring functions added to ABI v2), then this plan's milestones U1–U4. U1 can start alongside priority 3, because it does not touch the ABI.

| Milestone | What | Size (estimate) |
| --- | --- | --- |
| U0 | ABI v2 also carries `rge_measure_text` and `rge_texture_size` (done as part of priority 3) | \~1–2 days on top of priority 3 |
| U1 | A layout offset on every object, and a measuring interface in the player | \~2–3 days |
| U2 | `<Flex>`: the built-in, the layout algorithm, `background` | \~1 week |
| U3 | Sizing to the window (`fill`), `grow`, and the demo's HUD rewritten with it | \~3–4 days |
| U4 | Polish: text alignment inside a fixed width, pixel snapping, a `Flex` that is pressable | \~3–4 days |

Sizes are rough, for one engineer, in the style of the other plans.

## What an author writes

### The props

| Prop | Values | Default | Meaning (as in CSS) |
| --- | --- | --- | --- |
| `direction` | `"row"`, `"column"` | `"row"` | The main axis: children go left to right, or top to bottom |
| `alignItems` | `"start"`, `"center"`, `"end"`, `"stretch"` | `"stretch"` | Where children sit on the cross axis |
| `justifyContent` | `"start"`, `"center"`, `"end"`, `"space-between"`, `"space-around"`, `"space-evenly"` | `"start"` | How children and free space share the main axis |
| `gap` | pixels | `0` | Space between neighbouring children |
| `padding` | pixels | `0` | Space inside the edge, on all four sides |
| `paddingX`, `paddingY` | pixels | `padding` | Left and right, or top and bottom; override `padding` |
| `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | pixels | the axis value | One side; overrides the two above |
| `width`, `height` | pixels | the size of the content | A fixed size for the box |
| `fill` | boolean | `false` | Take the whole box of the parent (the window, under `<Screen>`) |
| `grow` | number | `0` | Inside another `Flex`: take this share of the free main-axis space |
| `background` | a CSS colour | none | Draw a filled rectangle behind the children, the size of the box |

Every one is a plain string, number or boolean, so each is a field on the object, set in place by `render()` like `Shape.width` is. There are no object-valued props (`padding={{ x: 8 }}`): an object would be allocated on every render, which the performance work in priority 4 is trying to remove, and the compiler today only special-cases `transform` as an object. That is why padding is spelled out as separate props.

The keyword props (`direction`, `alignItems`, `justifyContent`) go in the manifest's `intrinsicLiterals`, exactly like `<Shape kind>`. A typo is a compile error with the choices and a suggestion. CSS also spells `start` as `flex-start`, so that typo gets its own hint: `<Flex alignItems> must be one of "start", "center", "end", "stretch", not 'flex-start' (did you mean "start"?)`.

### An example HUD

Coins at the top left, a health bar pushed to the top right, a pause button centred at the bottom. The coin count can grow from `9` to `10` and the row stays right; the label can change and the button resizes around it.

```tsx
import { useState, Flex, Screen, Sprite, Text } from "@rge/runtime/jsx";
import { HealthBar } from "./HealthBar.tsx";
import { Button } from "./Button.tsx";

export function Hud({ coins, health }: { coins: number; health: number }) {
  const [paused, setPaused] = useState(false);
  return (
    <Screen>
      <Flex fill direction="column" justifyContent="space-between" padding={16}>
        <Flex direction="row" alignItems="center" gap={8}>
          <Sprite image="coin.png" />
          <Text size={20}>{coins}</Text>
          <Flex grow={1} />
          <HealthBar value={health} />
        </Flex>
        <Flex direction="row" justifyContent="center">
          <Button label={paused ? "Resume" : "Pause"} onPress={() => setPaused((p) => !p)} />
        </Flex>
      </Flex>
    </Screen>
  );
}
```

`<Flex grow={1} />` is a spacer, as `flex: 1` on an empty `div` is in CSS.

A button is an ordinary component. This one takes a `label` string; a `Panel` that wraps `{children}` in a `Flex` works too, since `{children}` may sit inside any container built-in (the manifest's `containerIntrinsics`, which `Flex` joins).

```tsx
export function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Entity>
      <Flex paddingX={16} paddingY={8} background="slategray" alignItems="center">
        <Text>{label}</Text>
      </Flex>
      {/* Until U4's pressable Flex, a Pointer is sized by hand. */}
      <Pointer width={96} height={32} onPress={onPress} />
    </Entity>
  );
}
```

The `Pointer` here still has a hand-picked size, which is exactly the problem layout is meant to remove. U4 proposes `onPress` on `Flex` itself, so the pressable area is the laid-out box.

### Rules an author can rely on

- **Children are laid out in tree order.** That is the order of `children`, which already follows the JSX: a conditional child that turns on takes its position among its siblings, and a keyed list keeps its items' order. When a conditional child turns off, the ones after it close up, as they would in the DOM.
- **A child's own `transform` does not move its slot; it moves the child within it.** This is CSS's rule for `transform` and `position: relative`: layout decides where the box goes, and `transform={{ y: -4 }}` nudges it from there without pushing its neighbours. So a button can bounce on press, or a HUD element can slide in, without disturbing the row. Rotation and scale work the same way: they do not change the space a child takes.
- **Leaves keep their size.** `alignItems="stretch"` and `grow` resize only a child that is itself a `Flex`; a `Shape`, `Sprite` or `Text` keeps the size its own props give it, as an element with a fixed width does in CSS. Resizing a `Shape` from layout would fight its `render()`, which sets `width` every time it runs. To stretch a coloured box, use a `Flex` with a `background`.
- **Layout runs every frame, before drawing.** What a handler reads from `worldTransform()` (or a `Pointer` hit-tests against) is where the object was drawn last frame. That matches the player's existing rule that a press uses last frame's pointers.

## How each kind of child is measured

Layout asks each child for a box: a width and a height, and where its top-left corner is relative to its origin. Every drawable built-in already uses its top-left corner as its origin, which keeps this simple.

| Child | Box |
| --- | --- |
| `Shape`, `Pointer`, `Collider` | `width` × `height` |
| `Text` | `measureText(text, size)` × `size`, from librge (raylib's `MeasureText`) |
| `Sprite` | The texture's size, from librge. A texture that failed to load is the 16 × 16 magenta square that is drawn instead |
| `AnimatedSprite` | The size of its first frame, so the layout does not jitter if frames differ |
| `Flex` | Its laid-out size: content plus padding, or its `width`/`height`/`fill`/`grow` size |
| `Entity` or a component | The bounding box of its children, each at its own `transform` position, ignoring rotation. The demo's button (a 96 × 32 `Shape` with a `Text` inside it) is 96 × 32 |
| `Camera` | Nothing; a warning once, because a camera inside a layout is almost certainly a mistake |
| `Screen` (inside a `Flex`) | A compile error: a screen layer belongs at the top of the tree |

The `Entity` rule is what makes ordinary components work as layout children with no extra annotation. If the bounding box starts above or left of the origin (a sprite drawn centred on its position, say), layout shifts the child so the box, not the origin, sits in the slot.

## How it fits the engine

### Where the position goes: a layout offset

`GameObject` already composes two transforms: `placement`, set by the parent's `transform` attribute on a component element, and `transform`, the object's own. Layout must not write into either. Writing into `transform` would fight `render()`, and writing into `placement` would erase what the parent set.

So layout gets its own slot: two numbers, `layoutX` and `layoutY`, on every `GameObject`, composed first.

```
world = parent × layout × placement × transform
```

They are zero for anything not inside a `Flex`, which keeps the existing fast path in `composeTransforms` (an identity step returns the parent unchanged). `worldTransform()` and the player's `walkTree` both gain the step; `test/draw.test.ts` already checks those two agree over a real tree, and it will catch one being updated without the other. Only x and y: layout never rotates or scales anything.

`layoutX` and `layoutY` join `reservedMembers` in the manifest, so a component's state cannot take those names.

### Where layout runs: inside the frame builder's walk

The player's `FrameBuilder.build` already walks the tree once per frame, a parent before its children. Layout fits in that walk without a second pass:

1. When the walk reaches a `Flex`, it measures each child (recursing into nested `Flex`es and components for their sizes), then writes each child's `layoutX`/`layoutY`, and the assigned size of any child `Flex` that is stretched or grown.
2. It emits the `background` rectangle, if any, then continues into the children, whose world transforms now include their layout offsets.
3. A nested `Flex` reached later in the same walk lays out its own children inside the size its parent assigned it.

A game with no `Flex` pays nothing beyond one more `kindOf` case. A HUD is tens of objects, so laying it out every frame is cheap. Caching layout for an unchanged subtree can come later if a menu with hundreds of items ever shows up in the bench.

The algorithm lives in a new `packages/player/src/layout.ts`, as a function of a `Flex`, its children, and a measurer. It needs no window, so it is unit-tested like the collision tracker is.

### The measurer, and the ABI change

The runtime stays backend-free (a Phase 3 ground rule), and only the backend can measure text and textures. So the player gets a measuring interface, implemented by each backend:

```ts
// packages/player/src/backend.ts
interface Backend {
  …
  /** The width in pixels of `text` drawn at `size` with the default font. */
  measureText(text: string, size: number): number;
  /** The size in pixels of a loaded texture (a handle from `loadTexture`). */
  textureSize(handle: number): { width: number; height: number };
}
```

In `native/include/rge.h`, as part of ABI v2:

```c
float   rge_measure_text(const char *text, float size);            /* raylib MeasureText */
void    rge_texture_size(int32_t handle, int32_t *width, int32_t *height); /* 0 × 0 for -1 */
```

Each one needs: the header, `protocol.ts` (the parity test reads the header), librge's implementation and `smoke.c`, the Node host's koffi binding, the Rust host's `ffi.rs` and its QuickJS binding in `backend.rs`, and the recording backend. The recording backend measures deterministically (for instance, `0.6 × size` per character) so layout tests have stable numbers without a window.

`FrameBuilder` caches both answers: texture sizes per handle, forever; text widths per `(text, size)`, cleared now and then so a running timer does not grow the cache without end. A changing score costs one native call per new value, not one per frame.

Measuring text in librge, rather than in TypeScript with a table of glyph widths, keeps the measured width equal to what is drawn, and keeps it right when real fonts arrive (the "Fonts, text measuring and alignment" row in NEXT_PRIORITIES' "Not now" table, which this plan pulls in).

### What the compiler needs

Almost nothing, because the compiler is driven by the runtime manifest. `Flex` is added to `intrinsics`, `containerIntrinsics`, `transformIntrinsics`, `intrinsicMembers` and `intrinsicLiterals`, and `@rge/runtime/jsx` exports its props type. The runtime test that checks `intrinsicMembers` against the class catches a field left out. `<Flex>{children}</Flex>` in a receiving component works because `{children}` is allowed inside any container intrinsic.

The one compiler addition is the `flex-start` hint above, a special case in the existing literal-choice diagnostic.

### `<Screen>` and layout together

`<Screen>` (priority 3) is drawn through an identity view in window pixels. For layout it also defines a box: the window, `width` × `height` from the input buffer, read every frame, so a resized window lays out again. A `Flex fill` directly under `<Screen>` takes that box. That is how a HUD pins things to corners and edges: a full-window column with `justifyContent="space-between"`, holding rows with spacers.

Pointers inside a laid-out `<Screen>` need nothing new. A `Pointer` hit-tests through `worldTransform()`, which includes the layout offset, and priority 3 already has screen pointers hit-tested in window coordinates.

## Why write the algorithm, not use a library

Yoga (the flexbox engine React Native uses) was the obvious alternative. It is rejected for now:

- Yoga ships as C++ or as WebAssembly. QuickJS-ng has no WebAssembly, and linking C++ into librge breaks its "C + raylib, the C side does no maths" rule from NATIVE_PLAN.
- The subset a game HUD needs (one line, no wrapping, fixed-size leaves, `grow` on containers) is a few hundred lines of TypeScript, and stays readable and steppable in the debugger.
- Byte-identical output between Node and QuickJS is easy to keep with one pure TypeScript function. A native layout engine would make that a second thing to verify.

If games later need wrapping, `min`/`max` sizes, or absolute positioning inside a `Flex`, those are additions to the same function. Yoga can be reconsidered if the subset grows past what is reasonable to maintain.

## Milestones

### U0: measuring in ABI v2 (with priority 3)

**Done when**

- [ ] `rge_measure_text` and `rge_texture_size` are in `rge.h` as part of ABI v2, and `protocol.ts` and the header-parity test agree
- [ ] `smoke.c` measures a string and a loaded texture
- [ ] Both hosts and the recording backend implement `measureText` and `textureSize`
- [ ] The parity test still passes byte for byte

### U1: the layout offset and the measurer

**Done when**

- [ ] `GameObject` has `layoutX`/`layoutY`, composed before `placement` in `worldTransform()` and in `walkTree`, and the draw test still finds them in agreement
- [ ] The two names are in `reservedMembers`, with a compiler test that a state named `layoutX` is rejected
- [ ] `FrameBuilder` measures `Text` and `Sprite` through the backend, with caching, and a test counts the native calls

### U2: `<Flex>`

**Done when**

- [ ] `Flex` is a runtime class with the props above, and in the manifest; the compiler accepts it with no compiler edit beyond the `flex-start` hint
- [ ] `layout.ts` covers every `direction` × `alignItems` × `justifyContent` combination, `gap` and every padding prop, tested with a fake measurer against hand-computed positions
- [ ] Nested `Flex`es, and component and `Entity` children sized by their bounding box, are tested
- [ ] A child's own `transform` moves it within its slot without moving its neighbours (a test)
- [ ] `background` draws a rectangle behind the children; a recording test and a pixel test show it
- [ ] Conditional children and keyed lists inside a `Flex` reflow when they change

### U3: the window, `grow`, and the demo

**Done when**

- [ ] `fill` under `<Screen>` takes the window, and a resize lays out again (a recording test with two window sizes)
- [ ] `grow` shares free space by weight; `stretch` sizes a child `Flex` on the cross axis
- [ ] The demo's click counter and button are a `Flex` row inside `<Screen>`, with the label centred by layout instead of by a guessed `x`
- [ ] The parity run covers the demo's HUD under QuickJS

### U4: polish

**Done when**

- [ ] Layout positions are rounded to whole pixels (see the open decisions), so centred text is not blurry
- [ ] `<Text align="center">` inside a fixed width: the second half of "text measuring and alignment"
- [ ] `<Flex onPress>` is pressable over its laid-out box, so a button no longer needs a hand-sized `Pointer`
- [ ] DESIGN.md has a "Layout" section and README shows the HUD example

## Decisions needed before work starts

1. **Default `direction`.** CSS's default is `"row"`, which this plan uses to keep the "feel like ideal React" rule. React Native chose `"column"`, and game menus are often columns. Recommendation: `"row"`, because the web is what most authors know.
2. **Pixel snapping.** Centring often lands on half pixels, which makes raylib's default font blurry. Rounding each layout offset to a whole pixel fixes that, at the cost of a pixel of drift in nested centring. Recommendation: round by default; offer no switch until someone asks for one.
3. **Name.** `Flex` reads like CSS and says what it does. An alternative is a pair, `Row` and `Column`, which is shorter in JSX but hides that they are the same thing. Recommendation: `Flex`, with `Row` and `Column` possible later as components written in TSX on top of it.
4. **Whether `onPress` belongs on `Flex` (U4).** It is the most convenient way to make a button, but it makes `Flex` both a layout box and a hit area. The alternative is a `Pointer` that sizes itself to its parent's box (`<Pointer fill />`). Recommendation: decide after U3, once real HUD code shows which reads better.

## Not in this plan, and what would pull it in

| Item | Why it waits | What would pull it in |
| --- | --- | --- |
| Wrapping (`flex-wrap`) | A HUD row rarely wraps | An inventory grid; or a separate `Grid` built-in |
| `min`/`max` sizes, `shrink` | Nothing overflows in a fixed HUD | Text long enough to overflow its box |
| Absolute children inside a `Flex` | `transform` already offsets within a slot | A badge pinned to a button's corner that must not take space |
| Percentage sizes (`width="50%"`) | `grow` covers sharing space | A layout `grow` cannot express |
| Borders and rounded corners on `background` | Needs a new draw op (rounded rectangle, outline) | The first real menu design |
| Scrolling containers | Needs clipping (a scissor op in the ABI) | A long settings menu or a chat log |
| Caching layout of unchanged subtrees | A HUD is small enough to lay out every frame | A menu of hundreds of items showing up in the bench |
| Focus and keyboard or gamepad navigation between buttons | Needs gamepads first (a "Not now" item in NEXT_PRIORITIES) | A console-style menu |
