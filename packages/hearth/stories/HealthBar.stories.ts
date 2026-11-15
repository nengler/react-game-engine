import { stories } from "@tsengine/player";

import { HealthBar } from "../generated/HealthBar.ts";

/** The bar over a hurt enemy, drawn around the enemy's middle (its origin). */
export default stories(HealthBar, { size: [16, 6], origin: [8, 12] });

export const Full = { hp: 10, maxHp: 10 };
export const Hurt = { hp: 3, maxHp: 10 };
export const Dead = { hp: 0, maxHp: 10 };
