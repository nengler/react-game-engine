# Swarm: design note

A small survivors-style game, the fourth on the engine. The player walks an endless field; weapons fire on their own; enemies come in
from every side, a few at first and about 2,000 by the end of ten minutes. Kills drop gems, gems give levels, and each level offers three
upgrades.

**Why this game.** Hearth's busiest scene has 109 enemies. A swarm game needs fifteen to twenty times that, all crowded round one
point, so it tests how the engine scales: per-enemy costs, the collision broad phase in a pile, `nearby` asked by every enemy every
step, lists of thousands of items that change every step, and items mounting and unmounting all the time. It is written the obvious
way on purpose: one component per enemy, bolt and gem, each with its own state, and enemies keeping apart by asking `nearby`. What
that costs is the point.

**Not in this game**, on purpose: characters, a shop, saving, stage hazards, chests, evolutions, damage numbers. Music is left out too.

```
npm run play:swarm                                      play it (a window; needs the native build)
SWARM_STRESS=1500 npm run play:swarm                    the stress scene: 1,500 enemies at once (SWARM_ARMED=1: every weapon)
npm run check:swarm                                     compile, type-check, test, parity
node games/swarm/tools/frame-time.ts --count 1500 [--armed]   script time of the stress scene
node games/swarm/tools/frame-time.ts                    script time of the walking replay
```

## How it is built

- `Play` owns the run: where the player is, the clock and the spawner, experience and the build, and the lists of enemies, bolts and
  gems. Each list item is a component with its own state (`Enemy`, `Shot`, `Gem`). Each reports up through a callback when it
  dies, is spent or is taken.
- Enemies get the player's position as props (`px`, `py`) and walk straight at it until they touch the player, so the crowd rings
  the player rather than piling onto one point. Every step, each one asks
  `nearby("enemy", x, y, SPACING)` for the enemies touching it and steps out of half of each overlap. An enemy left more than
  `DESPAWN_RADIUS` behind comes back on the other side of the player.
- Bolts and blades hurt enemies through their colliders (`onCollisionEnter`). The aura is sent to every enemy inside its circle
  (`send`). Contact damage to the player is one `nearby` query from `Play` each step.
- The spawner tops the crowd up to `targetAt(clock)` (`rules/spawn.ts`), at most 40 a step. The stress scene (`Stress.tsx`) is
  `Play` with the clock started at an hour, a cap and a player who cannot be hurt.

## Performance

Script time under Node on a 4-core cloud VM, 2026-11-17, with the game written plainly (see below). The stress scene's player
walks the replay's loop, so the crowd follows and the ground scrolls. "Armed" adds every weapon at its last level, so enemies are
hit, die and are replaced every step. Each number is the best of three 15-second runs. The VM's speed wanders by up to 25 % over
an hour, so the same run timed Hearth's wave 10 as a yardstick: 0.90 ms, against about 1.0 ms on the machine the numbers in
[docs/PLAYER.md](../../docs/PLAYER.md) were taken on. Compare changes A/B in the same window, never against a number written down
earlier.

| Enemies | Median step | 99th percentile | Armed, median | Armed, 99th percentile |
| ------- | ----------- | --------------- | ------------- | ---------------------- |
| 500     | 3.0 ms      | 6.4 ms          | 4.6 ms        | 8.0 ms                 |
| 1,000   | 6.0 ms      | 10.4 ms         | 9.3 ms        | 15.7 ms                |
| 1,500   | 9.3 ms      | 17.3 ms         | 14.8 ms       | 24.3 ms                |
| 2,000   | 14.5 ms     | 26.9 ms         | 18.1 ms       | 31.8 ms                |
| 3,000   | 22.0 ms     | 37.0 ms         | 31.6 ms       | 52.7 ms                |

When this game was first written, 1,500 took about 18 ms without weapons and 22 ms armed, and 1,000 took 21 ms before the first
fixes below (on the same VM, at times when it ran about 1.25 times slower than here). The walking replay (the real game, up to
about 210 enemies) has a median step of 0.9 ms.

**Is 1,500 at 60 Hz there?** Without weapons, yes: 9.3 ms of script, with libtse's drawing on top. Armed, not quite: a median of
14.8 ms fits a 16.7 ms frame, but the slow steps (24 ms at the 99th percentile) do not. Past 2,000 it does not fit. Interpolation
(drawing between steps, on by default in a window) is 1.9 ms of the 9.3: `--no-interpolate` gives 7.5 ms.

