// The packs `npm run pack` writes can be installed into an empty project and imported under plain Node: no workspace,
// no TypeScript source, nothing from the repository's node_modules. (Slow: it runs npm install.)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findNativeLibrary } from "../src/index.ts";
import { packAll, rewriteSpecifiers } from "../../../tools/pack.ts";

test("rewriteSpecifiers turns relative .ts imports into .js and leaves packages alone", () => {
  const before = [
    `import { a } from "./a.ts";`,
    `export * from "../b/c.tsx";`,
    `const m = await import("./d.ts");`,
    `import { t } from "typescript/ast";`,
    `import x from "@rge/runtime/jsx";`,
  ].join("\n");
  assert.equal(
    rewriteSpecifiers(before),
    [
      `import { a } from "./a.js";`,
      `export * from "../b/c.js";`,
      `const m = await import("./d.js");`,
      `import { t } from "typescript/ast";`,
      `import x from "@rge/runtime/jsx";`,
    ].join("\n"),
  );
});

test("the packs install into an empty project and every entry point imports under Node", { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "rge-installed-"));
  try {
    const tarballs = packAll(join(dir, "packs"));
    const project = join(dir, "project");
    execFileSync("mkdir", [project]);
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "installed", private: true, type: "module" }));
    execFileSync("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: project, stdio: "pipe" });
    const entries = ["@rge/runtime", "@rge/runtime/jsx", "@rge/runtime/jsx-runtime", "@rge/player", "@rge/player-node", "@rge/compiler", "@rge/native"];
    writeFileSync(
      join(project, "check.mjs"),
      `const out = {};\nfor (const s of ${JSON.stringify(entries)}) out[s] = Object.keys(await import(s)).length;\nconsole.log(JSON.stringify(out));\n`,
    );
    const counts = JSON.parse(execFileSync("node", ["check.mjs"], { cwd: project, encoding: "utf8" })) as Record<string, number>;
    // An installed game has no repository: librge comes from @rge/native, and loads (the ABI check passes).
    if (findNativeLibrary("headless") !== null) {
      writeFileSync(
        join(project, "native.mjs"),
        `import { findNativeLibrary, loadNative, checkAbi } from "@rge/player-node";\nconst path = findNativeLibrary("headless");\ncheckAbi(loadNative(path));\nconsole.log(path);\n`,
      );
      const path = execFileSync("node", ["native.mjs"], { cwd: project, encoding: "utf8", env: { ...process.env, RGE_NATIVE_LIB: "" } }).trim();
      assert.ok(path.includes(join("node_modules", "@rge", "native", "lib")), `librge came from ${path}`);
    }
    for (const entry of entries) assert.ok((counts[entry] ?? 0) > 0, `${entry} exports nothing`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
