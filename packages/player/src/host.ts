import type { Backend } from "./backend.ts";

/** The global a host sets before it runs the game, so one entry file runs under every host. */
export const HOST_BACKEND_KEY = "__rgeBackend";

/**
 * The backend the host installed on `globalThis`: the Node launcher sets it from koffi, the Rust host
 * from the native library. A game's entry file is `run(hostBackend(), { … })`.
 */
export function hostBackend(): Backend {
  const backend = (globalThis as Record<string, unknown>)[HOST_BACKEND_KEY];
  if (backend === undefined || backend === null) {
    throw new Error(`No host backend: this game must be started by a host (the Node launcher or the native executable), which sets globalThis.${HOST_BACKEND_KEY} first.`);
  }
  return backend as Backend;
}
