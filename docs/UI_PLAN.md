# react-game-engine: UI layout plan

As of 2026-11-09. A proposal, written to sit next to priority 3 in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md) (the screen-space HUD layer). Nothing here is built yet. Push back on any decision below before work starts, as [DESIGN.md](DESIGN.md) asks.

The plan has two parts that are designed together:

1. **Layout** (milestones U0–U4): a `<Flex>` built-in that places its children in a row or a column, as CSS flexbox does.
2. **A fixed game resolution** (milestones C1–C3, [Part 2](#part-2-a-fixed-game-resolution-screen)): a `<Screen width={320} height={180}>` at the root, so the game is drawn at 320 × 180 whatever size the window is, and scaled up to fit.

They meet at one point: everything that today means "the window" (the size `<Hud>` and `Flex fill` take, the point the camera centres on, the mouse position) means the game's own 320 × 180 area once a `<Screen>` exists (called "the canvas" below: the surface the game is drawn on before it is scaled into the window). A HUD designed for 320 × 180 then looks the same in a 640 × 360 window as in a full-screen 4K one.

## Summary of part 1

Games need UI: a score in a corner, a health bar, a pause menu, a row of buttons. Today every one of those is placed by hand with `transform={{ x, y }}`. The demo's click button is a `Shape`, a `Pointer` and a `Text`, each given its own coordinates, and the label is centred by guessing (`x: 92` inside a box at `x: 80`). Change the label and the guess is wrong.

This plan adds **layout**: a `<Flex>` built-in that places its children in a row or a column, the way CSS flexbox does.

```tsx
<Flex direction="row" alignItems="center" gap={8} padding={12} background="#0008">
  <Sprite image="coin.png" />
  <Text size={20}>{coins}</Text>
</Flex>
```

It takes the props a web developer expects (`direction`, `alignItems`, `justifyContent`, `gap`, `padding`), with CSS's meanings. It is a container, like `<Entity>`, and it works anywhere in the tree, in the world or on priority 3's `<Hud>`. In practice almost all of it will live on the screen, which is why it goes alongside priority 3.

What has to exist first, and why priority 3 comes before or with this:

- **Sizes.** Layout needs to know how big each child is. `Shape`, `Pointer` and `Collider` already have `width` and `height`. A `Text` and a `Sprite` do not: the size of text depends on the font, and the size of a sprite on the image file. Both are known only to librge. So the native library must answer two new questions, "how wide is this text at this size?" and "how big is this texture?", which is an ABI change. Priority 3 already bumps the ABI to version 2 for `<Hud>`; these two functions should go into the **same** version 2, so the ABI moves once.
- **A screen to lay out on.** A HUD laid out in world space still drifts with the camera. `<Hud>` gives layout a fixed box: the window.

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
| `fill` | boolean | `false` | Take the whole box of the parent (the window, under `<Hud>`) |
| `grow` | number | `0` | Inside another `Flex`: take this share of the free main-axis space |
| `background` | a CSS colour | none | Draw a filled rectangle behind the children, the size of the box |

Every one is a plain string, number or boolean, so each is a field on the object, set in place by `render()` like `Shape.width` is. There are no object-valued props (`padding={{ x: 8 }}`): an object would be allocated on every render, which the performance work in priority 4 is trying to remove, and the compiler today only special-cases `transform` as an object. That is why padding is spelled out as separate props.

The keyword props (`direction`, `alignItems`, `justifyContent`) go in the manifest's `intrinsicLiterals`, exactly like `<Shape kind>`. A typo is a compile error with the choices and a suggestion. CSS also spells `start` as `flex-start`, so that typo gets its own hint: `<Flex alignItems> must be one of "start", "center", "end", "stretch", not 'flex-start' (did you mean "start"?)`.

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
    </Hud>
  );
}
```

The component is called `PlayerHud`, not `Hud`, because `Hud` is the built-in: the compiler rejects a component that takes a built-in's name ("Component 'Hud' conflicts with a runtime intrinsic"). Adding `Hud`, `Screen` and `Flex` as built-ins takes those three names away from games, so the work renames the two places that use one today: the `Hud` component in `packages/compiler/test/m10.test.ts` and the `Hud` example in DESIGN.md's "Children" section.

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
| `Hud` or `Screen` (inside a `Flex`) | A compile error: a HUD layer goes directly inside the root, and `Screen` is the root |

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

### `<Hud>` and layout together

`<Hud>` (priority 3) is drawn through an identity view in window pixels. For layout it also defines a box: the window, `width` × `height` from the input buffer, read every frame, so a resized window lays out again. A `Flex fill` directly under `<Hud>` takes that box. That is how a HUD pins things to corners and edges: a full-window column with `justifyContent="space-between"`, holding rows with spacers.

Pointers inside a laid-out `<Hud>` need nothing new. A `Pointer` hit-tests through `worldTransform()`, which includes the layout offset, and priority 3 already has screen pointers hit-tested in window coordinates.

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

**Done 2026-11-09.** Nothing writes the offset yet (that is U2's `<Flex>`), and no native backend measures yet (U0): until then text widths are estimated (0.6 × size per character) and textures measure 0 × 0, with one warning. `RecordingBackend` measures deterministically, so layout tests can start now. The QuickJS bench is unchanged within its noise; the tree walk tests for a zero offset inline, because QuickJS does not inline calls.

**Done when**

- [x] `GameObject` has `layoutX`/`layoutY`, composed before `placement` in `worldTransform()` and in `walkTree`, and the draw test still finds them in agreement
- [x] The two names are in `reservedMembers`, with a compiler test that a state named `layoutX` is rejected
- [x] `FrameBuilder` measures `Text` and `Sprite` through the backend, with caching, and a test counts the native calls

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

- [ ] `fill` under `<Hud>` takes the window, and a resize lays out again (a recording test with two window sizes)
- [ ] `grow` shares free space by weight; `stretch` sizes a child `Flex` on the cross axis
- [ ] The demo's click counter and button are a `Flex` row inside `<Hud>`, with the label centred by layout instead of by a guessed `x`
- [ ] The parity run covers the demo's HUD under QuickJS

### U4: polish

**Done when**

- [ ] Layout positions are rounded to whole pixels (see the open decisions), so centred text is not blurry
- [ ] `<Text align="center">` inside a fixed width: the second half of "text measuring and alignment"
- [ ] `<Flex onPress>` is pressable over its laid-out box, so a button no longer needs a hand-sized `Pointer`
- [ ] DESIGN.md has a "Layout" section and README shows the HUD example

## Decisions

All four were decided on 2026-11-09:

1. ~~**Default `direction`.**~~ `"row"`, as in CSS.
2. ~~**Pixel snapping.**~~ Layout offsets are rounded to whole pixels by default, so centred text is not blurry. No switch until someone asks for one.
3. ~~**Name.**~~ `Flex`. `Row` and `Column` may come later as TSX components on top of it.
4. ~~**Whether `onPress` belongs on `Flex`.**~~ Yes: `<Flex onPress>` is pressable over its laid-out box (U4), so a button needs no hand-sized `Pointer`.

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

# Part 2: a fixed game resolution (`<Screen>`)

## Summary

Today a game is drawn at the window's size, one game pixel to one window pixel. A pixel-art game at 320 × 180 in a 1280 × 720 window is drawn in the top-left quarter. A resized window shows more of the world, not a bigger one. HUD positions written for one window size are wrong at another.

This part adds a root built-in that separates the two sizes:

```tsx
export default function Game() {
  return (
    <Screen width={320} height={180} fit="integer" border="black">
      <World />
      <Hud>
        <PlayerHud />
      </Hud>
    </Screen>
  );
}
```

- **The game size** is the `<Screen>`'s `width` and `height`: 320 × 180. Everything inside is written in those units: transforms, the camera's view, `<Hud>`, `Flex fill`, the mouse position. The game never needs to know the window's size.
- **The screen size** is the window's: the starting size in `PlayerConfig` (`width: 1280, height: 720`), and then whatever the player resizes it to, or the monitor's size when full screen comes. The player scales the canvas to fit it each frame, and fills the leftover space with `border`.

| Milestone | What | Size (estimate) |
| --- | --- | --- |
| C1 | `<Screen>` with `pixelPerfect={false}`: drawn at window resolution through a scale. No ABI change | \~3–4 days |
| C2 | `pixelPerfect`: drawn into a 320 × 180 texture, then scaled up. One ABI op, in ABI v2 | \~3–4 days |
| C3 | The demo on a canvas; `fit="expand"`; full screen on a key | \~2–3 days |

C1 can be done before priority 3, because it needs no ABI change. C2 goes in ABI v2 with priority 3's `<Hud>` and U0's measuring functions, so the version still moves only once.

## The two sizes

| | Game size | Window size |
| --- | --- | --- |
| Set by | `<Screen width height>` in the game's TSX | `PlayerConfig.width`/`height` to start; the window's real size after that |
| Changes when | The game changes the props (a settings menu could) | The player resizes the window, or goes full screen |
| What uses it | Everything inside the game: transforms, the camera, `<Hud>`, `Flex fill`, `input.pointerX` | Only the player: to scale the canvas and place the borders, and to map the mouse back |
| Without a `<Screen>` | The same as the window size, as today | |

**Why the window's size stays in `PlayerConfig`, not on `<Screen>`.** (Update: the player now builds the root *before* the window opens, so that an optional `<Game>` root can configure the window; sounds made in constructors are recorded and preloaded once it is open. A `<Screen>`'s props are therefore known before the window opens, and the window could open at 3 × the canvas with no resize afterwards. The decision below stands for another reason.) The window's size is the host's business: the user resizes it, and a packaged game might save it between runs. So the game says what resolution it is drawn at, and the window is whatever it is. One small change helps: `PlayerConfig.width`/`height` become optional, and when they are left out with a `<Screen>` at the root, the window opens at 3 × the canvas (960 × 540 for 320 × 180). The window opens at that size, since the root is already built.

## Props

| Prop | Values | Default | Meaning |
| --- | --- | --- | --- |
| `width`, `height` | pixels | required | The game's resolution |
| `fit` | `"integer"`, `"contain"`, `"stretch"` | `"integer"` | How the canvas is scaled into the window (below) |
| `pixelPerfect` | boolean | `true` | Draw at the game's resolution and scale the finished frame up (chunky), or draw at the window's resolution through a scale (smooth) |
| `border` | a CSS colour | `"black"` | The bars around the canvas when it does not fill the window |

The canvas's own background is the existing `PlayerConfig.background`: inside the canvas it is the clear colour, and outside it, `border`.

### `fit`: how the canvas is scaled

For a 320 × 180 canvas in a window of a given size:

| `fit` | Scale | 1280 × 720 window | 1000 × 600 window | Use |
| --- | --- | --- | --- | --- |
| `"integer"` | The largest whole number that fits | ×4, no bars | ×3 (960 × 540), bars of 20 px left and right, 30 px top and bottom | Pixel art: every game pixel is the same number of screen pixels, so nothing shimmers |
| `"contain"` | The largest scale that fits, any number | ×4 | ×3.125 (1000 × 562.5), bars top and bottom | Smooth art, or pixel art where filling the window matters more |
| `"stretch"` | Each axis on its own | ×4 | ×3.125 by ×3.33: distorted, no bars | Rarely; for completeness |

The canvas is centred, and the bars are drawn in `border`. `"integer"` falls back to `"contain"` when the window is smaller than the canvas (a scale below 1), so the game is never cut off.

A later fourth mode, `"expand"`, keeps the height at 180 game pixels and widens the canvas to the window's shape (320 × 180 at 16:9, 384 × 180 at a 21:9 monitor), so there are no bars and a wide screen shows more of the world. It is in C3, because then the game size is no longer fixed, and `Flex fill` and the HUD must cope with a canvas width that changes.

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

`Screen` is a runtime class with the fields above, a container like `Entity` and `Camera`, added to the manifest in the same places `Flex` is. A component whose root element is `<Screen>` extends `Screen` (that is how components work already), so the player finds it once per frame at the root of the tree (as built in C1: the root it is given, or that root's only child, since a `World` keeps what it mounted under a bare root object). Reading its fields every frame means a game can change its resolution or `fit` from state, for example in a settings menu.

A `<Screen>` anywhere but the root has nothing sensible to mean, so it draws its children as an `Entity` would, with a warning once: "A `<Screen>` only works as the root of the game." The compiler cannot catch this on its own, because whether a component ends up at the root depends on another file (`PlayerConfig.root`).

`Screen` does not move its children: it has no transform of its own to apply, and a `transform` on it is rejected (it is left out of `transformIntrinsics`), like a sound would be.

### The player: one canvas-to-window map

All the work is in the player, in TypeScript, keeping NATIVE_PLAN's "the C side does no maths" rule. Each frame, `FrameBuilder.build` works out, from the canvas's props and the window's size:

- `scale` (or `scaleX` and `scaleY` for `"stretch"`), and
- `dest`: the rectangle in the window the canvas is drawn into.

It then uses them in four places:

1. **The camera's view.** `#view` centres the followed point on the canvas's centre (160, 90), not the window's. Today it adds `width / 2` and `height / 2` of the window; with a canvas, it adds the canvas's.
2. **`<Hud>`.** Its view is the identity in canvas units (so a HUD at `x: 8` is 8 game pixels in), and its layout box for `Flex fill` is 320 × 180.
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
- **`Flex` under `<Hud>`** lays out in game pixels. A 16 px padding is 16 game pixels, which is 64 screen pixels at ×4. That is the point: the HUD scales with the game.
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
- [ ] The camera centres on the canvas's centre (done); `<Hud>` is in canvas units (waits for priority 3)
- [x] The mouse maps back through the canvas: a `Pointer` is pressed in the right place in a resized, letterboxed window, and a press in the bars hits nothing
- [x] ~~`input.width`/`height` report the canvas's size~~ (see above: not needed)
- [x] Bars are drawn in `border`; a pixel test checks one
- [x] A game with no `<Screen>` produces byte-identical records to today (the existing recording tests and the Node↔QuickJS parity test pass unchanged)
- [x] A `<Screen>` that is not the root warns once and behaves as an `Entity`

