/**
 * Reading a game as text: find components in a tree, read their state, and describe the tree in a few lines a person or a
 * language model can read without a screenshot. `@tsengine/testing` re-exports the finders; `tse session` and
 * `Rendered.describe()` print `sceneText(describeScene(root))`.
 *
 *     Play @(0,0) state={gold: 120, wave: 3, lives: 10}
 *       Enemy[key=7] @(212.5,96) state={hp: 2}
 *         Sprite image="enemy.png"
 *         Collider tag="enemy" 12×12
 *       Text "Gold 120" @(8,8)
 *
 * A position is world space, and is printed only where it differs from the parent's; props are the ones written in the JSX
 * (functions left out); a component's state is its `useMutable` fields and refs by their names in the source.
 */
import { Collider } from "./components/Collider.ts";
import { Entity } from "./components/Entity.ts";
import { Flex } from "./components/Flex.ts";
import { Pointer } from "./components/Pointer.ts";
import { Text } from "./components/Text.ts";
import { GameObject } from "./GameObject.ts";
import { getGameTree } from "./gameTree.ts";
import { isComponent } from "./inspect.ts";

/** What `findComponent` looks for: an object's `name` or class name (`"Play"`), or a class (`Play`). */
export type ComponentQuery<T extends GameObject> = string | (abstract new (...args: never[]) => T);

/** Whether `object` is what `what` asks for: its `name`, its class's name, or an instance of the class. */
export function matchesQuery(object: GameObject, what: ComponentQuery<GameObject>): boolean {
  return typeof what === "string"
    ? (object as { name?: unknown }).name === what || object.constructor.name === what
    : object instanceof what;
}

/**
 * Every object under `root` (itself included) whose `name` is `what`, or whose class is called that, or which is an instance of
 * that class, in tree order. Without a `root`, the running game's tree (`createPlayer`, `runScript`, a replay, `tse session`).
 */
export function findComponents<T extends GameObject = GameObject>(
  what: ComponentQuery<T>,
  root: GameObject | null = getGameTree()?.root ?? null
): T[] {
  const out: T[] = [];
  if (root === null) return out;
  const visit = (object: GameObject): void => {
    if (matchesQuery(object, what as ComponentQuery<GameObject>)) out.push(object as T);
    for (const child of object.children) visit(child);
  };
  visit(root);
  return out;
}

/** The first of `findComponents`, or null: `findComponent(Play)` is the running game's `Play`, while it is on screen. */
export function findComponent<T extends GameObject = GameObject>(
  what: ComponentQuery<T>,
  root: GameObject | null = getGameTree()?.root ?? null
): T | null {
  return (findComponents(what, root)[0] as T | undefined) ?? null;
}

/**
 * A component's own state by the names its source gives them (`{ hp: 3 }`, and a `useMutable` as an object, `{ s: { vx: 0 } }`):
 * what hot reload keeps, read back. `componentState(findComponent(Play)!)` reads a running game's `Play`.
 */
