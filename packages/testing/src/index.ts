/**
 * Testing one component without a window, as React Testing Library tests one React component: mount it in a headless world, step
 * it, press keys from the input script language the games already use, report collisions and presses, and read what it would
 * draw and what it holds.
 *
 *     import { render } from "@rge/testing";
 *     import { Enemy } from "../generated/Enemy.ts";
 *
 *     const t = render(Enemy, { hp: 3, onDefeated });
 *     t.collide("enemy", { tag: "shot", data: { damage: 1 } }, 3);
 *     t.step();
 *     assert.equal(onDefeated.mock.callCount(), 1);
 *
 * Tests import the generated class, as a game's `game.ts` does.
 */
import { CollisionTracker, parseInputScript } from "@rge/player";
import {
  Collider,
  Controls,
  Entity,
  GameObject,
  NO_INPUT,
  Text,
  World,
  createInputState,
  registerTilemaps,
  resetGameState,
  setTextDefaults,
  setGameTree,
  type TilemapData,
} from "@rge/runtime";

export interface RenderOptions {
  /** Tiled maps to register before the component is made, by name (what `<Tilemap map>` and `getTilemap` look up). */
  readonly tilemaps?: Readonly<Record<string, TilemapData>>;
  /** The game's controls, so `input("jump")` and `input.pressed("jump")` mean what they mean in the game. */
  readonly controls?: Controls;
  /** Seconds a step reports. Default 1/60, the fixed step. */
  readonly dt?: number;
  /** Leave the game state as it is, rather than putting every store back to its initial state first. */
  readonly keepGameState?: boolean;
  /**
   * Find collisions after every step, as the player does: colliders that come to overlap report `onCollisionEnter` (and
   * `onCollisionExit` when they part) by themselves. Default false: a test reports the contacts it wants with `collide`.
   */
  readonly collisions?: boolean;
}

/** A collider to touch the component with, made for the test: what the other side's `other` will read. */
export interface ContactSpec {
  readonly tag?: string;
  readonly data?: unknown;
  readonly width?: number;
  readonly height?: number;
}

/** Another collider put in the world for a test (`place`): a contact spec, and where its top left is. */
export interface PlacedSpec extends ContactSpec {
  readonly x: number;
  readonly y: number;
  readonly layer?: string;
}

/** A component mounted for a test. Every method that runs the world flushes it after, so what is read is what would be drawn. */
export class Rendered<Root extends GameObject = GameObject> {
  readonly world = new World();
  readonly root: Root;
  readonly #dt: number;
  readonly #controls: Controls | undefined;
  /** Colliders made by `collide` to stand for the other side, kept so a second contact with the same spec is the same collider. */
  readonly #others = new Map<string, Collider>();
  readonly #holder = new Entity({ name: "$test" });
  readonly #tracker: CollisionTracker | null;

