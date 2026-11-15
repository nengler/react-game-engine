import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnimatedSprite, Camera, Fade, Music, Provider, Route, Router, createContext, Particles, ParticleLayer, createParticles, Tilemap, Collider, Entity, Flex, Game, GameObject, Hud, Pointer, SCREEN_FITS, SHAPE_KINDS, Screen, Shape, Slider, Sprite, Text, Toggle, Button, Menu, CALLBACK_PRIMITIVES, createInputState, runtimeManifest } from "../src/index.ts";

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
      Game: new Game(),
      Sprite: new Sprite({ image: "a" }),
      Collider: new Collider({ width: 1, height: 1 }),
      Text: new Text({ text: "" }),
      Slider: new Slider(),
      Toggle: new Toggle(),
      Button: new Button(),
      Menu: new Menu(),
      Shape: new Shape({ kind: "rect", width: 1, height: 1 }),
      Camera: new Camera(),
      AnimatedSprite: new AnimatedSprite({ frames: ["a.png"] }),
      Pointer: new Pointer({ width: 1, height: 1 }),
      Screen: new Screen({ width: 1, height: 1 }),
      Hud: new Hud(),
      Flex: new Flex(),
      Tilemap: new Tilemap({ map: "m", image: "i" }),
      Particles: new Particles(),
      ParticleLayer: new ParticleLayer({ particles: createParticles({}) }),
      Fade: new Fade(),
      Music: new Music({ src: "m.ogg" }),
      Router: new Router({ route: "a" }),
      Route: new Route({ name: "a" }),
      Provider: new Provider({ context: createContext(0), value: 0 }),
    };
    const base = new Entity();
    for (const tag of runtimeManifest.intrinsics) {
      const instance = instances[tag]!;
      const fields = Object.keys(instance).filter((key) => !(key in base) || key === "name");
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(instance) as object).filter((key) => key !== "constructor" && !(key in base));
      const declared = [...(runtimeManifest.intrinsicMembers[tag] ?? [])].sort();
      assert.deepEqual(declared, [...fields, ...methods].sort(), `${tag}: intrinsicMembers must list exactly the fields and methods it adds`);
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
        for (const p of params) assert.ok(p.type in runtimeManifest.handleTypes || (CALLBACK_PRIMITIVES as readonly string[]).includes(p.type), `${tag}.${name}: ${p.type} is neither a handle type nor a plain value`);
      }
    }
  });

  it("names, for text content, an intrinsic that is a leaf and a prop it really has", () => {
    for (const [tag, prop] of Object.entries(runtimeManifest.textContent)) {
      assert.ok(runtimeManifest.intrinsics.includes(tag), tag);
      assert.ok(!runtimeManifest.containerIntrinsics.includes(tag), `${tag} holds text, not elements`);
      assert.ok(runtimeManifest.intrinsicMembers[tag]?.includes(prop), `${tag}.${prop} must be one of its members`);
      assert.ok(runtimeManifest.intrinsicRequired[tag]?.includes(prop), `${tag}.${prop} is the content, so it is required`);
    }
  });

  it("restricts only real props of real intrinsics to a set of strings, and Shape.kind to its kinds", () => {
    for (const [tag, props] of Object.entries(runtimeManifest.intrinsicLiterals)) {
      assert.ok(runtimeManifest.intrinsics.includes(tag), tag);
      for (const [name, values] of Object.entries(props)) {
        assert.ok(runtimeManifest.intrinsicMembers[tag]?.includes(name), `${tag}.${name} must be a member`);
        assert.ok(values.length > 0, `${tag}.${name} needs at least one value`);
      }
    }
    assert.deepEqual(runtimeManifest.intrinsicLiterals["Shape"]?.["kind"], [...SHAPE_KINDS]);
    assert.deepEqual(runtimeManifest.intrinsicLiterals["Screen"]?.["fit"], [...SCREEN_FITS]);
  });

  it("lists exactly the hooks each intrinsic implements itself, so a component rooted at it can call super", () => {
    const hooks = ["onInput", "onUpdate", "onMount", "onUnmount"];
    const classes: Record<string, { prototype: object }> = { Entity, Game, Sprite, Collider, Text, Shape, Camera, AnimatedSprite, Pointer, Screen, Hud, Flex, Slider, Toggle, Button, Menu, Tilemap, Particles, ParticleLayer, Fade, Music, Router, Route, Provider };
    for (const tag of runtimeManifest.intrinsics) {
      const overridden = hooks.filter((hook) => Object.hasOwn(classes[tag]!.prototype, hook)).sort();
      assert.deepEqual([...(runtimeManifest.intrinsicHooks[tag] ?? [])].sort(), overridden, `${tag}: intrinsicHooks must list the hooks its class overrides`);
    }
  });

  it("lists only intrinsics as transformable, including the host", () => {
    for (const tag of runtimeManifest.transformIntrinsics) assert.ok(runtimeManifest.intrinsics.includes(tag), tag);
    assert.ok(runtimeManifest.transformIntrinsics.includes(runtimeManifest.hostIntrinsic));
  });

  it("does not let a Screen be placed: it is the game's whole screen, not something in it", () => {
    assert.ok(!runtimeManifest.transformIntrinsics.includes("Screen"));
    assert.ok(runtimeManifest.containerIntrinsics.includes("Screen"));
  });

  it("reserves the layout offset, which the player writes into every object", () => {
    for (const name of ["layoutX", "layoutY"]) assert.ok(runtimeManifest.reservedMembers.includes(name), name);
  });

  it("names the host intrinsic among its intrinsics, and every intrinsic is a runtime class", () => {
    assert.ok(runtimeManifest.intrinsics.includes(runtimeManifest.hostIntrinsic));
    const classes: Record<string, unknown> = { Entity, Game, Sprite, Collider, Text, Shape, Camera, AnimatedSprite, Pointer, Screen, Hud, Flex, Slider, Toggle, Button, Menu, Tilemap, Particles, ParticleLayer, Fade, Music, Router, Route, Provider };
    for (const name of runtimeManifest.intrinsics) assert.equal(typeof classes[name], "function", name);
  });

  it("lets components call every method of InputState and read every property (the compiler knows a handle by the manifest)", () => {
    const input = createInputState({}) as unknown as Record<string, unknown>;
    // `isAction` is how the player asks the controls; a component never calls it.
    const internal = new Set(["isAction"]);
    const methods = Object.keys(input).filter((k) => typeof input[k] === "function" && !internal.has(k));
    const properties = Object.keys(input).filter((k) => typeof input[k] !== "function");
    const known = runtimeManifest.handleTypes["InputState"]!;
    assert.deepEqual(methods.filter((m) => known.methods[m] === undefined), [], "add these to handleTypes.InputState.methods, with their argument counts");
    assert.deepEqual(properties.filter((p) => !known.properties.includes(p)), [], "add these to handleTypes.InputState.properties");
    for (const m of methods) assert.equal((input[m] as (...a: unknown[]) => unknown).length, known.methods[m], `${m}'s argument count`);
  });
});
