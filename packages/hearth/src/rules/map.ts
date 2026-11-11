import { getTilemap } from "@rge/runtime";
// The generated table registers its maps as it loads.
import "../../generated/tilemaps.ts";
import { readMap } from "./path.ts";


/** The one map: the path the enemies walk and the pads towers go on, read from `scenes/field.tmj`'s Markers layer. */
export const MAP = readMap(getTilemap("field"));

/** Where the path ends. */
export const HEARTH = MAP.path.points[MAP.path.points.length - 1] ?? { x: 0, y: 0 };
