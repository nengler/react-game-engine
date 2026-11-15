import { registerTilemaps } from "@rge/runtime";

import { tilemaps } from "../generated/tilemaps.ts";

/** The Tiled maps in `scenes/`, made known by name for `<Tilemap map="…">`. Imported once, by `Main.tsx`. */
registerTilemaps(tilemaps);
