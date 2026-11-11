/**
 * Runs the ten waves through the rules only (no engine) against a few fixed build orders and prints the lives left after each
 * wave. `test/balance.test.ts` checks the table against `test/balance.expected.json`, so a change to a number in the rules shows
 * up as a change in difficulty. `--write` updates the expected table after a change you meant to make.
 *
 *   node packages/hearth/tools/balance.ts [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newBattle, stepBattle, type Battle, type Command } from "../src/rules/battle.ts";
import { STEP } from "../src/rules/constants.ts";
import { MAP } from "../src/rules/map.ts";
import { pathAt } from "../src/rules/path.ts";
import { TOWERS, upgradeCost, type TowerKind } from "../src/rules/towers.ts";
import { WAVES } from "../src/rules/waves.ts";

/** How many pixels of the path a pad's tower of this kind could reach: where a sensible player builds first. */
function coverage(pad: number, kind: TowerKind): number {
  const p = MAP.pads[pad]!;
  let n = 0;
  for (let d = 0; d <= MAP.path.length; d += 2) {
    const at = pathAt(MAP.path, d);
    if (Math.hypot(at.x - p.x, at.y - p.y) <= TOWERS[kind].range) n += 2;
  }
  return n;
}

export const BEST = [...MAP.pads].map((p) => p.id).sort((a, b) => coverage(b, "bolt") - coverage(a, "bolt") || a - b);

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

/** The lives left after each wave is cleared; a wave that ends the battle shows as 0 and later waves as null. */
export function runOrder(order: Order): (number | null)[] {
  let b: Battle = newBattle(MAP);
  let next = 0;
  let upgradeAt = 0;
  const placed: number[] = [];
  const out: (number | null)[] = [];
  const buyAhead = (): Command[] => {
    const commands: Command[] = [];
    let gold = b.gold;
    while (next < order.steps.length) {
      const s = order.steps[next] as Step;
      if (s === "upgrade") {
        // Upgrade the towers in the order they were built, round and round.
        const pad = placed[upgradeAt % Math.max(1, placed.length)];
        if (pad === undefined) break;
        const t = b.pads[pad]?.tower;
        const cost = t === null || t === undefined ? null : upgradeCost(t.kind, t.level);
        if (cost === null) {
          next += 1;
          upgradeAt += 1;
          continue;
        }
        if (gold < cost) break;
        gold -= cost;
        commands.push({ type: "upgrade", pad });
        upgradeAt += 1;
        next += 1;
      } else {
        const cost = TOWERS[s.build].cost;
        const pad = BEST.find((id) => b.pads[id]?.tower === null && !placed.includes(id));
        if (pad === undefined) {
          next += 1;
          continue;
        }
        if (gold < cost) break;
        gold -= cost;
        placed.push(pad);
        commands.push({ type: "build", pad, kind: s.build });
        next += 1;
        if (commands.length > 0) break; // one purchase a step keeps `b.pads` honest for the next choice
      }
      if (commands.length > 0) break;
    }
    return commands;
  };
  let wave = 0;
  for (let i = 0; i < 60 * 60 * 30 && b.status === "playing"; i++) {
    const commands = buyAhead();
    if (!b.active) commands.push({ type: "startWave" });
    const before = b.wave;
    const wasActive = b.active;
    b = stepBattle(b, STEP, commands, MAP).battle;
    if (wasActive && !b.active && b.status === "playing") out[wave++] = b.lives;
    if (before !== b.wave && b.status !== "playing") break;
  }
  if (b.status === "lost") out[Math.max(0, b.wave - 1)] = 0;
  if (b.status === "won") out[WAVES.length - 1] = b.lives;
  while (out.length < WAVES.length) out.push(null);
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
  for (const [name, row] of Object.entries(t)) console.log(`${name.padEnd(10)}${row.map((v) => (v === null ? "   -" : String(v).padStart(4))).join("")}`);
  if (process.argv.includes("--write")) {
    writeFileSync(expectedPath, `${JSON.stringify(t, null, 2)}\n`);
    console.log(`wrote ${expectedPath}`);
  }
}
