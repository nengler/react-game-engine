# Kite: the first level (design note)

An original precision platformer: run, jump, a dash in eight directions, wall slide and wall jump, one-screen rooms, instant
respawn, a camera that slides from room to room. The first milestone is **one complete level, "The Foothills"**: a title screen,
eight rooms that teach and then combine the mechanics, an end screen, music, sound and gamepad. The character, art, rooms,
music and name are original and made for this repository (see `assets/README.md`).

## Mechanics

Controls: arrows, WASD, the d-pad or the left stick move; Z, Space or `A` jump; X, `X` or `B` dash; C, Shift, V or a bumper grab.
**The character moves the way Celeste's does** (an experiment, 2026-11-11): its numbers and its rules are those of Celeste's
`Player.cs`. Held jump goes higher; coyote time (0.1 s) and an input buffer (0.08 s) forgive small mistakes. One dash in eight
directions, refilled on the ground; the character turns blue-grey while it is spent. Wall slides start slow and speed up;
wall jumps push away for a moment. Grab holds onto a wall to climb it, on 110 stamina (about 2.4 s climbing up). And the
tech: super jumps (jump during a dash along the ground), hypers and wavedashes (a dash down at an angle into the ground, then
jump), wall bounces (jump off a wall during a dash straight up), corner corrections for jumps and dashes. Touching spikes or
falling out of the room is a death: the world freezes for a moment, the screen shakes and dims, and the character is back at
the room's start 0.45 s later. Leaving a room by its exit moves to the next, with a 0.4 s camera slide.

## How it is built

- **Each piece handles itself.** `Player.tsx` keeps the character's state (`useMutable`) and moves it in its own `useUpdate`
  by calling `stepPlayer` (`rules/player.ts`): the body moves, spikes or a fall kill it and it comes back, an exit takes it
  into the next room. It answers what it did (sound, dust and freeze from `effects.ts`, its squash, the camera's shake
  through `onDie`) and reports what the run needs to know through the game state's actions (`died`, `respawned`,
  `enteredRoom`, `finished`). The game state (`GameState.ts`) steps nothing: it keeps the screen, the gem and the run's
  facts that other components read (the room, the deaths, whether the character is dead, the time). The character keeps the
  clock (every step it plays; the camera's slides between rooms are not counted); `DashTrail` is the character's child and is given what it draws.
- **Rules are plain functions** (`src/rules/`), which know nothing of the engine's drawing: `body.ts` (one step of the body,
  read top to bottom: timers, what carries over, the state's rules, moving), with the parts in `body/`: `types.ts` (the body,
  whose `state` is `"normal"`, `"dash"` or `"climb"`), `normal.ts` (run, fall, duck, grab, jump), `dash.ts`, `climb.ts`,
  `jumps.ts` (every kind of jump), `collide.ts` (moving, and what happens when blocked) and `step.ts` (what a step shares);
  `player.ts` (the character's step, above), `level.ts` (the run's facts and how each outcome changes them, and `stepSim`,
  the character and the run stepped together for the solver and the rule-level tests), `rooms.ts` (rooms read from the
  Tiled maps, and what a body touches in one), `playback.ts` (what the engine does around the rules, for a driver without
  an engine), `constants.ts` (every number).
- **Rooms are Tiled maps** (`scenes/room1.tmj` …: a tile layer `Tiles`, a hidden layer `Markers`), 32 × 18 tiles of 10 px; the
  compiler writes `generated/tilemaps.ts` from them. Movement reads the same data the `<Tilemap>` draws. Room 1's start is the
  tile 8 on `Markers`, an exit is tile 7 (tile 9 for the last one). `tools/rooms.ts` holds the first drafts as text and
  `tools/make-rooms.ts` writes the maps from them; after that the maps are the source.
- **Engine features used**: fixed 60 Hz timestep, `<Tilemap>`, camera bounds/slide/shake, `<AnimatedSprite>` sheets, `<Particles>`,
  `<Fade>`, bitmap font, `freeze()`, `<Music>`, sound volume, gamepad keys, the engine's hooks `useSquash` and `useShake`, a
  `<Router>` for the screens, and `<Collider>` for the gem. Hazards, exits and the start are tiles read by the rules in the same step
  (a collision callback arrives after the frame, which would make a death a step late and untestable without the player).

## The rooms

