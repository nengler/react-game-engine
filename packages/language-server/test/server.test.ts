import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
/**
 * The language server end to end: started as `tse lsp` would start it (its own process, stdin and stdout), given a game in a
 * temporary folder, and spoken to as an editor would.
 */
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyEdits } from "../src/fixes.ts";
import { LineMap } from "../src/server.ts";

const main = resolve(dirname(fileURLToPath(import.meta.url)), "../src/main.ts");
const game = mkdtempSync(join(tmpdir(), "tse-lsp-"));
after(() => rmSync(game, { recursive: true, force: true }));

interface Received {
  readonly id?: number;
  readonly method?: string;
  readonly params?: any;
  readonly result?: any;
}

class Client {
  readonly #child: ChildProcess;
  readonly #waiting: { test: (m: Received) => boolean; done: (m: Received) => void }[] = [];
  readonly #seen: Received[] = [];
  #id = 0;

  constructor() {
    this.#child = spawn(process.execPath, [main], { stdio: ["pipe", "pipe", "inherit"] });
    let buffer = Buffer.alloc(0);
    this.#child.stdout!.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end === -1) return;
        const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())![1]);
        if (buffer.length < end + 4 + length) return;
        const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8")) as Received;
        buffer = buffer.subarray(end + 4 + length);
        const waiter = this.#waiting.findIndex((w) => w.test(message));
        if (waiter === -1) this.#seen.push(message);
        else this.#waiting.splice(waiter, 1)[0]!.done(message);
      }
    });
  }

  send(message: object): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.#child.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  next(test: (m: Received) => boolean, ms = 20_000): Promise<Received> {
    const index = this.#seen.findIndex(test);
    if (index !== -1) return Promise.resolve(this.#seen.splice(index, 1)[0]!);
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("no such message")), ms);
      this.#waiting.push({ test, done: (m) => (clearTimeout(timer), done(m)) });
    });
  }

  request(method: string, params: object): Promise<Received> {
    const id = ++this.#id;
    this.send({ id, method, params });
    return this.next((m) => m.id === id);
  }

  diagnostics(uri: string, version?: number): Promise<Received> {
    return this.next(
      (m) =>
        m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && (version === undefined || m.params.version === version)
    );
  }

  exited(): Promise<number | null> {
    return new Promise((done) => this.#child.on("exit", (code) => done(code)));
  }
}

const COMPONENT = `import { Entity } from "@tsengine/runtime/jsx";
import { useGame } from "./GameState.ts";

// A component written as in React: two things the compiler knows to say.
export function Coins() {
  const coins = useGame((s) => s.coins);
  const st = useMutable({ shown: false });
  return <Entity transform={{ x: coins }} />;
}
`;
const STATE = `import { createGameState } from "@tsengine/runtime";

export const useGame = createGameState({ coins: 0 }, {});
`;

describe("the language server", () => {
  let client: Client;
  const uri = (path: string): string => pathToFileURL(join(game, path)).href;
  before(() => {
    writeFileSync(join(game, "package.json"), JSON.stringify({ name: "g", tse: {} }));
    mkdirSync(join(game, "src"));
    writeFileSync(join(game, "src/GameState.ts"), STATE);
    writeFileSync(join(game, "src/Coins.tsx"), COMPONENT);
    client = new Client();
  });

  it("starts, publishes a component's TSE diagnostics at their ranges, and offers the quick fix", async () => {
    const init = await client.request("initialize", { processId: null, rootUri: pathToFileURL(game).href, capabilities: {} });
    assert.equal(init.result.capabilities.textDocumentSync.change, 1);
    client.send({ method: "initialized", params: {} });
    client.send({
      method: "textDocument/didOpen",
      params: { textDocument: { uri: uri("src/Coins.tsx"), languageId: "typescriptreact", version: 1, text: COMPONENT } },
    });
    const published = await client.diagnostics(uri("src/Coins.tsx"), 1);
    const [missing] = published.params.diagnostics;
    assert.equal(published.params.diagnostics.length, 1, JSON.stringify(published.params.diagnostics));
    assert.equal(missing.code, "TSE1005");
    assert.equal(missing.source, "tse");
    assert.equal(missing.severity, 1);
    assert.deepEqual(
      missing.range,
      { start: { line: 6, character: 13 }, end: { line: 6, character: 41 } },
      "useMutable({ shown: false }), on the line it is on"
    );

    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri: uri("src/Coins.tsx") },
      range: missing.range,
      context: { diagnostics: [missing] },
    });
    assert.equal(actions.result.length, 1);
    const [action] = actions.result;
    assert.equal(action.title, `Import 'useMutable' from "@tsengine/runtime/jsx"`);
    assert.equal(action.isPreferred, true);
    const lines = new LineMap(COMPONENT);
    const edits = action.edit.changes[uri("src/Coins.tsx")].map((e: { range: { start: never; end: never }; newText: string }) => ({
      start: lines.offset(e.range.start),
      end: lines.offset(e.range.end),
      text: e.newText,
    }));
    const fixed = applyEdits(COMPONENT, edits);
    assert.match(fixed, /^import \{ Entity, useMutable \} from "@tsengine\/runtime\/jsx";/);

    client.send({
      method: "textDocument/didChange",
      params: { textDocument: { uri: uri("src/Coins.tsx"), version: 2 }, contentChanges: [{ text: fixed }] },
    });
    assert.deepEqual((await client.diagnostics(uri("src/Coins.tsx"), 2)).params.diagnostics, []);
  });

  it("analyses the open components again when GameState.ts changes in the editor", async () => {
    // The selector reads `coins`; take it out of the state, unsaved.
    client.send({
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: uri("src/GameState.ts"),
          languageId: "typescript",
          version: 1,
          text: STATE.replace("coins: number;", "gold: number;").replace("coins: 0", "gold: 0"),
        },
      },
    });
    const published = await client.diagnostics(uri("src/Coins.tsx"));
    assert.ok(
      published.params.diagnostics.some((d: { code: string; message: string }) => d.code === "TSE1108" && /coins/.test(d.message)),
      JSON.stringify(published.params.diagnostics)
    );
  });

  it("leaves a .tsx outside the game's source folder alone, clears a closed component, and exits after shutdown", async () => {
    writeFileSync(join(game, "Other.tsx"), "export const x = <div />;");
    client.send({
      method: "textDocument/didOpen",
      params: { textDocument: { uri: uri("Other.tsx"), languageId: "typescriptreact", version: 1, text: "export const x = <div />;" } },
    });
    client.send({ method: "textDocument/didClose", params: { textDocument: { uri: uri("src/Coins.tsx") } } });
    assert.deepEqual((await client.diagnostics(uri("src/Coins.tsx"))).params.diagnostics, []);
    await assert.rejects(
      client.next((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri("Other.tsx"), 600),
      /no such message/,
      "nothing is published for it"
    );
    const exited = client.exited();
    assert.equal((await client.request("shutdown", {})).result, null);
    client.send({ method: "exit" });
    assert.equal(await exited, 0);
  });
});
