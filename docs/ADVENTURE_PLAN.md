# A third game, made outside this repository: a small top-down adventure (plan)

Planned 2026-11-11. This is priority 8 in [NEXT_PRIORITIES.md](NEXT_PRIORITIES.md), merged with a third game: the work that makes
the engine usable outside this repository is tested by writing a game outside it, and the game is chosen to hit what Kite and
Hearth never touched.

## Why this game

Kite (`packages/kite`) and Hearth (`packages/hearth`) pull in different directions: one is about how a character moves, the other
about lists, menus and UI. But they are alike in what they leave out:

- **One screen, a few minutes, nothing kept.** Neither game scrolls a world bigger than the screen, loads or unloads anything as
  the player moves, or remembers anything between runs. Saves were excluded on purpose in both.
- **Written from the inside.** Both live in `packages/`, compile through a path into `packages/compiler/src/cli.ts`, and were
  written by people who know where each diagnostic comes from. Most of the friction found was the compiler subset.
- **Checked by tools.** Hearth has never been played in a window; Kite has been played once, and that once found an unplayable
  room that every test passed (Kite finding 12).

A small top-down adventure is the opposite shape on each of these: one world bigger than the screen, a save, NPCs that talk,
an inventory, enemies that find their way to the player, and a settings screen. Each row below is a gap the earlier games named
or left untouched.

| Gap | What exists today | Where this game hits it |
| --- | --- | --- |
| A large, scrolling world | `<Tilemap>` writes one record per filled cell with no culling; the camera has `bounds` and `slide` but no follow smoothing; a room change costs one ~25 ms step (Kite finding 10); room seams are not continuous (Kite finding 7) | One overworld map about 4 × 3 screens, scrolled continuously with the character, plus interiors entered by doors |
| Saving and loading | Nothing: no storage call in librge, the Node host or the Rust host | A save slot written at shrines and on quitting; the title offers "Continue"; settings kept apart from the save |
| Maps saved by Tiled itself | The importer reads CSV layers, finite maps and one embedded tileset; every map so far was written by a script (Kite finding 8) | The overworld is drawn in Tiled by a person: external tilesets (`.tsx`), more than one tileset, object layers for NPCs, doors, chests and spawns with custom properties |
| Deeper UI | Context not built (needs a tree three levels deep); children on list items flat only (`RGE1209`); `<Text>` does not wrap | A dialogue box with wrapped, revealed text; an inventory grid of slots that may be empty; a settings screen of nested panels, sliders and a key-capture row |
| Entities that think | `moveActorX`/`moveActorY` against tiles; colliders report overlaps but stop nothing; no pathfinding | Enemies that wander, notice the player and path to them around walls; NPCs and pushable blocks that the character cannot walk through |
| Settings and rebinding | `createControls` binds names to keys at build time; one volume per sound or music | Rebinding a control by pressing a key, music and effects volume, full screen; all kept across runs |
| Usable outside this repo | Every game is a workspace in `packages/*` | The game is made from a template, installs the engine as packed packages, and is built and played with one command line |

The rule from priorities 7 and 7b still holds: **write the game the way the guide says to, and build an engine feature only when
the game hits the gap.** When something turns out not to be needed, write that down as a finding and build nothing.

## The game

Working title **Bramble** (the name can change). Original art, sound and music, made by a `tools/make-assets.ts` the same way Kite
and Hearth make theirs. No character, place or story from an existing game.

**Premise.** A small walled valley has gone quiet. The character, a keeper's apprentice, finds three bells hidden around the
valley (in a cave, an old house and a hedge maze) and rings them at the gate to open the road out. Twenty to thirty minutes for
someone new to it. One ending.

**Screen.** 320 × 180, like Kite and Hearth; tiles of 16 px (20 × 11.25 tiles in view).

**World.**

- **The overworld:** one Tiled map, about 80 × 48 tiles (four screens across, about four down). The camera follows the character
  smoothly, with a small dead zone, and stops at the map's edge. No room-by-room slide.
- **Three interiors** (the cave, the house, the maze), each its own map of one to two screens, entered through a door object.
  Going through a door fades out and back in, and the character arrives at the door object named by the one they used.
- Grass and bushes the character walks behind (a layer drawn over the character), water and walls that block, and a few
  pushable blocks in the maze.

**The character** walks in eight directions at a fixed speed, faces where they last moved, and has one action: **talk / use /
swing**, depending on what is in front of them. They have five hearts. Losing them all returns the character to the last shrine
with full hearts; nothing else is lost.

**People.** Four NPCs, each with a few lines that change once with progress (before and after the bell nearest them). Dialogue
is data in a `.ts` file: a list of pages per NPC per state. No branching choices.

**Items.** Six: a lantern (lights the cave), a key (opens the house), shears (cut bushes that block the maze), a bell ×3 (counted).
The inventory is a grid of eight slots on the pause screen; a slot can be empty. Picking an item up shows a short card.

**Enemies.** Two kinds, both simple:

