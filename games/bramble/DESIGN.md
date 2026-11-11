# Bramble: design note

A small top-down adventure, the third game made on the engine and the first made from outside it (see
[`docs/ADVENTURE_PLAN.md`](../../docs/ADVENTURE_PLAN.md)). This is the greybox of milestone M1: the rules and the screens, with
shapes instead of art. Numbers marked *(guess)* have not been played.

## Premise and finish

A walled valley has gone quiet. Find three bells (a cave, an old house, a hedge maze) and ring them at the gate in the north.
**Finished** means: the character carries three bells and steps onto the gate (`run.done`, the end screen).

## The chain

```
lantern (valley) ──opens──▶ cave ──▶ key, bell ①
key ──opens──▶ house ──▶ shears, bell ②
shears ──cut the bushes──▶ maze ──▶ bell ③
three bells ──▶ gate
```

`test/rules.test.ts` searches the whole world with its locks and bushes and fails if a bell or the gate cannot be reached.

## Rules (`src/rules/`, plain TypeScript, headless tests)

| File | Holds |
| --- | --- |
| `constants.ts` | Every number: tile 16, hitbox 10, speed 56 px/s *(guess)*, reach 12 px *(guess)*, 5 hearts, 3 bells |
| `maps.ts` | The four maps as text (`.` ground, `#` wall, `~` water, `b` bush), and the people, items, doors and shrines placed on them by tile |
| `dialogue.ts` | What four people say: pages before and after the bell nearest them is found |
| `run.ts` | `newRun()`, `step(run, input, dt)` returning the run and events, doors, talking, pickups, bushes, shrines, `hurt`, the gate, `saveOf` / `loadRun` |
| `view.ts` | The lists the screen draws (see finding 2) |
| `controls.ts` | The actions and their keys, and `readInput` |

- **Movement** is eight-way at one speed (diagonals normalised) through the engine's `moveActorX` / `moveActorY`, against walls,
  water, uncut bushes and people (a tile-sized box each). The character faces where they last moved, even into a wall.
- **Doors** are tiles set into walls; stepping on one leads to its partner, and the character arrives one tile out from it. The
  cave needs the lantern and the house the key; a refused door sets a notice and puts the character back outside it.
- **Talking:** the action, facing a person within reach, starts a conversation; each press moves to the next page; the world
  waits while someone talks. No choices.
- **Shrines** (three) save the place and refill the hearts. Hearts run out only through `hurt` (no enemies yet, M5); then the
  character is back at the last shrine with full hearts, and nothing else is lost.
- **A save** (`saveOf`) is a plain object with a version: items, picked-up ids, cut bushes, the last shrine, the time. Loading
  puts the character beside the shrine. Writing it to disk is M3.

## Not in the greybox yet

Enemies and the swing's damage (M5), the large scrolling overworld (this one is 48 × 30 tiles, a camera that stops at the
edge, no follow smoothing; M2), saving to disk and settings (M3), the dialogue box with wrapped, revealed text and the
inventory grid (M4), maps drawn in Tiled by a person (M6; these are written by `tools/make-maps.ts` from the text), pushable
blocks in the maze, art, sound and music (M7).

## Findings while writing

Written down as they were hit, as Kite and Hearth did; the engine is changed only when one is worth it.

1. **Side-effect imports are not allowed in a component file** (`RGE1001`). Registering the Tiled maps (`registerTilemaps`) had
   to move into a plain `.ts` file that `GameState.ts` imports. Fair, but the message does not say where such an import can go.
2. **A component cannot compute a list** (`RGE1002`, `RGE1209`): the items of a `.map` come from state or props, optionally
   `.filter`ed, and the body allows only state, refs and derived `const`s. The rules therefore produce the lists (`viewOf`) and the
   game state holds them. This is the main cost of the subset for a map with many kinds of thing on it.
3. **`x !== undefined` is not a condition** (`RGE1302`): a map that may have a gate became a list of zero or one gates.
4. **The built-in font is not readable under size 10** at 320 × 180 (it is drawn, but letters break up); Kite and Hearth use a
   bitmap font. Bramble uses multiples of 10 until it has one (M7).
5. **`rge check` under `node --test`:** the child's test run printed `?` for its counts because `NODE_TEST_CONTEXT` made it
   report to the outer run. `rge check` now clears it. (An engine-tooling finding, fixed.)
6. **Compile errors name the generated file** (`generated/Play.ts:9:23 … './World.ts'`) when the real cause is in `src/` (the
   source file had failed to compile, above in the output). Reading the whole output top-down is needed.

## Run it

```
npm install && npm run check      # compile, type-check, test, parity under Node and rge-host
npm run dev                       # window with hot reload
npm run assets && npm run maps    # rewrite assets/tiles.png and scenes/*.tmj
```

From the engine's repository: `npm run bramble:install` repacks the engine and installs it here; `npm run check:outside` checks
a copy of this folder in a temporary directory.
