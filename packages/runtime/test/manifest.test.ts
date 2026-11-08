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

  it("names the host intrinsic among its intrinsics, and every intrinsic is a runtime class", () => {
    assert.ok(runtimeManifest.intrinsics.includes(runtimeManifest.hostIntrinsic));
    const classes: Record<string, unknown> = { Entity, Sprite, Collider };
    for (const name of runtimeManifest.intrinsics) assert.equal(typeof classes[name], "function", name);
  });
});
