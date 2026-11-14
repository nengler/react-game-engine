/**
 * What the development inspector (`rge dev`'s page, REACT_FEEL_PLAN.md C4) shows of a running game: the tree by component, and
 * one object's props, state, refs, game-state subscriptions and renders. It only reads; editing goes through `editState`, which
 * sets state as hot reload does.
 */
import { GameObject } from "./GameObject.ts";

/** One object of the tree, as the inspector lists it. */
export interface InspectedNode {
  readonly id: number;
  /** The component's name (`Enemy`), or the built-in's (`Sprite`). */
  readonly name: string;
  /** The list key it was made with, if any. */
  readonly key?: string | number;
  /** Whether it is a compiled component (rather than a built-in). */
  readonly component: boolean;
  readonly children: readonly InspectedNode[];
}

/** One object in detail. */
export interface InspectedObject {
  readonly id: number;
  readonly name: string;
  /** Its props, as data (functions as `"ƒ name"`). */
  readonly props: Record<string, unknown>;
  /** Its `useMutable` fields (`s.vx`) and refs, by their names in the source. */
  readonly state: Record<string, unknown>;
  /** The game-state paths it reads (`useGame((s) => s.player.hp)` → `player.hp`). */
  readonly subscriptions: readonly string[];
  /** How many times it has rendered since it was made. */
  readonly renders: number;
}

const ids = new WeakMap<GameObject, number>();
const byId = new Map<number, WeakRef<GameObject>>();
let nextId = 1;

/** A stable number for an object, for as long as it lives. */
export function inspectId(object: GameObject): number {
  let id = ids.get(object);
  if (id === undefined) {
    id = nextId++;
    ids.set(object, id);
    byId.set(id, new WeakRef(object));
  }
  return id;
}

/** The object an id names, if it is still alive. */
export function inspectedObject(id: number): GameObject | null {
  return byId.get(id)?.deref() ?? null;
}

/** Whether an object is a compiled component (the compiler marks the class `managed`). */
export function isComponent(object: GameObject): boolean {
  return Object.prototype.hasOwnProperty.call(object.constructor, "managed");
}

/** The tree under `root`. Built-ins under a component are listed too, so a layout can be followed down to a `<Flex>`. */
export function inspectTree(root: GameObject): InspectedNode {
  return {
    id: inspectId(root),
    name: root.constructor.name,
    ...(root.hotKey !== undefined ? { key: root.hotKey } : {}),
    component: isComponent(root),
    children: root.children.map(inspectTree),
  };
}

/** A value as JSON can carry it: functions and objects that are not plain data are named, not copied. */
export function asData(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value === undefined) return null;
  if (typeof value === "function") return `ƒ ${value.name || "anonymous"}`;
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => asData(v, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return `[${(value as object).constructor?.name ?? "object"}]`;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asData(v, depth + 1)]));
  }
  return String(value);
}

/** One object in detail: what the inspector shows when it is selected. */
export function inspectObject(object: GameObject): InspectedObject {
  const saved = object.saveHotState() ?? {};
  const state: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(saved)) state[key.slice(key.indexOf(".") + 1)] = asData(value);
  return {
    id: inspectId(object),
    name: object.constructor.name,
    props: asData(object.props) as Record<string, unknown>,
    state,
    subscriptions: [...object.gameStateKeys],
    renders: object.renderCount,
  };
}

/**
 * Set one of an object's state values by its name in the source (`hp`), from the inspector: as hot reload sets state, so it
 * shows on the next render. Returns whether it had such a state. Development only.
 */
export function editState(object: GameObject, name: string, value: unknown): boolean {
  const saved = object.saveHotState() ?? {};
  const key = Object.keys(saved).find((k) => k.slice(k.indexOf(".") + 1) === name);
  if (key === undefined) return false;
  object.loadHotState({ [key]: value });
  object.markDirty();
  return true;
}