### Where a step goes, at 1,500 enemies

From the inspector's profiler (`tools/frame-time.ts --profile`) and CPU profiles, without weapons:

| What | Time | Per enemy |
| --- | --- | --- |
| Enemies' updates, of which about half is `nearby` | 4.5 ms | 3 µs |
| Renders and committing state (each enemy re-renders every step: it moved) | 1.6 ms | 1 µs |
| `Play`'s render: its list of 1,500 enemies, each given the player's position | 1.0 ms | 0.7 µs |
| The draw walk for collisions, then the collision tracker | 1.9 ms | 1.3 µs |
| The draw walk again, between steps (interpolation), and saving and blending transforms | 1.9 ms | 1.3 µs |

Nothing is over 10 % of a step on its own any more. What is left is the price of an enemy in this engine: three objects (the
component's entity, its sprite, its collider), each visited by the update order, the renders, two draw walks a frame, the collision
tracker and the interpolator, and a `nearby` query. The draw walk's hottest lines are the first read of each object's fields,
so the walk is limited by memory latency, not by what it computes.

### What Swarm found, and what was fixed

Engine, in the order found:

1. **A list item's live prop read searched the whole list** (quadratic). Reading `px` in `<Enemy key={e.id} {...e} px={s.px} />`
   found the item with `findIndex` on every read: 25 % of a step at 2,000 enemies. The generated module now keeps a map of each
   list array's keys (`$indexOfKey`). A prop written after every spread has a getter of its own.
2. **`nearby` registered every result in a `WeakMap`**, so `send` could find its collider: about 200 times what making the result
   cost, and every result lived past the young generation. A result now carries its collider in a private field.
3. **`nearby` made garbage for every candidate it looked at** (a bounds object, an entry with its distance, a sort with a closure),
   and 32-pixel cells under 10-pixel enemies made it look at fifty entries to find four. It is one pass into reused arrays, sorted
   by insertion, on cells sized to the boxes (16 to 64 pixels). Making the index composed each collider's transform up the whole
   tree; ancestors' spaces are now remembered while the boxes are worked out.
4. **`Math.hypot` is about four times slower than `Math.sqrt(dx * dx + dy * dy)` in V8** (38 against 9 ns). `distanceToBox` used it
   for every candidate.
5. **A keyed list did all its bookkeeping on every render**: a set of keys for duplicates, a scan for removed items, a reorder
   check, an `entries()` iterator, and `Object.keys` in `applyProps` for every item. A list whose keys are the same as last render
   skips the bookkeeping; the loop is indexed, and `applyProps` uses `for…in`.
6. **A changed list sorted all of its parent's children**, and **the order handlers run in was made again with two set lookups for
   every object**, on every step that anything mounted or unmounted. A reorder now writes the slot's run in place, and which
   hooks an object has is a field on it (`worldHandlers`).

7. **A `nearby` query read memory that was not in the cache, and guessed wrong about every box.** After 3, a query still looked at
   twenty colliders to find three. Each was an object with its box another object, in every cell its box touched, and marked as
   seen so it was taken once; working out its distance branched on which side of the point it was, which a processor cannot
   guess. `within` alone was 18 % of a step. A collider is now in one cell, the one its middle is in, and a query looks a
   half-box wider; the boxes' edges are in one array in cell order, a row of cells is one run of it, and one test with one
   branch drops what is out of reach before any distance is worked out. Colliders much larger than the rest go on a coarser grid
   of their own. A result's `owner` (a walk up the tree) is worked out once per collider a step, not once per result, and making
   the index no longer keeps a map entry for every collider and every enemy's entity. On a fixed crowd of 1,500, a query went
   from about 1,100 to 450 ns and making the index from 0.5 to 0.2 ms.

8. **Drawing between steps walked the whole tree to find what had moved.** The interpolator's `blend` visited every object, three an
   enemy, to move one. The capture after each step now lists the objects whose own transform changed, and `blend` reads the list:
   0.42 to 0.18 ms a frame at 1,500 enemies. The capture (0.44 ms) and putting the transforms back (0.09 ms) are as they were.

9. **Reading a prop in a handler cost an enemy about 0.6 µs, three times its own arithmetic.** An enemy reads `px` and `py` once
   each in its update, and each read went through four things: an object of getters (`this.$live.px`), `GameObject.liveProp`
   (one function for every component and every prop, so V8 could not settle on what `getters[name]` held or what it called), the
   parent's getter, and there a `WeakMap` and two `Map` lookups to find the item by its key. A CPU profile put 4 % of a step
   on the `px` line; reading `this.props.px` there took 0.9 ms off a 7.8 ms step. Two changes, each worth about half. The
   component has a getter of its own for each prop (`this.$live_px`), which reads the parent's getter by name. A list item's
   getters share `$at`, where the item was at the last read, and look there before asking `$indexOfKey`. Remembering the place
   had been tried alone before, and an A/B showed nothing; one comparison, with the generic read still in front of it.

Measured A/B on 9 (2026-11-17, medians, old then new in turn, only `Enemy` and `Play` changed between them): 1,500 enemies 7.9
to 6.9 ms, armed 12.6 to 11.2.

Measured A/B on the same game, the engine before and after 7 (2026-11-17, medians, old then new in turn): 1,000 enemies 5.5 to
4.7 ms, 1,500 about 9.3 to 7.9, 1,500 armed about 14 to 12.9, 3,000 about 21.8 to 17. The table above was taken before 7.

Measured A/B on the same game, the engine before and after 3 to 6: 14.0 to 11.0 ms without weapons, 19.0 to 16.3 ms armed. Before
that, 1 and 2 took 2,000 enemies from 38 to 24 ms.

The game, and what it says about writing one:

10. **A crowd piles up unless separation is stronger than walking.** Every enemy walks at the player's middle. With a push as a
   speed (40 px/s, at most four neighbours), the crowd behind always won: one 32-pixel cell held 169 enemies and thirty stood on
   one pixel, and every `nearby` in the pile looked at all of them. Stopping at the player and stepping out of each overlap keeps
   the busiest cell under fifty. It is the largest single change here (15 to 11 ms). It is kept because the pile was wrong to
   look at (a blob, enemies stacked on one pixel), not for speed; the engine's cost follows the crowd's density either way.

**Swarm is written plainly, on purpose.** It is the engine's test, so it does what a person writing the game would do: every enemy
separates every step, and distances are `Math.hypot`. Making the game do less to hide what the engine costs measures nothing. The
numbers above are for the game written that way; speed comes from the engine.

### Tried, and not kept

- **Workarounds in the game**: separating every other step (half the crowd each step) and `Math.sqrt(dx * dx + dy * dy)` for
  `Math.hypot` were together about 1.5 ms at 1,500 enemies. Both were taken out again: see "Swarm is written plainly".

- **An index of keys that survives removals** (looking a few places left of where the item was, before making the map again):
  no difference.
- **Telling the draw walk that only a parent's children changed** (`markChildrenChanged`, so a list in which one enemy died copies
  the rest's draw records instead of writing them again): 0.5 ms slower. For an enemy that is one sprite and one collider,
  copying its records is no cheaper than writing them.
- **16-, 12- and 8-pixel cells against 32** on a fixed crowd: 16 was best, smaller was no better; the index now picks the size.

- **A `limit` on `nearby`** (not built): a query here finds 3.1 colliders on average at 1,500 enemies and 4.5 at 3,000, and nine
  in ten find six or fewer, which is all an enemy uses. There is nothing for a limit to cut; the cost was the twenty looked at to
  find them (7 above).
- **Cells of 8 and 4 pixels** under the new index, against 16: within the VM's noise on the crowd, and 4-pixel cells made a
  query over 200 spread-out colliders four times slower. The rule for the cell's side is unchanged.

### Collisions without a draw walk (done, worth less than hoped)

With interpolation on, every step used to build the whole frame only to find where the colliders are, keep none of what it drew, and
build it again between steps. `FrameBuilder.colliders` now places the colliders without drawing anything (see docs/PLAYER.md).
Estimated at 1 to 1.5 ms at 1,500 enemies; measured A/B, 0.1 to 0.6 ms without weapons, 0.3 to 1.0 ms armed, and Hearth's wave
10 from about 0.94 to 0.86 ms. A walk that only places colliders still costs about 60 % of a build: it visits the same objects,
and the walk is limited by reading them, not by drawing them. That is the lesson for what is left: a pass over the object tree
costs about the same whatever it does, so the remaining gains are in visiting fewer objects, not in doing less at each.

### What would close the rest

- **A data-oriented crowd**: one component drawing every enemy from arrays (as Hearth's backlog suggests for health bars). It is
  not how this engine asks for games to be written, which is why Swarm does not do it, but it is how a game of 5,000 would.
