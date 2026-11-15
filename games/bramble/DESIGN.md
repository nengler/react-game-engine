# Bramble: design note

A small top-down adventure, the third game made on the engine and the first made from outside it. Numbers marked *(guess)* have
not been played.

**Why this game.** Kite and Hearth are both one screen, a few minutes long, keep nothing between runs, and live inside the
engine's workspaces. Bramble is the opposite on each count: a world bigger than the screen, scrolled continuously, with interiors
behind doors; a save and settings kept across runs; maps read from Tiled files with object layers; dialogue with wrapped, revealed
text, an inventory and a settings screen with rebinding; enemies that find a path to the character. And it is made the way an
outside author makes a game: from the `tse create` template, installing the engine as packed packages, checked by `tse check`
from a copy outside the repository. The engine's storage (`createSave`, `createSettings`), `<Text maxWidth reveal>`, `findPath` and
`lineOfSight`, culled tilemaps, the camera's `deadzone` and `smoothing`, Tiled object layers, lighting and `sequence` were all
built or first used here.

## Premise and finish

A walled valley has gone quiet. Find three bells (a cave, an old house, a hedge maze) and ring them at the gate in the north.
**Finished** means: the character carries three bells and steps onto the gate (`run.done`, the end screen). One ending, twenty to
thirty minutes for someone new to it *(guess)*.

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
| `constants.ts` | Every number: tile 16, hitbox 10, speed 56 px/s *(guess)*, reach 12 px *(guess)*, 5 hearts, 3 bells, the enemies' numbers |
| `maps.ts` | The four maps, read from the Tiled files in `scenes/` and checked by `readMap`: the `Ground` layer as text (`.` ground, `#` wall, `~` water, `b` bush) and the people, items, doors, shrines, enemies, gate and bushes from the `Things` object layer |
| `dialogue.ts` | What four people say: pages before and after the bell nearest them is found |
| `enemies.ts` | The beetle and the wisp |
| `run.ts` | `newRun()`, `step(run, input, dt)` returning the run and events, doors, talking, pickups, bushes, shrines, `hurt`, the gate, `saveOf` / `loadRun` |
| `view.ts` | What the screen draws of a run (`spotsOf`, `heroOf`, `dialogueOf`, `slotsOf`, `glowsOf`), called by the components as they render |
| `menu.ts` | The rows of the title, settings and pause menus |
| `controls.ts` | The actions and their keys, and `readInput` |

- **Movement** is eight-way at one speed (diagonals normalised) through the engine's `moveActorX` / `moveActorY`, against walls,
  water, uncut bushes and people (a tile-sized box each). The character faces where they last moved, even into a wall.
- **Doors** are tiles set into walls; stepping on one leads to its partner, and the character arrives one tile out from it. The
  cave needs the lantern and the house the key; a refused door sets a notice and puts the character back outside it.
- **Talking:** the action, facing a person within reach, starts a conversation; each press moves to the next page; the world
  waits while someone talks. No choices. The dialogue box is `<Text maxWidth lineGap reveal>`: the rules count the typed characters
  (`talk.shown`, 40 a second *(guess)*); a press finishes the page, the next turns it.
- **Shrines** (three) save the place and refill the hearts. When the hearts run out the character is back at the last shrine with
  full hearts, and nothing else is lost.
- **The game state** holds what the screens share (the run, the screen, whether there is a save); the components compute what they
  draw from the run (`{spotsOf(run).map((s) => <Sprite key={s.id} … />)}`). Sounds and particles answer the step's events in the
  `advance` action (`answer(events)` in `effects.ts`).

## The world

The overworld is 80 × 48 tiles (1280 × 768 px: four screens across, almost five down); the cave, the house and the maze are maps of
their own. The camera follows with a dead zone of 24 × 16 and a smoothing of 0.12 s *(guess)*, and stops at the map's edge. The
player writes only the tilemap cells the view shows.

The maps are `scenes/*.tmj`, edited in Tiled; the `Things` layer has the bool property `data`, which tells the scene importer it is
the rules' data and not prefabs. They were first written by a tool, and none has yet been saved by Tiled itself.

## Enemies

A **beetle** (2 hearts, 22 px/s) wanders and turns at walls. A **wisp** (3 hearts, 34 px/s) drifts until the character is within six
tiles and in sight (`lineOfSight`), then follows `findPath` (diagonals, `maxNodes` 600), found again every 0.5 s and not each step,
and gives up 4 s after last seeing them. The swing (the action with nothing else in front) is a 14 px box that costs each enemy in it
a heart and knocks it back 14 px; contact costs the character a heart, then a second of safety. Actors block each other (people,
other enemies; doors are walls to enemies). Enemies keep their place when the character leaves a map; defeated ones are kept in the
save. A seeded generator (`nextRandom`) makes wandering repeat exactly. Eleven enemies in all: seven on the overworld, two in the
cave, one in the maze.

## Saving, settings and the pause screen

- **The save** is written when the character steps onto a shrine (not every step they stand on it), and holds the items, the picked-up
  and cut ids, the defeated enemies, the last shrine and the time (`saveOf`, with a version). The title shows **Continue** first when a
  save exists; it loads the run beside its shrine with full hearts. A save that cannot be read is said once and Continue starts a new
  game.