| Enemy | Does |
| --- | --- |
| Beetle | Wanders, turns at walls. One heart on contact. Two hits. |
| Wisp | Drifts until the character is within 6 tiles and in sight, then paths to them around walls; loses interest after 4 s out of sight. One heart on contact. Three hits. |

The swing knocks an enemy back. Enemies keep their place when they leave the screen, and come back when the character
returns to a map.

**Shrines.** Three, one in each part of the overworld. Touching one saves and refills the hearts.

**Screens.** Title (New game, Continue if a save exists, Settings, Quit), play, pause (inventory, Settings, Save and quit), settings
(music volume, effects volume, full screen, rebind each control by pressing a key, reset to defaults), and the end.

## How it is built

The shape both games settled on stays the same:

- **Rules are plain TypeScript** in `src/rules/`, with headless tests: moving against the map and solid actors, the camera's
  follow, doors, talking (which NPC, which page), picking items up, enemy behaviour and paths, damage and knockback, shrines
  and respawn, and what a save holds.
- **The game state holds the run** (`run: newRun()`): the map the character is on, their position and hearts, the inventory,
  each NPC's progress, which chests are open, which enemies are defeated. **What gets saved is a plain object picked from that
  state**, with a version number, so a test can save, load and compare.
- **Effect stores** answer the rules' events (sounds, particles, shake), as in both earlier games.
- **The router** has the screens; the play screen steps the world through one action.

## What has to be built

### Priority 8: a game outside this repository

- **One command line** for a game wherever it lives: `rge dev` (compile, play, hot reload), `rge check` (compile, type-check,
  tests, the parity run), `rge build` (compile only), `rge package`, and `rge screenshot` with an input script. It replaces the
  per-game scripts in the root `package.json`, which then call it, so Kite and Hearth are its first users.
- **A template** (`rge create <folder>`): `package.json`, `tsconfig.json`, `main.ts`, a `<Game>` root with one screen, one
  asset, one rules file with one test, and a `.gitignore`. Its packages come from `npm pack` tarballs of `@rge/runtime`,
  `@rge/compiler`, `@rge/player`, `@rge/player-node` (or a path dependency), never a relative import into this repository.
- **Where the game lives.** In `games/bramble`, which is *not* one of the workspaces (`packages/*`), so it installs the packed
  packages like an outside game would. A CI step and `npm run check:outside` copy it to a temporary folder outside the
  repository, install from fresh tarballs, and run `rge check`, so a relative path or a missing export fails there.
- **The guide** (`docs/index.html` and its pages) gets a getting-started page, from an empty folder to a packaged game, written
  by following it from scratch while making Bramble, and a reference entry with an example for every built-in and hook.
- **A license**, and a check of the repository for anything that should not be public.

### Engine: a large world

- **`<Tilemap>` draws only what the camera sees**, in chunks (for example 16 × 16 cells), so an 80 × 48 map costs what a
  screen costs. The records for a chunk are kept until the chunk or the tiles change.
- **A camera that follows**: `<Camera follow>` (a ref or a position), `deadzone`, and `smoothing`, still in whole pixels and still
  clamped by `bounds`. A `slide` on a `bounds` change stays for Kite.
- **Map changes without the hitch** (Kite finding 10): the next map's tilemap is made a step early or kept, and the measured
  step time on a door is recorded.
- **Layers above the character**: a `<Tilemap layer>` with a `z`, already possible, checked with a real map.
- **Off-screen entities**, measured first: if a map with its enemies and NPCs (about 40) costs too much off screen, a way to skip
  rendering what is far from the view.

### Engine: maps saved by Tiled

- External tilesets (`.tsx`, which are XML), more than one tileset per map, and whatever layer format Tiled saves by default.
- Object layers as data for the rules (NPCs, doors with a target map and door name, chests with an item, spawns, shrines),
  with custom properties typed, alongside the tile layers that already work.
- **A person opens and saves at least one map in Tiled**, since an agent cannot run it; the importer is fixed for what that file
  holds. Until then, the maps can be written by a tool the way Kite's are.

### Engine: saving

- **Storage in both hosts**, not in librge: Node writes with `fs`, the Rust host exposes the same few calls to the script. A
  small JavaScript interface, the same under both: read, write and remove a named entry, written whole, atomically (a temporary
  file, then rename). The folder is the platform's user data folder (`$XDG_DATA_HOME/<game>` on Linux), named by `<Game id>`.
- **`createSave({ version, pick, apply, migrate })`**, an effect-store-style module like `createSounds`: `save.write(slot)`,
  `save.read(slot)`, `save.exists(slot)`. What is saved is JSON; a save from an older version is passed through `migrate`.
- **A memory store** for tests and the recording backend, so the harness can save, load and compare without a disk, and a
  replay can start from a save.
- Settings use the same storage under their own name, read before the window opens (full screen, volumes).

### Engine: UI for text and inventory

- **Wrapped text**: `<Text maxWidth>` breaks on spaces (and inside a word only when a word alone is too wide), with `lines` and
  `align`; `<Flex>` measures it as wrapped.
