import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, GameObject, Sprite, runtimeManifest } from "../src/index.ts";

/** Every instance field and prototype member a generated subclass of `host` would inherit, excluding Object.prototype. */
function inheritedMembers(host: object): Set<string> {
  const names = new Set(Object.getOwnPropertyNames(host));
  for (let proto = Object.getPrototypeOf(host) as object | null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  return names;
}

describe("runtime manifest", () => {
  it("reserves every member generated classes inherit from the host intrinsic", () => {
    const reserved = new Set(runtimeManifest.reservedMembers);
    const missing = [...inheritedMembers(new Entity())].filter((name) => !reserved.has(name));
    assert.deepEqual(missing, [], `add these to runtimeManifest.reservedMembers: ${missing.join(", ")}`);
  });

  it("detects a GameObject member missing from the reserved list", () => {
    const proto = GameObject.prototype as unknown as Record<string, unknown>;
    proto["newHookForTest"] = function () {};
    try {
      const reserved = new Set(runtimeManifest.reservedMembers);
      assert.ok([...inheritedMembers(new Entity())].some((name) => !reserved.has(name)));
    } finally {
      delete proto["newHookForTest"];
    }
  });

  it("describes each intrinsic's own members, containers and callbacks accurately", () => {
    const instances: Record<string, object> = {
      Entity: new Entity(),
      Sprite: new Sprite({ image: "a" }),
      Collider: new Collider({ width: 1, height: 1 }),
    };
    const base = new Entity();
    for (const tag of runtimeManifest.intrinsics) {
      const own = Object.keys(instances[tag]!).filter((key) => !(key in base) || key === "name").sort();
      const declared = [...(runtimeManifest.intrinsicMembers[tag] ?? [])].sort();
      assert.deepEqual(declared, own, `${tag}: intrinsicMembers must list exactly the fields it adds`);
    }
    for (const [tag, required] of Object.entries(runtimeManifest.intrinsicRequired)) {
      for (const name of required) assert.ok(runtimeManifest.intrinsicMembers[tag]?.includes(name), `${tag}.${name} is required, so it must be one of the intrinsic's members`);
    }
    assert.deepEqual(Object.keys(runtimeManifest.intrinsicRequired).sort(), [...runtimeManifest.intrinsics].sort(), "every intrinsic says what it requires");
    for (const tag of runtimeManifest.containerIntrinsics) assert.ok(runtimeManifest.intrinsics.includes(tag), tag);
    assert.ok(runtimeManifest.containerIntrinsics.includes(runtimeManifest.hostIntrinsic));
    for (const [tag, callbacks] of Object.entries(runtimeManifest.intrinsicCallbacks)) {
      for (const [name, params] of Object.entries(callbacks)) {
        assert.ok(name in (instances[tag] ?? {}), `${tag}.${name} must be a field`);
        for (const p of params) assert.ok(p.type in runtimeManifest.handleTypes, `${tag}.${name}: ${p.type} is not a handle type`);
      }
    }
  });

  it("lists only intrinsics as transformable, including the host", () => {
    for (const tag of runtimeManifest.transformIntrinsics) assert.ok(runtimeManifest.intrinsics.includes(tag), tag);
    assert.ok(runtimeManifest.transformIntrinsics.includes(runtimeManifest.hostIntrinsic));
  });

  it("names the host intrinsic among its intrinsics, and every intrinsic is a runtime class", () => {
    assert.ok(runtimeManifest.intrinsics.includes(runtimeManifest.hostIntrinsic));
    const classes: Record<string, unknown> = { Entity, Sprite, Collider };
    for (const name of runtimeManifest.intrinsics) assert.equal(typeof classes[name], "function", name);
  });
});
