import assert from "node:assert/strict";
/**
 * `createSounds({ … })` is written in a plain `.ts` module, which the compiler does not otherwise read: its sound files are
 * checked against the assets folder when the project is built, so a typo is an error with the nearest name, not silence.
 */
import { after, describe, it } from "node:test";

import { DiagnosticCode } from "../src/index.ts";
import { closeCompiler, getCompiler } from "./helpers.ts";

after(closeCompiler);

const FILES = ["jump.wav", "land.wav", "sfx/hit.wav"];
const options = { exists: (name: string) => FILES.includes(name), list: () => FILES, folder: "assets" };

function check(text: string, fileName = "effects.ts") {
  return getCompiler().checkSoundStores([{ fileName, text }], options);
}

describe("sound stores are checked against the assets folder", () => {
  it("accepts files that exist, as a name or as { src, volume }", () => {
    assert.deepEqual(
      check(`export const sfx = createSounds({ jump: "jump.wav", land: { src: "land.wav", volume: 0.5 }, hit: "sfx/hit.wav" });`),
      []
    );
  });

  it("reports a missing file with the nearest name and where it is written", () => {
    const [d, ...rest] = check(
      `import { createSounds } from "@tsengine/runtime";\n\nexport const sfx = createSounds({\n  jump: "jmup.wav",\n});\n`
    );
    assert.equal(rest.length, 0);
    assert.equal(d?.code, DiagnosticCode.MissingAsset);
    assert.equal(d?.severity, "error");
    assert.match(d?.message ?? "", /The sound 'jmup\.wav' is not in assets\/ \(did you mean 'jump\.wav'\?\)\./);
    assert.deepEqual([d?.span?.fileName, d?.span?.line, d?.span?.column], ["effects.ts", 4, 9]);
  });

  it("reports the src of an entry that is an object, and every missing file", () => {
    const found = check(`export const sfx = createSounds({ land: { src: "lnad.wav", volume: 0.5 }, hit: "nope.wav", ok: "jump.wav" });`);
    assert.deepEqual(
      found.map((d) => /'([^']+)'/.exec(d.message)?.[1]),
      ["lnad.wav", "nope.wav"]
    );
  });

  it("sees through `as const` and `satisfies`, and a quoted key", () => {
    const found = check(`export const sfx = createSounds({ "wall jump": { src: "wal.wav" } } as const);`);
    assert.equal(found.length, 1);
  });

  it("skips what is not written as a literal, and other calls", () => {
    assert.deepEqual(
      check(
        `const file = "x.wav"; export const a = createSounds({ x: file, y: \`\${file}.wav\`, z: { src: file } }); const b = other({ q: "missing.wav" });`
      ),
      []
    );
  });

  it("leaves a file that does not make a sound store alone, even when it cannot be parsed", () => {
    assert.deepEqual(check(`export const x = {{{ "missing.wav"`), []);
  });
});
