# Hearth: design note

A small tower defense, the second game on the engine (the plan is [docs/TOWER_DEFENSE_PLAN.md](../../docs/TOWER_DEFENSE_PLAN.md)).
Enemies walk one fixed road from the left edge to the hearth on the right; the player builds towers on marked pads beside it,
upgrades and sells them, and starts each of ten waves with a button. It is written the React way on purpose: lists, menus, and the
same small pieces (a button, a panel, a stat row) used in many places.

```
npm run play:hearth     play it (a window; needs the native build)
npm run check:hearth    compile, type-check, test, parity
node packages/hearth/tools/balance.ts [--write]   the balance table
```

## What "finished" means

- Playable from the title through ten waves to a win or a loss, by mouse, keyboard or gamepad (`test/replays.test.ts` plays it by
  clicks and keys: a good build wins with lives left, a thin one loses, the pause menu works).
- The battle is tested as components, without a window (`test/battle.test.ts`, `@rge/testing`): an enemy walking, taking a
  blast, slowed, dying and getting through; a tower aiming, firing on its cooldown, a mortar's scatter and a frost pulse; a shell
  landing; and `Play`'s economy, waves, rewards, leaks and loss. The data and helpers (map, path, generator, wave tables, the
  towers' numbers, targeting) have plain tests (`test/data.test.ts`).
- The balance table (`test/balance.expected.json`) says the waves are meant to be hard in the way described below, and a test fails
  if a number changes it. `tools/balance.ts` plays `Play` headless, pressing what a player presses.
- Original art, sound and music, made in code by `tools/make-assets.ts` and `tools/make-map.ts`.

