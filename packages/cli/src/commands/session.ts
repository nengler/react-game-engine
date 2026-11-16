/**
 * `tse session [folder] [--no-build]`: the game, headless, driven a request at a time on stdin, one answer a line on stdout. For a
 * tool or a language model that plays, tests or debugs the game: step, look, decide, step again.
 *
 * A request is a JSON object, or a command and its argument as words:
 *
 *     {"cmd": "input", "script": "right*30, jump"}         input right*30, jump
 *     {"cmd": "step", "until": {"text": "ROOM 2"}}          step 60
 *     {"cmd": "observe", "only": "components"}              observe components
 *     {"cmd": "snapshot", "name": "boss"}                   restore boss
 *
 * Every answer is one line of JSON: `{"ok": true, "frame": 31, …}` or `{"ok": false, "frame": 31, "error": "…"}`, with the game's
 * new warnings under `warnings`. The first line says the game is ready and lists what it takes (`info`). `help` lists every command.
 * The game's own console output goes to stderr, so stdout stays one answer a line.
 */
import { createInterface } from "node:readline";

import { UsageError } from "../config.ts";
import { describeError, parseRequestLine, SessionServer } from "../session-server.ts";

export async function sessionCommand(args: readonly string[]): Promise<number> {
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--no-build");
  if (unknown.length > 0) throw new UsageError(`unknown option ${unknown[0]}\nusage: tse session [folder] [--no-build]`);
  const folder = args.find((arg) => !arg.startsWith("--")) ?? ".";
  const write = (answer: unknown): void => {
    process.stdout.write(`${JSON.stringify(answer)}\n`);
  };
  // stdout carries answers only: what the game prints goes to stderr.
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  process.setSourceMapsEnabled(true); // an error inside a component names its line in src/, not in generated/

  let server: SessionServer;
  try {
    server = await SessionServer.open(folder, { build: !args.includes("--no-build") });
  } catch (error) {
    write({ ok: false, frame: 0, error: describeError(error) });
    return 1;
  }
  write({ ok: true, frame: 0, ready: true, ...server.info() });

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let request;
    try {
      request = parseRequestLine(line);
    } catch (error) {
      write({ ok: false, frame: server.session.frame, error: `Cannot read the request: ${describeError(error)}` });
      continue;
    }
    if (request === null) continue;
    if (request.cmd === "quit" || request.cmd === "exit") break;
    write(await server.handle(request));
  }
  server.close();
  return 0;
}
