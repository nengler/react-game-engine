# tse

A native-first, code-focused 2D game engine with React-like TSX authoring.
Components are written as TSX functions, but there is no React and no virtual
DOM: a compiler turns each component into an ordinary TypeScript class whose
children are persistent instances, updated in place when state changes.

It has a compiler, a runtime, and a native player that draws, plays sound and reads the keyboard, mouse and gamepads
through raylib. The player runs under Node while you develop (with hot reload and rewind); a packaged game is one folder that
runs on V8 or on a small Rust + QuickJS-ng host. Three games are built on it: [Kite](packages/kite) (a precision platformer),
[Hearth](packages/hearth) (a tower defense) and [Bramble](games/bramble) (a top-down adventure made from the template, outside
the workspaces). Linux is the supported platform.

Start with the [authoring guide](docs/index.html) (open it in a browser): [Getting started](docs/start.html) goes from an
empty folder to a packaged game (`tse create my-game`, or `--template menu` / `--template platformer`), and
[Recipes](docs/recipes.html) has a menu, a settings screen, a health bar and other everyday pieces. For how it is built, read
[docs/DESIGN.md](docs/DESIGN.md) (the compiler, the runtime and every design decision), [docs/PLAYER.md](docs/PLAYER.md)
(the player, its ABI and its performance) and [docs/LAYOUT.md](docs/LAYOUT.md) (`<Flex>`, `<Hud>`, `<Screen>`). What is next is
in [docs/NEXT_PRIORITIES.md](docs/NEXT_PRIORITIES.md); what still trips a new author is [docs/PAIN_POINTS.md](docs/PAIN_POINTS.md).

```tsx
import { useMutable, Entity, Sprite, Collider } from "@tsengine/runtime/jsx";
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
tested alone with [`@tsengine/testing`](packages/testing), as React Testing Library tests one component. Plain functions in `.ts`
files are for what you would extract in React too: tables, pure calculations, and code a search runs thousands of times.

UI is laid out with `<Flex>`. A `<Hud>` stays on screen while the camera moves, and a `<Flex>` in it places its
children in a row or a column (see [docs/LAYOUT.md](docs/LAYOUT.md)):

```tsx
import { useMutable, Flex, Hud, Sprite, Text } from "@tsengine/runtime/jsx";

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
  runtime/    the authoring entry point (`@tsengine/runtime/jsx`: typed hooks and built-in elements), GameObject and World,
              the built-ins (Entity, Sprite, Text, Flex, Button, Menu, Tilemap, …), the game state, sound, saves,
              `loadScene`, and `runtimeManifest` (what the compiler is told about the runtime)
  player/     the player's pure-TypeScript half: object tree → draw records, layout, collisions, the fixed step, a recording backend
  player-node/ the Node host: the binding to `libtse`, `tse dev` (hot reload, rewind, the inspector), screenshots, previews
  cli/        `tse`: create, dev, check, build, screenshot, preview, package, lsp; and the game templates
  testing/    `@tsengine/testing`: mount one compiled component in a headless world and test it, as React Testing Library does
  language-server/ `tse lsp`: the compiler's TSE diagnostics in the editor (editors/vscode is the VS Code extension)
  native/     `@tsengine/native`: where the built libtse and host are found
  demo/       a small playable game; `npm run play:demo`
  kite/       a precision platformer: `npm run play:kite`, `npm run check:kite`
  hearth/     a tower defense: `npm run play:hearth`, `npm run check:hearth`
  example/    example components (their generated output is not committed: `npm run generate`)
native/       libtse, in C over raylib: the ABI every host calls (native/include/tse.h)
host/         the small host: Rust + QuickJS-ng, linked statically against libtse, for `--engine quickjs`
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
npm run native:build    # libtse with a real window → native/build
npm run play:demo       # play the demo under Node, with hot reload: save a file under src/ and the window updates
npm run package         # packages/demo/dist/demo/: the game on Node's V8 as one executable (~125 MB; 10-30x faster script)
npm run package -- --engine quickjs   # packages/demo/dist/demo/: the Rust host (needs cargo), game.js and assets/; a few MB, no JIT
```

### Releases

Pushing a tag `vX.Y.Z`, or running the Release workflow from the Actions tab with a version (it tags the branch it runs on),
runs [`.github/workflows/release.yml`](.github/workflows/release.yml). It builds libtse and tse-host on Linux x64, macOS
arm64 and x64, and Windows x64, and smoke-tests each (C smoke test, the Node host against the software renderer, the demo's
parity run under tse-host). Then it packs the engine with every platform's binaries in `@tsengine/native` (stamped with that
version), attaches the packs to a GitHub release and publishes them to npm as `@tsengine/*`, with provenance. The platform
matrix is about 25 runner-minutes a release (free while the repository is public). To try it without releasing, run the
workflow from the Actions tab with `dry_run` ticked: it builds, tests and packs everything and keeps the packs as the run's
artifact, but neither releases nor publishes. A game made on the engine is packaged on the platform it is for: run
`tse package` on each (for example in a matrix in the game's own CI).

What a player needs besides the packaged game:

- **Windows:** the Microsoft Visual C++ runtime (the "VC++ Redistributable", x64). libtse and tse-host link it dynamically,
  and a Windows machine without it reports a missing `VCRUNTIME140.dll`. Many machines already have it; ship the
  redistributable with the game, or point players to it.
- **macOS:** `tse package` signs the game ad hoc (`codesign --sign -`). It is not notarized, so Gatekeeper refuses a
  downloaded copy the first time ("cannot be opened because the developer cannot be verified"). The player opens it with
  right-click, Open, or clears the quarantine flag: `xattr -d com.apple.quarantine <game>`. Notarizing needs an Apple
  developer account and is not done by the engine.
- **Linux:** x64 with glibc 2.38 or newer (Ubuntu 23.10 and 24.04 or later): the release builds on Ubuntu 24.04, and the
  binaries ask for nothing newer than `GLIBC_2.38`.

Publishing uses npm's trusted publishing: npm accepts the Release workflow's own identity, so no npm token is stored anywhere.
It is set up once:

1. the `tsengine` organization on npm (npmjs.com, Add Organization; the free plan publishes public packages), which owns the
   `@tsengine` scope;
2. each package's first version published by hand, since a trusted publisher is set on a package that exists: download
   the release's eight `.tgz` files and, after `npm login`, `npm publish <file> --access public` for runtime, compiler,
   player, native, player-node, testing, language-server and cli, in that order (each names the ones before it);
3. on npmjs.com, each package's Settings, Trusted Publisher, GitHub Actions: owner `nengler`, repository `tse`, workflow
   `release.yml`; then, under publishing access, require two-factor authentication and disallow tokens, so only the
   workflow can publish.

If publishing fails after the release was made, run the workflow again with the same version: it publishes the packs
already attached to the release, so npm and the release's URLs serve the same files, and skips what is already on npm.
Once a release is on npm, a game starts with:

```sh
npx @tsengine/cli@latest create my-game     # pins every @tsengine/* package to that release
cd my-game && npm install && npm run check
```

Every `@tsengine/*` package a game uses should be at the same release; each depends on the others at its own version.

Programmatic use:

```ts
import { Compiler } from "@tsengine/compiler";

const compiler = new Compiler({ runtimeModule: "@tsengine/runtime" });
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
