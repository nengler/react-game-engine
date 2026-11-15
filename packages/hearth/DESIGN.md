# Hearth: design note

A small tower defense, the second game on the engine. Enemies walk one fixed road from the left edge to the hearth on the right;
the player builds towers on marked pads beside it, upgrades and sells them, and starts each of ten waves with a button.

**Why this game.** Kite is one character in one-screen rooms: no lists of things that come and go, no menus, no deep trees. A tower
defense is the opposite shape: dozens of enemies, towers and shots as keyed lists, a side panel and modals, and the same small pieces
(a button, a panel, a stat row) used in many places. It is written the React way on purpose, so the compiler's gaps are hit for a
real reason; spread props, conditionals inside a list's `.map`, children on list items and forwarding `{children}` were built
because Hearth hit them. It is also the engine's many-sprites load: wave 10 is the busiest scene of the three games (see
"Performance").

**Not in this game**, on purpose: more than one map, pathfinding or free placement (pads keep the cursor simple and keep placement
rules out of what the game tests), flying enemies, tower abilities, saving, settings or rebinding, an endless mode.

```
npm run play:hearth     play it (a window; needs the native build)
npm run check:hearth    compile, type-check, test, parity
node packages/hearth/tools/balance.ts [--write]   the balance table
```

## What "finished" means

- Playable from the title through ten waves to a win or a loss, by mouse, keyboard or gamepad (`test/replays.test.ts` plays it by
  clicks and keys: a good build wins with lives left, a thin one loses, the pause menu works).
- The battle is tested as components, without a window (`test/battle.test.ts`, `@tsengine/testing`): an enemy walking, taking a
  blast, slowed, dying and getting through; a tower aiming, firing on its cooldown, a mortar's scatter and a frost pulse; a shell
  landing; and `Play`'s economy, waves, rewards, leaks and loss. The data and helpers (map, path, generator, wave tables, the
  towers' numbers, targeting) have plain tests (`test/data.test.ts`).
- The balance table (`test/balance.expected.json`) says the waves are meant to be hard in the way described below, and a test fails
  if a number changes it. `tools/balance.ts` plays `Play` headless, pressing what a player presses.
- Original art, sound and music, made in code by `tools/make-assets.ts` and `tools/make-map.ts`.

It is **not** finished as a game a person has played: nobody has played it in a real window, so the numbers are a first pass set by the
balance tool alone, and nothing about how it feels is known.

## Mechanics

