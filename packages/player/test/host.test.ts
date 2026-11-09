import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOST_BACKEND_KEY, hostBackend } from "../src/host.ts";
import { RecordingBackend } from "../src/recording.ts";

describe("hostBackend", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[HOST_BACKEND_KEY];
  });

  it("throws a clear error when no host installed a backend", () => {
    assert.throws(() => hostBackend(), /No host backend.*__rgeBackend/);
  });

  it("returns the backend the host installed", () => {
    const backend = new RecordingBackend();
    (globalThis as Record<string, unknown>)[HOST_BACKEND_KEY] = backend;
    assert.equal(hostBackend(), backend);
  });
});
