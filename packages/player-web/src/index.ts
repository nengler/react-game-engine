/**
 * The browser host: what the Node launcher and the Rust executable are on the desktop, for a page. `startWebHost` fetches the game's
 * files, makes a `WebBackend` over a canvas, and installs it and a frame loop on `globalThis` (`HOST_BACKEND_KEY`, `HOST_RUN_KEY`), so
 * the game's own entry file, `run(hostBackend(), config)`, runs unchanged: `run` hands the loop the player, which steps once an
 * animation frame. `tse package --web` writes a page that calls it, then imports the entry file.
 */
import { createPlayer, HOST_BACKEND_KEY, HOST_RUN_KEY, type Backend, type PlayerConfig } from "@tsengine/player";

import { preloadAssets, WebBackend } from "./backend.ts";

export { normalizePath, preloadAssets, WebBackend, type Preloaded } from "./backend.ts";
export { WebInput } from "./input.ts";
export { SHADER_HEAD, SHADER_TAIL, WebRenderer, type GlTexture, type LayerShader, type RendererAssets } from "./renderer.ts";
export { BUILTIN_FONT_BITS } from "./fonts-data.ts";

export interface WebHostOptions {
  /** The canvas to draw into; it should fill the space the game is to take. */
  readonly canvas: HTMLCanvasElement;
  /** Every file the game may load, relative to `base`, as the game names them (`assets/hero.png`). */
  readonly files: readonly string[];
  /** Where those files are: the page's own folder by default. */
  readonly base?: string;
  /** Called with the error a frame throws, after the loop stops: the page can show it. */
  readonly onError?: (error: unknown) => void;
}

/** The player of the running game, for a page or a test to look at; null before `run` starts it. */
export let webPlayer: ReturnType<typeof createPlayer> | null = null;

/** Fetch the game's files, then install the backend and the frame loop for `run`. Resolves once the game may be imported. */
export async function startWebHost(options: WebHostOptions): Promise<WebBackend> {
  const files = await preloadAssets(options.base ?? globalThis.location?.href ?? "", options.files);
  const backend = new WebBackend(options.canvas, files);
  const globals = globalThis as Record<string, unknown>;
  globals[HOST_BACKEND_KEY] = backend;
  globals[HOST_RUN_KEY] = (host: Backend, config: PlayerConfig) => {
    const player = createPlayer(host, config);
    webPlayer = player;
    const tick = () => {
      try {
        if (player.step()) requestAnimationFrame(tick);
        else player.close();
      } catch (error) {
        console.error(error);
        options.onError?.(error);
      }
    };
    requestAnimationFrame(tick);
  };
  return backend;
}
