# A second game: a small tower defense (plan)

Planned 2026-11-11. Nothing here is built yet. This is priority 7b in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md): a
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
   ("spread attributes … are rejected"). The work is in the analyzer and `transform/elements.ts`: lower a spread into one
   prop per key the **receiving component declares**, so the generated code stays `new Enemy({ x: e.x, y: e.y, … })`
   with no runtime spread. Within one file the receiver's `PropDeclIR`s are at hand. Today each file is compiled alone
   and `project.ts` only checks across files afterwards, so a receiver in another file (the usual case) needs the
   project to read props first. That pass is part of this work.
   A spread onto a built-in reads the built-in's props from the manifest. The spread's dependency is the whole object, so
   the element re-renders when the object changes (an immutable update), which is already how list items work.
   *Open decision:* how the compiler knows which keys the spread object *has*. Either (a) the receiver's props, read
   from the object only where its declared type (an interface the compiler can read, as it does for `useState<T[]>`)
   has them (no checker query, but limited to types written as interfaces), or (b) query the TypeScript 7.1 checker
   for the object's type (exact, and the first checker query in the compiler; DESIGN.md avoided that until now). Decide
   in the first commit; (a) is the default.

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
   passed-children slot: at construction, `Modal` sets its `passedChildrenHost` to wherever `Panel` mounts *its*
   passed children, so the outer parent's `attachPassedChild` lands in the innermost container in one step. Forwarding
   through two levels (Modal → Panel → Flex) must work. A forwarded slot inside a condition stays a diagnostic.

5. **Context** (`createContext`, a provider element, `useContext`). Today: an unknown hook. The proposed shape:
   - `export const TowerContext = createContext<TowerView>(defaultValue)` in a `.ts` file.
   - `<TowerContext value={…}>…</TowerContext>` as the provider (React 19's form; `.Provider` can be an alias), an
     implicit `<Entity>` holding its children.
   - `const tower = useContext(TowerContext)` at the top level of a component, a compiler intrinsic like the other
     hooks.
   - At runtime a consumer finds the nearest provider when it is attached (walking up), and the provider re-renders its
     consumers when `value` changes (by reference, as React does). A consumer with no provider gets the default.
   - The provider's value is a dependency of the consumer's `render()`, like a prop.
   *Open decision:* the provider as an element (above) versus a compile-time-only lowering that threads the value as a
   hidden prop. The element works across files and through passed children, so it is the default.

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

- [ ] `packages/hearth/DESIGN.md` covers the mechanics, the numbers and what "finished" means
- [ ] The game is playable from the title through ten waves to a win or a loss, with mouse, keyboard or gamepad, under
      Node and as a packaged build (headless verification at least; a person plays it in priority 6's spirit)
- [ ] Each Tier 3 item is either built (design section, compiler and runtime tests, used by the game) or recorded as a
      finding saying why the game did not need it; the matching "Not now" rows are removed or updated
- [ ] Input scripts can click, and a wave replay builds towers by clicking and wins
- [ ] Headless tests cover targeting, splash, slow, the economy, leaking, and the balance tool's output
- [ ] The many-sprites bench scenario is in `bench/budget.json`, wave 10's frame time is recorded in `NATIVE_PLAN.md`,
      and finding 9 is closed or updated with numbers
- [ ] A "Findings from the second game" section in `NEXT_PRIORITIES.md`, including which of Kite's findings held a second
      time (rules apart from drawing, effect stores, the router) and which did not
- [ ] `npm run check:hearth`, `npm test`, `npm run typecheck` and the parity test pass

## Open decisions

1. **The name.** "Hearth" is a working title.
2. **How a spread knows its keys** (receiver's props versus a checker query). See "Spread props". Default: the
   receiver's props.
3. **Context's provider form:** an element (`<TowerContext value>`) or a compile-time hidden prop. Default: the element.
4. **Pads or free placement.** Default: pads. Free placement needs a click-to-tile query and path blocking rules, which
   add nothing to what this game is meant to test.
