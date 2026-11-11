# A second game: a small tower defense (plan)

Planned 2026-11-11. **Built the same day, in part**: see "Status" at the end. This is priority 7b in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md): a
second, small game in a different genre, done **before priority 8**, so the guide and template describe a shape that has
worked twice.

## Why this game

Kite (`packages/kite`) is one character in one-screen rooms. It had no lists of things that come and go, no menus and
no deep component trees, so the Tier 3 items from priority 7 were never hit (finding 15), and finding 9 ("styled sprites
leave the fast path; measure with a scene of many animated sprites") was never measured. A tower defense is the
opposite shape: dozens of enemies, towers and shots as lists, a side panel and menus, and the same small pieces (a
button, a panel, a stat row) used in many places. Writing it the way React code is normally written should hit each
Tier 3 diagnostic for a real reason, not a contrived one.

| Open item | Where this game hits it |
| --- | --- |
| Spread props | `<Enemy key={e.id} {...e} />`, `<Tower {...t} {...TOWERS[t.kind]} />` |
| Conditionals inside a list's `.map` | `pads.map((p) => p.tower ? <Tower …/> : <EmptyPad …/>)`, `shots.map((s) => s.live && <Shot …/>)` |
| Children on list items | `TOWER_LIST.map((d) => <MenuButton key={d.kind} …><Icon …/><Label …/></MenuButton>)` |
| Forwarding `{children}` | `<Modal title>` → `<Panel>{children}</Panel>` → `<Flex>{children}</Flex>`, for pause, won, lost and the upgrade panel |
| Context | Each tower provides its own state (level, range, target angle, whether it is selected) to `Barrel`, `RangeRing`, `LevelPips` and `MuzzleFlash`; one value per list item, which a single global store cannot hold without passing ids |
| Finding 9 (many animated sprites) | The last waves have about 80 enemies on screen, each an `<AnimatedSprite>` with `flipX` and a hit-flash `tint`, plus about 20 rotating towers and up to 50 shots |

The rule from priority 7 still holds: **write the component the React way first, and lift a diagnostic only when the
game hits it.** If a feature turns out not to be needed (props or the store did the job cleanly), that is recorded as a
finding instead of being built.

## The game

Working title **Hearth** (package `packages/hearth`; the name can change). Original art, sound and music, made by a
`tools/make-assets.ts` the way Kite's are.

**One map, one fixed path.** Enemies walk a path from the left edge to the hearth on the right. The path is fixed, so
they follow waypoints and there is no pathfinding. Towers go on **build pads** (about 18 marked tiles beside the path),
not on any free tile. Pads make the keyboard and gamepad cursor simple (move between pads) and keep placement rules out
of the way.

**Screen.** 320 × 180, like Kite. The playfield is the left 240 × 180 (24 × 18 tiles of 10 px), drawn from a Tiled map
with a `Tiles` layer and a hidden `Markers` layer (path tiles, pads, the spawn, the hearth), the same way Kite marks a room's start
and exits. The right 80 × 180 is a side panel in a `<Hud>`. The playfield and the panel do not overlap, so a click on the
panel is never also a click on the field.

**Towers** (first numbers; the balance tool and a person playing set the real ones):

| Tower | Cost | Range | Fires every | Does |
| --- | --- | --- | --- | --- |
| Bolt | 50 | 40 px | 0.4 s | 6 damage to one enemy |
| Mortar | 80 | 55 px | 1.6 s | 18 damage in a 14 px radius, after a 0.5 s flight |
| Frost | 60 | 35 px | 1.0 s | 2 damage and a 40 % slow for 1.5 s, in a radius |

Two upgrade levels per tower (cost 60 % and then 100 % of the base cost, about +40 % damage and +10 % range each). A
tower targets the enemy in range that is furthest along the path. Selling returns 70 % of what was spent.

**Enemies:**

| Enemy | HP | Speed | Gold | Lives it takes |
| --- | --- | --- | --- | --- |
| Runner | 14 | 40 px/s | 4 | 1 |
| Grunt | 30 | 25 px/s | 6 | 1 |
| Brute | 120 | 14 px/s | 15 | 3 |

**Waves.** Ten hand-written waves (a table of groups: kind, count, gap, delay) in `rules/waves.ts`. HP scales by
1 + 0.15 per wave. Wave 10 puts about 80 enemies on the path at once. The player starts with 120 gold and 20 lives, and
starts each wave with a button. Losing every life is a loss. Clearing wave 10 is a win.

**Controls.**

- Mouse: click a pad to select it. The side panel then shows the build menu (empty pad) or the upgrade panel (a tower).
  The tower's range ring shows while the mouse is over a tower or a pad holding one.
- Keyboard and gamepad: a cursor moves between pads with the arrows or the d-pad (to the nearest pad in that direction).
  Confirm (`Z`, `A`) selects and buys, back (`X`, `B`) cancels, and `1`/`2`/`3` buy a tower directly. `U` upgrades and
  `S` sells. Space or `Y` starts the next wave. `F` toggles 2× speed. `Esc` or Start pauses.
- All of it goes through `createControls` and `<Game controls>`, as in Kite.

**Screens:** title, play, pause (a modal over play), won and lost, switched by a `<Router>` on a `screen` leaf in the
game state, as in Kite. Music plays under all of them.

**Not in this game:** more than one map, pathfinding or free placement, flying enemies, tower abilities, saving,
settings or rebinding, an endless mode.

## How it is built

The shape Kite settled on (finding 1 and finding 16), used a second time on purpose: if it holds up, it is what the
guide describes.

```
packages/hearth/
  DESIGN.md            the one-page design note (mechanics, numbers, what "finished" means)
  src/
    rules/             plain TypeScript, no engine: the whole simulation
      battle.ts        stepBattle(battle, dt, commands) → battle; the one entry point
      path.ts          the waypoints read from the map's Markers layer, and position-at-distance
      targeting.ts     which enemy a tower aims at
      towers.ts        TOWERS: kind → cost, range, rate, damage, upgrades
      enemies.ts       ENEMIES: kind → hp, speed, gold, lives
      waves.ts         the ten waves, and the spawner
      economy.ts       buy, upgrade, sell, rewards
      rng.ts           a seeded random number generator (for spread and timing), so a run is repeatable
      controls.ts      the action map (createControls)
    GameState.ts       screen, battle, selected pad, speed; actions call the rules
    effects.ts         effect stores: particles, sounds, shake
    Main.tsx           <Game>, <Screen>, <Router>, <Music>
    Play.tsx           the field, the lists, the side panel
    Field.tsx, Pad.tsx, EmptyPad.tsx, Tower.tsx, Barrel.tsx, RangeRing.tsx, LevelPips.tsx, MuzzleFlash.tsx,
    Enemy.tsx, HealthBar.tsx, Shot.tsx,
    SidePanel.tsx, StatRow.tsx, BuildMenu.tsx, UpgradePanel.tsx, MenuButton.tsx, Modal.tsx, Panel.tsx, Label.tsx,
    Title.tsx, Won.tsx, Lost.tsx
  scenes/field.tmj     the map
  assets/              sheets, font, sounds, music (made by tools/make-assets.ts)
  test/                rules tests, wave replays, the balance check
  tools/               make-assets.ts, balance.ts
  game.ts, main.ts, parity.ts
```

**Rules apart from drawing.** `stepBattle` takes the battle (enemies, towers, shots, gold, lives, wave, the spawner's
clock, the RNG seed) and the commands of this step (build, upgrade, sell, start wave) and returns the next battle.
Everything a test needs runs without the engine. It also returns the step's events (`shot`, `hit`, `killed`, `leaked`,
`waveCleared`), which the game state hands to the effect stores for sound and particles, the way Kite's `GameEvent`s
work. 2× speed is two fixed steps of the rules per engine step.

