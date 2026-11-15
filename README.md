# react-game-engine

A native-first, code-focused 2D game engine with React-like TSX authoring.
Components are written as TSX functions, but there is no React and no virtual
DOM: a compiler turns each component into an ordinary TypeScript class whose
children are persistent instances, updated in place when state changes.

It has a compiler, a runtime, and a native player that draws, plays sound and reads the keyboard, mouse and gamepads
through raylib: under Node while you develop (with hot reload and rewind), and packaged as one folder that runs on V8 or on a
small Rust + QuickJS-ng host. Three games are built on it: [Kite](packages/kite) (a precision platformer),
[Hearth](packages/hearth) (a tower defense) and [Bramble](games/bramble) (a top-down adventure made from the template, outside
the workspaces). Linux is the supported platform.

**Start with the [authoring guide](docs/index.html)** (open it in a browser): [Getting started](docs/start.html) goes from an
empty folder to a packaged game (`rge create my-game`, or `--template menu` / `--template platformer`), and
[Recipes](docs/recipes.html) has a menu, a settings screen, a health bar and other everyday pieces. For how it is built, read
[docs/DESIGN.md](docs/DESIGN.md) (the compiler, the runtime and every design decision), [docs/PLAYER.md](docs/PLAYER.md)
(the player, its ABI and its performance) and [docs/LAYOUT.md](docs/LAYOUT.md) (`<Flex>`, `<Hud>`, `<Screen>`). What is next is
in [docs/NEXT_PRIORITIES.md](docs/NEXT_PRIORITIES.md); what still trips a new author is [docs/PAIN_POINTS.md](docs/PAIN_POINTS.md).

```tsx
import { useMutable, Entity, Sprite, Collider } from "@rge/runtime/jsx";
import { WarningIcon } from "./WarningIcon.tsx";

function Player() {
  const s = useMutable({ health: 100 });
  return (
    <Entity>
      <Sprite image={s.health > 50 ? "normal.png" : "hurt.png"} />
      <Collider width={16} height={24} />
      {s.health < 25 && <WarningIcon />}
    </Entity>
  );
}
```

compiles to an ordinary TypeScript class (run `npm run example` and see `packages/example/generated/Player.ts`, with the IR
next to it as `Player.ir.json`).

Game code lives in components, as in React: a component keeps its own state (`useMutable`, written directly as `s.hp -= 1`
and read back at once in a handler, or `useBody` for a position that walls stop), steps itself in `useUpdate`, takes hits in its collider's `onCollisionEnter`, and tells its parent what happened through
callback props. [Hearth](packages/hearth) is built that way: its enemies, towers and shots each keep their own state, and each is
tested alone with [`@rge/testing`](packages/testing), as React Testing Library tests one component. Plain functions in `.ts`
files are for what you would extract in React too: tables, pure calculations, and code a search runs thousands of times.

UI is laid out, not placed by hand. A `<Hud>` stays on screen while the camera moves, and a `<Flex>` in it places its
children in a row or a column (see [docs/LAYOUT.md](docs/LAYOUT.md)):

```tsx
import { useMutable, Flex, Hud, Sprite, Text } from "@rge/runtime/jsx";

interface PlayerHudProps {
  coins: number;
}

function PlayerHud({ coins }: PlayerHudProps) {
  const s = useMutable({ paused: false });
  return (
    <Hud>
      <Flex width="grow" height="grow" direction="column" justifyContent="space-between" padding={16}>
        <Flex alignItems="center" gap={8}>
          <Sprite image="coin.png" />
          <Text size={20}>{coins}</Text>
          <Flex width="grow" />
        </Flex>
        <Flex justifyContent="center">
          <Flex paddingX={16} paddingY={8} background="slategray" onPress={() => { s.paused = !s.paused; }}>
            <Text>{s.paused ? "Resume" : "Pause"}</Text>
          </Flex>
        </Flex>
      </Flex>
    </Hud>
  );
}
```

## Layout

