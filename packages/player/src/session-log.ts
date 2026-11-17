/**
 * What happened while a session stepped, for whoever asked it to step: a long `step` or `input` answers with what came and went
 * and changed, frame by frame, instead of only how it ended. `Session` keeps one and hands it out with `takeLog`.
 *
 * - **Events**, found by comparing each step with the one before: a component came (`+Enemy[key=9]`) or went (`-Enemy[key=5]`),
 *   a value of the game state changed (`useGame.lives 20→19`), a text appeared on screen (`"GAME OVER"`). What happens often in
 *   one answer (a shot every few steps, a score that counts up) is counted rather than listed, so the rare things stand out.
 * - **Sounds**, counted by name.
 * - **Watched values** (`watch("Play.s.lives")`): every change, with its frame.
 */
import { isComponent, Text, type GameObject } from "@tsengine/runtime";

/** What happened since the log was last taken. */
export interface SessionLogEntry {
  /** One line a frame with events, in order: `frame 905: -Enemy[key=5]  useGame.lives 20→19  "19"`. */
  readonly events: readonly string[];
  /** What happened too often to list, counted: `+Shot ×54`, `useGame.gold changed 12 times (last 99)`. */
  readonly often?: readonly string[];
  /** Sounds played, by name, with how many times. */
  readonly sounds?: Readonly<Record<string, number>>;
  /** Each watched value's changes: `[frame, value]`, the first being its value when the log was last taken. */
  readonly watched?: Readonly<Record<string, readonly (readonly [number, unknown])[]>>;
}

/** What the log reads from the game after a step. */
export interface LogContext {
  readonly root: GameObject | null;
  readonly gameState: Record<string, Record<string, unknown>>;
  readonly plays: readonly string[];
  /** A watched path's value now (`undefined` when there is no such thing). */
  readonly resolve: (path: string) => unknown;
}

interface RawEvent {
  readonly frame: number;
  /** What it is counted by when it happens often: `+Enemy`, `useGame.gold`, `text Gold #`. */
  readonly group: string;
  readonly text: string;
}

/** Events of a group happening more than this often in one answer are counted, not listed. */
const OFTEN = 5;
/** The most frames listed in one answer. */
const MAX_LINES = 80;
/** The most changes kept for a watched value in one answer. */
const MAX_CHANGES = 60;

/** The leaves of a value (numbers, strings, booleans, null) by dotted path, lists and objects walked three deep. */
function leaves(value: unknown, prefix: string, into: Map<string, string>, depth = 0): void {
  if (value === null || typeof value !== "object") {
    into.set(prefix, JSON.stringify(value) ?? "undefined");
    return;
  }
  if (depth >= 3 || (Array.isArray(value) && value.length > 32)) {
    into.set(prefix, Array.isArray(value) ? `[${value.length} items]` : "{…}");
    return;
  }
  for (const [k, v] of Object.entries(value)) leaves(v, prefix === "" ? k : `${prefix}.${k}`, into, depth + 1);
}

/** A component's name for the log: its class, with its list key. */
function nameOf(object: GameObject): string {
  return object.hotKey !== undefined ? `${object.constructor.name}[key=${String(object.hotKey)}]` : object.constructor.name;
}

export class SessionLog {
  #components = new Map<GameObject, string>();
  #state = new Map<string, string>();
  #texts = new Set<string>();
  #playsSeen = 0;
  #raw: RawEvent[] = [];
  #sounds = new Map<string, number>();
  readonly #watches = new Map<string, { last: string; changes: [number, unknown][]; dropped: number }>();

  /** Follow a value (`Play.s.lives`, `useGame.wave`, `Hero.s.x`): `takeLog` gives every change to it, with its frame. */
  watch(path: string, now: unknown, frame: number): void {
    this.#watches.set(path, { last: JSON.stringify(now) ?? "undefined", changes: [[frame, now]], dropped: 0 });
  }

  unwatch(path: string): boolean {
    return this.#watches.delete(path);
  }