### C2: `pixelPerfect`

**Done when**

- [ ] `RGE_OP_CANVAS` is in `rge.h` (ABI v2) and `protocol.ts`, and the header-parity test agrees
- [ ] librge draws into a render texture, recreated only when the size changes, and scales it with point filtering
- [ ] `smoke.c` checks that one canvas pixel becomes a 4 × 4 block of window pixels
- [ ] A turned sprite stays on the game's pixel grid (a pixel test)
- [ ] The parity test passes byte for byte under both hosts

### C3: the demo, `expand` and full screen

**Done when**

- [ ] The demo runs on a `<Screen>` (320 × 180 or 640 × 360), and its HUD (from U3) is laid out in canvas units
- [ ] `fit="expand"` widens the canvas to the window's shape; `Flex fill` and the camera follow the changing width
- [ ] `PlayerConfig.width`/`height` are optional with a root `<Screen>`, and the window opens at 3 × the canvas
- [ ] A full-screen toggle exists (a `PlayerConfig` key, or `useWindow().setFullscreen()`; see the decisions)

## Decisions

Decided on 2026-11-09:

- ~~**Default for `pixelPerfect`.**~~ `true`.
- ~~**Full screen.**~~ In, as part of C3. Unless decided otherwise, it is a key the player handles (F11 or Alt+Enter, configurable in `PlayerConfig`); a `useWindow()` hook for a settings menu would need its own design note under the "hooks are compiler intrinsics" rule.

