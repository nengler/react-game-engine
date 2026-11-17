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
- Enemies get the player's position as props (`px`, `py`) and walk straight at it. Each one asks `nearby("enemy", x, y, SPACING)`
  for the enemies touching it and steps away from up to four of them. An enemy left more than `DESPAWN_RADIUS` behind comes back
  on the other side of the player.
- Bolts and blades hurt enemies through their colliders (`onCollisionEnter`). The aura is sent to every enemy inside its circle
  (`send`). Contact damage to the player is one `nearby` query from `Play` each step.
- The spawner tops the crowd up to `targetAt(clock)` (`rules/spawn.ts`), at most 40 a step. The stress scene (`Stress.tsx`) is
  `Play` with the clock started at an hour, a cap and a player who cannot be hurt.

## Performance

Script time under Node on a 4-core cloud VM (2026-11-17, about 1.25 times slower than the machine the numbers in
[docs/PLAYER.md](../../docs/PLAYER.md) were taken on). The stress scene's player walks the replay's loop, so the crowd follows and
the ground scrolls; "armed" adds every weapon at its last level, so enemies die and are replaced all the time.

| Enemies | Mean | 99th percentile | Armed, mean |
| ------- | ---- | --------------- | ----------- |
| 500     | 4.5 ms | 8.4 ms | 5.8 ms |
| 1,000   | 10.1 ms | 16.1 ms | 12.8 ms |
| 1,500   | 18.3 ms | 33.6 ms | 21.7 ms |
| 2,000   | 27.5 ms | 48.6 ms | 36.9 ms |
| 3,000   | 51.0 ms | 93.5 ms | 56.0 ms |

The walking replay (the real game, up to about 130 enemies before the scripted player dies) runs at a mean of 0.9 ms.

So 1,500 does not fit a 60 Hz frame yet. It grows faster than the count because a bigger crowd is a denser one: each `nearby`
query finds more neighbours in its cells.

### What Swarm found, and what was fixed

1. **A list item's live prop read searched the whole list.** A handler reading a prop of a keyed list item (`px` in
   `<Enemy key={e.id} {...e} px={s.px} />`) found the item again with `findIndex` on every read. With every enemy reading `px` and
   `py` every step, that was quadratic: 25 % of a step at 2,000 enemies. The generated module now indexes a list's keys once per
   array (`$indexOfKey`). A prop written after every spread also gets its own getter, so reading `px` does not build the item's
   whole props object.
2. **`nearby` paid for every result as if it would be sent.** Each result was registered in a `WeakMap` so `send` could find its
   collider: about 200 times what making the result cost. That alone was 18 % of a step with 1,000 enemies separating. Results
   are now kept in plain arrays for the step they were found in (and the next), and go into the `WeakMap` only when sent. Each
   index entry also remembers which component owns its collider, instead of walking up the tree on every query.

Measured on the same game with only those engine changes reverted: 1,000 enemies went from 12.3 to 9.2 ms, and 2,000 from 38.3
to 24.2 ms.

3. **Separation reach is easy to get wrong.** `nearby` measures to the edge of a box, not its middle, so a reach of 7 pixels found
   eleven neighbours per query in a crowd. Two pixels finds the ones touching. That was a game fix (`SPACING`), but the docs for
   `nearby` could say it.

### Where the rest goes

At 2,000 enemies no single function is over 10 % of the step. The cost is spread across the per-enemy work: the `nearby` grid
query, the enemy's update (state written through the generated setters), building draw records, the collision tracker, and saving
and blending transforms for interpolation. What could close the gap to 1,500 at 60 Hz, in the order to try them:

- A `limit` on `nearby`: an enemy wants its four nearest, but every result in reach is made and sorted.
- Separation every other step, by id, in the game: half the queries, and nobody would see the difference.
- Cheaper writes for state that changes every step (`s.x += …` goes through a setter that marks the component dirty).