export function componentState(component: GameObject): Record<string, unknown> {
  const saved = component.saveHotState() ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(saved)) {
    // `Hero.hp`, or `Hero.s.vx` for a `useMutable` field: a name cannot hold a dot, so a second one always means a field.
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

/** One object of a described tree. Every field but `name` and `children` is left out when it says nothing. */
export interface SceneNode {
  /** The component's or built-in's class name (`Enemy`, `Sprite`), or an `<Entity name>`'s name. */
  readonly name: string;
  /** Its list key, when a list made it. */
  readonly key?: string | number;
  /** True for a compiled component. */
  readonly component?: true;
  /** Its world position, rounded to a tenth of a pixel. */
  readonly x: number;
  readonly y: number;
  /** A `<Text>`'s words. */
  readonly text?: string;
  /** A collider's tag and size; the size of a `<Pointer>` or a laid-out `<Flex>`. */
  readonly tag?: string;
  readonly width?: number;
  readonly height?: number;
  /** A component's props that are plain data (no functions, no children); a built-in's image, shape or colour. */
  readonly props?: Record<string, unknown>;
  /** A component's state, by its names in the source. */
  readonly state?: Record<string, unknown>;
  /** The node is under an `inert` or `modal`-blocked scope and takes no input. */
  readonly inert?: true;
  readonly children: readonly SceneNode[];
  /** Objects below this one that were not described (`depth`, `maxNodes`), counted. */
  readonly omitted?: number;
}

export interface DescribeOptions {
  /**
   * Which objects to list. `"all"` (the default): every object. `"components"`: compiled components and `<Text>` only (what the
   * game's own code made, and the words on screen); the built-ins between them are walked through, not listed.
   */
  readonly only?: "all" | "components";
  /** How many levels below the root to describe. Default: all. */
  readonly depth?: number;
  /** The most objects to describe; the rest are counted in `omitted`. Default 400. */
  readonly maxNodes?: number;
  /** Include the props written in the JSX. Default true. */
  readonly props?: boolean;
  /** Include components' state. Default true. */
  readonly state?: boolean;
}

/** Props never listed: placement is shown as the position, children and keys as the tree. */
const SKIPPED_PROPS: ReadonlySet<string> = new Set(["x", "y", "transform", "children", "key", "name", "text"]);

const round = (n: number): number => Math.round(n * 10) / 10;

/** A value as plain, short data: numbers rounded, functions and game objects left out, long lists and deep objects cut. */
function plain(value: unknown, depth = 0): unknown {
  if (typeof value === "number") return Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (value === undefined || typeof value === "function" || value instanceof GameObject) return undefined;
  if (depth >= 3) return Array.isArray(value) ? `[${value.length} items]` : "{…}";
  if (Array.isArray(value)) {
    if (value.length > 32) return `[${value.length} items]`;
    return value.map((item) => plain(item, depth + 1) ?? null);
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return `[${(value as object).constructor?.name ?? "object"}]`;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const p = plain(v, depth + 1);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return undefined;
}

function plainRecord(record: object, skip: ReadonlySet<string> = new Set()): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const [k, v] of Object.entries(record)) {
    if (skip.has(k)) continue;
    const p = plain(v);
    if (p === undefined) continue;
    out[k] = p;
    any = true;
  }
  return any ? out : undefined;
}

/** The fields worth a glance on a built-in: what it shows (an image, a shape, a colour) and its size where that is its own. */
const BUILTIN_FIELDS = ["image", "sheet", "frame", "kind"] as const;

function builtinFields(object: GameObject): Record<string, unknown> | undefined {
  const fields = object as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let any = false;
  for (const name of BUILTIN_FIELDS) {
    const value = fields[name];
    if (typeof value !== "string" && typeof value !== "number") continue;
    if (name === "frame" && value === 0) continue;
    out[name] = plain(value);
    any = true;
  }
  // A shape's size and colour are what it draws (a collider's size is printed on its own; a text's colour is noise).
  if (typeof fields["kind"] === "string" && typeof fields["width"] === "number") {
    out["width"] = plain(fields["width"]);
    out["height"] = plain(fields["height"]);
    out["color"] = plain(fields["color"]);
  }
  return any ? out : undefined;
}

/**
 * The tree under `root` as data: names, world positions, texts, colliders, props and state. Without a `root`, the running game's
 * tree. `sceneText` prints it.
 */
