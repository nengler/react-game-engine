/**
 * The VS Code extension (`editors/vscode/extension.js`), driven by a stand-in for the `vscode` module: it finds the game's
 * `@rge/cli`, starts `rge lsp`, shows its diagnostics and turns its quick fixes into workspace edits. What VS Code itself does
 * with those (drawing squiggles, the light bulb) is not tested here.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const game = mkdtempSync(join(tmpdir(), "rge-vscode-"));
const disposables: { dispose(): void }[] = [];
after(() => {
  for (const d of disposables) d.dispose();
  rmSync(game, { recursive: true, force: true });
});

class Position {
  readonly line: number;
  readonly character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: number, b: number, c: number, d: number) {
    this.start = new Position(a, b);
    this.end = new Position(c, d);
  }
}
class Uri {
  readonly scheme: string;
  readonly fsPath: string;
  constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
  }
  static parse(value: string): Uri {
    return new Uri("file", fileURLToPath(value));
  }
  static file(path: string): Uri {
    return new Uri("file", path);
  }
  toString(): string {
    return pathToFileURL(this.fsPath).href;
  }
}

const sets: { uri: string; diagnostics: { code: string; source: string; range: Range; message: string }[] }[] = [];
let provider: { provideCodeActions(document: unknown, range: Range, context: unknown): Promise<any[]> } | null = null;
const listeners: Record<string, ((value: unknown) => void)[]> = {};
const on = (name: string) => (listener: (value: unknown) => void) => {
  (listeners[name] ??= []).push(listener);
  return { dispose() {} };
};

const fake = {
  Range,
  Uri,
  Diagnostic: class {
    source = "";
    code = "";
    readonly range: Range;
    readonly message: string;
    readonly severity: number;
    constructor(range: Range, message: string, severity: number) {
      this.range = range;
      this.message = message;
      this.severity = severity;
    }
  },
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  CodeAction: class {
    isPreferred = false;
    diagnostics: unknown[] = [];
    edit: unknown = null;
    readonly title: string;
    readonly kind: string;
    constructor(title: string, kind: string) {
      this.title = title;
      this.kind = kind;
    }
  },
  CodeActionKind: { QuickFix: "quickfix" },
  WorkspaceEdit: class {
    readonly replaced: { uri: string; range: Range; text: string }[] = [];
    replace(uri: Uri, range: Range, text: string): void {
      this.replaced.push({ uri: uri.toString(), range, text });
    }
  },
  window: { createOutputChannel: () => ({ append() {}, appendLine() {}, dispose() {} }) },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri: Uri, diagnostics: never[]) => sets.push({ uri: uri.toString(), diagnostics }),
      delete() {},
      clear() {},
      dispose() {},
    }),
    registerCodeActionsProvider: (_selector: unknown, given: typeof provider) => {
      provider = given;
      return { dispose() {} };
    },
  },
  workspace: {
    textDocuments: [] as unknown[],
    getConfiguration: () => ({ get: () => process.execPath }),
    onDidOpenTextDocument: on("open"),
    onDidChangeTextDocument: on("change"),
    onDidCloseTextDocument: on("close"),
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
};

const SOURCE = `import { Entity } from "@rge/runtime/jsx";\n\nexport function Lamp() {\n  const s = useMutable({ on: true });\n  return <Entity />;\n}\n`;

describe("the VS Code extension", () => {
  it("starts the game's rge lsp, shows its diagnostics, and offers its quick fixes as edits", async () => {
    writeFileSync(join(game, "package.json"), JSON.stringify({ name: "g", dependencies: { "@rge/runtime": "0.0.0" } }));
    mkdirSync(join(game, "src"));
    mkdirSync(join(game, "node_modules/@rge"), { recursive: true });
    symlinkSync(join(repo, "packages/cli"), join(game, "node_modules/@rge/cli"), "dir");
    const file = join(game, "src/Lamp.tsx");
    writeFileSync(file, SOURCE);

    const load = (Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown })._load;
    (Module as unknown as { _load: unknown })._load = (request: string, ...rest: unknown[]) => (request === "vscode" ? fake : load(request, ...rest));
    let extension: { activate(context: { subscriptions: { dispose(): void }[] }): void; cliOf(dir: string): string | null };
    try {
      extension = createRequire(import.meta.url)(join(repo, "editors/vscode/extension.js"));
    } finally {
      (Module as unknown as { _load: unknown })._load = load;
    }
    assert.equal(extension.cliOf(join(game, "src")), join(game, "node_modules/@rge/cli/src/cli.ts"));

    const context = { subscriptions: disposables };
    extension.activate(context);
    const document = { uri: Uri.file(file), languageId: "typescriptreact", version: 1, getText: () => SOURCE };
    for (const listener of listeners["open"]!) listener(document);

    const deadline = Date.now() + 30_000;
    while (sets.length === 0 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    const shown = sets.at(-1)!;
    assert.equal(shown.uri, pathToFileURL(file).href);
    assert.deepEqual(
      shown.diagnostics.map((d) => [d.code, d.source, d.range.start.line, d.range.start.character]),
      [["RGE1005", "rge", 3, 12]],
    );

    const actions = await provider!.provideCodeActions(document, shown.diagnostics[0]!.range, { diagnostics: shown.diagnostics });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].title, `Import 'useMutable' from "@rge/runtime/jsx"`);
    assert.equal(actions[0].isPreferred, true);
    assert.equal(actions[0].diagnostics.length, 1);
    assert.deepEqual(
      actions[0].edit.replaced.map((r: { range: Range; text: string }) => [r.range.start.line, r.range.start.character, r.range.end.character, r.text]),
      [[0, 8, 16, " Entity, useMutable "]],
    );
  });
});
