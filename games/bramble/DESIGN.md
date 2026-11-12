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
| `maps.ts` | The four maps, read from the Tiled files in `scenes/` and checked by `readMap`: the `Ground` layer as text (`.` ground, `#` wall, `~` water, `b` bush) and the people, items, doors, shrines, enemies, gate and bushes from the `Things` object layer (M6) |
| `dialogue.ts` | What four people say: pages before and after the bell nearest them is found |
| `run.ts` | `newRun()`, `step(run, input, dt)` returning the run and events, doors, talking, pickups, bushes, shrines, `hurt`, the gate, `saveOf` / `loadRun` |
| `view.ts` | What the screen draws of a run (`spotsOf`, `heroOf`, `dialogueOf`), called by the components as they render |
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

Enemies and the swing's damage (M5), saving to disk and settings (M3), the dialogue box with wrapped, revealed text and the
inventory grid (M4), maps drawn in Tiled by a person (M6; the `.tmj` files are the source since M6.2, but none has yet been saved by Tiled itself), pushable
blocks in the maze, art, sound and music (M7).

## The world (M2)

The overworld is 80 × 48 tiles (1280 × 768 px: four screens across, almost five down). The camera follows with a dead zone of 24 × 16
and a smoothing of 0.12 s *(guess)*, and stops at the map's edge. The player writes only the tilemap cells the view shows. A door
step (the map changes, the new map's cells are written for the first time) costs **1.2 to 1.5 ms** of script under Node
(`node tools/frame-time.ts`), so no hitch needs fixing; the mean step is 0.6 ms, the 99th percentile 5 ms, and one step in 1,433
took 18 ms (a garbage collection or a JIT step, nowhere near a door).

## Findings while writing

Written down as they were hit, as Kite and Hearth did; the engine is changed only when one is worth it.

1. **Side-effect imports are not allowed in a component file** (`RGE1001`). Registering the Tiled maps (`registerTilemaps`) had
   to move into a plain `.ts` file that `GameState.ts` imports. Fair, but the message does not say where such an import can go. *Since:* the message now says where such an import goes.
2. **A component cannot compute a list** (`RGE1002`, `RGE1209`): the items of a `.map` come from state or props, optionally
   `.filter`ed, and the body allows only state, refs and derived `const`s. The rules therefore produce the lists (`viewOf`) and the
   game state holds them. This is the main cost of the subset for a map with many kinds of thing on it. *Since:* a list's items are any array (`{spotsOf(run).map(…)}`), so `view` left the game state and the components compute what they draw.
3. **`x !== undefined` is not a condition** (`RGE1302`): a map that may have a gate became a list of zero or one gates. *Since:* `undefined` is a value; the gate is one of the spots.
4. **The built-in font is not readable under size 10** at 320 × 180 (it is drawn, but letters break up); Kite and Hearth use a
   bitmap font. Bramble uses multiples of 10 until it has one (M7).
5. **`rge check` under `node --test`:** the child's test run printed `?` for its counts because `NODE_TEST_CONTEXT` made it
   report to the outer run. `rge check` now clears it. (An engine-tooling finding, fixed.)
6. **Compile errors name the generated file** (`generated/Play.ts:9:23 … './World.ts'`) when the real cause is in `src/` (the
   source file had failed to compile, above in the output). Reading the whole output top-down is needed. *Since:* the generated code
   is not type-checked while a file fails to compile, and a type error in generated code is reported at its line in `src/`.

7. **Props need a declared type** (`RGE1208`): `Menu({ top }: { top: number })` is refused; the type is declared in the file. The message
   says exactly that. Fine.
8. **A new engine API is not in the authoring types until the manifest says so.** `InputState.lastPressed()` compiled in plain
   TypeScript but not in a component (`RGE1301`, "no callable method"), because the compiler reads `handleTypes` in
   `runtime/src/manifest.ts`. Added there. (Worth a test that every `InputState` method is in the manifest.) *Since:* a runtime test checks every `InputState` method and property is in the manifest.
9. **`createSettings` takes its type from the defaults**, so `fullscreen: false` became the type `false` and `!s.fullscreen` did not
   type-check. The game gives the type explicitly (`createSettings<Settings>`); the guide's example does too. *Since:* `createSettings` widens a boolean default (`SettingsOf`); the type is no longer given.
10. **In a handler, `x !== undefined` is not a condition** (`RGE1302`, again). `capture(input.lastPressed())` hands the maybe-undefined
    value to a game-state action, which tests it in plain TypeScript. *Since:* fixed with 3: `const key = input.lastPressed(); if (key !== undefined) bindKey(capturing, key);`.
11. **A script holds a key until it changes**, so `right, right` is one press and `right, _, right` is two. It cost three wrong test
    scripts (menus move on a press). Not an engine fault; the replay format says it, but nobody reads that twice.

## Saving and settings (M3)

- **The save** is written when the character steps onto a shrine (not every step they stand on it), and holds the items, the picked-up
  and cut ids, the last shrine and the time (`saveOf`). The title shows **Continue** first when a save exists; it loads the run beside
  its shrine with full hearts. A save that cannot be read is said once and Continue starts a new game.
- **The settings** (`src/settings.ts`) are kept apart: music and effects volume (tenths), full screen, and the keys. The settings
  screen is a list of rows with a cursor: left and right change a value, confirm on a key's row waits for a key (Escape cancels),
  "Reset to defaults" puts everything back. They are applied before the first frame and stored at each change.
- Not yet: "Save and quit" and the pause screen (M4), and `Quit` on the title.

12. **A list item's children cannot hold a condition** (`RGE1209`), which the inventory grid needs (an empty slot shows nothing). The message
    gives the way out: make the item a component (`SlotBox`) that takes the fields as props and holds the `{filled && …}`. That is
    enough, so no engine change was made (plan 4.3: not needed). *Since:* an item's children may be conditional and nested; `SlotBox` is gone.
13. **`name` is reserved as a `const`** inside a component (`RGE1103`): `const name = useGame(…)` fails. Renamed `speaker`. *Since:* a game-state value keeps its name (its field is `$name`); a `useState` called `name` still is not allowed.
14. **Text wrapping and revealing needed no workaround**: `<Text maxWidth lineGap reveal>` (engine, M4.1/4.2) draws the dialogue box; the rules
    count the typed characters (`talk.shown`, 40 a second *(guess)*; a press finishes the page, the next turns it).
15. **The scene importer took every Tiled object for a prefab** (M6.2). Moving the doors, people and items into an object layer made
    `rge check` fail with `RGE1503: Unknown prefab 'door'` for each one, because every map in `scenes/` is also imported as a scene.
    *Fixed in the engine:* an object layer with the bool property `data` is the rules' (read into `TilemapData.objects`) and the scene
    importer skips it; Bramble's `Things` layer has it. The tile importer also places objects by their layers' offsets now, as the
    scene importer did.
16. **The maps read from Tiled are the text maps, exactly:** a one-off script wrote the objects from the old text maps, and the
    `MAPS` that `readMap` builds from them was compared with the old `MAPS` before `make-maps.ts` was removed. The rules did not change.

## The pause screen (M4)

Escape opens it over the world (the world is not stepped): the inventory as eight slots, two rows, empty ones dark; then Resume and
Save and quit (which writes the save and goes to the title). Picking up an item shows a card across the top.

Since the engine's `modal` (2026-11-12), the pause screen is its own component (`Pause.tsx`) with `modal` on its root: while it is
shown the play screen hears no keys, so it closes itself on Escape, and `Play` no longer returns early from `useInput` when paused.
The settings screen's wait for a key is `KeyPrompt.tsx`, a modal with no children, so `Menu` lost its `disabled` prop.

17. **Narrowing does not reach a callback in the generated code.** In `{capturing !== null && <KeyPrompt onKey={(key) => bindKey(capturing, key)} />}`,
    TypeScript narrows `capturing` (a `const`) inside the arrow, but the generated callback reads `this.capturing`, which is not
    narrowed, so the type-check of the generated code fails (`string | null` is not `string`). Written `capturing!` for now. *Should
    become:* the generator keeps the narrowing (a callback created under a condition could read a `const` taken there). Meanwhile
    the error is at least reported at the `<KeyPrompt>` line of `Settings.tsx`, not in the generated file.

## Enemies (M5)

`rules/enemies.ts`. A **beetle** (2 hearts, 22 px/s) wanders and turns at walls. A **wisp** (3 hearts, 34 px/s) drifts until the character
is within six tiles and in sight (`lineOfSight`), then follows `findPath` (diagonals, `maxNodes` 600), found again every 0.5 s and
not each step, and gives up 4 s after last seeing them. The swing (the action with nothing else in front) is a 14 px box that costs
each enemy in it a heart and knocks it back 14 px; contact costs the character a heart, then a second of safety. Actors block each
other (people, other enemies; doors are walls to enemies). Enemies keep their place when the character leaves a map; defeated ones
are kept in the save. A seeded generator (`nextRandom`) makes wandering repeat exactly. Eleven enemies in all: seven on the overworld,
two in the cave, one in the maze. With them the mean step is 0.75 ms under Node (was 0.6), so **plan 2.4 needs no filtering by
distance**; the busiest view has a handful. Path searches are bounded by `maxNodes`: the bench's 100 corner-to-corner searches of the
whole 80 × 48 map take 1.3 ms each under Node and 20 ms under QuickJS, which is why a wisp never searches the whole map.

## Run it

```
npm install && npm run check      # compile, type-check, test, parity under Node and rge-host
npm run dev                       # window with hot reload
npm run assets                    # rewrite the art and sound in assets/
                                  # the maps are scenes/*.tmj: open and edit them in Tiled
```

From the engine's repository: `npm run bramble:install` repacks the engine and installs it here; `npm run check:outside` checks
a copy of this folder in a temporary directory.

## After the review: React-like again

The review of this milestone asked which of the workarounds above were the engine's to remove. With findings 1–3, 8–10, 12 and 13
answered, the components read like React:

- **What is drawn is computed where it is drawn.** `World` is one list, `{spotsOf(run).map((s) => <Sprite key={s.id} … />)}`; the
  character is one `<Sprite>` in the camera (not a list of one); `Inventory` holds its `{slot.filled && …}` in the list item.
- **A menu's cursor is the screen's own state** (`useState`), and the rows are computed from the game state (`titleRows(hasSave)`,
  `settingsRows(settings, bindings, capturing)`) and passed to `<Menu rows cursor>` as props. The game state keeps only what is shared:
  the run, the screen and whether there is a save.
- **The settings screen listens to the settings itself**: it keeps the values and the keys as its own state and subscribes in
  `useMount`, returning what `settings.subscribe` returns as the cleanup, so it re-renders when a volume or a key changes and stops
  listening when it goes. (Until the engine had cleanups, a module-level `settings.subscribe` mirrored them into `useGame`, as
  `s.settings` and `s.bindings`.)

Every frame of three replays (the title and settings, the cave with the pause screen, and the whole game) draws exactly what it drew
before the change.

A second review found what still read unlike React, and the engine took three more: methods of strings and numbers
(`String(seconds).padStart(2, "0")` on the end screen, `id.startsWith("bind:")` in the settings, where a `bindingOf` helper had stood in),
destructured derived values worked out once (`const { x, y, frame } = heroOf(run)`, `const { name, page, shown, more } = dialogueOf(run)`),
and `useState` starting from the game state. With them, `<Menu>` owns its cursor and keys and says what was chosen through
`onChoose` and `onAdjust` (the title, the settings and the pause screen pass actions or an arrow), the screens take several actions in
one `useGame((s) => s)`, and the inventory's slot holds one condition over a fragment. The three replays still draw every frame as
before.

Still as it was: sounds and particles answer the step's events in the `advance` action (`answer(events)`), since the engine has no
`useEffect` on purpose; a list inside a list item is not built yet; and the play screen keeps three refs for the keys, since a ref
holds a number, string or boolean only.
