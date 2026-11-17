/**
 * `tse render-server <folder>`: the game drawn through the hidden window, kept open, a request a line in and an answer a line out,
 * both on file descriptor 3 (a pipe its parent opens: stdin and stdout are not used, because the native renderer's start reads
 * stdin and raylib logs to stdout). `tse session` starts one for its screenshots and sends it only the input played since its last
 * picture, so a picture late in a long run is quick. Not for people; its requests are:
 *
 *     {"play": <packed frames>}               play frames of input (see `packFrames`), a step each
 *     {"shot": "/path.png", "scale": 2}       write the picture of the last step played
 */
import { writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { unpackFrames, type PackedFrames, type PlayerConfig } from "@tsengine/player";
import { encodePng, Renderer } from "@tsengine/player-node";

import { enlarge } from "./screenshot.ts";

export async function renderServerCommand(args: readonly string[]): Promise<number> {
  const gameDir = resolve(args[0] ?? ".");
  const channel = new Socket({ fd: 3, readable: true, writable: true });
  const write = (answer: unknown): void => {
    channel.write(`${JSON.stringify(answer)}\n`);
  };
  console.log = console.error;
  const lines = createInterface({ input: channel, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const { gameConfig } = (await import(pathToFileURL(join(gameDir, "game.ts")).href)) as { gameConfig: PlayerConfig };
  process.chdir(gameDir);
  const warnings: string[] = [];
  const renderer = new Renderer(gameConfig, { warnings });
  try {
    for (let next = await lines.next(); next.done !== true; next = await lines.next()) {
      const line = next.value;
      if (line.trim() === "") continue;
      try {
        const request = JSON.parse(line) as { play?: PackedFrames; shot?: string; scale?: number };
        if (request.play !== undefined) renderer.play(unpackFrames(request.play));
        if (request.shot !== undefined) writeFileSync(request.shot, encodePng(enlarge(renderer.pixels(), Math.max(1, request.scale ?? 1))));
        write({ ok: true, frames: renderer.frames });
      } catch (error) {
        write({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    renderer.close();
    channel.end();
  }
  return 0;
}