```
packages/
  compiler/   TSX → IR → TypeScript compiler (uses the TypeScript 7.1 API)
    src/parser/       TypeScript 7.1 parsing (typescript/sync)
    src/analyzer/     component / hook / JSX discovery (analyzer.ts; the rest in model.ts, matchers.ts, component.ts and util.ts)
    src/ir/           IR types, split by kind (types.ts re-exports them) and hook/handler signatures (handlers.ts)
    src/transform/    analysis → IR; ComponentLowering is layered over lowering.ts, expressions.ts, hooks.ts and elements.ts
    src/generator/    IR → TypeScript; ComponentGenerator is layered over expressions.ts, handlers.ts and elements.ts
    src/typecheck/    type-checking generated code with TypeScript 7.1
    src/diagnostics/  diagnostic codes and formatting
    test/             end-to-end tests
  runtime/    the authoring entry point (`@rge/runtime/jsx`: typed hooks and built-in elements), GameObject and World,
              the built-ins (Entity, Sprite, Text, Flex, Button, Menu, Tilemap, …), the game state, sound, saves,
              `loadScene`, and `runtimeManifest` (what the compiler is told about the runtime)
  player/     the player's pure-TypeScript half: object tree → draw records, layout, collisions, the fixed step, a recording backend
  player-node/ the Node host: the binding to `librge`, `rge dev` (hot reload, rewind, the inspector), screenshots, previews
  cli/        `rge`: create, dev, check, build, screenshot, preview, package, lsp; and the game templates
  testing/    `@rge/testing`: mount one compiled component in a headless world and test it, as React Testing Library does
  language-server/ `rge lsp`: the compiler's RGE diagnostics in the editor (editors/vscode is the VS Code extension)
  native/     `@rge/native`: where the built librge and host are found
  demo/       a small playable game; `npm run play:demo`
  kite/       a precision platformer: `npm run play:kite`, `npm run check:kite`
  hearth/     a tower defense: `npm run play:hearth`, `npm run check:hearth`
  example/    example components (their generated output is not committed: `npm run generate`)
native/       librge, in C over raylib: the ABI every host calls (native/include/rge.h)
host/         the small host: Rust + QuickJS-ng, linked statically against librge, for `--engine quickjs`
games/bramble a top-down adventure made from the template, checked from outside the repository by `npm run check:outside`
```

## Usage

Requires Node.js ≥ 22.18 (TypeScript files run directly via type stripping).

```sh
npm install
npm test            # full pipeline tests
npm run typecheck   # tsc 7.1 over the packages, their tests and the generated games
npm run ci:local    # the CI workflow's jobs, on this machine
npm run lint        # oxlint
npm run format      # oxfmt --write (format:check to only verify)
npm run example     # recompile packages/example/src → packages/example/generated, and check its scenes

# The native player (needs cmake and a C compiler; on Linux, the X11/GL dev packages for a real window)
npm run native:build    # librge with a real window → native/build
npm run play:demo       # play the demo under Node, with hot reload: save a file under src/ and the window updates
npm run package         # packages/demo/dist/demo/: the game on Node's V8 as one executable (~125 MB; 10-30x faster script)
npm run package -- --engine quickjs   # packages/demo/dist/demo/: the Rust host (needs cargo), game.js and assets/; a few MB, no JIT
```

### Releases

Pushing a tag `vX.Y.Z`, or running the Release workflow from the Actions tab with a version (it tags the branch it runs on),
runs [`.github/workflows/release.yml`](.github/workflows/release.yml): it builds the packs (as
`npm run dist`, stamped with that version) and attaches them to a GitHub release. A game outside this repository can depend
on them by URL instead of building the engine itself (Linux x64 only, as the native binaries are built there):

```json
"@rge/runtime": "https://github.com/nengler/react-game-engine/releases/download/v0.1.0/rge-runtime-0.1.0.tgz"
```

List every `@rge/*` package the game uses at the same release; each pack depends on the others at its own version.

Programmatic use:

```ts
import { Compiler } from "@rge/compiler";

const compiler = new Compiler({ runtimeModule: "@rge/runtime" });
try {
  const result = compiler.compile("Player.tsx", source);
  if (result.ok) {
    console.log(result.code);                                         // generated TypeScript
    console.log(compiler.typeCheck([{ fileName: "/abs/Player.ts", text: result.code }]));
  } else {
    console.error(result.diagnostics);
  }
} finally {
  compiler.close(); // stops the TypeScript 7 server process
}
```

Compiler output (`packages/*/generated`) is not committed: `npm run generate` makes it, and `npm test` and
`npm run typecheck` run it first. CI does the same.

## License

MIT, see [LICENSE](LICENSE).