  get watching(): readonly string[] {
    return [...this.#watches.keys()];
  }

  /** Take the game as it is now as the start, with no events: after the game starts, a restore or a reset. */
  baseline(context: LogContext): void {
    const { components, texts } = this.#walk(context.root);
    this.#components = components;
    this.#texts = texts;
    this.#state = new Map();
    for (const [name, values] of Object.entries(context.gameState)) leaves(values, name, this.#state);
    this.#playsSeen = context.plays.length;
    for (const [path, watch] of this.#watches) {
      const now = context.resolve(path);
      watch.last = JSON.stringify(now) ?? "undefined";
    }
  }

  #walk(root: GameObject | null): { components: Map<GameObject, string>; texts: Set<string> } {
    const components = new Map<GameObject, string>();
    const texts = new Set<string>();
    const visit = (object: GameObject): void => {
      if (object !== root && isComponent(object)) components.set(object, nameOf(object));
      if (object instanceof Text && object.text !== "") texts.add(object.text);
      for (const child of object.children) visit(child);
    };
    if (root !== null) visit(root);
    return { components, texts };
  }

  /** Compare the game after step `frame` with the step before, and note what changed. */
  record(frame: number, context: LogContext): void {
    const { components, texts } = this.#walk(context.root);
    for (const [object, name] of components)
      if (!this.#components.has(object)) this.#raw.push({ frame, group: `+${object.constructor.name}`, text: `+${name}` });
    for (const [object, name] of this.#components)
      if (!components.has(object)) this.#raw.push({ frame, group: `-${object.constructor.name}`, text: `-${name}` });
    this.#components = components;

    const state = new Map<string, string>();
    for (const [name, values] of Object.entries(context.gameState)) leaves(values, name, state);
    for (const [path, value] of state) {
      const before = this.#state.get(path);
      if (before !== value) this.#raw.push({ frame, group: path, text: `${path} ${before ?? "(none)"}→${value}` });
    }
    this.#state = state;

    for (const text of texts)
      if (!this.#texts.has(text)) this.#raw.push({ frame, group: `text ${text.replace(/\d+/g, "#")}`, text: JSON.stringify(text) });
    this.#texts = texts;

    for (let i = this.#playsSeen; i < context.plays.length; i++) {
      const sound = context.plays[i] as string;
      this.#sounds.set(sound, (this.#sounds.get(sound) ?? 0) + 1);
    }
    this.#playsSeen = context.plays.length;

    for (const [path, watch] of this.#watches) {
      const now = context.resolve(path);
      const text = JSON.stringify(now) ?? "undefined";
      if (text === watch.last) continue;
      watch.last = text;
      if (watch.changes.length < MAX_CHANGES) watch.changes.push([frame, now]);
      else {
        watch.dropped++;
        watch.changes[watch.changes.length - 1] = [frame, now];
      }
    }
  }

  /** What happened since the last take (null when nothing did), and start again. */
  take(): SessionLogEntry | null {
    const counts = new Map<string, number>();
    for (const event of this.#raw) counts.set(event.group, (counts.get(event.group) ?? 0) + 1);
    const byFrame = new Map<number, string[]>();
    const often: string[] = [];
    const lastOf = new Map<string, RawEvent>();
    for (const event of this.#raw) {
      if ((counts.get(event.group) ?? 0) > OFTEN) {
        lastOf.set(event.group, event);
        continue;
      }
      let line = byFrame.get(event.frame);
      if (line === undefined) byFrame.set(event.frame, (line = []));
      line.push(event.text);
    }
    for (const [group, count] of counts) {
      if (count <= OFTEN) continue;
      const last = lastOf.get(group) as RawEvent;
      if (group.startsWith("+") || group.startsWith("-")) often.push(`${group} ×${count}`);
      else if (group.startsWith("text ")) often.push(`${count} new texts like ${last.text} (last at frame ${last.frame})`);
      else often.push(`${group} changed ${count} times (last ${last.text.slice(last.text.lastIndexOf("→") + 1)} at frame ${last.frame})`);
    }
    const frames = [...byFrame];
    const events = frames.slice(0, MAX_LINES).map(([frame, texts]) => `frame ${frame}: ${texts.join("  ")}`);
    if (frames.length > MAX_LINES)
      events.push(`… ${frames.length - MAX_LINES} more frames with events (step in shorter runs, or watch a value)`);

    const watched: Record<string, (readonly [number, unknown])[]> = {};
    let anyWatched = false;
    for (const [path, watch] of this.#watches) {
      if (watch.changes.length > 1) {
        watched[path] =
          watch.dropped > 0
            ? [...watch.changes.slice(0, -1), [-watch.dropped, "changes not listed"], watch.changes.at(-1)!]
            : watch.changes;
        anyWatched = true;
      }
      // The next answer starts from the value now.
      watch.changes = [[watch.changes.at(-1)![0], JSON.parse(watch.last === "undefined" ? "null" : watch.last) as unknown]];
      watch.dropped = 0;
    }
    const sounds = Object.fromEntries(this.#sounds);
    this.#raw = [];
    this.#sounds = new Map();
    if (events.length === 0 && often.length === 0 && Object.keys(sounds).length === 0 && !anyWatched) return null;
    return {
      events,
      ...(often.length > 0 ? { often } : {}),
      ...(Object.keys(sounds).length > 0 ? { sounds } : {}),
      ...(anyWatched ? { watched } : {}),
    };
  }
}
