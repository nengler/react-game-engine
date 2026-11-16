# Working on the engine (for AI agents)

tse is a 2D game engine: TSX components compiled to TypeScript classes (`packages/compiler`), a backend-free runtime
(`packages/runtime`), a pure-TypeScript player (`packages/player`) and a native layer over raylib (`native/`, `host/`). README.md
has the layout; docs/DESIGN.md, docs/PLAYER.md and docs/LAYOUT.md say why each piece is shaped as it is. A game made with the
engine gets its own guide for agents: `packages/cli/template/AGENTS.md`.

## Checks

| What | Command |
| --- | --- |
| Every test (compiles the example games first) | `npm test` (about 90 s) |
| One package's or one file's tests | `node --test packages/player/test/session.test.ts` (run `npm run generate` once first) |
| Types | `npm run typecheck`, or `npx tsc -p tsconfig.json` for the packages alone |
| Lint and format | `npm run lint`, `npm run format` (`format:check` only verifies) |
| What CI runs | `npm run ci:local` |
| A game, all at once | `node packages/cli/src/cli.ts check packages/kite --json` |
| The headless native build (screenshots, pixel tests) | `npm run native:build:headless` (cmake, a C compiler; fetches raylib) |

After changing a section of the HTML guide (`docs/*.html`), run `node tools/docs-index.ts`; a test checks the search index.

## Seeing a game without a window

- `node packages/cli/src/cli.ts session packages/hearth`: a game driven a request a line on stdin, one JSON answer a line
  (`input right*30`, `step 60`, `observe components`, `state Play`, `snapshot x`, `restore x`, `reload`, `screenshot`, `help`).
  `tse mcp` is the same as an MCP server. The core is `Session` in `packages/player/src/session.ts`.
- `describeScene` / `sceneText` (`packages/runtime/src/describe.ts`): any tree as indented text, with world positions, texts,
  colliders, props and state. `render(…).describe()` in a component test.
- `runScript` (`packages/player/src/harness.ts`): a whole scripted run on a recording backend, observing each step.
- `node packages/cli/src/cli.ts screenshot packages/demo --script "right*20" --at 19 --out /tmp/shots`: PNGs through the software
  renderer.

## Ground rules

- `@tsengine/runtime` and `@tsengine/player` import no `node:` module and no native package: they run under QuickJS (a test checks).
- The runtime never draws, plays or polls: backends plug in through sinks.
- `native/include/tse.h` is the protocol's source of truth: change it first, bump `TSE_ABI_VERSION`, then `protocol.ts`.
- Logic goes in TypeScript unless it needs the GPU, the OS or audio.
- A run must repeat: the same input gives the same frames (parity runs under Node twice and under the Rust host). No `Math.random`
  or wall clock in engine or game logic; games use the seeded `roll` functions.
- A new runtime function a component may call is listed in `packages/runtime/src/manifest.ts` (`functions`), or the compiler
  refuses it; a new built-in needs an entry in `docs/reference.html`.
- Generated code (`packages/*/generated`) is not committed; `npm run generate` writes it.
- The docs describe the code as it is. When something is built, it leaves docs/NEXT_PRIORITIES.md and its reasons go into
  DESIGN.md or PLAYER.md.