- **The settings** (`src/settings.ts`) are kept apart: music and effects volume (tenths), full screen, and the keys. The settings
  screen follows them with `useStore`. It is a `<Menu>` of rows (`Choices.tsx`): left and right change a value, confirm on a key's row
  opens `KeyPrompt` (a modal that waits for a key; Escape cancels), "Reset to defaults" puts everything back. They are applied before
  the first frame and stored at each change.
- **The pause screen** (`Pause.tsx`, a modal: the world is not stepped and the play screen hears no keys) shows the inventory as eight
  slots in two rows, empty ones dark, then Resume and Save and quit. Picking up an item shows a card across the top (`Notice.tsx`).

## The cave

The cave is drawn under `<Lighting ambient="#16162c">`: the lantern is a `<Light radius={56}>` on the character, each item still lying
in the cave glows warm and faint, and each wisp carries a cold light (`glowsOf` in `rules/view.ts`, its numbers *(guess)*). The layer
goes through `assets/cave.glsl`, which makes the lantern's light flicker a little (`params[0]`, 0.12 *(guess)*) and darkens the
screen's edges; the stored story picture is the software renderer's, without it. Not decided yet: how dark it should be when played,
and how bright the glows are.

**The first visit is a cutscene.** The first time the character steps into the cave, `Play` holds the world for 3.4 s
(`CAVE_INTRO_SECONDS`) while a sequence (`cutscenes.ts`, the engine's `sequence`) grows the lantern's light out of the dark and shows
a line. It is kept in a `useMutable` field (`intro`), so it is not saved: a run loaded from a save plays it again on the next visit,
which is fine for now. The stories `Play/Cave` (after it) and `Play/CaveIntro` (during it) keep its pictures.

## Tests and performance

- `test/rules.test.ts`, `enemies.test.ts` and `maps.test.ts`: the rules headless, including the reachability search, a wisp that
  follows a path round a wall, and losing the last heart.
- Through the game itself: the title, the lantern, a conversation and the cave's door (`replay.test.ts`); Continue, settings and
  rebinding (`saving.test.ts`); and the whole game from the title to the end screen, planned with `findPath` (`fullrun.test.ts`).
  A script holds a key until it changes, so `right, right` is one press and `right, _, right` is two.
- **Frame time** (`node tools/frame-time.ts`, under Node): the mean step is 0.75 ms with the enemies; a door step (the new map's
  cells written for the first time) costs 1.2 to 1.5 ms, so there is no hitch to fix, and nothing needs filtering by distance to the
  view. Path searches are bounded by `maxNodes`: the bench's 100 corner-to-corner searches of the whole 80 × 48 map take 1.3 ms each
  under Node and 20 ms under QuickJS, which is why a wisp never searches the whole map. Not measured under QuickJS.

## Not done

A person has not played it in a window. No pushable blocks in the maze, no pixel font (the built-in font is used at sizes 10 and 20;
a new game from `tse create` now gets Kite's), no shake or fades, no cave theme, no Quit on the title.

## Findings while writing

Written down as they were hit; the engine was changed when one was worth it. Each of these is fixed in the engine unless it says
otherwise.

1. Side-effect imports are not allowed in a component file (`TSE1001`): registering the Tiled maps lives in `src/tilemaps.ts`. The
   message now says where such an import goes.
2. A component could not compute a list, test `x !== undefined`, call methods of strings and numbers, or hold a condition in a list
   item's children (`TSE1002`, `TSE1209`, `TSE1302`): the game kept its lists in the game state and wrapped items in components. All
   of these now compile, and the workarounds are gone.
3. A narrowed `const` read in a callback under a condition did not type-check in the generated code: the generated callback now
   starts with `$assume(…)` (DESIGN.md, "Narrowing in the generated code").
4. A new engine API is not in the authoring types until the manifest says so (`InputState.lastPressed()`); a runtime test now checks
   every `InputState` member is in the manifest.
5. `createSettings` took `false` as the type of a boolean default; it now widens it.
6. Compile errors named the generated file when the cause was in `src/`; a type error in generated code is now reported at its line
   in `src/`.
7. `tse check` under `node --test` printed `?` for its counts (`NODE_TEST_CONTEXT`); `tse check` now clears it.
8. The scene importer took every Tiled object for a prefab (`TSE1503`); an object layer with the bool property `data` is now the
   rules'.
9. Props need a declared type (`TSE1208`); the message says so. Not changed.
10. The cave's cutscene: a field started at `null` cannot have its methods called (it starts from `noCutscene()`), and
    `import type` from `@tsengine/runtime` is refused in a component, so `@tsengine/runtime/jsx` re-exports the type (DESIGN.md, "Sequences,
    for cutscenes").

## Run it

```
npm install && npm run check      # compile, type-check, test, parity under Node and tse-host
npm run dev                       # window with hot reload
npm run assets                    # rewrite the art and sound in assets/
                                  # the maps are scenes/*.tmj: open and edit them in Tiled
```

From the engine's repository: `npm run bramble:install` repacks the engine and installs it here; `npm run check:outside` checks
a copy of this folder in a temporary directory.
