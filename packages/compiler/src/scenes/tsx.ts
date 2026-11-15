/**
 * Tiled's XML tileset (`.tsx`, not to be confused with TypeScript's) → the same shape as a JSON tileset (`.tsj`), so the tilemap
 * importer reads either one way. A small reader that knows only the elements a tileset uses: `tileset`, `image`, `tile`,
 * `properties` and `property`; everything else (`grid`, `tileoffset`, `wangsets`, animations, text) is skipped. Not a general XML
 * parser: no DTDs, and entities are only the five predefined ones and numeric ones.
 */

/** A tileset as `importTilemap` reads it: the fields of Tiled's JSON format that matter to it. */
export interface TilesetJson {
  readonly name?: string;
  readonly tilewidth?: number;
  readonly tileheight?: number;
  readonly columns?: number;
  readonly tilecount?: number;
  readonly margin?: number;
  readonly spacing?: number;
  readonly image?: string;
  readonly imagewidth?: number;
  readonly imageheight?: number;
  readonly tiles?: { id: number; image?: string; properties?: { name: string; type: string; value: string | number | boolean }[] }[];
}

interface Tag {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly kind: "open" | "close" | "empty";
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescape(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#")
      return String.fromCodePoint(ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? whole;
  });
}

/** The tags of a document, in order, without text, comments, processing instructions or declarations. Throws on a malformed tag. */
function tags(xml: string): Tag[] {
  const out: Tag[] = [];
  let i = 0;
  while (true) {
    const start = xml.indexOf("<", i);
    if (start < 0) return out;
    if (xml.startsWith("<!--", start)) {
      const end = xml.indexOf("-->", start + 4);
      if (end < 0) throw new Error("a comment is not closed");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      const end = xml.indexOf("]]>", start);
      if (end < 0) throw new Error("a CDATA section is not closed");
      i = end + 3;
      continue;
    }
    if (xml[start + 1] === "?" || xml[start + 1] === "!") {
      const end = xml.indexOf(">", start);
      if (end < 0) throw new Error("a declaration is not closed");
      i = end + 1;
      continue;
    }
    // Find the tag's end, stepping over quoted attribute values (which may hold '>').
    let j = start + 1;
    let quote = "";
    for (; j < xml.length; j++) {
      const ch = xml[j]!;
      if (quote !== "") {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    if (j >= xml.length) throw new Error("a tag is not closed");
    let body = xml.slice(start + 1, j).trim();
    i = j + 1;
    if (body.startsWith("/")) {
      out.push({ name: body.slice(1).trim(), attrs: {}, kind: "close" });
      continue;
    }
    const empty = body.endsWith("/");
    if (empty) body = body.slice(0, -1);
    const nameMatch = /^[^\s/>]+/.exec(body);
    if (nameMatch === null) throw new Error("a tag has no name");
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    const rest = body.slice(nameMatch[0].length);
    for (let m = attrRe.exec(rest); m !== null; m = attrRe.exec(rest)) attrs[m[1]!] = unescape(m[2] ?? m[3] ?? "");
    out.push({ name: nameMatch[0], attrs, kind: empty ? "empty" : "open" });
  }
}

const int = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** A property's value in the type Tiled saved it as: `bool`, `int` and `float` as booleans and numbers, everything else as text. */
function propertyValue(type: string, value: string): string | number | boolean {
  if (type === "bool") return value === "true";
  if (type === "int" || type === "float") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

/** Read a `.tsx` tileset. Throws, with a short reason, when the text is not a tileset this reader understands. */
export function readTsx(xml: string): TilesetJson {
  const list = tags(xml);
  const root = list.find((t) => t.kind !== "close");
  if (root === undefined || root.name !== "tileset") throw new Error("it is not a Tiled tileset (no <tileset> element)");
  const out: {
    -readonly [K in keyof TilesetJson]: TilesetJson[K];
  } = {};
  const a = root.attrs;
  if (a["name"] !== undefined) out.name = a["name"];
  for (const [key, field] of [
    ["tilewidth", "tilewidth"],
    ["tileheight", "tileheight"],
    ["columns", "columns"],
    ["tilecount", "tilecount"],
    ["margin", "margin"],
    ["spacing", "spacing"],
  ] as const) {
    const n = int(a[key]);
    if (n !== undefined) out[field] = n;
  }
  const tiles: NonNullable<TilesetJson["tiles"]> = [];
  // Where we are: inside the tileset (depth 1), a tile, its properties. Elements we do not know are skipped with their children.
  let tile: (typeof tiles)[number] | null = null;
  let skip = 0;
  let inProperties = false;
  for (let k = list.indexOf(root) + 1; k < list.length; k++) {
    const t = list[k]!;
    if (skip > 0) {
      if (t.kind === "open") skip++;
      else if (t.kind === "close") skip--;
      continue;
    }
    if (t.kind === "close") {
      if (t.name === "tile") tile = null;
      else if (t.name === "properties") inProperties = false;
      else if (t.name === "tileset") break;
      continue;
    }
    if (t.name === "image") {
      // The tileset's sheet, or (inside a <tile>) one image of a collection of images.
      if (tile !== null) {
        if (t.attrs["source"] !== undefined) tile.image = t.attrs["source"];
      } else {
        if (t.attrs["source"] !== undefined) out.image = t.attrs["source"];
        const w = int(t.attrs["width"]);
        const h = int(t.attrs["height"]);
        if (w !== undefined) out.imagewidth = w;
        if (h !== undefined) out.imageheight = h;
      }
      if (t.kind === "open") skip = 1; // <image> may hold <data>, which we do not read
    } else if (t.name === "tile" && tile === null) {
      const id = int(t.attrs["id"]);
      if (id === undefined) throw new Error("a <tile> has no id");
      tile = { id };
      tiles.push(tile);
      if (t.kind === "empty") tile = null;
    } else if (t.name === "properties" && tile !== null) {
      if (t.kind === "open") inProperties = true;
    } else if (t.name === "property" && inProperties && tile !== null) {
      const name = t.attrs["name"];
      if (name !== undefined) {
        const type = t.attrs["type"] ?? "string";
        (tile.properties ??= []).push({ name, type, value: propertyValue(type, t.attrs["value"] ?? "") });
      }
      // A multi-line string keeps its value as the element's text, which we do not read; a class property holds <properties>.
      if (t.kind === "open") skip = 1;
    } else if (t.kind === "open") skip = 1;
  }
  if (tiles.length > 0) out.tiles = tiles;
  return out;
}
