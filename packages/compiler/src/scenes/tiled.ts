/**
 * Tiled map (`.tmj`) → scene JSON. Object layers only: each object becomes an
 * entity whose prefab is the object's `type` (Tiled 1.9+ saves it as `class`)
 * and whose props are its custom properties. Tile layers are a renderer
 * concern. The result goes through the same validation as a hand-written scene.
 */
import { DiagnosticCode, error, warning, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { SCENE_VERSION } from "./validate.ts";

interface TiledProperty {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly value?: unknown;
}

interface TiledObject {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly type?: unknown;
  readonly class?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly height?: unknown;
  readonly rotation?: unknown;
  readonly gid?: unknown;
  readonly properties?: unknown;
}

interface TiledLayer {
  readonly type?: unknown;
  readonly name?: unknown;
  /** Pixels the layer (and, for a group, everything in it) is shifted by. */
  readonly offsetx?: unknown;
  readonly offsety?: unknown;
  readonly objects?: unknown;
  readonly layers?: unknown;
}

interface SceneEntityData {
  id: string;
  prefab: string;
  props?: Record<string, string | number | boolean>;
  transform: { x: number; y: number; rotation?: number };
}

export interface TiledImport {
  readonly scene: { readonly version: 1; readonly entities: SceneEntityData[] };
  readonly diagnostics: CompilerDiagnostic[];
}

export function importTiled(fileName: string, text: string): TiledImport {
  const diagnostics: CompilerDiagnostic[] = [];
  const entities: SceneEntityData[] = [];
  const at = (message: string): string => `${fileName}: ${message}`;
  const fail = (message: string): void => void diagnostics.push(error(DiagnosticCode.TiledImport, at(message), null));
  const skip = (message: string): void => void diagnostics.push(warning(DiagnosticCode.TiledImport, at(message), null));

  let map: { layers?: unknown };
  try {
    map = JSON.parse(text) as { layers?: unknown };
  } catch (e) {
    fail(`not valid JSON (${e instanceof Error ? e.message : String(e)}). Export the map as JSON (.tmj).`);
    return { scene: { version: SCENE_VERSION, entities }, diagnostics };
  }
  if (map === null || typeof map !== "object" || !Array.isArray(map.layers)) {
    fail("not a Tiled map: expected an object with a `layers` array.");
    return { scene: { version: SCENE_VERSION, entities }, diagnostics };
  }

  // A layer's offset shifts its objects, and a group's shifts everything inside it: Tiled shows them there, so the entity goes there.
  const visit = (layers: readonly TiledLayer[], dx: number, dy: number): void => {
    for (const layer of layers) {
      const x = dx + (typeof layer.offsetx === "number" ? layer.offsetx : 0);
      const y = dy + (typeof layer.offsety === "number" ? layer.offsety : 0);
      if (layer.type === "group" && Array.isArray(layer.layers)) visit(layer.layers as TiledLayer[], x, y); // groups flatten
      else if (layer.type === "objectgroup" && Array.isArray(layer.objects)) {
        const layerName = typeof layer.name === "string" ? layer.name : "layer";
        for (const object of layer.objects as TiledObject[]) importObject(layerName, object, x, y);
      }
    }
  };

  const importObject = (layerName: string, object: TiledObject, dx: number, dy: number): void => {
    const label = `layer '${layerName}', object ${String(object.id)}${typeof object.name === "string" && object.name ? ` ('${object.name}')` : ""}`;
    // `class` is where Tiled 1.9 and later keep what older versions called `type`.
    const prefab = typeof object.class === "string" && object.class !== "" ? object.class : typeof object.type === "string" ? object.type : "";
    if (prefab === "") {
      skip(`${label} has no type, so it is not a prefab and was skipped. Set its Class in Tiled to place a component.`);
      return;
    }
    if (typeof object.id !== "number" || typeof object.x !== "number" || typeof object.y !== "number") {
      fail(`${label} needs a numeric id, x and y.`);
      return;
    }
    const rotation = typeof object.rotation === "number" ? (object.rotation * Math.PI) / 180 : 0; // degrees clockwise → radians
    let x = object.x + dx;
    let y = object.y + dy;
    // A tile object is anchored at its bottom left; an entity's origin is its top left. Move the anchor along the
    // object's own (rotated) up axis, so a rotated tile lands where Tiled shows it.
    if (typeof object.gid === "number" && typeof object.height === "number") {
      x += object.height * Math.sin(rotation);
      y -= object.height * Math.cos(rotation);
    }
    const props: Record<string, string | number | boolean> = {};
    if (Array.isArray(object.properties)) {
      for (const property of object.properties as TiledProperty[]) {
        if (typeof property.name !== "string") continue;
        const value = property.value;
        switch (property.type ?? "string") {
          case "bool": if (typeof value === "boolean") props[property.name] = value; else fail(`${label}: property '${property.name}' is not a boolean.`); break;
          case "int":
          case "float": if (typeof value === "number") props[property.name] = value; else fail(`${label}: property '${property.name}' is not a number.`); break;
          case "string":
          case "file":
          case "color": if (typeof value === "string") props[property.name] = value; else fail(`${label}: property '${property.name}' is not a string.`); break;
          default: fail(`${label}: property '${property.name}' has the type '${String(property.type)}', which a scene cannot hold (use bool, int, float, string, file or color).`);
        }
      }
    }
    const round = (n: number): number => Math.round(n * 1e6) / 1e6; // sin/cos noise
    entities.push({
      id: `${layerName}/${object.id}`,
      prefab,
      ...(Object.keys(props).length > 0 ? { props } : {}),
      transform: { x: round(x), y: round(y), ...(rotation !== 0 ? { rotation: round(rotation) } : {}) },
    });
  };

  visit(map.layers as TiledLayer[], 0, 0);
  return { scene: { version: SCENE_VERSION, entities }, diagnostics };
}
