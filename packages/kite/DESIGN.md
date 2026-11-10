# Kite: the first level (design note)

An original precision platformer: run, jump, a dash in eight directions, wall slide and wall jump, one-screen rooms, instant
respawn, a camera that slides from room to room. The first milestone is **one complete level, "The Foothills"**: a title screen,
eight rooms that teach and then combine the mechanics, an end screen, music, sound and gamepad. The character, art, rooms,
music and name are original and made for this repository (see `assets/README.md`).

## Mechanics

Controls: arrows, WASD, the d-pad or the left stick move; Z, C, Space or `A` jump; X, Shift, `B`, `X` or the right bumper dash.
Held jump goes higher (a tap is about a third of it). Coyote time and a jump buffer forgive small mistakes. One dash, refilled on
the ground; the character turns blue-grey while it is spent. A wall within 3 px lets you slide (holding toward it) or jump off
it. Touching spikes or falling out of the room is a death: the world freezes for a moment, the screen shakes and dims, and the
character is back at the room's start 0.45 s later. Leaving a room by its exit moves to the next, with a 0.4 s camera slide.

## How it is built

- **Rules are plain functions** (`src/rules/`), which know nothing of the engine's drawing: `body.ts` (the body: movement, jump,
  dash, walls), `level.ts` (a run: deaths, respawn, room changes), `rooms.ts` (rooms read from the Tiled maps), `playback.ts` (what
  the engine does around the rules, for a driver without an engine), `constants.ts` (every number). `GameState.ts` keeps the run
  where components can read it; `Player.tsx` and the other components only draw it.
- **Rooms are Tiled maps** (`scenes/room1.tmj` …: a tile layer `Tiles`, a hidden layer `Markers`), 32 × 18 tiles of 10 px; the
  compiler writes `generated/tilemaps.ts` from them. Movement reads the same data the `<Tilemap>` draws. Room 1's start is the
  tile 8 on `Markers`, an exit is tile 7 (tile 9 for the last one). `tools/rooms.ts` holds the first drafts as text and
  `tools/make-rooms.ts` writes the maps from them; after that the maps are the source.
- **Engine features used**: fixed 60 Hz timestep, `<Tilemap>`, camera bounds/slide/shake, `<AnimatedSprite>` sheets, `<Particles>`,
  `<Fade>`, bitmap font, `freeze()`, `<Music>`, sound volume, gamepad keys, a custom hook (`usePlatformerBody`, `useSoundOnCount`,
  `useBurst` in `Player.tsx`), and `<Collider>` for the gem. Hazards, exits and the start are tiles read by the rules in the same step
  (a collision callback arrives after the frame, which would make a death a step late and untestable without the player).

## The rooms

| # | Name | Teaches | Needs |
| --- | --- | --- | --- |
| 1 | First steps | run, a short hop, a 4-tile gap over spikes | run + jump |
| 2 | Stepping stones | held jumps up 2-tile steps over spikes | jump height |
| 3 | Dash across | an 8-tile gap, too wide to jump | jump + dash |
| 4 | Dash up | a ledge 4 tiles up on the right, a second 5 above it on the left, the ceiling opening over that | up-dash, twice |
| 5 | The shaft | wall jumps up a 6-wide shaft | walls |
| 6 | Spikes on the wall | the same, with spikes on both walls | walls + dash |
| 7 | Gem ledge | a spiked pit with a pillar; the **optional gem** is up and to the right | everything |
| 8 | Summit | stepping stones, a dash across, up the wall, the exit | everything |

A solver finding a route is not the same as a person finding one: room 4 was first built with a ledge whose only route was a contrived one, and was effectively impossible to play. `test/rooms.test.ts` now also checks that the two dash moves (rooms 3 and 4) work over a window of dash timings, not a single frame (three tests: floor to the first ledge, first to second, and the exit; each checks a window of at least a tenth of a second). Rooms 1 and 2 are solved by the search with no dash; 4 and 6 cannot be solved without one. Room 3 can be crossed by wall jumping
out of the pit (a finding: one wall is a ladder).

## What "finished" means for the level

1. A scripted run (`test/replays.ts`, in the input-script format) finishes every room, in order, through the game itself, with no
   deaths, and at any frame rate (`test/rooms.test.ts`); `tools/solve.ts` finds the replays by searching over the rules and
   rewrites the file after any change to a room or a constant. A second replay takes the gem.
2. Title → eight rooms → end works from a button press to the end screen, headlessly, under Node and the Rust host (the parity
   run plays two rooms under both).
3. `npm run check:kite` passes: compile (maps, assets), type-check, tests, parity.
4. A person has played it and tuned the numbers (priority 6): **not done**.

## The movement constants (`src/rules/constants.ts`)

All set from the genre's usual ranges, **none felt yet**. What the tests check is in the third column; the rest are guesses.

| Constant | Value | Checked by a test | Try first when playing |
| --- | --- | --- | --- |
| run speed / accel / friction | 90 px/s, 1000, 1000 | reaches 90, stops | how quickly it stops (friction); air control 0.65 |
| gravity / max fall / fast fall | 900, 160, 240 | jump heights follow | max fall; whether fast fall is wanted |
| jump speed / hold time | 105, 0.2 s | held jump 27–30 px, tap 6–14 px | hold time (jump height) |
| jump boost | +40 px/s toward the held direction | running jump 58–66 px | none first |
| coyote / buffer | 0.1 s, 0.1 s | both windows, in and out | both, a little longer if it feels strict |
| dash speed / time / end speed | 240, 0.15 s, 160 | ≈ 5 tiles; 8 directions equal | dash time; end speed |
| dash count / cooldown | 1, 0.2 s | refill on landing, none in the air | cooldown |
| dash freeze | 3 steps (50 ms) | replays play through it | 2 to 4 steps |
| wall slide / reach / jump / lock | 40 px/s, 3 px, 130 px/s, 0.16 s | slide speed, jump direction and lock | slide speed; lock |
| corner forgiveness | 3 px | a clipped ceiling corner does not stop a jump | none first |
| respawn delay / transition | 0.45 s, 0.4 s | – | respawn delay |

The geometry the rooms need from them: a four-tile gap has a margin of at least 40 % of a running jump; an eight-tile gap
(room 3) is more than a jump (64 px) and less than a jump plus a dash (85 px, 11 px of margin); a ledge six tiles up needs the
dash. If any constant changes, `npm run kite:solve` and the tests say which room it breaks.

## Known limits

Hazard and exit shapes are tiles (spikes are half a tile deep), not arbitrary rectangles. The room seam is not continuous (the
character reappears standing on the next room's floor a little inside it, under the slide). One gem, no save, no settings, no
rebinding, no dialogue (see the plan). Art and sound are placeholders made by `tools/make-assets.ts`.