export function describeScene(root: GameObject | null = getGameTree()?.root ?? null, options: DescribeOptions = {}): SceneNode {
  if (root === null) return { name: "(no game)", x: 0, y: 0, children: [] };
  const only = options.only ?? "all";
  const maxDepth = options.depth ?? Infinity;
  let budget = options.maxNodes ?? 400;
  const withProps = options.props ?? true;
  const withState = options.state ?? true;

  const count = (object: GameObject): number => {
    let n = 1;
    for (const child of object.children) n += count(child);
    return n;
  };
  const listed = (object: GameObject): boolean => only === "all" || isComponent(object) || object instanceof Text;

  const node = (object: GameObject, depth: number): SceneNode => {
    budget--;
    const at = object.worldTransform();
    const component = isComponent(object);
    const entityName = object instanceof Entity && object.name !== "" ? object.name : null;
    const out: { -readonly [K in keyof SceneNode]: SceneNode[K] } = {
      name: entityName ?? object.constructor.name,
      x: round(at.x),
      y: round(at.y),
      children: [],
    };
    if (object.hotKey !== undefined) out.key = object.hotKey;
    if (component) out.component = true;
    if (object instanceof Text) out.text = object.text;
    if (object instanceof Collider) {
      if (object.tag !== "") out.tag = object.tag;
      out.width = round(object.width);
      out.height = round(object.height);
    }
    // What can be clicked says how big it is, so a click can find its middle.
    if (object instanceof Pointer) {
      out.width = round(object.width);
      out.height = round(object.height);
    } else if (object instanceof Flex && (object.onPress !== undefined || object.box.size[0]! > 0)) {
      out.width = round(object.box.size[0]!);
      out.height = round(object.box.size[1]!);
    }
    if (withProps) {
      // A component's props are what its parent passed; a built-in keeps what it was given as fields of its own.
      const props = component ? plainRecord(object.props as object, SKIPPED_PROPS) : builtinFields(object);
      if (props !== undefined) out.props = props;
    }
    if (withState && component) {
      const state = plainRecord(componentState(object));
      if (state !== undefined) out.state = state;
    }
    // Marked where it starts, not on everything under it.
    const world = object.world;
    if (world !== null && world.isInert(object) && (object.parent === null || !world.isInert(object.parent))) out.inert = true;
    const children: SceneNode[] = [];
    let omitted = 0;
    const visit = (child: GameObject, childDepth: number): void => {
      if (!listed(child)) {
        for (const grandchild of child.children) visit(grandchild, childDepth);
        return;
      }
      if (childDepth > maxDepth || budget <= 0) {
        omitted += count(child);
        return;
      }
      children.push(node(child, childDepth));
    };
    for (const child of object.children) visit(child, depth + 1);
    out.children = children;
    if (omitted > 0) out.omitted = omitted;
    return out;
  };
  return node(root, 0);
}

/** A value as it is printed in a scene line: JSON, but with spaces after colons and commas and unquoted keys. */
function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${show(v)}`)
      .join(", ")}}`;
  return JSON.stringify(value);
}

/** `describeScene`'s tree as indented lines, one object a line. A position is printed where it differs from the parent's. */
export function sceneText(scene: SceneNode): string {
  const lines: string[] = [];
  const line = (node: SceneNode, indent: string, parent: SceneNode | null): void => {
    let text = node.name;
    if (node.key !== undefined) text += `[key=${String(node.key)}]`;
    if (node.text !== undefined) text += ` ${JSON.stringify(node.text)}`;
    if (parent === null || node.x !== parent.x || node.y !== parent.y) text += ` @(${node.x},${node.y})`;
    if (node.tag !== undefined) text += ` tag=${JSON.stringify(node.tag)}`;
    if (node.width !== undefined) text += ` ${node.width}×${node.height}`;
    if (node.inert) text += " inert";
    if (node.props !== undefined)
      text += Object.entries(node.props)
        .map(([k, v]) => ` ${k}=${show(v)}`)
        .join("");
    if (node.state !== undefined) text += ` state=${show(node.state)}`;
    lines.push(indent + text);
    for (const child of node.children) line(child, indent + "  ", node);
    if (node.omitted !== undefined) lines.push(`${indent}  … ${node.omitted} more`);
  };
  line(scene, "", null);
  return lines.join("\n");
}