| # | Name | Teaches | Needs |
| --- | --- | --- | --- |
| 1 | First steps | run, a short hop, a 4-tile gap over spikes | run + jump |
| 2 | Stepping stones | held jumps up 2-tile steps over spikes | jump height |
| 3 | Dash across | an 8-tile gap, too wide to jump | jump + dash |
| 4 | Dash up | a ledge 4 tiles up on the right, a second 5 above it on the left, the ceiling opening over that | up-dash, twice |
| 5 | The shaft | wall jumps up a 6-wide shaft | walls |
| 6 | Spikes on the wall | a shaft six tiles wide: spikes low on the left wall and high on the right, a ledge on the left between them, out along the top | climb or wall jump the right wall, wall jump onto the ledge, rest, up the left wall |
| 7 | Gem ledge | a spiked pit with a pillar; the **optional gem** is up and to the right | everything |
| 8 | Summit | stepping stones, a dash across, up the wall, the exit | everything |

**A solver finding a route is not the same as a person finding one.** Room 4 was first built with a ledge whose only route was a
contrived one, and room 6, after the switch to the Celeste body, had only the solver's route (a dash past the spike tips); both were
remade. So `test/rooms.test.ts` also checks that the dash moves of rooms 3 and 4 work over a window of at least a tenth of a second of
dash timings, not a single frame, and plays a person's route through room 6 from a range of heights. Rooms 1 and 2 are solved with no
dash; 4 and 6 cannot be solved without one. Room 3 can also be crossed by wall jumping out of the pit (one wall is a ladder).

## What "finished" means for the level

1. A scripted run (`test/replays.ts`, in the input-script format) finishes every room, in order, through the game itself, with no
   deaths, and at any frame rate (`test/rooms.test.ts`); `tools/solve.ts` finds the replays by searching over the rules and
   rewrites the file after any change to a room or a constant. A second replay takes the gem.
2. Title → eight rooms → end works from a button press to the end screen, headlessly, under Node and the Rust host (the parity
   run plays two rooms under both).
3. `npm run check:kite` passes: compile (maps, assets), type-check, tests, parity.
4. A person has played it and tuned the numbers: **not done**.

## The movement constants (`src/rules/constants.ts`)

Celeste's values, by Celeste's names where it has one (see the file; `test/movement.test.ts` checks each behaviour).
Kite's tiles are 10 px and Celeste's 8, so the same jump is about 2.8 Kite tiles where it is 3.5 of Celeste's. **None felt
yet** in this engine.

| Group | Values | Checked by a test |
| --- | --- | --- |
| run | 90 px/s, accel 1000, reduce 400, air × 0.65, duck friction 500 | reaches 90, stops |
| fall | gravity 900 (half below 40 px/s with jump held), max 160, fast fall to 240 at 300/s² | jump heights; fast fall ramps |
| jump | 105 px/s held 0.2 s, +40 toward the held direction, coyote 0.1 s, buffer 0.08 s, corner correction 4 px | held 26–30 px; windows |
| super jumps | super 260 px/s; hyper × 1.25 across, × 0.5 up; wall bounce 170 across, 160 up | each, from its inputs |
| dash | 240 px/s for 0.15 s, a step to read the direction, ends at 160 (× 0.75 up; down keeps 240), cooldown 0.2 s, refill after 0.1 s, freeze 3 steps | 8 ways equal; ends; refill |
| walls | jump check 3 px, push 130 px/s held away 0.16 s, slide from 20 px/s to 160 over 1.2 s, speed kept 0.06 s | slide, jump, reach |
| climb | stamina 110: up 45 px/s at 45/s, still 10/s, climb jump 27.5; down 80, slip 30, hop 120 up and 100 over | climb, let go, hop, climb jump |

The geometry the rooms need from them: a four-tile gap has a margin of at least 40 % of a running jump; an eight-tile gap
(room 3) is more than a jump (64 px) and less than a jump plus a dash; a ledge six tiles up needs the dash. With Celeste's
moves the rooms are easier than they were designed to be: a super jump crosses room 3's gap, grabbing climbs walls, and the
solver (which never grabs) finds every room in seconds. The rooms were made for a simpler body and have not been redesigned for
this one. If any constant changes, `npm run kite:solve` and the tests say
which room it breaks.

## Known limits

Hazard and exit shapes are tiles (spikes are half a tile deep), not arbitrary rectangles. The room seam is not continuous (the
character reappears standing on the next room's floor a little inside it, under the slide). One gem, no save, no settings, no
rebinding, no dialogue: those were left to Bramble. Art and sound are placeholders made by `tools/make-assets.ts`.

`src/Runner.tsx` is not part of the game: it is the normal state's ground moves written as a component with `useBody` and
`useMutable`, kept beside the rules so `test/runner.test.ts` can play both on the same input and show they agree.
