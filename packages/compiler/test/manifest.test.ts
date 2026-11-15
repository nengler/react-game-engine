/** The runtime manifest as the compiler's configuration: its intrinsics, reserved names and the hooks each built-in implements. */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { runtimeManifest } from "@tsengine/runtime";

import { Compiler, DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, withAuthoringImports, getCompiler } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("runtime manifest as compiler config", () => {
  const TORCH = `
function Lamp() {
  return (
    <Entity name="Lamp">
      <Torch radius={4} />
    </Entity>
  );
}`;

  it("rejects an intrinsic the manifest does not list", () => {
    const compiler = new Compiler();
    try {
      const result = compiler.compile("Lamp.tsx", withAuthoringImports(TORCH));
      assert.deepEqual(
        result.diagnostics.map((d) => d.code),
        [DiagnosticCode.UnknownComponent]
      );
    } finally {
      compiler.close();
    }
  });

  it("accepts a new intrinsic with no compiler edit", () => {
    const manifest = { ...runtimeManifest, intrinsics: [...runtimeManifest.intrinsics, "Torch"] };
    const compiler = new Compiler({ manifest });
    try {
      const result = compiler.compile("Lamp.tsx", withAuthoringImports(TORCH, manifest));
      assert.ok(result.ok);
      assert.match(result.code, /import \{ Entity, Torch \} from "@tsengine\/runtime";/);
      assert.match(result.code, /new Torch\(\{ radius: 4 \}\)/);
    } finally {
      compiler.close();
    }
  });

  it("takes the reserved names, host intrinsic and functions from the manifest it is given", () => {
    const manifest = {
      ...runtimeManifest,
      reservedMembers: [...runtimeManifest.reservedMembers, "score"],
      functions: { clamp: 3, wrap: 2 },
    };
    const compiler = new Compiler({ manifest });
    try {
      const reserved = compiler.compile(
        "R.tsx",
        withAuthoringImports(
          `
function R() {
  const score = useMutable({ n: 0 });
  return <Entity name="R" />;
}`,
          manifest
        )
      );
      assert.ok(reserved.ok && reserved.code.includes("get $score()"), "a reserved name from the manifest is kept apart, as `$score`");
      const calls = compiler.compile(
        "W.tsx",
        withAuthoringImports(
          `
function W() {
  const s = useMutable({ n: 0 });
  useUpdate(() => { s.n = wrap(s.n, 10); });
  return <Entity name="W" />;
}`,
          manifest
        )
      );
      assert.ok(calls.ok);
      assert.match(calls.code, /import \{ Entity, wrap \} from "@tsengine\/runtime";/);
    } finally {
      compiler.close();
    }
  });
});

describe("the manifest says which hooks a built-in implements", () => {
  it("lists onUpdate for the built-ins that advance themselves (AnimatedSprite, Camera, Particles, Fade, Music, Router), and ParticleLayer's mount hooks", () => {
    assert.deepEqual(runtimeManifest.intrinsicHooks, {
      AnimatedSprite: ["onUpdate"],
      Camera: ["onUpdate"],
      Particles: ["onUpdate"],
      ParticleLayer: ["onMount", "onUnmount"],
      Fade: ["onUpdate"],
      Music: ["onUpdate"],
      Router: ["onUpdate"],
    });
  });

  it("is driven by the manifest, not by AnimatedSprite: any intrinsic can be marked", () => {
    const withSuper = (manifest: typeof runtimeManifest) => {
      const compiler = new (getCompiler().constructor as new (config: object) => ReturnType<typeof getCompiler>)({ manifest });
      try {
        const result = compiler.compile(
          "C.tsx",
          `import { Shape, useUpdate, useMutable } from "@tsengine/runtime/jsx";\nfunction C() { const s = useMutable({ r: 0 }); useUpdate((dt) => { s.r += dt; }); return <Shape kind="rect" width={1} height={1} />; }`
        );
        assert.ok(result.ok, JSON.stringify(result.diagnostics));
        return result.code;
      } finally {
        compiler.close();
      }
    };
    assert.doesNotMatch(withSuper(runtimeManifest), /super\.onUpdate/);
    assert.match(
      withSuper({ ...runtimeManifest, intrinsicHooks: { Shape: ["onUpdate"] } }),
      /override onUpdate\(dt: number, input: InputState\): void \{\n\s+super\.onUpdate\(dt, input\);\n\s+this\.#onUpdate0\(dt\);/
    );
  });
});
