/**
 * The development inspector (REACT_FEEL_PLAN.md C4): a local web page that `rge dev` serves while the game runs, showing the tree
 * by component (as React DevTools does), the selected component's props, state, refs, game-state subscriptions and renders, and
 * each game state with the last actions and what they changed (as Redux DevTools does). A state value or a game-state leaf can be
 * edited from it; an edit is development-only (it is not input, so a replay does not repeat it) and is said so in the log.
 *
 * The page gets what it shows as server-sent events and sends a selection or an edit as a POST: a browser is better than the
 * game window at trees, scrolling and text fields, and the game window stays free of debugging UI. It only reads the game, apart
 * from those edits; it reads the tree's shape and the selected component a few times a second, not every object every frame.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Rewind } from "@rge/player";
import { asData, editState, inspectObject, inspectTree, inspectedObject, type GameObject, type GameStore } from "@rge/runtime";

export interface InspectorOptions {
  /** The game's current root (it changes on a hot reload). */
  readonly root: () => GameObject | null;
  /** The game's states, by `file#export`. */
  readonly stores: () => ReadonlyMap<string, GameStore<unknown>>;
  /** The port to serve on: 0 (the default) takes a free one. */
  readonly port?: number;
  readonly log?: (message: string) => void;
  /** The dev loop's rewind, whose timeline the page shows and drives. */
  readonly rewind?: Rewind | null;
}

export interface Inspector {
  /** The page's address. */
  readonly url: string;
  /** Called once a frame by the dev loop: sends what changed to open pages, a few times a second. */
  update(): void;
  close(): Promise<void>;
}

/** Steps between two sends: 6 a second at 60 frames a second. */
const EVERY = 10;

export function startInspector(options: InspectorOptions): Promise<Inspector> {
  const log = options.log ?? ((message: string) => console.log(message));
  const clients = new Set<ServerResponse>();
  let selected: number | null = null;
  let frame = 0;
  const last = { tree: "", object: "", stores: "", rewind: "" };

  const send = (res: ServerResponse, event: string, data: string): void => {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  };
  const broadcast = (event: string, data: string, key: keyof typeof last): void => {
    if (last[key] === data) return;
    last[key] = data;
    for (const res of clients) send(res, event, data);
  };

  const storeName = (key: string): string => {
    const [file = key, name = ""] = key.split("#");
    return `${file.slice(file.lastIndexOf("/") + 1)} ${name}`;
  };

  const snapshot = (force = false): void => {
    if (force) last.tree = last.object = last.stores = last.rewind = "";
    const rewind = options.rewind;
    if (rewind) broadcast("rewind", JSON.stringify({ paused: rewind.paused, ...rewind.range, snapshots: rewind.snapshotFrames, divergence: rewind.divergence }), "rewind");
    const root = options.root();
    broadcast("tree", JSON.stringify(root === null ? null : inspectTree(root)), "tree");
    const object = selected === null ? null : inspectedObject(selected);
    broadcast("object", JSON.stringify(object === null ? null : inspectObject(object)), "object");
    const stores = [...options.stores()].map(([key, store]) => {
      const state = Object.fromEntries(Object.entries(store.getState() as Record<string, unknown>).filter(([, v]) => typeof v !== "function"));
      return { key, name: storeName(key), state: asData(state), history: store.history.slice(-20).map((h) => ({ action: h.action, changes: h.changes.map((c) => ({ path: c.path, before: asData(c.before), after: asData(c.after) })) })) };
    });
    broadcast("stores", JSON.stringify(stores), "stores");
  };

  const body = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((done) => {
      let text = "";
      req.on("data", (chunk: Buffer) => (text += chunk.toString()));
      req.on("end", () => {
        try {
          done(JSON.parse(text) as Record<string, unknown>);
        } catch {
          done({});
        }
      });
    });

  /** Apply an edit from the page. Development only, and said so. */
  const applyEdit = (edit: Record<string, unknown>): string => {
    if (edit["target"] === "state" && typeof edit["id"] === "number" && typeof edit["name"] === "string") {
      const object = inspectedObject(edit["id"]);
      if (object === null) return "that component is gone";
      if (!editState(object, edit["name"], edit["value"])) return `${object.constructor.name} has no state '${edit["name"]}'`;
      log(`inspector: ${object.constructor.name}.${edit["name"]} = ${JSON.stringify(edit["value"])} (an edit from the inspector, not input: a replay does not repeat it)`);
      return "ok";
    }
    if (edit["target"] === "store" && typeof edit["key"] === "string" && typeof edit["path"] === "string") {
      const store = options.stores().get(edit["key"]);
      if (store === undefined) return "no such game state";
      const keys = edit["path"].split(".");
      const state = store.getState() as Record<string, unknown>;
      const setIn = (at: unknown, depth: number): unknown => {
        if (depth === keys.length) return edit["value"];
        const key = keys[depth] as string;
        const object = (typeof at === "object" && at !== null ? at : {}) as Record<string, unknown>;
        return Array.isArray(object) ? object.map((v, i) => (String(i) === key ? setIn(v, depth + 1) : v)) : { ...object, [key]: setIn(object[key], depth + 1) };
      };
      const top = keys[0] as string;
      store.setState({ [top]: setIn(state[top], 1) } as never);
      log(`inspector: ${storeName(edit["key"])} ${edit["path"]} = ${JSON.stringify(edit["value"])} (an edit from the inspector, not input: a replay does not repeat it)`);
      return "ok";
    }
    return "not an edit the inspector knows";
  };

  /** Pause, step, scrub or play on, from the page's timeline. */
  const applyRewind = (data: Record<string, unknown>): string => {
    const rewind = options.rewind;
    if (!rewind) return "rewind is off";
    const action = data["action"];
    if (action === "pause") {
      if (rewind.paused === null) rewind.pause();
    } else if (action === "resume") rewind.resume();
    else if (action === "seek" && typeof data["frame"] === "number") {
      if (rewind.paused === null) rewind.pause();
      rewind.seek(data["frame"]);
    } else return "not a rewind action";
    return "ok";
  };

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
    } else if (req.method === "GET" && url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      clients.add(res);
      for (const store of options.stores().values()) store.recording = true;
      req.on("close", () => clients.delete(res));
      snapshot(true);
    } else if (req.method === "POST" && (url === "/select" || url === "/edit" || url === "/rewind")) {
      void body(req).then((data) => {
        let answer = "ok";
        if (url === "/select") selected = typeof data["id"] === "number" ? data["id"] : null;
        else if (url === "/rewind") answer = applyRewind(data);
        else answer = applyEdit(data);
        res.writeHead(answer === "ok" ? 200 : 400, { "content-type": "text/plain" });
        res.end(answer);
        snapshot(true);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      done({
        url: `http://127.0.0.1:${port}/`,
        update: () => {
          if (clients.size === 0 || ++frame % EVERY !== 0) return;
          for (const store of options.stores().values()) store.recording = true;
          snapshot();
        },
        close: () =>
          new Promise<void>((closed) => {
            for (const res of clients) res.end();
            clients.clear();
            server.close(() => closed());
          }),
      });
    });
  });
}

