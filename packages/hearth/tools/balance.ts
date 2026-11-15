/**
 * Plays the ten waves against a few fixed build orders and prints the lives left after each wave. The battle is the game's own
 * `Play` component, mounted alone in a headless world (`@rge/testing`, collisions on), and the orders are played by pressing what
 * a player presses: a pad is selected, then the build menu's key, the upgrade key, the wave key. `test/balance.test.ts` checks the table against `test/balance.expected.json`, so a change to a number in the rules shows
 * up as a change in difficulty. `--write` updates the expected table after a change you meant to make.
 *
 *   node packages/hearth/tools/balance.ts [--write]
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "@rge/testing";

import { Play } from "../generated/Play.ts";
import { useGame } from "../src/GameState.ts";
import { controls } from "../src/rules/controls.ts";
import { BEST } from "../src/rules/coverage.ts";
import { TOWERS, upgradeCost, type TowerKind } from "../src/rules/towers.ts";
import { WAVES } from "../src/rules/waves.ts";

type Step = { readonly build: TowerKind } | "upgrade";

/** A build order: what to buy next, in order, as soon as the gold is there (between waves and during them). */
export interface Order {
  readonly name: string;
  readonly steps: readonly Step[];
}

const bolts = (n: number): Step[] => Array.from({ length: n }, () => ({ build: "bolt" as const }));
export const ORDERS: readonly Order[] = [
  { name: "all bolt", steps: [...bolts(18), ...Array.from({ length: 36 }, () => "upgrade" as const)] },
  {
    name: "mixed",
    steps: [
      ...Array.from({ length: 6 }, (_, i): Step => ({ build: (["bolt", "mortar", "frost"] as const)[i % 3] as TowerKind })),
      ...Array.from({ length: 12 }, (_, i): Step => ({ build: (["bolt", "mortar", "frost"] as const)[i % 3] as TowerKind })),
      ...Array.from({ length: 36 }, () => "upgrade" as const),
    ],
  },
  { name: "too few", steps: bolts(3) },
];

const KEY = { bolt: "one", mortar: "two", frost: "three" } as const;

/** The lives left after each wave is cleared; a wave that ends the battle shows as 0 and later waves as null. */
export function runOrder(order: Order, seed = 1): (number | null)[] {
  const t = render(Play, { seed }, { controls, collisions: true });
  useGame.getState().begin();
  const play = t.root;
  const press = (pad: number, key: string): void => {
    useGame.getState().select(pad);
    t.world.flush();
    t.input(key);
  };
  let next = 0;
  let upgradeAt = 0;
  const placed: number[] = [];
  const out: (number | null)[] = [];
  /** The next purchase of the order, when the gold is there: one a step, as a player presses one key at a time. */
  const buyNext = (): boolean => {
    while (next < order.steps.length) {
      const s = order.steps[next] as Step;
      if (s === "upgrade") {
        // Upgrade the towers in the order they were built, round and round.
        const pad = placed[upgradeAt % Math.max(1, placed.length)];
        if (pad === undefined) return false;
        const tower = play.s.towers[pad] ?? null;
        const cost = tower === null ? null : upgradeCost(tower.kind, tower.level);
        if (cost === null) {
          next += 1;
          upgradeAt += 1;
          continue;
        }
        if (play.s.gold < cost) return false;
        press(pad, "upgrade");
        upgradeAt += 1;
        next += 1;
        return true;
      }
      const pad = BEST.find((id) => play.s.towers[id] === null && !placed.includes(id));
      if (pad === undefined) {
        next += 1;
        continue;
      }
      if (play.s.gold < TOWERS[s.build].cost) return false;
      placed.push(pad);
      press(pad, KEY[s.build]);
      next += 1;
      return true;
    }
    return false;
  };
  let wave = 0;
  for (let i = 0; i < 60 * 60 * 30 && useGame.getState().screen === "play"; i++) {
    const wasActive = play.s.active;
    if (buyNext()) {
      // pressed: that was this step
    } else if (!play.s.active) t.input("wave");
    else t.step();
    if (wasActive && !play.s.active && useGame.getState().screen === "play") out[wave++] = play.s.lives;
  }
  const end = useGame.getState();
  if (end.screen === "lost") out[Math.max(0, end.endWave - 1)] = 0;
  if (end.screen === "won") out[WAVES.length - 1] = end.endLives;
  while (out.length < WAVES.length) out.push(null);
  t.unmount();
  return out;
}

export function table(): Record<string, (number | null)[]> {
  return Object.fromEntries(ORDERS.map((o) => [o.name, runOrder(o)]));
}

const expectedPath = join(dirname(fileURLToPath(import.meta.url)), "../test/balance.expected.json");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = table();
  console.log("lives left after each wave (0: lost in that wave, -: not reached)");
  console.log(`${"order".padEnd(10)}${WAVES.map((_, i) => String(i + 1).padStart(4)).join("")}`);
  for (const [name, row] of Object.entries(t))
    console.log(`${name.padEnd(10)}${row.map((v) => (v === null ? "   -" : String(v).padStart(4))).join("")}`);
  if (process.argv.includes("--write")) {
    writeFileSync(expectedPath, `${JSON.stringify(t, null, 2)}\n`);
    console.log(`wrote ${expectedPath}`);
  }
}
