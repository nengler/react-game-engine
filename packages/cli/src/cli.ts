#!/usr/bin/env node
/**
 * rge: one command line for a game made with the engine. Run it in the game's folder, or give the folder as the first argument.
 *
 *   rge build [folder]                 compile src to generated
 *   rge dev [folder] [--no-watch]      compile, open the window, hot reload
 *   rge check [folder]                 compile, type-check, test, and check parity under Node and rge-host
 *   rge package [folder] [options]     a folder you can hand to someone (see `rge package --help`)
 *   rge screenshot <folder> [options]  PNGs of a scripted run, through the headless build
 *   rge preview [folder] [options]     the game's stories: one component with given props, in a window or as PNGs
 *   rge create <folder> [options]      a new game from the template
 *   rge lsp                            the language server, on stdin and stdout, for an editor (the VS Code extension starts it)
 *
 * A game's settings live in the "rge" field of its package.json: name, entry, src, generated, scenes, assets, checkAssets.
 */
import { UsageError } from "./config.ts";
import { buildCommand } from "./commands/build.ts";
import { checkCommand } from "./commands/check.ts";
import { createCommand } from "./commands/create.ts";
import { devCommand } from "./commands/dev.ts";
import { packageCommand } from "./commands/package.ts";
import { previewCommand } from "./commands/preview.ts";
import { screenshotCommand } from "./commands/screenshot.ts";

const USAGE = `usage: rge <command> [folder] [options]

  build        compile src to generated
  dev          compile, open the window, hot reload       [--no-watch]
  check        compile, type-check, test, parity
  package      a folder to hand to someone                [--engine node|quickjs] [--headless] [--entry file] [--name name]
  screenshot   PNGs of a scripted run                     rge screenshot <folder> --script "right*30" --at 0,29
  preview      one component at a time, from its stories  [--story HealthBar] [--screenshot | --compare]
  create       a new game from the template               rge create <folder> [--name name] [--packs dir]
  lsp          the language server for an editor, on stdin and stdout (RGE diagnostics and quick fixes as you type)`;

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
      case "create":
        return createCommand(rest);
      case "lsp": {
        // Serves until the editor sends `exit`, which ends the process; an editor that just goes away closes stdin.
        const { startServer } = await import("@rge/language-server");
        startServer(process.stdin, process.stdout);
        return await new Promise<number>((done) => process.stdin.on("end", () => done(1)));
      }
      case "--help":
      case "-h":
      case undefined:
        console.log(USAGE);
        return command === undefined ? 2 : 0;
      default:
        console.error(`rge: unknown command ${command}\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`rge ${command}: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
