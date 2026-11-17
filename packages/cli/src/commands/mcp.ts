/**
 * `tse mcp [folder] [--no-build]`: `tse session` as a Model Context Protocol server on stdin and stdout, so an AI assistant can play,
 * test and debug the game with tools (`game_input`, `game_step`, `game_observe`, `game_screenshot`, …). With Claude Code, in the
 * game's folder:
 *
 *     claude mcp add tse -- npx tse mcp
 *
 * It speaks MCP's stdio transport (JSON-RPC 2.0, one message a line) with only what tools need: `initialize`, `tools/list`,
 * `tools/call` and `ping`. The game is loaded on the first tool call, so a compile error is the call's answer, not a failed start.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { UsageError } from "../config.ts";
import { COMMANDS, describeError, SessionServer, type SessionResponse } from "../session-server.ts";

/** The protocol version answered when the client asks for one this server does not know. */
const PROTOCOL_VERSION = "2025-06-18";
const KNOWN_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

const INSTRUCTIONS = `A game made with tse, running headless: nothing is drawn unless you ask for a screenshot. The game steps 60 times a
second of game time, and only when you play input or step it. Play input with game_input (a script such as "right*30, jump, _*10":
a name is one of the game's actions or a key name, *N holds it N steps, + starts terms together, _ waits). Read the game with
game_observe (the scene as text: each object, its world position, texts, colliders and state), game_map (the level drawn in characters, with things marked) and game_state. Keep a moment with
game_snapshot and go back with game_restore. After changing the game's source, game_reload compiles it and plays the same input again
with the new code. Positions are in pixels, y grows downward.`.replace(/\n/g, " ");

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const str = (description: string): Record<string, unknown> => ({ type: "string", description });
const num = (description: string): Record<string, unknown> => ({ type: "number", description });
const schema = (properties: Record<string, unknown> = {}, required: readonly string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

const UNTIL = {
  type: "object",
  description:
    'Stop as soon as this holds. {"text": "GAME OVER"} a text is on screen; {"gone": "LOADING"} it is not; {"component": "Boss"} it is in the tree (with "absent": true, it is not); {"component": "Hero", "path": "s.hp", "below": 1} its state; {"path": "wave", "equals": 3} the game state. Comparisons: equals, not, above, below.',
  properties: {
    text: { type: "string" },
    gone: { type: "string" },
    component: { type: "string" },
    absent: { type: "boolean" },
    path: { type: "string" },
    equals: {},
    not: {},
    above: { type: "number" },
    below: { type: "number" },
  },
  additionalProperties: false,
};

/** The arguments of each command, as JSON schemas. */
const SCHEMAS: Readonly<Record<string, Record<string, unknown>>> = {
  info: schema(),
  input: schema({ script: str('The input script, e.g. "right*30, jump, right*20+dash, _*10" or "click@120,64".') }, ["script"]),
  step: schema({
    count: num("Steps to run with nothing pressed (default 1)."),
    until: UNTIL,
    maxSteps: num("With until: the most steps to run (default 3600, a minute)."),
  }),
  type: schema({ text: str("The characters to type; \\b is Backspace.") }, ["text"]),
  press: schema({ query: str("What to click: a name or class name (`StartButton`), or a list item (`Pad[key=7]`).") }, ["query"]),
  observe: schema({
    only: { type: "string", enum: ["all", "components"], description: '"components": only components and texts (shorter).' },
    depth: num("How many levels below the root to describe."),
    maxNodes: num("The most objects to describe (default 400)."),
  }),
  state: schema({ query: str("A component's name: every such component's position and state. Without it: the game state.") }),
  map: schema({
    around: str("A component's name: draw the tilemap it stands on (default: what the camera follows)."),
    region: {
      type: "object",
      description: "The part of the world to draw, in pixels.",
      properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
      required: ["x", "y", "width", "height"],
      additionalProperties: false,
    },
    maxColumns: num("The widest the map may be, in characters (default 120)."),
  }),
  texts: schema(),
  snapshot: schema({ name: str("A name for the snapshot.") }, ["name"]),
  restore: schema({ name: str("The snapshot to go back to.") }, ["name"]),
  replay: schema(),
  reset: schema(),
  reload: schema(),
  hash: schema(),
  screenshot: schema({
    out: str("Where to write the PNG (a folder or a .png path); default ./shots in the game's folder."),
    scale: num("Enlarge the picture this many times (pixel art reads better at 2 to 4)."),
  }),
};

export function mcpTools(): Tool[] {
  return Object.entries(COMMANDS)
    .filter(([cmd]) => cmd !== "help")
    .map(([cmd, { does }]) => ({ name: `game_${cmd}`, description: does, inputSchema: SCHEMAS[cmd] ?? schema() }));
}

/** An answer as text a model reads easily: long strings (the scene) as they are, everything else as JSON. */
export function answerText(answer: SessionResponse): string {
  const lines: string[] = [];
  const { ok: _ok, id: _id, error, frame, warnings, ...rest } = answer;
  lines.push(`frame ${frame}`);
  if (error !== undefined) lines.push(`error: ${error}`);
  for (const [key, value] of Object.entries(rest))
    lines.push(typeof value === "string" && value.includes("\n") ? `${key}:\n${value}` : `${key}: ${JSON.stringify(value)}`);
  if (Array.isArray(warnings)) for (const warning of warnings) lines.push(`warning: ${String(warning)}`);
  return lines.join("\n");
}

interface RpcMessage {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export async function mcpCommand(args: readonly string[]): Promise<number> {
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--no-build");
  if (unknown.length > 0) throw new UsageError(`unknown option ${unknown[0]}\nusage: tse mcp [folder] [--no-build]`);
  const folder = args.find((arg) => !arg.startsWith("--")) ?? ".";
  const build = !args.includes("--no-build");
  const send = (message: unknown): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };
  // stdout carries protocol messages only.
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  process.setSourceMapsEnabled(true);

  let server: SessionServer | null = null;
  const open = async (): Promise<SessionServer> => (server ??= await SessionServer.open(folder, { build }));
  const version =
    (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";

  const call = async (name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const cmd = name.startsWith("game_") ? name.slice(5) : name;
    if (!(cmd in COMMANDS) || cmd === "help") return { content: [{ type: "text", text: `No tool called ${name}.` }], isError: true };
    let game: SessionServer;
    try {
      game = await open();
    } catch (error) {
      return { content: [{ type: "text", text: describeError(error) }], isError: true };
    }
    const answer = await game.handle({ ...input, cmd });
    const content: Record<string, unknown>[] = [{ type: "text", text: answerText(answer) }];
    if (answer.ok && cmd === "screenshot" && typeof answer["path"] === "string")
      content.push({ type: "image", mimeType: "image/png", data: readFileSync(answer["path"]).toString("base64") });
    return { content, isError: !answer.ok };
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const id = message.id;
    if (id === undefined) continue; // a notification (initialized, cancelled): nothing to answer
    const reply = (result: unknown): void => send({ jsonrpc: "2.0", id, result });
    switch (message.method) {
      case "initialize": {
        const asked = message.params?.["protocolVersion"];
        reply({
          protocolVersion: typeof asked === "string" && KNOWN_VERSIONS.has(asked) ? asked : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "tse", version },
          instructions: INSTRUCTIONS,
        });
        break;
      }
      case "ping":
        reply({});
        break;
      case "tools/list":
        reply({ tools: mcpTools() });
        break;
      case "tools/call": {
        const name = message.params?.["name"];
        const input = message.params?.["arguments"];
        if (typeof name !== "string") {
          send({ jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call needs a tool name." } });
          break;
        }
        reply(await call(name, typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}));
        break;
      }
      default:
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${String(message.method)}` } });
    }
  }
  (server as SessionServer | null)?.close();
  return 0;
}
