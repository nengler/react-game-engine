#!/usr/bin/env node
import { buildCommand } from "./commands/build.ts";
import { checkCommand } from "./commands/check.ts";
import { createCommand } from "./commands/create.ts";
import { devCommand } from "./commands/dev.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { packageCommand } from "./commands/package.ts";
import { previewCommand } from "./commands/preview.ts";
import { renderServerCommand } from "./commands/render-server.ts";
import { screenshotCommand } from "./commands/screenshot.ts";
import { sessionCommand } from "./commands/session.ts";
/**
 * tse: one command line for a game made with the engine. Run it in the game's folder, or give the folder as the first argument.
 *
 *   tse build [folder]                 compile src to generated
 *   tse dev [folder] [--no-watch]      compile, open the window, hot reload
 *   tse check [folder]                 compile, type-check, test, and check parity under Node and tse-host
 *   tse package [folder] [options]     a folder you can hand to someone (see `tse package --help`)
 *   tse screenshot <folder> [options]  PNGs of a scripted run, through the headless build (or the GPU with --gpu)
 *   tse preview [folder] [options]     the game's stories: one component with given props, in a window or as PNGs
 *   tse session [folder]               the game headless, driven a request a line on stdin (JSON answers on stdout): for tools and AI
 *   tse mcp [folder]                   the same session as an MCP server, for an AI assistant (Claude Code: `claude mcp add`)
 *   tse create <folder> [options]      a new game from the template
 *   tse lsp                            the language server, on stdin and stdout, for an editor (the VS Code extension starts it)
 *
 * A game's settings live in the "tse" field of its package.json: name, entry, src, generated, scenes, assets, checkAssets.
 */
import { UsageError } from "./config.ts";

const USAGE = `usage: tse <command> [folder] [options]

  build        compile src to generated                   [--json]
  dev          compile, open the window, hot reload       [--no-watch]
  check        compile, type-check, test, parity          [--json]
  package      a folder to hand to someone                [--engine node|quickjs] [--headless] [--entry file] [--name name]
  screenshot   PNGs of a scripted run                     tse screenshot <folder> --script "right*30" --at 0,29 [--gpu] [--compare dir]
  preview      one component at a time, from its stories  [--story HealthBar] [--screenshot | --compare]
  session      the game headless, a request a line on stdin, JSON answers on stdout (\`help\` lists the commands)  [--no-build]
  mcp          the same session as an MCP server on stdin and stdout, for an AI assistant  [--no-build]
  create       a new game from a template                 tse create <folder> [--name name] [--template blank|menu|platformer] [--packs dir]
  lsp          the language server for an editor, on stdin and stdout (TSE diagnostics and quick fixes as you type)`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "build":
        return buildCommand(rest);
      case "dev":
        return devCommand(rest);
      case "check":
        return await checkCommand(rest);
      case "package":
        return await packageCommand(rest);
      case "preview":
        return await previewCommand(rest);
      case "screenshot":
        return await screenshotCommand(rest);
      case "session":
        return await sessionCommand(rest);
      case "mcp":
        return await mcpCommand(rest);
      case "render-server": // tse session's screenshots; not for people
        return await renderServerCommand(rest);
      case "create":
        return createCommand(rest);
      case "lsp": {
        // Serves until the editor sends `exit`, which ends the process; an editor that just goes away closes stdin.
        const { startServer } = await import("@tsengine/language-server");
        startServer(process.stdin, process.stdout);
        return await new Promise<number>((done) => process.stdin.on("end", () => done(1)));
      }
      case "--help":
      case "-h":
      case undefined:
        console.log(USAGE);
        return command === undefined ? 2 : 0;
      default:
        console.error(`tse: unknown command ${command}\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`tse ${command}: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