**The game state** holds the battle as one object (arrays are allowed now, finding 16). The `Play` screen's
`useUpdate` calls one action, `step(input, dt)`, which turns input into commands and calls `stepBattle`. Components
select what they draw: `useGame((s) => s.battle.enemies)` and so on.

**The component tree**, with the Tier 3 feature each spot uses:

```
Main  <Game> <Screen> <Router> <Music>
├─ Title
├─ Play
│  ├─ Field                    <Tilemap>
│  ├─ pads.map(p =>            conditional inside .map, spread props
│  │     p.tower ? <Tower key {...p.tower} /> : <EmptyPad key {...p} />)
│  │   Tower                   provides TowerContext (one value per tower)
│  │   ├─ Base                 <Sprite>
│  │   ├─ Barrel               useContext: rotation toward the target
│  │   ├─ RangeRing            useContext: shown when selected or hovered
│  │   ├─ LevelPips            useContext: level.map(...)
│  │   └─ MuzzleFlash          useContext: last shot time
│  ├─ enemies.map(e => <Enemy key={e.id} {...e} />)
│  │   Enemy                   <AnimatedSprite flipX tint>, {e.hp < e.maxHp && <HealthBar …/>}
│  ├─ shots.map(s => s.live && <Shot key={s.id} {...s} />)
│  ├─ <ParticleLayer>
│  └─ <Hud>
│     ├─ SidePanel             <Flex column>
│     │  ├─ StatRow × 3        gold, lives, wave
│     │  ├─ BuildMenu          TOWER_LIST.map(d => <MenuButton key …><Icon/><Label/></MenuButton>)   children on list items
│     │  │  or UpgradePanel    <Panel title>{rows}</Panel>                                         forwarding children
│     │  └─ MenuButton         next wave, speed
│     └─ {paused && <Modal title="Paused"><MenuButton …/>…</Modal>}                               forwarding children twice
├─ Won                         <Modal> again
└─ Lost
```

