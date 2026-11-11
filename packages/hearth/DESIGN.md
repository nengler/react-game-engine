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
- The rules are tested without the engine (`test/rules.test.ts`): path following, targeting, damage, splash, slow, spawning, the
  economy, leaking, winning and losing.
- The balance table (`test/balance.expected.json`) says the waves are meant to be hard in the way described below, and a test fails
  if a number changes it.
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

## Controls

All through `createControls` and `<Game controls>` (`rules/controls.ts`), and one path: every key and click calls a game-state action.

- **Mouse:** click a pad (empty or built) to select it; the panel shows the build menu or the upgrade panel; the buttons in the panel are
  clicks too. The range ring shows for the selected tower and for the tower the mouse is over (`onPointerEnter` / `onPointerLeave`).
- **Keyboard and gamepad:** the pads are focusable, so the arrows or d-pad move the focus (the cursor) to the nearest pad in that direction
  and `Z` / `A` presses the focused one (it opens the panel), as a click does; `X` / `B` closes it (`Play`'s one `useInput`). Every button
  owns its key (`pressKey`): `1` `2` `3` buy a bolt, mortar or frost tower while the build menu shows, `U` upgrades and `S` sells while
  the upgrade panel shows, `Space` / `Y` starts the next wave, `F` toggles 2× speed, `Esc` / Start pauses and resumes. A button's label
  names its key from the bindings (`keyLabel("wave")`).

## How it is built

The shape Kite settled on, used a second time on purpose:

```
src/rules/     plain TypeScript, no engine: the whole simulation
  battle.ts    stepBattle(battle, dt, commands, map) → { battle, events }: the one entry point
  path.ts      the polyline and the markers; position-at-distance
  targeting.ts, towers.ts, enemies.ts, waves.ts, economy.ts, rng.ts
  view.ts      what the panel reads about the cursor's pad (focusOf), a tower's range
  controls.ts  the action map, and keyLabel(action) for the buttons' labels
  map.ts       the one map, read from the generated tilemap
src/GameState.ts   screen, battle, cursor, panel, speed, pause; the actions the buttons and pads call; `step(dt)` is the one place a step is taken
src/theme.ts       the colours and icon frames, by name
src/effects.ts     particle and sound stores; playEvents(events)
src/*.tsx          Main, Title, Play, End, Field, Pad, Tower, Barrel, RangeRing, LevelPips, MuzzleFlash,
                   Enemy, HealthBar, Shot, SidePanel, StatRow, BuildMenu, BuildOption, UpgradePanel, MenuButton, Modal, Panel, Label, Icon
```

`stepBattle` takes the battle (enemies, pads with their towers, shots, gold, lives, the wave, the spawner's clock, the seed) and the
commands of this step (build, upgrade, sell, start a wave), and returns the next battle and the step's events (`shot`, `hit`, `killed`,
`leaked`, `built`, `waveCleared`, `denied`, …), which the game state hands to `effects.ts` for sounds and particles. At 2× speed `step` runs
the rules twice per engine step. The game state holds the battle as one object, replaced every step; components select what they draw.

The component tree: `Main` (`<Game>`, `<Screen>`, `<Router>` on a `screen` leaf, `<Music>`) → `Title`, `Play`, `End` (won or lost, a `Modal`).
`Play` draws the field, then `pads.map((p) => <Pad key={p.id} {...p} />)` (a `Pad` takes the focus and the press, shows the cursor, and its
`Tower` when it has one, which only draws), `enemies.map(…)`, `shots.map(…)`, the particle layer,
and a `<Hud>` holding the `SidePanel` and, while paused, a `Modal` whose children are two buttons.

## Which engine features it uses

Written first the React way; each Tier 3 gap it hit is recorded in [docs/NEXT_PRIORITIES.md](../../docs/NEXT_PRIORITIES.md), "Findings from
the second game".

| Feature | Where | State |
| --- | --- | --- |
| Spread props | `<Enemy key={e.id} {...e} />`, `<Shot {...s} />` (a `Tower` takes named props: spreading the whole tower passed its `cooldown`, which changes every step while it fires, so every firing tower re-rendered every step) | built |
| Conditional inside a list's map | `pads.map((p) => p.tower ? <Tower/> : <EmptyPad/>)`, `shots.map((s) => s.live && <Shot/>)` | built |
| Forwarding `{children}` | `Modal` → `Panel` → its column | built |
| Children on list items | `TOWER_LIST.map((d) => <MenuButton …><Icon/><Label/></MenuButton>)` | built (flat children only) |
| Context | one value per tower for `Barrel`, `RangeRing`, `LevelPips`, `MuzzleFlash` | **not built, not needed**: each takes two or three props from `Tower` |
| Computed selectors | `useGame((s) => s.cursor === id)` in `Tower`/`EmptyPad`, `useGame((s) => focusOf(s.battle, s.cursor))` in `UpgradePanel` | built after review |
| Constants and index reads in components | `ROW[kind] * 3 + level` in `Tower`, `ICON[d.kind]` in `BuildMenu`, `WALKS` in `Enemy`, `Math.PI` in `Shot` | built after review |
| A component as the root | `BuildMenu` and `UpgradePanel` return `<Panel>`; `MuzzleFlash` returns `on ? <Sprite/> : null` | built after review |
| Functions passed whole | `onPress={resume}`, `onPress={startWave}`; `MenuButton`'s `<Flex onPress={onPress}>` | built after review |

## Performance

Wave 10 on the road: 109 enemies, 14 towers. Script time per step (the rules twice at 2× speed, the tree, the draw list; no drawing),
`tools/frame-time.ts`: Node/V8 mean 1.0 ms (p99 2.7, slowest 7); QuickJS-ng mean 6.7 ms (p99 15, slowest 24). The rules are 0.1 ms (V8) and
0.5 ms (QuickJS) of a step; the rest is 109 enemy components each re-rendered every step because they move. Inside a 16.7 ms frame at the
mean, close to it at the 99th percentile on QuickJS. See NATIVE_PLAN.md.
