# tse for VS Code

Shows the engine compiler's `TSE` diagnostics in a game's components as you type, with quick fixes, beside TypeScript's own
errors. Without it they appear only when the compiler runs: on save under `tse dev`, or in `tse check`.

- **Diagnostics** for every `.tsx` in a game's source folder (`src/`, or the `"tse"` field's `src`), as the editor has it, unsaved
  changes included. A change to `GameState.ts` or to a custom hook updates the components that use it.
- **Quick fixes** for the messages that say what to write instead: a missing import from `@tsengine/runtime/jsx`, an import from
  `"react"`, `useEffect(…, [])` (to `useMount`), `useMemo` and `useCallback` (to the value and the function), `<Text text=…>` (to
  children), a whole-state selector (to `useGame.actions()`), and a name the engine does not export.

It runs the game's own `tse lsp` (from `@tsengine/cli`, which every game has as a dev dependency), so its messages always match the
engine the game is built with. A game is a folder whose `package.json` has an `"tse"` field or depends on `@tsengine/runtime`.

## Install

Nothing is published. From the engine's repository:

    npm run vscode:pack
    code --install-extension dist/tse-vscode-0.0.1.vsix

It needs Node.js 22.6 or later on the `PATH` (or set `tse.node` to its path). **tse: Restart the language server**
starts it again after the engine is updated. Its output is in the **tse** output panel.

Other editors: run `tse lsp` in the game's folder as a language server for `typescriptreact` files (stdin and stdout).
