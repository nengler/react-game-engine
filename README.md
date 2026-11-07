# react-game-engine

A native-first, code-focused 2D game engine with React-like TSX authoring.
Components are written as TSX functions, but there is no React and no virtual
DOM: a compiler turns each component into an ordinary TypeScript class whose
children are persistent instances, updated in place when state changes.

This repository currently contains the **first vertical slice of the
compiler** and a minimal mock runtime. See [docs/DESIGN.md](docs/DESIGN.md)
for the architecture, the IR, and the design decisions.

```tsx
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

## Layout

```
packages/
  compiler/   TSX → IR → TypeScript compiler (uses the TypeScript 7.1 API)
    src/parser/       TypeScript 7.1 parsing (typescript/sync)
    src/analyzer/     component / hook / JSX discovery
    src/ir/           IR types
    src/transform/    analysis → IR
    src/generator/    IR → TypeScript
    src/typecheck/    type-checking generated code with TypeScript 7.1
    src/diagnostics/  diagnostic codes and formatting
    test/             end-to-end tests
  runtime/    mock GameObject / World (with `tick` / `reportCollision`), Entity, Sprite, Collider,
              and `runtimeManifest` (what the compiler is told about the runtime)
  example/    example components and their committed generated output
```

## Usage

Requires Node.js ≥ 22.18 (TypeScript files run directly via type stripping).

```sh
npm install
npm test            # full pipeline tests
npm run typecheck   # tsc 7.1 over compiler, runtime, tests and generated example
npm run example     # recompile packages/example/src → packages/example/generated
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