## What has to be built

### Engine: Tier 3 in the compiler

Each one gets a design section in `DESIGN.md` (next to "Keyed lists" and "Passing children"), compiler tests (IR, the
generated code, diagnostics for what is still not allowed), a runtime test, and keeps the parity test byte-identical.
The order is the order the game is expected to hit them; build each when it is hit.

1. **Spread props** (`<Enemy {...e} />`, and spread together with named props, later ones winning). Today: rejected
   ("Only plain `name={value}` attributes are supported", `RGE1203`). On a **component** element this needs no key list:
   the generated code can spread for real (`new Enemy({ ...e, speed: 2 })`, `updateProps({ ...e })`). TypeScript checks
   the object against the props type, the source type-check reports a missing prop at the author's line, and the
   runtime's `applyProps` already compares key by key, so a render only marks the child dirty when a value changed.
   The spread's dependency is everything the spread expression reads, so it re-renders when the object is replaced (an
   immutable update), as list items already do. On a **built-in** a render writes each prop to a field one by one, so
   a spread needs the keys. That stays a diagnostic until a game spreads onto a built-in (Hearth does not plan to).
   The cost is one object per render of the element, which the bench in "Performance" measures.

2. **Conditionals inside a list's `.map`.** Today `.map` must return one element; the workaround is
   `filter(…).map(…)`, as in Kite's `Level.tsx`. Two forms:
   - `items.map((i) => cond && <A key …/>)`: an item whose condition is false has no instance, the same as filtered out.
     This can lower to the existing keyed list over an implicit filter, so it is small.
   - `items.map((i) => cond ? <A key …/> : <B key …/>)`: an item can switch kind. The key must be the same expression in
     both branches (otherwise a diagnostic). The item's slot holds whichever instance matches, and switching
     unmounts one and mounts the other in the same position. The IR gains a branch on `KeyedListChild`. `$items` maps
     keys to `{ branch, instance }`.

3. **Children on list items** (`items.map((d) => <MenuButton key={d.kind}><Icon …/><Label …/></MenuButton>)`). Today
   not supported ("children on list items are not supported yet"). Each item's passed children are built with the item,
   owned by the parent's list block, and may read the item and its index. They go through `attachPassedChild`, as a
   static block's children do. When the item goes, its children go with it.

4. **Forwarding `{children}`** (`function Modal({ title, children }) { return <Panel title={title}>{children}</Panel>; }`).
   Today not supported ("Forwarding to another component … is not supported yet"). The receiver's slot is itself a
   passed-children slot: at construction, `Modal` records `Panel` as where its passed children go, and the runtime
   hands each one on, so the outer parent's `attachPassedChild` ends in the innermost container. Forwarding through two
   levels (Modal → Panel → Flex) must work. A forwarded slot inside a condition stays a diagnostic.
   **Decided 2026-11-11: the forwarded `{children}` must be the only child passed to the inner component** (open
   decision 5, option A). `<Panel title={title}>{children}</Panel>` is allowed; `<Panel><Title/>{children}<Footer/></Panel>`
   is a diagnostic.

5. **Context** (`createContext`, a provider element, `useContext`). Today: an unknown hook. The proposed shape:
   - `export const TowerContext = createContext<TowerView>(defaultValue)` in a `.ts` file.
   - A built-in `<Provider context={TowerContext} value={…}>…</Provider>` as the provider, a container like `<Entity>`.
     A built-in is cheap for the compiler (it is driven by the manifest). React 19's `<TowerContext value>` can come
     later as sugar that lowers to it.
   - `const tower = useContext(TowerContext)` at the top level of a component, a compiler intrinsic like the other
     hooks.
   - At runtime a consumer finds the nearest provider when it is attached (walking up), and the provider re-renders its
     consumers when `value` changes (by reference, as React does). A consumer with no provider gets the default.
   - The provider's value is a dependency of the consumer's `render()`, like a prop.
   *Open decision:* the provider as an element (above) versus a compile-time-only lowering that threads the value as a
   hidden prop. The element works across files and through passed children, so it is the default.
   Context in a custom hook (`useTower()` wrapping `useContext`) is left out of the first cut.

