/**
 * The language server: `TSE` diagnostics for a game's components as they are edited, and quick fixes for them, over the Language
 * Server Protocol (JSON-RPC with `Content-Length` headers, on stdin and stdout). It runs beside TypeScript's own server, which
 * keeps doing the types, hovers and completions; this one adds what only the engine's compiler knows.
 *
 * What it answers: `initialize`, the document notifications (`didOpen`, `didChange` with whole texts, `didSave`, `didClose`),
 * `textDocument/codeAction`, `shutdown` and `exit`. It publishes `textDocument/publishDiagnostics`. A document is analysed a
 * moment after the last change to it (`delay`); a change to a game's `GameState.ts` analyses its open components again.
 */
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CompilerDiagnostic } from "@tsengine/compiler";

import { fixesFor, type Edit } from "./fixes.ts";
import { findGame, GameProject, isComponentFile, readFromDisk } from "./project.ts";

interface Position {
  readonly line: number;
  readonly character: number;
}
interface Range {
  readonly start: Position;
  readonly end: Position;
}
interface LspDiagnostic {
  readonly range: Range;
  readonly severity: 1 | 2;
  readonly code: string;
  readonly source: "tse";
  readonly message: string;
}
interface Message {
  readonly jsonrpc: "2.0";
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
}

/** Line and character (UTF-16) of an offset, and back. */
export class LineMap {
  readonly #starts: number[] = [0];
  readonly #length: number;
  constructor(text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.#starts.push(i + 1);
    this.#length = text.length;
  }
  position(offset: number): Position {
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.#starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low, character: offset - (this.#starts[low] as number) };
  }
  offset(position: Position): number {
    const start = this.#starts[Math.min(position.line, this.#starts.length - 1)] as number;
    return Math.min(start + position.character, this.#length);
  }
}

/** Reads framed messages from a stream and calls `on` with each. */
function readMessages(input: NodeJS.ReadableStream, on: (message: Message) => void): void {
  let buffer = Buffer.alloc(0);
  input.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"))?.[1]);
      if (!Number.isFinite(length)) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      if (buffer.length < headerEnd + 4 + length) return;
      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      buffer = buffer.subarray(headerEnd + 4 + length);
      try {
        on(JSON.parse(body) as Message);
      } catch {
        // A body that is not JSON: nothing to answer.
      }
    }
  });
}

export interface ServerOptions {
  /** Milliseconds after the last change before a document is analysed. Default 150. */
  readonly delay?: number;
  /** Called when the client sends `exit`. Default: end the process. */
  readonly exit?: (code: number) => void;
}