  constructor(root: Root, options: RenderOptions) {
    this.root = root;
    this.#dt = options.dt ?? 1 / 60;
    this.#controls = options.controls;
    this.#tracker = options.collisions === true ? new CollisionTracker() : null;
    this.world.mount(this.#holder);
    this.#holder.addChild(root);
    setGameTree(this.world, root);
    this.world.flush();
  }

  /** Run `count` steps with nothing pressed. */
  step(count = 1): this {
    for (let i = 0; i < count; i++) this.#tick(this.#dt, NO_INPUT);
    return this;
  }

  /**
   * Run the steps of an input script (`"right*30, jump, _"`): the format of the games' replays, one step per frame. Names are the
   * controls' actions (given as `controls`) or key names.
   */
  input(script: string): this {
    const bindings = this.#controls?.toJSON();
    const frames = parseInputScript(script, { dt: this.#dt, ...(bindings ? { bindings } : {}) });
    for (const frame of frames) this.#tick(frame.dt, createInputState({ pressed: frame.pressed, down: frame.down, released: frame.released }, this.#controls));
    return this;
  }

  /**
   * Put another collider in the world, at (x, y) in the world's space: something for the component to find or touch (an enemy
   * near a tower). Returns it, to move (`transform`) or take out (`remove`) later.
   */
  place(spec: PlacedSpec): Collider {
    const collider = new Collider({ width: spec.width ?? 1, height: spec.height ?? 1, tag: spec.tag ?? "", data: spec.data, layer: spec.layer });
    collider.transform.x = spec.x;
    collider.transform.y = spec.y;
    // In an entity of its own: colliders with the same parent are one thing's, and never touch each other.
    const thing = new Entity({ name: "$placed" });
    thing.addChild(collider);
    this.#holder.addChild(thing);
    this.world.flush();
    return collider;
  }

  /** Take out what `place` put in. */
  remove(collider: Collider): void {
    if (collider.parent !== null) this.#holder.removeChild(collider.parent);
    this.world.flush();
  }

  /** One step: the tick, its renders, and (with `collisions`) the contacts it made, and what they changed. */
  #tick(dt: number, input: Parameters<World["tick"]>[1]): void {
    this.world.tick(dt, input);
    this.world.flush();
    if (this.#tracker === null) return;
    const entries: { collider: Collider; world: ReturnType<Collider["worldTransform"]> }[] = [];
    const visit = (object: GameObject): void => {
      if (object instanceof Collider) entries.push({ collider: object, world: object.worldTransform() });
      for (const child of object.children) visit(child);
    };
    visit(this.#holder);
    this.#tracker.update(this.world, entries);
    this.world.flush();
  }

  /** Press a pointer (or a `<Flex onPress>`, anything pressable) at its own position, as a click on it would. */
  press(target: GameObject | string): this {
    const pressable = typeof target === "string" ? this.find(target) : target;
    if (pressable === null) throw new Error(`press: nothing called '${String(target)}' in the tree`);
    // Its middle, for a target that has a size (a `<Pointer>`); else its position.
    const at = pressable.worldTransform();
    const size = pressable as unknown as { width?: unknown; height?: unknown };
    const x = at.x + (typeof size.width === "number" ? size.width / 2 : 0);
    const y = at.y + (typeof size.height === "number" ? size.height / 2 : 0);
    const hit = this.world.reportPress(pressable as never, x, y);
    if (!hit) throw new Error(`press: ${pressable.constructor.name} did not take a press at its own position (is it pressable, and not inert?)`);
    this.world.flush();
    return this;
  }

  /**
   * Report that one of the component's colliders (by `tag`, or the collider itself) began touching another, `times` times. The
   * other is a collider made for the test from `other` (a tag, data and size), or one already in the tree.
   */
  collide(collider: Collider | string, other: ContactSpec | Collider, times = 1): this {
    const own = typeof collider === "string" ? this.#collider(collider) : collider;
    const them = other instanceof Collider ? other : this.#other(other);
    for (let i = 0; i < times; i++) {
      this.world.reportCollision(own, them);
      this.world.flush();
    }
    return this;
  }

  /** Report that a collider stopped touching another (`onCollisionExit`). */
  separate(collider: Collider | string, other: ContactSpec | Collider): this {
    const own = typeof collider === "string" ? this.#collider(collider) : collider;
    const them = other instanceof Collider ? other : this.#other(other);
    this.world.reportCollisionExit(own, them);
    this.world.flush();
    return this;
  }

  /** Give the component new props, as its parent would. */
  setProps(props: object): this {
    (this.root as unknown as { updateProps(p: object): void }).updateProps(props);
    this.world.flush();
    return this;
  }

  /**
   * The first object in the tree (the component included) whose `name` is this, or whose class is called this (`"Sprite"`), or
   * which is an instance of this class. Null when there is none.
   */
  find<T extends GameObject = GameObject>(what: string | (abstract new (...args: never[]) => T)): T | null {
    return (this.findAll(what)[0] as T | undefined) ?? null;
  }

  /** Every object `find` would match, in tree order. */
  findAll<T extends GameObject = GameObject>(what: string | (abstract new (...args: never[]) => T)): T[] {
    const out: T[] = [];
    const visit = (object: GameObject): void => {
      const matches = typeof what === "string" ? (object as { name?: unknown }).name === what || object.constructor.name === what : object instanceof what;
      if (matches) out.push(object as T);
      for (const child of object.children) visit(child);
    };
    visit(this.root);
    return out;
  }

  /**
   * A component's own state and refs by the names its source gives them (`{ health: 3, cooldown: 0.2 }`, and a `useSim` as an object,
   * `{ s: { vx: 0 } }`): what hot reload keeps, read back. Defaults to the rendered component; pass any compiled component in the tree.
   */
  state(component: GameObject = this.root): Record<string, unknown> {
    const saved = component.saveHotState() ?? {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(saved)) {
      // `Hero.hp`, or `Hero.s.vx` for a `useSim` field: a name cannot hold a dot, so a second one always means a field.
      const [name, field] = key.slice(key.indexOf(".") + 1).split(".") as [string, string | undefined];
      if (field === undefined) {
        out[name] = value;
        continue;
      }
      const group = (out[name] ??= {}) as Record<string, unknown>;
      group[field] = value;
    }
    return out;
  }

  /** The words of every `<Text>` in the tree, in tree order. */
  texts(): string[] {
    return this.findAll(Text).map((t) => t.text);
  }

  /** Take the component out of the world: its unmount handlers and cleanups run. */
  unmount(): void {
    this.#holder.removeChild(this.root);
    this.world.flush();
  }

  #collider(tag: string): Collider {
    const found = this.findAll(Collider).find((c) => c.tag === tag);
    if (found === undefined) throw new Error(`collide: the component has no collider tagged '${tag}'`);
    return found;
  }

  #other(spec: ContactSpec): Collider {
    const key = JSON.stringify(spec);
    let collider = this.#others.get(key);
    if (collider === undefined) {
      collider = new Collider({ width: spec.width ?? 1, height: spec.height ?? 1, tag: spec.tag ?? "", data: spec.data });
      this.#others.set(key, collider);
      this.#holder.addChild(collider);
      this.world.flush();
    }
    return collider;
  }
}

/**
 * Mount a compiled component in a headless world, with the game state put back to its start and `options.tilemaps` registered.
 * Returns the handle a test steps, presses and reads.
 */
export function render<P extends object, R extends GameObject = GameObject>(
  Component: new (props: P) => R,
  props?: P,
  options: RenderOptions = {},
): Rendered<R> {
  if (!options.keepGameState) resetGameState();
  setTextDefaults({}); // no <Game> root here: a <Text> without its own size or colour uses the engine's

  if (options.tilemaps) registerTilemaps(options.tilemaps);
  const root: R = new Component(props ?? ({} as P));
  return new Rendered<R>(root, options);
}
