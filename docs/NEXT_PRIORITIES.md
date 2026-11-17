# What is next

As of 2026-11-15: what is being worked on, what is open, and what waits. When something is built it leaves this
file; how it works and why goes into [DESIGN.md](DESIGN.md), [PLAYER.md](PLAYER.md) or [LAYOUT.md](LAYOUT.md), and the plans
that led there are in git history. What still trips a new author is in [PAIN_POINTS.md](PAIN_POINTS.md).

It is mostly for the author, making their own games; open-sourcing it is a goal for later. A real game comes first,
readiness for other people second. It is local first: a game is written, played and packaged on one desktop machine. There is no
web backend and no hosted build. A release publishes the `@tsengine/*` packs to npm (README, "Releases").

## Now (decided 2026-11-15)

After a review of the engine as a whole (three games, about 1,800 tests, the new-game flow checked from an empty folder), the
author set this order. Each step lands as its own PR, checked with `npm run ci:local` while Actions has no minutes. The web
backend and QuickJS performance are set aside for now.

| # | Step | Status |
| --- | --- | --- |
| 1 | Finish the game-state migration: every game on `createGameState(data, actions)` | Done (#144) |
| 2 | Fix the docs: the guide and the notes match the code | Done: the notes were cut to DESIGN.md, PLAYER.md, LAYOUT.md, the game docs and this file |
| 3 | Props read live everywhere, and React subset gaps | Done (#146) |
| 4 | Checking visuals with a GPU renderer (`tse screenshot --gpu`) | Done (#147) |
| 5 | Render targets and blend modes (`<Layer>`, ABI v10) | Done (#151) |
| 6 | Shaders on layers (ABI v11) | Done (#153) |
| 7 | Lighting: `<Lighting>` and `<Light>` (ABI v12), no shadows | Done (#154) |
| 8 | Collider shapes: circles and convex polygons. Solid shapes and slopes are not planned | Done (#155, #157) |
| 9 | Cutscenes: `sequence`, `wait`, `tween`, `parallel`; Bramble's first visit to the cave | Done (#156) |
| 10 | A web backend (`@tsengine/player-web`, WebGL2) and `tse package --engine web`, so a game plays in a browser and on a phone | Done |

Every step is done; the next order has not been set.

## Waiting on a person

These cannot be checked in a cloud container, and each has found bugs the tests did not.

- macOS (decided 2026-11-15: the owner will make games on a Mac). Nobody has built or run anything on a Mac by hand: libtse's CMake build,
  `tse dev`, `tse package` (both engines), the link lists in `host/build.rs` and the storage paths are written for it but
  unverified beyond what the release workflow's platform matrix runs (the builds, the C smoke test, the Node host on the software
  renderer and the demo's parity under tse-host, on macOS arm64 and x64 and on Windows x64; a `dry_run` dispatch runs it without
  releasing). PR CI is Linux only. Play the demo in a real window there (on a Retina screen: shapes and text should be sharp, layers and clipped panels in place), file what breaks.
- Play in a real window: the demo and Hearth under Node and packaged (V8 and `--engine quickjs`); Bramble packaged; rewind in
  `tse dev`. Kite and Bramble have been played under Node on a Linux desktop, with sound.
- A save across a real quit under both hosts (each host was only tested against libtse separately).
- A map saved by Tiled itself. Every map so far was written by a tool, so the importer has never seen a file Tiled wrote.
  Open Bramble's overworld in Tiled, save it, and fix what breaks.
- The guide followed from scratch by someone who did not write it, from an empty folder to a packaged game.
- The language server in a real editor (`editors/vscode`); it is tested only through `tools/lsp-smoke.ts`.
- Hearth's balance: the replay table holds at seed 1, but an early mortar's scatter decides some seeds. Look at it when
  someone plays it.

## Backlog: not now, and what would pull it in

Each row waits because nothing above depends on it or no game has asked for it yet.

### Engine and player

| Item | Why it waits | What would pull it in |
| --- | --- | --- |
| Windows | Link lists and Node packaging steps are written but unverified | Someone wanting to play there |
| One-file executable, a smaller V8 build, signing | A package as a folder works; `--engine node` ships all of Node, about 125 MB | Handing a build to someone else, or open-sourcing |
| SDL3 platform layer, native code generation | Large, and nothing measured asks for them | Consoles, or script time dominating |
| QuickJS: a 10 ms target for 2,000 objects with colliders, bench budgets in CI | V8 is the main engine since 2026-11-10; QuickJS is the JIT-free fallback | Shipping to a platform that bans a JIT |
| Layouts kept by subtree, not only by root | A root nothing changed under keeps its layout (2026-11-17), but one changed text lays out the whole root again: Hearth's side panel is one root, changed on 45 % of the frames of its replay | A HUD whose layout shows in a profile again |
| An action of the game state without a copy of the whole state | Every action copies the state's data, runs on the copy, then compares it leaf by leaf with the state (`GameStore.#act`). A tower defence that gives XP for each hit, and for each step of each burn, spends 5 % of its step in them | A game with a large state, or actions called many times a step |
| Hearth wave 10 under QuickJS (99th percentile about 29 ms) | Fine under V8 | A hitch seen in the last waves: move the enemy's position out of its props, or draw all health bars from one component |
| Hot reload of changed asset files | Needs a restart today, and each build stays in memory | A session long enough for it to hurt |
| Tiled importer gaps: integer checks, template properties, zstd layers, infinite maps, collections of images | Each says so when met | A map that uses them |
| `hsl()` colours; Router cross-fades and nested routers | Not asked for; `<Layer opacity>` may make cross-fades cheap now | A game wanting them |
| Rewind restoring effects (particles in flight, playing sounds) | Rewind snapshots component state only | Rewind being used in anger |

### Compiler and language

| Item | Why it waits | What would pull it in |
| --- | --- | --- |
| Spread onto a built-in (`<Shape {...p} />`, `TSE1203`) | Needs the keys from the manifest's members; no game wanted it | A game writing it |
| Destructuring declarations inside a block | Never hit by a game | An author hitting it |
| `save: false` on a field, to keep it out of saves | No game needs it; Hearth does not save mid-wave | A game with state that must not be saved |
| Errors inside a custom hook naming the hook's line and the call | Hooks are inlined, so the error points at the expansion | Custom hooks used widely |
| A `transition` layer (transforms eased by the runtime, with no renders), and a clock that runs while `<Game paused>` | The motion hooks cost enough for now; a pause menu cannot animate | A game where the hooks cost too much, or an animated pause menu |
| A warning when a helper in a `.ts` file changes an item of a `useMutable` list in place | It shows nothing, as in React (PAIN_POINTS.md) | Someone losing time to it |
| The refusal for writing every item of a list naming the pattern that works (build a local, assign once) | The cost is quadratic but unmeasured past Hearth's wave 10 | A list big enough to show it |
| A keyed list guarded by what it reads, like the parts of `render()` that set a built-in's props (`RenderGuard`) | Measured 2026-11-17: a component with a field written every step (a wave's clock) goes through each of its lists every step, 5.8 % of a step of a tower defence with four lists in its battle component, 3.3 % of Hearth's. The guard needs every expression in the list's block (source, key, item props, the item's children and conditions) to be one whose changes a comparison sees. It also changes what shows: an item a `.ts` helper changed in place is drawn today whenever the component renders for another reason (PAIN_POINTS.md, 5), and would not be | A battle component whose render shows in a profile, or QuickJS frame time mattering again |
| A handler reading the game state live, and a list inside a list item read live | Both read the last render; nothing has minded. A list item's own props find it by a map of the list's keys since 2026-11-17 (Swarm) | A bug traced to it |
| Swarm's crowd at 60 Hz with every weapon: 1,500 enemies take 14.8 ms of script time, 24 ms at the 99th percentile (games/swarm/DESIGN.md, "What would close the rest") | Without weapons 1,500 fit (9.3 ms); what is left is the price of an enemy's three objects | A game that size: a data-oriented crowd (one component drawing every enemy from arrays), then a `limit` on `nearby`; a pass over the tree costs about the same whatever it does (collisions without a draw walk, 2026-11-17, saved 0.1 to 1 ms, not the 1.5 hoped) |
| A compiler error for a field read in a closure after narrowing without a `const` | TypeScript catches most of it | A confusing runtime error from it |
| Asset names in a `.ts` file (`createSounds`) checked at build time | Names in components are checked | A typo that ships |
| A body that others hit as a collider, one-way platforms | `useBody` moves against tiles and solid colliders only | A platformer that needs them |

### Layout

The open layout items (text wrapped to its box, aspect-ratio boxes, transitions, wrapping columns and grids, dragging scroll
bars, nine-slice options, sliders, a sharp `<Hud>` over a pixel-art world, several canvases) are in [LAYOUT.md](LAYOUT.md),
"Not built, and what would pull it in".

### Tooling

| Item | Why it waits | What would pull it in |
| --- | --- | --- |
| The overlay outlining gaps between boxes | The box outlines are enough so far | A layout that is hard to read |
| A live playground in the guide | Needs the compiler and a backend in the browser | The web backend |
| Rewind for players | Needs snapshots in packaged builds | A game designed around it |

## Held, or decided against

- `useEffect` stays out; DESIGN.md, "Why there is no `useEffect`", says what replaces each use. `useChange(value, prev => …)`,
  the one use with no answer yet, is held for a separate discussion.
- Collision shapes are circles and convex polygons only, for now (2026-11-15): no solid shapes or slopes.
- No macOS or Windows CI until a build works there (2026-11-09; the macOS step above would change it).
- Actions stay the only writers of the game state. A shortcut for small writes (a `free: [...]` list) is open, but no game has
  asked for one.
- Allowing a field write in `useUnmount` (refused today, `TSE1402`) is open.