- ~~**One component or two.**~~ Two, renamed: the sized root is `<Screen width height>` (called `Canvas` in earlier drafts), and priority 3's camera-ignoring layer is `<Hud>` (called `Screen` in earlier drafts). They do different jobs: the root sets the game's resolution and how it is scaled into the window, and there is one; `<Hud>` is a layer inside it that does not move with the camera, and there may be several. They cannot be one component, because the world must be inside the sized root but outside the camera-ignoring layer.
- ~~**Where the window's starting size lives.**~~ In `PlayerConfig`, as an optional `width`/`height`, because the window opens before any component exists. Left out, the window opens at 3 × the game's size.

## Not in this part, and what would pull it in

| Item | Why it waits | What would pull it in |
| --- | --- | --- |
| A sharp HUD over a pixel-perfect world (`<Hud pixelPerfect={false}>`) | Two render paths in one frame; it needs `<Hud>` and C2 both working first | Small text in a pixel-art HUD that is hard to read |
| Several canvases (split screen, a minimap) | Needs render targets as a general feature, not one canvas | A local multiplayer or minimap game |
| Post-processing (CRT filter, palette shaders) | Needs shaders in the ABI | An art direction that asks for it |
| Sub-pixel camera smoothing in `pixelPerfect` mode (drawing one pixel larger and offsetting the blit) | A refinement; slow pans may look a little steppy without it | A slow-scrolling game where the camera's steps show |
