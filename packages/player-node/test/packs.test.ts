// The packs `npm run pack` writes can be installed into an empty project and imported under plain Node: no workspace,
// no TypeScript source, nothing from the repository's node_modules. (Slow: it runs npm install.)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { nativeProblems, packAll, rewriteSpecifiers, setupNotes, stampVersion } from "../../../tools/pack.ts";
import { findNativeLibrary } from "../src/index.ts";

test("rewriteSpecifiers turns relative .ts imports into .js and leaves packages alone", () => {
  const before = [
    `import { a } from "./a.ts";`,
    `export * from "../b/c.tsx";`,
    `const m = await import("./d.ts");`,
    `import { t } from "typescript/ast";`,
    `import x from "@tsengine/runtime/jsx";`,
  ].join("\n");
  assert.equal(
    rewriteSpecifiers(before),
    [
      `import { a } from "./a.js";`,
      `export * from "../b/c.js";`,
      `const m = await import("./d.js");`,
      `import { t } from "typescript/ast";`,
      `import x from "@tsengine/runtime/jsx";`,
    ].join("\n")
  );
});

test("stampVersion sets a release's version and pins the other @tsengine packages to it", () => {
  const pkg = { name: "@tsengine/player", version: "0.0.0", dependencies: { "@tsengine/runtime": "0.0.0", koffi: "^2.9.0" } };
  assert.deepEqual(stampVersion(pkg, "0.1.0"), {
    name: "@tsengine/player",
    version: "0.1.0",
    dependencies: { "@tsengine/runtime": "0.1.0", koffi: "^2.9.0" },
  });
  assert.deepEqual(stampVersion({ name: "@tsengine/runtime", version: "0.0.0" }, "0.1.0"), { name: "@tsengine/runtime", version: "0.1.0" });
  assert.equal(stampVersion(pkg, undefined), pkg);
});

test("the packs install into an empty project and every entry point imports under Node", { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "tse-installed-"));
  try {
    const tarballs = packAll(join(dir, "packs"));
    const project = join(dir, "project");
    execFileSync("mkdir", [project]);
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "installed", private: true, type: "module" }));
    execFileSync("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: project, stdio: "pipe" });
    const entries = [
      "@tsengine/runtime",
      "@tsengine/runtime/jsx",
      "@tsengine/runtime/jsx-runtime",
      "@tsengine/player",
      "@tsengine/player-node",
      "@tsengine/compiler",
      "@tsengine/native",
    ];
    writeFileSync(
      join(project, "check.mjs"),
      `const out = {};\nfor (const s of ${JSON.stringify(entries)}) out[s] = Object.keys(await import(s)).length;\nconsole.log(JSON.stringify(out));\n`
    );
    const counts = JSON.parse(execFileSync("node", ["check.mjs"], { cwd: project, encoding: "utf8" })) as Record<string, number>;
    // An installed game has no repository: libtse comes from @tsengine/native, and loads (the ABI check passes).
    if (findNativeLibrary("headless") !== null) {
      writeFileSync(
        join(project, "native.mjs"),
        `import { findNativeLibrary, loadNative, checkAbi } from "@tsengine/player-node";\nconst path = findNativeLibrary("headless");\ncheckAbi(loadNative(path));\nconsole.log(path);\n`
      );
      const path = execFileSync("node", ["native.mjs"], {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, TSE_NATIVE_LIB: "" },
      }).trim();
      assert.ok(path.includes(join("node_modules", "@tsengine", "native", "lib")), `libtse came from ${path}`);
    }
    for (const entry of entries) assert.ok((counts[entry] ?? 0) > 0, `${entry} exports nothing`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const DESKTOP = ["lib/linux-x64/desktop/libtse.so", "bin/linux-x64/desktop/tse-host"];
const HEADLESS = ["lib/linux-x64/headless/libtse.so", "bin/linux-x64/headless/tse-host"];

test("setupNotes: with everything built, every line says ready and nothing is asked of the author", () => {
  const notes = setupNotes([...DESKTOP, ...HEADLESS], { cmake: true, cargo: true });
  assert.equal(notes.length, 4);
  for (const line of notes) assert.match(line, /ready/);
  assert.ok(!notes.some((line) => /install|Install/.test(line)));
});

test("setupNotes: with no tools and nothing built, games can still be written and checked, and each gap says what to install", () => {
  const notes = setupNotes([], { cmake: false, cargo: false }).join("\n");
  assert.match(notes, /Write, test and check games: ready/);
  assert.match(notes, /Screenshots and `tse package`: no libtse, because cmake was not found.*build-essential cmake/);
  assert.match(notes, /no tse-host, because cargo was not found.*rustup\.rs.*compares against Node only/);
  assert.match(notes, /A window \(`tse dev`\): not built.*libx11-dev.*libgl1-mesa-dev/);
});

test("setupNotes: a headless build without a window or a host says what is missing, and says a failed build is not a missing tool", () => {
  const notes = setupNotes(["lib/linux-x64/headless/libtse.so"], { cmake: true, cargo: true }).join("\n");
  assert.match(notes, /Screenshots and `tse package --headless`: ready/);
  assert.match(notes, /A window \(`tse dev`\): not built/);
  assert.match(notes, /no tse-host, because the build failed/);
  assert.doesNotMatch(notes, /was not found/);
});

test("nativeProblems: binaries from every platform are accepted where the package looks, and a listed platform needs all four", () => {
  const all = (folder: string, lib: string, bin: string): string[] =>
    ["desktop", "headless"].flatMap((flavor) => [`lib/${folder}/${flavor}/${lib}`, `bin/${folder}/${flavor}/${bin}`]);
  const files = [
    ...all("linux-x64", "libtse.so", "tse-host"),
    ...all("darwin-arm64", "libtse.dylib", "tse-host"),
    ...all("win32-x64", "tse.dll", "tse-host.exe"),
  ];
  assert.deepEqual(nativeProblems(files, ["linux-x64", "darwin-arm64", "win32-x64"]), []);
  assert.deepEqual(nativeProblems(files, ["darwin-x64"]), [
    "lib/darwin-x64/desktop/libtse.dylib: missing",
    "bin/darwin-x64/desktop/tse-host: missing",
    "lib/darwin-x64/headless/libtse.dylib: missing",
    "bin/darwin-x64/headless/tse-host: missing",
  ]);
  assert.deepEqual(nativeProblems(["lib/win32-x64/headless/libtse.so", "lib/linux-x64/headless/Release/libtse.so"]), [
    "lib/win32-x64/headless/libtse.so: not where @tsengine/native looks for a binary",
    "lib/linux-x64/headless/Release/libtse.so: not where @tsengine/native looks for a binary",
  ]);
});
