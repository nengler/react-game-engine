import { MAP } from "../src/rules/map.ts";
import { BEST } from "../src/rules/coverage.ts";

/**
 * Input scripts that play the whole game: they click pads to build and upgrade, start the waves and wait them out. The pad
 * positions come from the map, so the replays follow the map if it changes. Commands the player cannot afford are refused by the
 * rules (a denied event), so each round asks for everything still wanted, and what the gold allows is built. At 2× speed
 * (`fast`) a wave of the table's size is over inside a round.
 */
const click = (pad: number): string => `click@${MAP.pads[pad]!.x},${MAP.pads[pad]!.y}`;
const KEYS = { bolt: "one", mortar: "two", frost: "three" } as const;

/** One build: select the pad with a click and buy a tower on it. */
const build = (pad: number, kind: keyof typeof KEYS): string => `${click(pad)}, _, ${KEYS[kind]}, _`;
const upgrade = (pad: number): string => `${click(pad)}, _, upgrade, _`;

function rounds(wanted: readonly string[], waves: number, wait: number, later: readonly string[] = []): string {
  const out: string[] = ["confirm", "_*10", "fast", "_"];
  // Gold comes in during a wave, so ask for the builds again every so often while it plays.
  const chunks = 8;
  for (let w = 0; w < waves; w++) {
    // Towers first; upgrades only once most of the towers are up, as a person would (gold spent on upgrades early buys fewer towers).
    const asked = w >= 4 ? [...wanted, ...later] : wanted;
    out.push(...asked, "wave");
    for (let c = 0; c < chunks; c++) out.push(`_*${Math.round(wait / chunks)}`, ...asked);
  }
  return out.join(", ");
}

const KINDS = ["bolt", "mortar", "frost"] as const;

/** Eighteen towers of the three kinds on the best pads, then upgrades: a good build (the balance table's "mixed"). */
const MIXED = BEST.slice(0, 18).map((pad, i) => build(pad, KINDS[i % 3] as (typeof KINDS)[number]));
const UPGRADES = BEST.slice(0, 18).flatMap((pad) => [upgrade(pad), upgrade(pad)]);

export const REPLAYS = {
  /** A good build wins all ten waves with lives left. */
  good: rounds(MIXED, 10, 1600, UPGRADES),
  /** Three bolt towers lose. */
  thin: rounds(BEST.slice(0, 3).map((pad) => build(pad, "bolt")), 10, 800),
} as const;