Each one that is not hit stays a diagnostic, and its "Not now" row says so.

### Engine: performance (finding 9)

- **Measure first.** Add a bench scenario to `packages/player/bench/frame.ts`: 200 `<AnimatedSprite>`s with a frame,
  `flipX` and a `tint`, moving every step, driven by state the way a keyed list is (each item re-rendered by an immutable
  update). Record it under V8 and QuickJS and add it to `bench/budget.json`.
- Then measure Hearth's wave 10 the same way (`tools/frame-time.ts`, as Kite did for its busiest room) and record it in
  `NATIVE_PLAN.md`.
- **Only if it is over budget:** extend the "moved as a block" fast path to styled sprites (frame, flip and tint in the
  cached record), and look at the cost of a keyed list where every item changes every step (80 enemies replaced each
  step means 80 `render()`s). Both are guesses until the bench says so.

### Engine: tooling and small gaps

- **Clicks in input scripts.** Scripts are keys only today. A term such as `click@120,64` (move the mouse to a canvas
  point and tap `MouseLeft`) and `mouse@120,64` (move only) let a replay build towers by clicking. `InputFrame` already
  has `mouse`, so this is `parseInputScript` and the harness. Built first, with tests, using the demo's HUD button as
  the first user.
- **Clicks and the HUD.** `input.pressed("MouseLeft")` in a `useUpdate` sees a click that also landed on a HUD button.
  The panel and the field do not overlap, so Hearth does not need a fix. Record whether a "press already handled"
  flag is wanted (a finding, not built up front).
- **The bitmap font has one case** (finding 15). Menus can live with upper case. Record it if they read badly.
- **`check:hearth`, `play:hearth`, `package:hearth`** and adding the game to `generate` and `typecheck`, as Kite has.

### The game itself

- Rules and their tests: path following, targeting (furthest along, ties by id), damage and slow, splash, the
  spawner, economy (buy, upgrade, sell refund, rewards), leaking and losing, the win.