It is **not** finished as a game a person has played: nobody has played it in a real window, so the numbers are a first pass set by the
balance tool alone, and nothing about how it feels is known (priority 6's spirit).

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

**Numbers that differ from the plan's first guess**, set by the balance tool (`tools/balance.ts`): HP grows 20 % a wave (not 15 %),
and gold rewards are half the plan's (runner 2, grunt 3, brute 8), because with the first numbers eighteen bolt towers lost no lives
at all. The table now reads: a mixed build (bolts, mortars and frost on the best pads, then upgrades) wins wave 10 with lives left; the
same money in bolts alone runs out in wave 10; three towers lose in wave 5.

**How much luck is in it** (found 2026-11-13, rewriting the battle as components). The early waves are close for the mixed build:
whether its first mortar's shells land decides whether it ever catches up. With the old rules the mixed build won on six of eight
seeds and lost wave 5 or 6 on the other two; the components roll the same dice differently (each tower keeps its own scatter seed)
and it wins on seven of eight. The table is seed 1's (`<Play seed>`): the mixed build wins with 8 lives (the old seed 1 kept 15).

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

Since 2026-11-13 the game is in its components ([REACT_FEEL_PLAN.md](../../docs/REACT_FEEL_PLAN.md), A7), as the README's `Player`
keeps its own `health`. Before, the whole simulation was one plain function, `stepBattle(battle, dt, commands)` in `rules/`, and
the components drew what it returned.

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
src/*.tsx          Main, Title, End, Field, Barrel, RangeRing, LevelPips, MuzzleFlash, HealthBar, SidePanel, StatRow, BuildMenu,
                   UpgradePanel, MenuButton, Modal, Panel, Label, Icon
```

**How the pieces talk.** Down by props, up by callbacks, and across by collisions:

- `Play` draws `enemies.map((e) => <Enemy key={e.id} {...e} onKilled={killed} onLeaked={leaked} />)`, `pads.map(…)` and
  `shots.map(…)`. An enemy calls `onKilled(id, kind, x, y)` (Play adds its gold and drops it from the list) or `onLeaked`; a tower
  calls `onFire(shot)` (Play adds a `Shot`); a shot calls `onLanded(id)`. Each updates `Play`'s lists with updaters
  (`setEnemies((list) => list.filter(…))`), as many report in one step.
- An enemy's collider carries `data={{ id, dist, x, y, hp }}`; a tower asks its body which enemy colliders overlap its reach and
  picks from their data. A shot lands as a collider tagged `blast` carrying `{ target, x, y, radius, damage, slow }`; each enemy
  it touches decides whether it was hit (a bolt hits its target only, a shell or a pulse everything within its radius).
- The side panel is `Play`'s child: it gets the numbers and `onBuild`, `onUpgrade`, `onSell`, `onStartWave` as props.
- 2× speed and the pause are `<Game timeScale={speed} paused={paused}>`: two whole steps a frame, or none.

**Timing.** Every update of a step sees the state as the step began, and collisions are reported after the step's updates
([DESIGN.md](../../docs/DESIGN.md), "Sharing state between components"). So an enemy hit at the end of a step reports its death in
the next one, and `Play` sees the list empty (the wave cleared) the step after that. All of it repeats exactly.

**Seeds.** `<Play seed>` (default 1) seeds the enemies' lanes, and each pad's tower's mortar scatter (`seed * 101 + pad`).

## Which engine features it uses

Written first the React way; each Tier 3 gap it hit is recorded in [docs/NEXT_PRIORITIES.md](../../docs/NEXT_PRIORITIES.md), "Findings from
the second game".

| Feature | Where | State |
| --- | --- | --- |
| Spread props | `<Enemy key={e.id} {...e} onKilled={killed} />`, `<Shot key={s.id} {...s} onLanded={landed} />` | built |
| State in the components that own it | `Enemy` (`dist`, `hp`, `slow`, `flash`), `Tower` (`cooldown`, `angle`, `flash`, its scatter seed), `Shot` (`t`), `Play` (the battle) | built (A7) |
| Contacts that carry data | an enemy's position for the towers, a blast's damage for the enemies | built (A3, used here) |
| A body that asks what is near | `Tower`: `useBody` as big as its reach, `overlapping("enemy")` | built (A7) |
| Fast-forward and pause | `<Game timeScale={speed} paused={paused}>` | built (A7) |
| Conditional inside a list's map | `pads.map((p) => p.tower ? <Tower/> : <EmptyPad/>)`, `shots.map((s) => s.live && <Shot/>)` | built |
| Forwarding `{children}` | `Modal` → `Panel` → its column | built |
| Children on list items | `TOWER_LIST.map((d) => <MenuButton …><Icon/><Label/></MenuButton>)` | built (flat children only) |
| Context | one value per tower for `Barrel`, `RangeRing`, `LevelPips`, `MuzzleFlash`; the battle's numbers for the side panel | built (C3), **not used**: the side panel is two levels below `Play`, and props were enough |
| Computed selectors | `useGame((s) => s.cursor === id)` in `Pad` | built after review |
| Constants and index reads in components | `ROW[kind] * 3 + level` in `Tower`, `ICON[d.kind]` in `BuildMenu`, `WALKS` in `Enemy`, `Math.PI` in `Shot` | built after review |
| A component as the root | `BuildMenu` and `UpgradePanel` return `<Panel>`; `MuzzleFlash` returns `on ? <Sprite/> : null` | built after review |
| Functions passed whole | `onPress={resume}`, `onPress={startWave}`; `MenuButton`'s `<Flex onPress={onPress}>` | built after review |

## Performance

Wave 10 on the road: 109 enemies, 13 towers, at 2× (the replay's speed). Script time per frame (two steps: the tree, the collisions,
the draw list; no drawing), `tools/frame-time.ts`:

| | Node/V8 mean | p99 | QuickJS-ng mean | p99 |
| --- | --- | --- | --- | --- |
| The rules in `stepBattle` (before 2026-11-13): the rules twice, the tree once | 0.96 ms | 2.2 | 7.6 ms | 17.1 |
| The battle in components: two whole steps | 1.58 ms | 4.9 | 13.2 ms | 32.3 |

A step costs about what the old frame did (QuickJS 6.6 ms against 7.6): 109 enemy components re-render each step either way. What
doubled is 2×, which now steps the whole world twice (two renders, two collision passes, two tree walks a frame) where the old game
ran its rules twice and its tree once. At 1× it is inside a 16.7 ms frame on QuickJS; at 2× its mean is, its 99th percentile is not.
The colliders' world boxes are cached per update phase for the towers' queries (QuickJS was 19.2 ms mean without). See
NEXT_PRIORITIES.md, "Findings from Hearth in components".
