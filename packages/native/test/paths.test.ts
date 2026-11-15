import assert from "node:assert/strict";
import { test } from "node:test";

import { hostPathIn, libraryPathIn, nativeHost, nativeLibrary, platformFolder } from "../src/index.ts";

test("paths follow lib/<platform>-<arch>/<flavor>/", () => {
  assert.equal(platformFolder("linux", "x64"), "linux-x64");
  assert.equal(libraryPathIn("/p", "headless", "linux", "x64"), "/p/lib/linux-x64/headless/libtse.so");
  assert.equal(hostPathIn("/p", "desktop", "linux", "x64"), "/p/bin/linux-x64/desktop/tse-host");
});

test("in the workspace nothing is shipped, so every lookup is null", () => {
  assert.equal(nativeLibrary("desktop"), null);
  assert.equal(nativeHost("headless"), null);
});