/** Serve on these streams until `exit`. */
export function startServer(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, options: ServerOptions = {}): void {
  const delay = options.delay ?? 150;
  const documents = new Map<string, { text: string; version: number }>();
  /** One compiler per game, made on the first of its components that is opened. */
  const projects = new Map<string, GameProject>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The diagnostics last published for each document, for code actions. */
  const published = new Map<string, readonly CompilerDiagnostic[]>();
  let shutDown = false;

  const send = (message: object): void => {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  };
  const pathOf = (uri: string): string | null => (uri.startsWith("file:") ? fileURLToPath(uri) : null);
  /** Open documents first, so a custom hook or `GameState.ts` being edited is read as it is in the editor. */
  const read = (path: string): string | null => documents.get(pathToFileURL(resolve(path)).href)?.text ?? readFromDisk(path);

  const projectFor = (path: string): GameProject | null => {
    const game = findGame(path);
    if (game === null || !isComponentFile(game, path)) return null;
    let project = projects.get(game.dir);
    if (project === undefined) {
      project = new GameProject(game, read);
      projects.set(game.dir, project);
    }
    return project;
  };

  const analyse = (uri: string): void => {
    const document = documents.get(uri);
    const path = pathOf(uri);
    if (document === undefined || path === null) return;
    const project = projectFor(path);
    if (project === null) return;
    let diagnostics: CompilerDiagnostic[];
    try {
      diagnostics = project.diagnose(path, document.text);
    } catch (error) {
      // The compiler should not throw on any input; if it does, say so where the author looks rather than going quiet.
      diagnostics = [
        {
          code: "TSE1001",
          severity: "error",
          message: `The compiler failed on this file: ${error instanceof Error ? error.message : String(error)}`,
          span: null,
        },
      ];
    }
    published.set(uri, diagnostics);
    const lines = new LineMap(document.text);
    const zero = { line: 0, character: 0 };
    send({
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        version: document.version,
        diagnostics: diagnostics.map((d): LspDiagnostic => ({
          range: d.span === null ? { start: zero, end: zero } : { start: lines.position(d.span.start), end: lines.position(d.span.end) },
          severity: d.severity === "error" ? 1 : 2,
          code: d.code,
          source: "tse",
          message: d.message,
        })),
      },
    });
  };

  const schedule = (uri: string): void => {
    const pending = timers.get(uri);
    if (pending !== undefined) clearTimeout(pending);
    timers.set(
      uri,
      setTimeout(() => {
        timers.delete(uri);
        analyse(uri);
      }, delay)
    );
  };

  /** The open components of the game `uri` is in, but `uri` itself, analysed again: a change to `GameState.ts` or a hook file reaches them. */
  const othersChanged = (uri: string): void => {
    const path = pathOf(uri);
    if (path === null) return;
    const game = findGame(path);
    if (game === null) return;
    for (const other of documents.keys()) {
      const otherPath = pathOf(other);
      if (other !== uri && otherPath !== null && findGame(otherPath)?.dir === game.dir) schedule(other);
    }
  };

  /** A document changed: it is analysed again, and so are the other open components of its game, which may import it. */
  const changed = (uri: string): void => {
    schedule(uri);
    othersChanged(uri);
  };

  const codeActions = (params: { textDocument: { uri: string }; range: Range }): object[] => {
    const uri = params.textDocument.uri;
    const document = documents.get(uri);
    const diagnostics = published.get(uri);
    if (document === undefined || diagnostics === undefined) return [];
    const lines = new LineMap(document.text);
    const from = lines.offset(params.range.start);
    const to = lines.offset(params.range.end);
    const actions: object[] = [];
    for (const d of diagnostics) {
      if (d.span === null || d.span.end < from || d.span.start > to) continue;
      for (const fix of fixesFor(document.text, d)) {
        actions.push({
          title: fix.title,
          kind: "quickfix",
          isPreferred: fix.preferred === true,
          diagnostics: [
            {
              range: { start: lines.position(d.span.start), end: lines.position(d.span.end) },
              severity: d.severity === "error" ? 1 : 2,
              code: d.code,
              source: "tse",
              message: d.message,
            },
          ],
          edit: {
            changes: {
              [uri]: fix.edits.map((edit: Edit) => ({
                range: { start: lines.position(edit.start), end: lines.position(edit.end) },
                newText: edit.text,
              })),
            },
          },
        });
      }
    }
    return actions;
  };

  readMessages(input, (message) => {
    const { id, method } = message;
    const params = message.params as Record<string, any>;
    const reply = (result: unknown): void => send({ id, result });
    switch (method) {
      case "initialize":
        reply({
          capabilities: {
            textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
            codeActionProvider: { codeActionKinds: ["quickfix"] },
          },
          serverInfo: { name: "tse-language-server", version: "0.0.0" },
        });
        return;
      case "textDocument/didOpen": {
        const doc = params.textDocument as { uri: string; text: string; version: number };
        documents.set(doc.uri, { text: doc.text, version: doc.version });
        changed(doc.uri);
        return;
      }
      case "textDocument/didChange": {
        const doc = params.textDocument as { uri: string; version: number };
        const changes = params.contentChanges as { text: string; range?: unknown }[];
        const last = changes.at(-1);
        // Whole texts only (`change: 1`); a client that sends ranges anyway is answered from its last whole text.
        if (last !== undefined && last.range === undefined) documents.set(doc.uri, { text: last.text, version: doc.version });
        changed(doc.uri);
        return;
      }
      case "textDocument/didSave":
        changed((params.textDocument as { uri: string }).uri);
        return;
      case "textDocument/didClose": {
        const uri = (params.textDocument as { uri: string }).uri;
        documents.delete(uri);
        published.delete(uri);
        const pending = timers.get(uri);
        if (pending !== undefined) clearTimeout(pending);
        timers.delete(uri);
        if (uri.endsWith(".tsx")) send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
        othersChanged(uri);
        return;
      }
      case "textDocument/codeAction":
        reply(codeActions(params as { textDocument: { uri: string }; range: Range }));
        return;
      case "shutdown":
        shutDown = true;
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        for (const project of projects.values()) project.close();
        projects.clear();
        reply(null);
        return;
      case "exit":
        (options.exit ?? ((code) => process.exit(code)))(shutDown ? 0 : 1);
        return;
      default:
        // An unknown request is answered with an error, as the protocol asks; an unknown notification is ignored.
        if (id !== undefined && id !== null) send({ id, error: { code: -32601, message: `${method ?? "?"} is not supported` } });
    }
  });
}
