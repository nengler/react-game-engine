// The tse extension: starts the game's own language server (`tse lsp`, from the `@tsengine/cli` the game has installed)
// and shows its TSE diagnostics and quick fixes in the editor, beside TypeScript's own. It has no dependencies: the few messages
// of the Language Server Protocol it needs are spoken here directly.
//
// A file belongs to a game when a folder above it has a package.json with an "tse" field or a dependency on @tsengine/runtime. One
// server runs for each @tsengine/cli found (usually one per repository or game), and serves every game under it.
"use strict";

const vscode = require("vscode");
const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

/** The folder of the game a file is in, or null. */
function gameOf(file) {
  let dir = dirname(file);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, "utf8"));
        if (
          pkg.tse !== undefined ||
          (pkg.dependencies && pkg.dependencies["@tsengine/runtime"]) ||
          (pkg.devDependencies && pkg.devDependencies["@tsengine/runtime"])
        )
          return dir;
      } catch {
        // A package.json that does not parse: keep looking above it.
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The `tse` script of the @tsengine/cli a game resolves (its node_modules, or one above it), or null. */
function cliOf(game) {
  let dir = game;
  for (;;) {
    const manifest = join(dir, "node_modules", "@tsengine", "cli", "package.json");
    if (existsSync(manifest)) {
      try {
        const bin = JSON.parse(readFileSync(manifest, "utf8")).bin;
        const script = typeof bin === "string" ? bin : bin && bin.tse;
        if (script) return join(dirname(manifest), script);
      } catch {
        return null;
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** One running `tse lsp`, and the JSON-RPC around it. */
class Server {
  constructor(cli, output, onDiagnostics) {
    this.cli = cli;
    this.output = output;
    this.onDiagnostics = onDiagnostics;
    this.nextId = 0;
    this.pending = new Map();
    this.opened = new Set();
    this.buffer = Buffer.alloc(0);
    this.stopped = false;
    const node = vscode.workspace.getConfiguration("tse").get("node") || "node";
    this.child = spawn(node, [cli, "lsp"], { cwd: dirname(dirname(cli)), stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stderr.on("data", (chunk) => output.append(chunk.toString()));
    this.child.on("error", (error) => output.appendLine(`tse lsp could not start (${node} ${cli}): ${error.message}`));
    this.child.on("exit", (code) => {
      if (!this.stopped) output.appendLine(`tse lsp stopped (status ${code}). Run "tse: Restart the language server" to start it again.`);
      for (const { fail } of this.pending.values()) fail(new Error("the server stopped"));
      this.pending.clear();
    });
    this.ready = this.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: { textDocument: { publishDiagnostics: {}, codeAction: {} } },
    }).then(() => this.notify("initialized", {}));
  }

  read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString("ascii"));
      const length = match ? Number(match[1]) : 0;
      if (this.buffer.length < end + 4 + length) return;
      const body = this.buffer.subarray(end + 4, end + 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(end + 4 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.method === "textDocument/publishDiagnostics") this.onDiagnostics(message.params);
      else if (message.id !== undefined && this.pending.has(message.id)) {
        const { done, fail } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else done(message.result);
      }
    }
  }

  write(message) {
    if (this.child.exitCode !== null || this.child.stdin.destroyed) return;
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  request(method, params) {
    const id = ++this.nextId;
    return new Promise((done, fail) => {
      this.pending.set(id, { done, fail });
      this.write({ id, method, params });
    });
  }

  notify(method, params) {
    this.write({ method, params });
  }

  async open(document) {
    await this.ready;
    const uri = document.uri.toString();
    this.opened.add(uri);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: document.languageId, version: document.version, text: document.getText() },
    });
  }

  async change(document) {
    await this.ready;
    const uri = document.uri.toString();
    if (!this.opened.has(uri)) return this.open(document);
    this.notify("textDocument/didChange", {
      textDocument: { uri, version: document.version },
      contentChanges: [{ text: document.getText() }],
    });
  }

  async close(document) {
    await this.ready;
    const uri = document.uri.toString();
    if (!this.opened.delete(uri)) return;
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  async stop() {
    this.stopped = true;
    try {
      await Promise.race([this.request("shutdown", null), new Promise((done) => setTimeout(done, 1000))]);
      this.notify("exit", null);
    } catch {
      // Already stopped.
    }
    setTimeout(() => this.child.kill(), 1000).unref();
  }
}

const toRange = (r) => new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);

function activate(context) {
  const output = vscode.window.createOutputChannel("tse");
  const collection = vscode.languages.createDiagnosticCollection("tse");
  /** Servers by the @tsengine/cli they run. */
  const servers = new Map();
  const warned = new Set();
  context.subscriptions.push(output, collection);

  const onDiagnostics = (params) => {
    const uri = vscode.Uri.parse(params.uri);
    collection.set(
      uri,
      params.diagnostics.map((d) => {
        const diagnostic = new vscode.Diagnostic(
          toRange(d.range),
          d.message,
          d.severity === 2 ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = "tse";
        diagnostic.code = d.code;
        return diagnostic;
      })
    );
  };

  /** The server for a document of a game, started on first use; null for a file outside any game, or a game without @tsengine/cli. */
  const serverFor = (document) => {
    if (document.uri.scheme !== "file" || !/\.tsx?$/.test(document.uri.fsPath)) return null;
    const game = gameOf(document.uri.fsPath);
    if (game === null) return null;
    const cli = cliOf(game);
    if (cli === null) {
      if (!warned.has(game)) {
        warned.add(game);
        output.appendLine(`${game} has no @tsengine/cli installed (npm install --save-dev @tsengine/cli): no TSE diagnostics for it.`);
      }
      return null;
    }
    let server = servers.get(cli);
    if (server === undefined) {
      output.appendLine(`starting ${cli} lsp`);
      server = new Server(cli, output, onDiagnostics);
      servers.set(cli, server);
    }
    return server;
  };

  const report = (promise) => promise.catch((error) => output.appendLine(String(error)));
  for (const document of vscode.workspace.textDocuments) {
    const server = serverFor(document);
    if (server) report(server.open(document));
  }
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      const server = serverFor(document);
      if (server) report(server.open(document));
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const server = serverFor(event.document);
      if (server) report(server.change(event.document));
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const server = serverFor(document);
      if (server) report(server.close(document));
      collection.delete(document.uri);
    }),
    vscode.languages.registerCodeActionsProvider(
      [{ language: "typescriptreact", scheme: "file" }],
      {
        async provideCodeActions(document, range, context) {
          const ours = context.diagnostics.filter((d) => d.source === "tse");
          if (ours.length === 0) return [];
          const server = serverFor(document);
          if (server === null) return [];
          const toLsp = (r) => ({
            start: { line: r.start.line, character: r.start.character },
            end: { line: r.end.line, character: r.end.character },
          });
          let actions;
          try {
            actions = await server.request("textDocument/codeAction", {
              textDocument: { uri: document.uri.toString() },
              range: toLsp(range),
              context: { diagnostics: [] },
            });
          } catch {
            return [];
          }
          return (actions || []).map((a) => {
            const action = new vscode.CodeAction(a.title, vscode.CodeActionKind.QuickFix);
            action.isPreferred = a.isPreferred === true;
            action.diagnostics = ours.filter((d) =>
              a.diagnostics.some(
                (x) => x.code === d.code && x.range.start.line === d.range.start.line && x.range.start.character === d.range.start.character
              )
            );
            const edit = new vscode.WorkspaceEdit();
            for (const [uri, edits] of Object.entries(a.edit.changes))
              for (const e of edits) edit.replace(vscode.Uri.parse(uri), toRange(e.range), e.newText);
            action.edit = edit;
            return action;
          });
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.commands.registerCommand("tse.restart", async () => {
      for (const server of servers.values()) await server.stop();
      servers.clear();
      collection.clear();
      for (const document of vscode.workspace.textDocuments) {
        const server = serverFor(document);
        if (server) report(server.open(document));
      }
    }),
    { dispose: () => [...servers.values()].forEach((server) => server.stop()) }
  );
}

function deactivate() {}

module.exports = { activate, deactivate, gameOf, cliOf };