/** The page: plain HTML and script, no build step. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rge inspector</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f7f8; --fg: #1b1b1f; --dim: #6b6b75; --line: #d9d9de; --accent: #2f6fde; --panel: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16171b; --fg: #e8e8ec; --dim: #9a9aa6; --line: #2c2d33; --accent: #6ea0ff; --panel: #1d1e23; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); color: var(--fg); }
  header { padding: 8px 12px; border-bottom: 1px solid var(--line); display: flex; gap: 12px; align-items: baseline; }
  header b { font-size: 14px; } header span { color: var(--dim); }
  header { flex-wrap: wrap; } #rewind { display: inline-flex; gap: 6px; align-items: center; } #rewind[hidden] { display: none; }
  #rewind input { width: 260px; } button { font: inherit; background: transparent; color: inherit; border: 1px solid var(--line); border-radius: 4px; padding: 1px 8px; cursor: pointer; }
  .diverged { color: #e5534b; }
  main { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(260px, 1.2fr) minmax(260px, 1.2fr); gap: 1px; background: var(--line); height: calc(100vh - 44px); }
  @media (max-width: 800px) { main { grid-template-columns: 1fr; height: auto; } }
  section { background: var(--panel); overflow: auto; padding: 8px 12px; min-width: 0; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); margin: 6px 0; }
  ul { list-style: none; margin: 0; padding-left: 14px; } section > ul { padding-left: 0; }
  li > div { cursor: pointer; padding: 1px 4px; border-radius: 3px; white-space: nowrap; }
  li > div:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  li > div.on { background: var(--accent); color: #fff; }
  .builtin { color: var(--dim); } .key { color: var(--dim); }
  table { border-collapse: collapse; width: 100%; } td { padding: 2px 4px; vertical-align: top; border-bottom: 1px solid var(--line); word-break: break-word; }
  td:first-child { color: var(--dim); width: 38%; }
  input { font: inherit; width: 100%; background: transparent; color: inherit; border: 1px solid transparent; border-radius: 3px; padding: 1px 3px; }
  input:hover, input:focus { border-color: var(--line); outline: none; }
  .change { color: var(--dim); } .action { color: var(--accent); }
  .empty { color: var(--dim); font-style: italic; }
</style>
</head>
<body>
<header><b>rge inspector</b><span id="status">connecting…</span><span>edits here are development-only</span>
  <span id="rewind" hidden>
    <button id="rw-pause" title="Pause (F2 in the window)">pause</button>
    <button id="rw-back" title="One frame back">◀</button>
    <input id="rw-at" type="range" min="0" max="0" value="0" aria-label="Frame">
    <button id="rw-next" title="One frame on">▶</button>
    <button id="rw-play" title="Play on from here (the recorded future is dropped)">play</button>
    <span id="rw-label"></span>
  </span>
</header>
<main>
  <section><h2>Tree</h2><ul id="tree"><li class="empty">waiting for the game</li></ul></section>
  <section><h2>Selected</h2><div id="object"><p class="empty">Select a component in the tree.</p></div></section>
  <section><h2>Game state</h2><div id="stores"></div></section>
</main>
<script>
let selected = null;
let showBuiltins = false;
const post = (path, data) => fetch(path, { method: "POST", body: JSON.stringify(data) });
const text = (s) => document.createTextNode(String(s));
const el = (tag, cls, ...children) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const c of children) e.append(c); return e; };
const show = (v) => typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);

function renderTree(node) {
  const ul = document.getElementById("tree");
  ul.replaceChildren();
  if (!node) { ul.append(el("li", "empty", text("no game"))); return; }
  ul.append(item(node));
}
function item(node) {
  const li = el("li");
  const label = el("div", (node.component ? "" : "builtin") + (node.id === selected ? " on" : ""), text(node.name));
  if (node.key !== undefined) label.append(el("span", "key", text(" key=" + node.key)));
  label.onclick = (e) => { e.stopPropagation(); selected = node.id; post("/select", { id: node.id }); };
  li.append(label);
  const kids = node.children.filter((c) => c.component || showBuiltins || hasComponent(c));
  if (kids.length) { const ul = el("ul"); for (const c of kids) ul.append(item(c)); li.append(ul); }
  return li;
}
function hasComponent(n) { return n.component || n.children.some(hasComponent); }

function editor(value, commit) {
  const input = el("input");
  input.value = show(value);
  input.onchange = () => { try { commit(JSON.parse(input.value)); } catch { input.value = show(value); } };
  return input;
}
function rows(obj, edit) {
  const table = el("table");
  const keys = Object.keys(obj || {});
  if (!keys.length) table.append(el("tr", "", el("td", "empty", text("none"))));
  for (const k of keys) table.append(el("tr", "", el("td", "", text(k)), el("td", "", edit ? editor(obj[k], (v) => edit(k, v)) : text(show(obj[k])))));
  return table;
}
function renderObject(o) {
  const at = document.getElementById("object");
  at.replaceChildren();
  if (!o) { at.append(el("p", "empty", text("Select a component in the tree."))); return; }
  at.append(el("p", "", el("b", "", text(o.name)), text("  rendered " + o.renders + " times")));
  at.append(el("h2", "", text("State and refs")), rows(o.state, (name, value) => post("/edit", { target: "state", id: o.id, name, value })));
  at.append(el("h2", "", text("Props")), rows(o.props));
  at.append(el("h2", "", text("Reads from the game state")), el("p", o.subscriptions.length ? "" : "empty", text(o.subscriptions.join(", ") || "nothing")));
}
function leaves(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, path, out); else out[path] = v;
  }
  return out;
}
function renderStores(stores) {
  const at = document.getElementById("stores");
  at.replaceChildren();
  if (!stores.length) { at.append(el("p", "empty", text("no game state"))); return; }
  for (const s of stores) {
    at.append(el("h2", "", text(s.name)), rows(leaves(s.state, "", {}), (path, value) => post("/edit", { target: "store", key: s.key, path, value })));
    at.append(el("h2", "", text("Last actions")));
    const list = el("ul");
    for (const h of s.history.slice().reverse()) {
      const li = el("li", "", el("span", "action", text(h.action)));
      for (const c of h.changes) li.append(el("div", "change", text(c.path + ": " + show(c.before) + " → " + show(c.after))));
      list.append(li);
    }
    if (!s.history.length) list.append(el("li", "empty", text("none yet")));
    at.append(list);
  }
}
const events = new EventSource("/events");
events.onopen = () => (document.getElementById("status").textContent = "connected");
events.onerror = () => (document.getElementById("status").textContent = "disconnected: is rge dev still running?");
events.addEventListener("tree", (e) => renderTree(JSON.parse(e.data)));
events.addEventListener("object", (e) => renderObject(JSON.parse(e.data)));
events.addEventListener("stores", (e) => renderStores(JSON.parse(e.data)));
let rewindAt = 0;
events.addEventListener("rewind", (e) => {
  const r = JSON.parse(e.data);
  const bar = document.getElementById("rewind");
  bar.hidden = false;
  const at = r.paused ?? r.to;
  rewindAt = at;
  const range = document.getElementById("rw-at");
  range.min = String(r.from); range.max = String(r.to); range.value = String(at);
  const label = document.getElementById("rw-label");
  label.textContent = (r.paused === null ? "playing, frame " : "paused at frame ") + at + " of " + r.from + "–" + r.to + (r.divergence !== null ? "  (plays differently from frame " + r.divergence + ")" : "");
  label.className = r.divergence !== null ? "diverged" : "";
});
document.getElementById("rw-pause").onclick = () => post("/rewind", { action: "pause" });
document.getElementById("rw-play").onclick = () => post("/rewind", { action: "resume" });
document.getElementById("rw-back").onclick = () => post("/rewind", { action: "seek", frame: rewindAt - 1 });
document.getElementById("rw-next").onclick = () => post("/rewind", { action: "seek", frame: rewindAt + 1 });
document.getElementById("rw-at").onchange = (e) => post("/rewind", { action: "seek", frame: Number(e.target.value) });
</script>
</body>
</html>
`;