- The map in Tiled format (written by a tool first, as Kite's rooms were), the markers read by `path.ts`.
- Sprite sheets: three enemies × a 4-frame walk, three towers × base and barrel × three levels, shots, pads, a hearth,
  UI icons. Sounds: build, upgrade, sell, three shot sounds, hit, death, leak, wave start, win and lose. One music loop.
- A **balance tool** (`tools/balance.ts`, like Kite's `solve.ts`): runs the ten waves through the rules only, against a
  few fixed build orders (all Bolt, mixed, too few towers), and prints lives left per wave. Its output is checked by a
  test so a change to a number shows up as a change in difficulty.
- **Wave replays:** an input script that clicks build orders and starts waves, played through the game itself. It
  checks that a good build wins with lives left and a bad one loses.

## Implementation map

What each piece touches, file by file, as read from the code on 2026-11-11. Paths are under `packages/` unless they
start with `docs/` or `tools/`. Every engine item also gets: a section in `docs/DESIGN.md`, compiler tests in
`compiler/test/` (a new `tier3.test.ts`, or one file per feature in the style of `m14.test.ts`), the diagnostic it
replaces turned into a test of the new behaviour plus a test of what is still rejected, and a green
`npm test`, `npm run typecheck` and `check:demo` / `check:kite` (parity stays byte-identical).

### 0. Tooling: clicks in input scripts

| File | Change |
| --- | --- |
| `player/src/script.ts` | `parseTerm` accepts `click@x,y` (move the mouse and tap `MouseLeft` for one frame) and `mouse@x,y` (move only). `ScriptFrame` gains `mouse`, carried forward from frame to frame like a held key. Coordinates are in the game's canvas (the `<Screen>` size), not window pixels |
| `player/src/harness.ts`, `player/src/recording.ts` | Map a canvas point to the window point that `InputFrame.mouse` expects, through the same fit and scale the player uses (`player/src/screen.ts`), so `input.pointerX` and a `<Pointer>` see the point the script named |
| `player/test/script.test.ts`, `player/test/harness.test.ts` | Parsing (`click@10,20*3` is an error, `click@` combines with `+`), and a demo run that clicks its HUD button and sees the count change |
| `docs/NEXT_PRIORITIES.md` (priority 7's tooling paragraph) | One line on the new terms |

### 1. Spread props on component elements

| File | Change |
| --- | --- |
| `compiler/src/ir/elements.ts` | `PropIR` gains `SpreadPropIR { kind: "SpreadProp"; value: ExprIR; dependencies: DependencyIR[] }`. Order among props is kept, so later props win as in React |
| `compiler/src/transform/elements.ts` (`lowerProps`) | A `JsxSpreadAttribute` on a component element lowers its expression with `lowerNode` (so it may read state, props, the list item or a `useGame` selection). On a built-in: `RGE1203` "spread onto a built-in is not supported yet". `key` and `ref` checks are unchanged. A spread of a callback-only object is not special: functions in the object pass through as values |
| `compiler/src/transform/lowering.ts` (`asListItem`) | A spread that reads the item gets the `Item` dependency, like a dynamic prop |
| `compiler/src/generator/elements.ts` (`propsObject`, `emitPropUpdates`) | Emit `...(<expr>)` in place. `updateProps` gets the spread together with the dynamic props whenever the spread's dependencies changed. A static spread (reads nothing that changes) goes in at construction only |
| `compiler/src/ir/walk.ts` | Walk `SpreadProp` values (dependencies, `readsParam`, asset collection) |
| `compiler/src/prefabs/prefabs.ts`, `compiler/src/assets/assets.ts` | Skip spread props when listing settable props and literal asset paths (they are not literal) |
| Tests | Lowering and generated text, a spread in a keyed list re-rendering only the item whose object changed (runtime counts renders), named prop after a spread winning, source type-check catching a missing prop (`RGE9002`), spread onto `<Sprite>` rejected |

### 2. Conditionals inside a list's `.map`

| File | Change |
| --- | --- |
| `compiler/src/transform/elements.ts` (`lowerList`) | Accept a body that is `cond && <El key …/>`: rewrite the source to `source.filter((item) => cond)` (the source may already be filtered; `isListSource` allows it) and lower the element as today. Accept `cond ? <A key …/> : <B key …/>`: lower both branches, check that the two `key` expressions are the same IR (`sameExpr`, new in `ir/walk.ts`), otherwise `RGE1209` "both branches need the same key". A `null` branch is the `&&` form |
| `compiler/src/ir/elements.ts` | `KeyedListChildIR` gains `alternate: { condition: ExprIR; element: ElementIR } \| null`: `element` when `condition` is true, `alternate.element` otherwise. Each branch has its own `fieldName` |
| `compiler/src/generator/elements.ts` (`emitList`, `subtreeResets`), `generator.ts` (field declarations) | Per key keep `{ branch: 0 \| 1, instance }`. On render: compute the branch; a new key constructs that branch; a key whose branch flipped queues removal of the old instance and adds the new one at the same `(slot, position)`; otherwise update props. One items map and one order array per list, typed as the union of both classes. The duplicate-key check is unchanged |
| `compiler/src/generator/elements.ts` (`listItemType`) | Unchanged: the item type comes from the source |
| Tests | Generated code for both forms, a pad switching from `EmptyPad` to `Tower` keeping its position among siblings, an item whose condition turns false being removed, different keys in the branches rejected, a fragment branch still rejected (a list item is one element) |

### 3. Children on list items

Today `lowerList` rejects them ("A list item cannot have children yet"). The generated code keeps every element in a
field of the component (`this.<fieldName>`), and a list item has many instances, so its children need somewhere per
item to live.

| File | Change |
| --- | --- |
| `compiler/src/transform/elements.ts` (`lowerList`) | Allow children on the item element: static children, conditional children and a nested `{children}`-free subtree. They may read the item. A nested list inside a list item stays `RGE1209` in the first cut |
| `compiler/src/generator/elements.ts` | Teach the element emitters (`emitElementFields`, `emitStaticWiring`, `emitChildUpdates`, `emitMountStatics`, `subtreeResets`) to take an **owner** expression instead of assuming `this`: `this` for the component's own elements, `$rec` for a list item's, where `$rec` is the per-key record (the list already keeps `#<field>Records` for callbacks; it becomes the place the item's child instances live too). A component item mounts them with `attachPassedChild`; a built-in item with `addChild` |
| `compiler/src/generator/generator.ts` | Emit a record type per list with children (`{ current: Item; icon: Icon; label: Label \| null; … }`) |
| Tests | `TOWER_LIST.map((d) => <MenuButton key={d.kind}><Icon kind={d.kind}/><Label text={d.name}/></MenuButton>)`: built, updated when `d` changes, removed with its item. A conditional child in a list item. A list item that is a `<Flex>` with children |

### 4. Forwarding `{children}`

| File | Change |
| --- | --- |
| `compiler/src/transform/lowering.ts` (`lowerChildrenSlot`) | When `context.passed` (the slot is among the children passed to another component) and the slot is the only child of that block, accept it and record the forwarding target (that component element). Beside other passed children (open decision 5, decided: option A) it is `RGE1202`: "`{children}` forwarded to <Panel> must be the only child passed to it: put the other children inside <Panel> itself, or pass them through `{children}` from the parent." Inside a condition or a list, keep today's diagnostic |
| `compiler/src/ir/elements.ts`, `ir/declarations.ts` | `ChildrenSlotChildIR` gains `forwardedTo: string \| null` (the inner element's field). `ComponentIR` records it for the generator |
| `compiler/src/generator/generator.ts` (the constructor's slot wiring at `findChildrenSlot`) | For a forwarding component, emit `this.passedChildrenForward = this.<inner>;` instead of host and slot |
| `runtime/src/GameObject.ts` | `passedChildrenForward: GameObject \| null`. `attachPassedChild`, `queueAttachPassedChild`, `queueDetachPassedChild` and `queueReorderPassedChildren` delegate to it when set, so two levels (Modal → Panel → Flex) resolve in a chain. `acceptsPassedChildren` is true when either is set |
| Tests | Modal → Panel → Flex with static, conditional and list children; the runtime error for a component that does not render `{children}` still reads well through a forward; a forwarded `{children}` with a sibling in the same block rejected with `RGE1202` |

### 5. Context

| File | Change |
| --- | --- |
| `runtime/src/context.ts` (new), `runtime/src/index.ts` | `createContext<T>(defaultValue: T): Context<T>`, an object with an id and the default |
| `runtime/src/components/Provider.ts` (new) | `Provider extends Entity` with `context` and `value`. `value` is an accessor: setting a different value tells every consumer registered with it (`markDirty`). Holds a `Set` of consumers |
| `runtime/src/GameObject.ts` | `contextReads: readonly Context<unknown>[]` (generated code overrides it, like `gameStateKeys`). On `attachToWorld` walk up the parents for the nearest `Provider` per context, register, and call `receiveContext(context, value)`, then `markDirty` (the store's "refresh once" pattern). Unregister on `detachFromWorld`. With no provider the default stays |
| `runtime/src/manifest.ts`, `runtime/src/jsx.ts` | `Provider` in `intrinsics`, `containerIntrinsics`, `transformIntrinsics` and `intrinsicMembers`; `useContext` and `createContext` exported for authoring (`useContext` throws if called outside the compiler, as `useGame` does) |
| `compiler/src/analyzer/matchers.ts`, `analyzer/component.ts` | Recognise `const t = useContext(TowerContext)` at the top level, where `TowerContext` is imported from a `.ts` module (`plainImports`) |
| `compiler/src/transform/hooks.ts` | Lower it to a `StateIR` with `context: "<import name>"` (like `globalKey` for the store) and a type of `ContextValue<typeof TowerContext>`. Reading it anywhere a state can be read works with no other change |
| `compiler/src/generator/generator.ts` | Initialise the field to the context's default, emit `contextReads` and a `receiveContext` that assigns the field and marks dirty |
| `compiler/src/hooks/inline.ts` | Reject `useContext` inside a custom hook for now, with a message |
| Tests | Two towers in a list, each a provider with its own value, their `Barrel`s seeing their own tower; a value change re-rendering only that tower's consumers; the default with no provider; a consumer under a provider that moves through passed children (`Modal`) still finding it |

### 6. Performance (finding 9)

| File | Change |
| --- | --- |
| `player/bench/frame.ts` | New scenes: "200 animated sprites by state" (frame, `flipX`, `tint`, moved by an immutable list update every step) and "80 enemies, 20 towers, 50 shots" (Hearth's wave 10, built from shapes so it does not depend on the game package) |
| `player/bench/budget.json` | Budgets for both under V8 and QuickJS, at about 2.5–3× the measured time, as the file asks |
| `player/src/draw.ts` (only if over budget) | Let a styled sprite (frame, flip, tint) take the "moved as a block" path when only its transform changed, by keeping its styled record in the cache |
| `packages/hearth/tools/frame-time.ts` | Wave 10's frame time, as Kite's `tools/frame-time.ts` does, recorded in `docs/NATIVE_PLAN.md` |

### 7. The game package

| File | What it holds |
| --- | --- |
| `package.json` (root) | Scripts `hearth` (compile with `--scenes` and `--assets`), `hearth:assets`, `play:hearth`, `check:hearth`, `package:hearth`, and `hearth` added to `generate` and `typecheck` |
| `hearth/package.json`, `hearth/tsconfig.json` | As Kite's |
| `hearth/game.ts` | `gameConfig` (root `Main`) and the script `bindings` (`left`, `right`, `up`, `down`, `confirm`, `back`, `wave`, `fast`, `pause`, `one`, `two`, `three`, `upgrade`, `sell`) |
| `hearth/main.ts`, `hearth/parity.ts` | Entry, and a parity run: a short build order and the first wave, printing the battle's state each N steps |
| `hearth/src/rules/*.ts` | The simulation as described under "How it is built". `battle.ts` exports `Battle`, `Command`, `BattleEvent`, `newBattle(map)`, `stepBattle(b, dt, commands)` |
| `hearth/src/GameState.ts` | `screen`, `battle`, `selected` (pad id or null), `hover`, `speed`, `paused`; actions `begin`, `step(input, dt)`, `select`, `build`, `upgrade`, `sell`, `startWave`, `toggleSpeed`, `pause`, `resume`, `toTitle`. `step` forwards `BattleEvent`s to `effects.ts` |
| `hearth/src/*.tsx` | The components in the tree above |
| `hearth/scenes/field.tmj` | Written first by `tools/make-map.ts` from a text drawing, as Kite's rooms were |
| `hearth/tools/make-assets.ts` | Sheets, font (reuse Kite's font image or its generator), sounds, music |
| `hearth/tools/balance.ts` | Waves × build orders through `stepBattle` only, printing lives left per wave; `--write` updates the expected table |
| `hearth/test/rules.test.ts` | Path following, targeting, damage, splash, slow, spawning, economy, leaking, the win and the loss |
| `hearth/test/balance.test.ts` | The balance table matches `tools/balance.ts`'s output |
| `hearth/test/replays.test.ts`, `hearth/test/replays.ts` | Click-and-key scripts played through the game with the harness: a good build wins, a thin one loses, the pause menu resumes |
| `hearth/DESIGN.md` | The design note |

### Docs to update along the way

- `docs/DESIGN.md`: "Keyed lists" (conditionals, children on items), "Passing children" (forwarding), new "Spread props"
  and "Context" sections.
- `docs/NEXT_PRIORITIES.md`: the "Not now" rows for context and the Tier 3 syntax, finding 9, and a "Findings from the
  second game" section.
- `docs/NATIVE_PLAN.md`: the new bench scenes and wave 10's frame time.
- `README.md`: the game in the layout list and its scripts.

## Order of work

Engine and game changes in separate commits, as in priority 7.

0. **Tooling:** click and mouse terms in input scripts, with tests on the demo.
1. **Design note and rules:** `packages/hearth/DESIGN.md`, then `src/rules/` with headless tests. No rendering yet.
2. **Greybox, written the React way:** every piece as a `<Shape>`, the lists, the side panel and the modal written as
   they would be in React. Each Tier 3 diagnostic it hits is noted. Where a diagnostic blocks it, a temporary
   workaround keeps the game running (filter then map, props instead of spread) and is marked to be removed.
3. **Tier 3, one feature per commit, in the order hit** (expected: spread props, conditionals in `.map`, children on
   list items, forwarding `{children}`, context). Each removes its workaround in the game in a following commit.
4. **Input and the panel:** mouse selection, the keyboard and gamepad cursor, build, upgrade, sell, next wave, 2× speed.
5. **Screens:** title, pause, won and lost through the `<Router>` and `<Modal>`.
6. **Art, animation and sound:** sheets, `<AnimatedSprite>` walks with facing and hit flash, rotating barrels, muzzle
   flashes, particles for hits and deaths, sounds and music.
7. **Waves and balance:** the ten waves, the balance tool and its test, and the wave replays.
8. **Performance:** the bench scenario first, then wave 10, then a fix only if over budget.
9. **Wrap up:** findings written in `NEXT_PRIORITIES.md`, "Not now" rows updated, `check:hearth` green, packaged under
   both engines.

Steps 0–3 are the part that matters for priority 8. A natural place to stop and review is after step 3, when every
Tier 3 item is built or recorded as not needed.

**Size:** about 3–4 weeks for one engineer, in the style of the other estimates: the game is smaller than Kite (no
movement feel to tune), and the compiler work is most of it.

## Done when

- [x] `packages/hearth/DESIGN.md` covers the mechanics, the numbers and what "finished" means
- [~] The game is playable from the title through ten waves to a win or a loss, with mouse, keyboard or gamepad, under
      Node and as a packaged build (headless verification at least; a person plays it in priority 6's spirit). *Verified headless under Node; not packaged, not played.*
- [~] Each Tier 3 item is either built (design section, compiler and runtime tests, used by the game) or recorded as a
      finding saying why the game did not need it; the matching "Not now" rows are removed or updated. *Built: spread props, conditionals in a list's map, forwarding `{children}`, children on list items (flat). Context: recorded as not needed.*
- [x] Input scripts can click, and a wave replay builds towers by clicking and wins
- [x] Headless tests cover targeting, splash, slow, the economy, leaking, and the balance tool's output
- [x] The many-sprites bench scenario is in `bench/budget.json`, wave 10's frame time is recorded in `NATIVE_PLAN.md`,
      and finding 9 is closed or updated with numbers
- [x] A "Findings from the second game" section in `NEXT_PRIORITIES.md`, including which of Kite's findings held a second
      time (rules apart from drawing, effect stores, the router) and which did not
- [x] `npm run check:hearth`, `npm test`, `npm run typecheck` and the parity test pass

## Open decisions

1. **The name.** "Hearth" is a working title.
2. **Spread onto built-ins.** Spread onto components needs no key list (see "Spread props"). Spread onto built-ins would,
   from the manifest's `intrinsicMembers`. Default: not built until a game needs it.
3. **Context's provider form:** a built-in `<Provider context={TowerContext} value={…}>` (first), with
   `<TowerContext value>` as sugar later, or a compile-time hidden prop. Default: the built-in, see the implementation
   map.
4. **Pads or free placement.** Default: pads. Free placement needs a click-to-tile query and path blocking rules, which
   add nothing to what this game is meant to test.
5. ~~**Forwarded `{children}` beside other passed children.**~~ **Decided 2026-11-11: option A**, see below.

## Decided: forwarded `{children}` beside other passed children

**The problem.** When `Modal` forwards its children to `Panel` and also passes `Panel` children of its own:

```tsx
function Modal({ title, children }: ModalProps) {
  return (
    <Panel>
      <Title text={title} />
      {children}
      <Footer />
    </Panel>
  );
}
```

all of `Panel`'s passed children share one slot in its container and are sorted there by one number, `order`
(`GameObject.addChild` sorts by `(slot, order)`). `Modal` gives `Title` order 0 and `Footer` order 2. The forwarded
children are numbered 0, 1, 2… by the outer parent, so they mix with `Title` and `Footer` instead of landing between
them. One number cannot hold a whole list between two siblings.

**The options:**

| | Option | What it takes | Trade-off |
| --- | --- | --- | --- |
| A | Keep the restriction: the forwarded `{children}` is the only child passed to the inner component | Nothing beyond forwarding itself | Every use Hearth plans fits (`<Panel title={title}>{children}</Panel>`); anything else is a diagnostic, and the author restructures |
| B | Allow `{children}` in a wrapper element that is passed to the inner component (`<Panel><Title/><Flex direction="column">{children}</Flex><Footer/></Panel>`) | A small compiler change: that wrapper is always present, so it can hold the slot, and the slot's host is `Modal`'s own element. No runtime change | One more level in the tree; the wrapper must be a `<Flex>` for layout to apply to the children, and authors have to know to write it |
| C | Order ranges: forwarded children get order `position × K + i` (K about 2²⁰), the block's own children `position × K`; a reorder rewrites orders inside the range | A change in `GameObject`'s passed-children methods and in the generated orders | Any mix of siblings, with no extra objects; at most K − 1 items per forwarded block; order numbers become harder to read when debugging |
| D | Compound order: `order` becomes a path (`[1, 3]`) compared item by item | Changes `addChild` and the reorder code | The most general, but `addChild` runs on every mount and priority 4 tuned it, so the cost needs measuring |
| E | An automatic wrapper: the compiler inserts B's wrapper, and layout treats it as transparent | A "transparent container" in layout (`UI_PLAN.md`) as well as B | The best for authors, and the most work |

**Decision: A.** Hearth does not need more, and the rule from priority 7 is to build syntax only when a game hits it.
The diagnostic names the restriction and what to do instead (see the implementation map, step 4).

**If a game hits it:** B first (local to the compiler, no runtime cost; the diagnostic can then suggest the wrapper),
then C if the wrapper proves awkward. D and E only if several games ask. The "Not now" row for forwarding in
`NEXT_PRIORITIES.md` says the same once forwarding lands.

## Status (2026-11-11)

Done: step 0 (clicks in input scripts), 1 (design note, rules, headless tests), 2 (greybox, React way), 3 for spread props, conditionals in
`.map`, forwarding `{children}` and children on list items (one commit each, workarounds removed), 4 to 7 (input and panel, screens, art and sound, the ten waves, the
balance tool and the wave replays), 8 (bench scenes; wave 10 measured; no fix needed) and the findings in NEXT_PRIORITIES.md. Not done: Tier 3
item 5 (context, recorded as not needed), a real-window package, and a person playing it. Where the game differs from this plan: HP grows 20 % a wave and gold rewards are halved (the balance tool), wave 10
has 136 enemies, the range ring shows for the selected tower (no hover), and a `focus` object in the game state stands in for
index reads in render expressions.
