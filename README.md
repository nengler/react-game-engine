# react-game-engine

A native-first, code-focused 2D game engine with React-like TSX authoring.
Components are written as TSX functions, but there is no React and no virtual
DOM: a compiler turns each component into an ordinary TypeScript class whose
children are persistent instances, updated in place when state changes.

This repository contains the **compiler** (Phase 2, M0–M15), the runtime, and the
**native player** (Phase 3, N0–N6): a compiled game draws, plays sound and reads the
keyboard and mouse through raylib, under Node during development and as a small Rust +
QuickJS-ng executable that ships without Node. **Start with the [authoring guide](docs/index.html)** (open it in a browser: syntax, hooks, elements, how a frame runs, error codes). See [docs/DESIGN.md](docs/DESIGN.md) for the
architecture, the IR, the ground rules and the design decisions, and
[docs/NATIVE_PLAN.md](docs/NATIVE_PLAN.md) for the player's design, its ABI and its performance baseline. What comes next, including Phase 4 (a real game drives the backlog), is ranked in [docs/NEXT_PRIORITIES.md](docs/NEXT_PRIORITIES.md).

```tsx
import { useState, Entity, Sprite, Collider } from "@rge/runtime/jsx";
import { WarningIcon } from "./WarningIcon.tsx";

function Player() {
  const [health, setHealth] = useState(100);
  return (
    <Entity name="Player">
      <Sprite image={health > 50 ? "normal.png" : "hurt.png"} />
      <Collider width={16} height={24} />
      {health < 25 && <WarningIcon />}
    </Entity>
  );
}
```

compiles to [`packages/example/generated/Player.ts`](packages/example/generated/Player.ts)
(the IR is next to it as `Player.ir.json`).

UI is laid out, not placed by hand. A `<Hud>` stays on screen while the camera moves, and a `<Flex>` in it places its
children in a row or a column (see [docs/UI_PLAN.md](docs/UI_PLAN.md)):

```tsx
import { useState, Flex, Hud, Sprite, Text } from "@rge/runtime/jsx";

interface PlayerHudProps {
  coins: number;
}

function PlayerHud({ coins }: PlayerHudProps) {
  const [paused, setPaused] = useState(false);
  return (
    <Hud>
      <Flex width="grow" height="grow" direction="column" justifyContent="space-between" padding={16}>
        <Flex alignItems="center" gap={8}>
          <Sprite image="coin.png" />
          <Text size={20}>{coins}</Text>
          <Flex width="grow" />
        </Flex>
        <Flex justifyContent="center">
          <Flex paddingX={16} paddingY={8} background="slategray" onPress={() => setPaused((p) => !p)}>
            <Text>{paused ? "Resume" : "Pause"}</Text>
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
  runtime/    the authoring entry point (`@rge/runtime/jsx`: typed hooks and built-in elements for
              component source), and the mock GameObject / World (with `tick` / `reportCollision` / `reportPress`),
              the built-ins (Entity, Sprite, Collider, Text, Shape, Camera, AnimatedSprite, Pointer, Screen, Hud, Flex),
              Sound (a mock that records plays), `loadScene`, and `runtimeManifest`
              (what the compiler is told about the runtime)
  player/     (Phase 3) the native player's pure-TypeScript half: object tree → draw records, `Backend`, a recording backend for tests
  player-node/ (Phase 3) the Node host: koffi binding to `librge`, and `play.ts`
  host/       (Phase 3) the shipping host: Rust + QuickJS-ng, linked statically against librge; `npm run package`
  demo/       (Phase 3) a small playable game in TSX with its generated output and assets; `npm run play:demo`
  example/    example components and their committed generated output
```

## Usage

Requires Node.js ≥ 22.18 (TypeScript files run directly via type stripping).

```sh
npm install
npm test            # full pipeline tests
npm run typecheck   # tsc 7.1 over compiler, runtime, tests and generated example
npm run example     # recompile packages/example/src → packages/example/generated, and check its scenes

# The native player (needs cmake and a C compiler; on Linux, the X11/GL dev packages for a real window)
npm run native:build    # librge with a real window → native/build
npm run play:demo       # play the demo under Node
npm run package         # dist/demo/: the game on Node's V8 as one executable (~125 MB; 10-30x faster script)
npm run package -- --engine quickjs   # dist/demo/: the Rust host (needs cargo), game.js and assets/; a few MB, no JIT
```

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

CI (`.github/workflows/ci.yml`) runs the tests and the typecheck, then regenerates the
example and fails if `packages/example/generated` changed: commit regenerated output with any codegen change.
