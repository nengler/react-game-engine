// Is `tse lsp` working where a game is installed? Starts it, opens one of the game's components with a line added that the
// compiler refuses (`useMutable` used without being imported), waits for that TSE diagnostic, and shuts the server down.
//
//   node tools/lsp-smoke.ts <path of the tse command> <game folder>
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [tse, game] = process.argv.slice(2).map((arg) => resolve(arg)) as [string, string];
const component = readdirSync(join(game, "src")).find((name) => name.endsWith(".tsx") && name !== "Main.tsx") ?? "Main.tsx";
const path = join(game, "src", component);
// A statement at the top of the component's body: after the line that declares it.
const text = readFileSync(path, "utf8").replace(
  /(export (?:default )?function \w+\([^)]*\)[^{]*\{\n)/,
  "$1  const smoke = useMutable({ n: 0 });\n"
);
const uri = pathToFileURL(path).href;

const child = spawn(tse, ["lsp"], { cwd: game, stdio: ["pipe", "pipe", "inherit"] });
const send = (message: object): void => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const timer = setTimeout(() => {
  console.error("tse lsp published no diagnostics in 30 seconds");
  child.kill();
  process.exit(1);
}, 30_000);
let buffer = Buffer.alloc(0);
child.stdout.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end === -1) return;
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())?.[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8")) as {
      id?: number;
      method?: string;
      params?: { uri: string; diagnostics: { code: string }[] };
    };
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === "textDocument/publishDiagnostics" && message.params?.uri === uri) {
      const codes = message.params.diagnostics.map((d) => d.code);
      if (!codes.includes("TSE1005")) {
        console.error(`expected TSE1005 for ${component}, got ${JSON.stringify(message.params.diagnostics)}`);
        process.exit(1);
      }
      console.log(`tse lsp: ${component} has ${codes.join(", ")}`);
      send({ id: 2, method: "shutdown" });
    } else if (message.id === 2) {
      send({ method: "exit" });
    }
  }
});
child.on("exit", (code) => {
  clearTimeout(timer);
  process.exit(code === 0 ? 0 : 1);
});
send({ id: 1, method: "initialize", params: { processId: null, rootUri: pathToFileURL(game).href, capabilities: {} } });
send({ method: "initialized", params: {} });
send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescriptreact", version: 1, text } } });