**Screen and map.** 320 × 180. The left 240 × 180 is the field (24 × 18 tiles of 10 px) drawn from `scenes/field.tmj`: a `Tiles` layer
and a hidden `Markers` layer (the spawn, the path's corners in order, the hearth, a marker on each of 18 build pads). `rules/path.ts`
reads the markers into a polyline (`Path`: position and direction at a distance) and a list of pads in reading order. The right 80 × 180 is
the side panel, a `<Flex>` on the `<Hud>`; the field and the panel never overlap, so a click on the panel is never also a click on a pad.

**Towers** (`rules/towers.ts`). A tower targets the enemy in range that is furthest along the path (ties go to the lower id). Two upgrade
levels cost 60 % then 100 % of the base price and add 40 % damage and 10 % range each. Selling returns 70 % of everything spent.

| Tower | Cost | Range | Fires every | Does |
| --- | --- | --- | --- | --- |
| Bolt | 50 | 40 px | 0.4 s | 6 damage to one enemy |
| Mortar | 80 | 55 px | 1.6 s | 18 damage within 14 px, after a 0.5 s flight, landing where the target was (3 px of scatter) |
| Frost | 60 | 35 px | 1.0 s | 2 damage and a 40 % slow for 1.5 s to everything in its range |

**Enemies** (`rules/enemies.ts`). HP grows by 20 % of its base each wave (wave 10 is 2.8×).

| Enemy | HP | Speed | Gold | Lives it takes |
| --- | --- | --- | --- | --- |
| Runner | 14 | 40 px/s | 2 | 1 |
| Grunt | 30 | 25 px/s | 3 | 1 |
| Brute | 120 | 14 px/s | 8 | 3 |

Each enemy gets a sideways lane offset of up to 3 px from the seeded generator (`rules/rng.ts`), so a crowd is not one line.

**Waves** (`rules/waves.ts`). Ten hand-written tables of groups (kind, count, gap, delay). The player starts with 120 gold and 20 lives,
starts each wave with a button, gets 15 gold for clearing one, loses when the lives reach 0 and wins by clearing wave 10. Wave 10 has
136 enemies and, against the good build, 109 are on the road at once at the busiest moment.

**The numbers were set by the balance tool** (`tools/balance.ts`): the first guesses (HP growing 15 % a wave, rewards twice these)
let eighteen bolt towers lose no lives at all. The table now reads: a mixed build (bolts, mortars and frost on the best pads, then upgrades) wins wave 10 with lives left; the
same money in bolts alone runs out in wave 10; three towers lose in wave 5.

**How much luck is in it.** The early waves are close for the mixed build: whether its first mortar's shells land decides whether
it ever catches up. It wins on seven seeds of eight. The table is seed 1's (`<Play seed>`): the mixed build wins with 8 lives.

## Controls

All through `createControls` and `<Game controls>` (`rules/controls.ts`). The pads call game-state actions (the cursor is shared
by the pads and the side panel); the side panel's buttons call `Play`'s functions, which it passes down.

- **Mouse:** click a pad (empty or built) to select it; the panel shows the build menu or the upgrade panel; the buttons in the panel are
  clicks too. The range ring shows for the selected tower and for the tower the mouse is over (`onPointerEnter` / `onPointerLeave`).
- **Keyboard and gamepad:** the pads are focusable, so the arrows or d-pad move the focus (the cursor) to the nearest pad in that direction
  and `Z` / `A` presses the focused one (it opens the panel), as a click does; `X` / `B` closes it (`Play`'s one `useInput`). Every button
  owns its key (`pressKey`): `1` `2` `3` buy a bolt, mortar or frost tower while the build menu shows, `U` upgrades and `S` sells while
  the upgrade panel shows, `Space` / `Y` starts the next wave, `F` toggles 2× speed, `Esc` / Start pauses and resumes. A button's label
  names its key from the bindings (`keyLabel("wave")`).

## How it is built

The game is in its components, as the README's `Player` keeps its own `health`: each enemy, tower and shot keeps its own state
(`useMutable`) and steps itself in `useUpdate`. (Until 2026-11-13 the whole simulation was one plain function, `stepBattle`, and the
components only drew what it returned; moving it into components is what the engine's `useBody`, contacts that carry data and
`<Game timeScale paused>` were built for.)

```
src/Play.tsx       the battle: the gold, the lives, the wave and its spawner, the towers bought on each pad, the lists of
                   enemies and shots; build, upgrade, sell and startWave, which the side panel's buttons call
src/Enemy.tsx      walks the path (slower while frosted), takes what lands on it, reports when it dies or gets through
src/Tower.tsx      cools down, finds the enemies near it (`overlapping("enemy")`), aims at the one furthest along, fires
src/Shot.tsx       flies, then lands as a `blast` collider for one step
src/Pad.tsx        a place to build: the focus, the press, the cursor, and its Tower
src/battle.ts      the shapes they hand each other (Foe, Built, Fired), and what their colliders carry (`ColliderData`)
src/GameState.ts   what the screens share: the screen, the cursor, the speed, the pause, how the last battle ended
src/rules/         data and pure helpers: the towers', enemies' and waves' numbers, the path, the map, the generator,
                   targeting (`pickTarget`), the controls
src/effects.ts     particle and sound stores, called from the components' handlers
src/*.tsx          Main, Title, End, Field, Barrel, RangeRing, LevelPips, MuzzleFlash, HealthBar, SidePanel, SlideIn, StatRow,
                   BuildMenu, UpgradePanel, MenuButton, Modal, Panel, Label, Icon
```

**How the pieces talk.** Down by props, up by callbacks, and across by collisions:

- `Play` draws `s.enemies.map((e) => <Enemy key={e.id} {...e} onKilled={killed} onLeaked={leaked} />)`, `MAP.pads.map(…)` (each
  `Pad` holds its `Tower` under `{tower !== null && …}`) and `s.shots.map(…)`. An enemy calls `onKilled(id, kind, x, y)` (Play adds
  its gold and drops it from the list) or `onLeaked`; a tower calls `onFire(shot)` (Play adds a `Shot`); a shot calls `onLanded(id)`.
  Each writes `Play`'s lists directly (`s.enemies = s.enemies.filter(…)`); a handler reads its own writes, so several reports in one
  step add up.
- An enemy's collider carries `data={{ id, dist, x, y, hp }}`; a tower asks its body which enemy colliders overlap its reach and
  picks from their data. A shot lands as a collider tagged `blast` carrying `{ target, x, y, radius, damage, slow }`; each enemy
  it touches decides whether it was hit (a bolt hits its target only, a shell or a pulse everything within its radius).
- The side panel is `Play`'s child: it gets the numbers and `onBuild`, `onUpgrade`, `onSell`, `onStartWave` as props.
- 2× speed and the pause are `<Game timeScale={speed} paused={paused}>`: two whole steps a frame, or none.

**Timing.** Updates run in tree order, and collisions are reported after the step's updates ([DESIGN.md](../../docs/DESIGN.md),
"Sharing state between components"), so a blast that lands in one step is felt by the enemies at the end of it. All of it repeats
exactly.

**Seeds.** `<Play seed>` (default 1) seeds the enemies' lanes, and each pad's tower's mortar scatter (`seed * 101 + pad`).

## Which engine features it uses

What it was written to exercise, and where:

| Feature | Where |
| --- | --- |
| Spread props | `<Enemy key={e.id} {...e} onKilled={killed} />`, `<Shot key={shot.id} {...shot} onLanded={landed} />` |
| State in the components that own it | `Enemy` (`dist`, `hp`, `slow`, `flash`), `Tower` (`cooldown`, `angle`, `flash`, its scatter seed), `Shot` (`t`), `Play` (the battle) |
| Contacts that carry data | an enemy's position for the towers, a blast's damage for the enemies |
| A body that asks what is near | `Tower`: `useBody` as big as its reach, `overlapping("enemy")` |
| Fast-forward and pause | `<Game timeScale={speed} paused={paused}>` |
| Forwarding `{children}` | `Modal` → `Panel` → its column |
| Children on list items | `TOWER_LIST.map((d) => <MenuButton …><Icon/><Label/></MenuButton>)` |
| Computed selectors | `useGame((s) => s.cursor === id)` in `Pad` |
| Constants and index reads in components | `ROW[kind] * 3 + level` in `Tower`, `ICON[d.kind]` in `BuildMenu`, `WALKS` in `Enemy`, `Math.PI` in `Shot` |
| A component as the root | `BuildMenu` and `UpgradePanel` return `<Panel>`; `MuzzleFlash` returns `on ? <Sprite/> : null` |
| Functions passed whole | `onPress={resume}`, `onPress={startWave}`; `MenuButton`'s `<Flex onPress={onPress}>` |

Context is not used: one value per tower would suit `Barrel`, `RangeRing`, `LevelPips` and `MuzzleFlash`, but the trees are shallow
and props were enough.

## Performance

Wave 10 on the road: 109 enemies, 13 towers, at 2× (the replay's speed). Script time per frame (two steps: the tree, the collisions,
the draw list; no drawing), `tools/frame-time.ts`:

| | Node/V8 mean | p99 | QuickJS-ng mean | p99 |
| --- | --- | --- | --- | --- |
| Two whole steps (2×) | 1.58 ms | 4.9 | 13.2 ms | 32.3 |

109 enemy components re-render each step. 2× steps the whole world twice (two renders, two collision passes, two tree walks a frame),
so at 1× it is well inside a 16.7 ms frame on QuickJS; at 2× its mean is, its 99th percentile is not. The colliders' world boxes are
cached per update phase for the towers' queries (QuickJS was 19.2 ms mean without). Measured 2026-11-13, before the later
QuickJS work (#137); not measured since.