- **Revealed text**: `<Text reveal={n}>` draws the first `n` characters but lays out the whole, so the box does not grow as
  the text appears. The rules count `n`.
- **Inventory slots**: `{item && <Icon/>}` inside a list item's children (`RGE1209` today). Built when hit.
- **Context**, if the settings screen's nested panels pass the same props through three levels. Built when hit, or recorded as
  not needed again.
- **A slider** for volumes, if `<Flex>` with focus and `pressKey` does not cover it cleanly. Probably a component in the game, not
  a built-in; recorded either way.

### Engine: entities that think

- **`findPath(grid, from, to, options)`** in `@rge/runtime`: A* over a `TileGrid`'s solid cells (four or eight directions, a
  limit on the search), returning cells. Plain TypeScript, callable from rules and tests.
- **Moving against solid actors**, not only tiles: the `blocked` function `moveActorX`/`moveActorY` take already allows it; the
  game writes it first, and it moves into `@rge/runtime` only if it is the same code in two places.
- Enemy behaviour stays in the game's rules. No behaviour trees or state-machine built-in.

### Engine: settings and controls

- **Rebinding at run time**: `controls.bind(action, keys)` and `controls.bindings()`, saved and loaded as plain data.
- **Capturing a key**: `input.lastPressed()`, the key or button pressed this step, for "press a key for Jump".
- **Volume groups**: a master volume for music and one for effects, applied on top of each sound's own volume, in the player
  (not librge).

### The game itself

The design note (`games/bramble/DESIGN.md`), the rules with headless tests, the components, the maps, art, sound and music, a
scripted replay that plays it from the title to the end (and one that saves, quits, continues and finishes), and the frame time
on the busiest part of the overworld.

## Order of work

0. **Priority 8 groundwork:** the `rge` command line (with Kite and Hearth moved onto it), the template, packed packages, and
   `games/bramble` made from the template and checked from a folder outside the repository.
1. **Design note and greybox:** the rules (moving, the map as a solid grid, doors, talking, items, shrines) with headless tests,
   on a map written as text in a tool, the character as a `<Shape>`. A person plays it here if they can.
2. **The large world:** the camera's follow, the tilemap's chunks and culling, map changes without a hitch; the overworld at full
   size.
3. **Saving and settings:** storage in both hosts, `createSave`, the memory store, rebinding, volume groups, the settings screen.
4. **Dialogue and inventory:** wrapped and revealed text, the dialogue box, the inventory grid; Tier 3 items as they are hit.
5. **Enemies:** `findPath`, the two enemies, damage and knockback.
6. **Tiled:** a person draws or re-saves the overworld in Tiled; the importer is fixed for it; object layers replace the tool's
   markers.
7. **Art, sound and music**; replays from title to end and through a save; frame time on the busiest view.
8. **The guide**: the getting-started page checked by following it in an empty folder; reference entries.

Engine and game changes go in separate commits, as before. Native changes, if any are needed (none are planned: storage is in
the hosts), are batched so `RGE_ABI_VERSION` moves once.

## Done when

- [ ] `rge create`, `rge dev`, `rge check`, `rge build` and `rge package` work for a game in a folder outside this repository,
      installed from packed packages, and Kite and Hearth use the same command line
- [ ] Bramble is playable from the title to the end by keyboard or gamepad, under Node and as a packaged build, with music and
      sound; a scripted replay plays it through, and another saves, quits, continues and finishes
- [ ] A save survives quitting and is read by "Continue"; a save from an older version is migrated by a test; settings
      (volumes, full screen, bindings) are kept
- [ ] The overworld scrolls continuously; the frame time on its busiest view and on a door is recorded in `NATIVE_PLAN.md`,
      and a door causes no step over 16.7 ms under Node
- [ ] At least one map was saved by Tiled itself and is imported without changes by hand
- [ ] Each engine addition has its design notes, tests, and a guide entry; the parity test passes; `npm run bench:check` stays
      within budget
- [ ] The getting-started guide takes a new reader from an empty folder to a packaged game, checked by following it
- [ ] A license is chosen
- [ ] A "Findings from the third game" section is added to `NEXT_PRIORITIES.md`, including which of Kite's and Hearth's findings
      held a third time
- [ ] A person has played it in a window (priority 6), and what they found is filed or fixed

## Open decisions

1. **Where storage lives.** Proposed: in the hosts (Node `fs`, Rust `std::fs`), not librge, because librge has no files beyond
   loading assets and the web backend later would use `localStorage` instead. The cost is writing it twice.
2. **Whether the game is in this repository.** Proposed: yes, in `games/bramble` outside the workspaces, checked from a copy in a
   temporary folder. The alternative, a separate repository, tests "outside" more honestly but splits CI and review.
3. **Combat at all.** Proposed: the one swing and two enemies above, because enemies are what tests pathfinding and actors
   blocking each other. Dropping it keeps the game smaller and leaves `findPath` unasked for.
4. **Package names and a scope** for the packed packages (`@rge/…` today). Only matters once anything is published; decide with
   the license.
