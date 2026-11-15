import { stories } from "@tsengine/player";

import { LevelPips } from "../generated/LevelPips.ts";

/** A tower's level as pips, in the upgrade panel. */
export default stories(LevelPips, { size: [14, 4], origin: [6, -5] });

export const First = { level: 0 };
export const Second = { level: 1 };
export const Top = { level: 2 };
